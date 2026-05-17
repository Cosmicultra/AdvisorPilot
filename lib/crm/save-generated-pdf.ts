/**
 * Persist a generated PDF — upload bytes to Supabase Storage + insert a
 * row into advisorpilot_documents — so the document surfaces in the
 * Documents tab.
 *
 * Best-effort: logs and swallows every failure. Generation routes must
 * never have their PDF download blocked by an archive miss. If the upload
 * or row-insert fails, the PDF still streams back to the user; the
 * Documents tab just doesn't gain a row.
 *
 * Storage layout (reuses the existing advisorpilot-statements bucket per
 * docs/crm/20-technical-specs.md §2.5):
 *
 *   advisorpilot-statements/reports/
 *     {safeOwner}/{clientId or 'unassigned'}/{iso-timestamp}-{filename}.pdf
 *
 * Source values used today:
 *   - 'generated_client_snapshot'  — generate-report mode='client'
 *   - 'generated_advisor_deep_dive' — generate-report mode='advisor'
 *   - 'generated_roth_report'      — future wire-up of generate-roth-report
 *   - 'generated_snapshot_email'   — future wire-up of email-client-snapshot
 */

import { Buffer } from "buffer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REPORTS_BUCKET = "advisorpilot-statements";

let cachedAdmin: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return cachedAdmin;
}

export interface SaveGeneratedPdfInput {
  /** Raw PDF bytes from pdfDoc.save() or equivalent. */
  pdfBytes: Uint8Array;
  /** Display filename (e.g. "Client_Snapshot.pdf"). */
  originalFileName: string;
  /** Email of the advisor who triggered the generation. */
  ownerEmail: string;
  /** Optional Supabase auth user id (email/password users). */
  ownerUserId?: string | null;
  /** Client UUID. When non-UUID or null, document is owner-only. */
  clientId?: string | null;
  /** Distinguishes report types in the Documents tab. */
  source:
    | "generated_client_snapshot"
    | "generated_advisor_deep_dive"
    | "generated_roth_report"
    | "generated_snapshot_email"
    | "generated_report"
    | string;
  /** Free-form metadata persisted on the row (mode, totalValue, etc.). */
  metadata?: Record<string, unknown>;
}

export async function saveGeneratedPdf(input: SaveGeneratedPdfInput): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[crm:save-generated-pdf] Supabase env missing — skipping archive");
    return;
  }

  const safeOwner = safeSlug(input.ownerEmail) || "advisor";
  const validClientId = isUuid(input.clientId ?? "") ? (input.clientId ?? null) : null;
  const clientFolder = validClientId ?? "unassigned";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeFilename = input.originalFileName.replace(/[^A-Za-z0-9._-]+/g, "_");
  const objectPath = `reports/${safeOwner}/${clientFolder}/${timestamp}-${safeFilename}`;

  try {
    const admin = getAdmin();
    const buffer = Buffer.from(input.pdfBytes);

    const { error: uploadErr } = await admin.storage
      .from(REPORTS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadErr) {
      console.error(
        `[crm:save-generated-pdf] storage upload failed (${REPORTS_BUCKET}/${objectPath}): ${uploadErr.message}`
      );
      return;
    }

    const { error: insertErr } = await admin.from("advisorpilot_documents").insert({
      owner_email: input.ownerEmail,
      owner_user_id: input.ownerUserId ?? null,
      client_id: validClientId,
      storage_bucket: REPORTS_BUCKET,
      storage_path: objectPath,
      original_file_name: input.originalFileName,
      mime_type: "application/pdf",
      file_size_bytes: input.pdfBytes.length,
      source: input.source,
      status: "complete",
      metadata: input.metadata ?? {},
    });

    if (insertErr) {
      console.error(
        `[crm:save-generated-pdf] document row insert failed: ${insertErr.message}`
      );
      return;
    }

    console.info(
      `[crm:save-generated-pdf] archived ${input.source} (${input.pdfBytes.length} bytes) for ${input.ownerEmail}` +
        (validClientId ? ` client=${validClientId.slice(0, 8)}` : "")
    );
  } catch (err) {
    console.error("[crm:save-generated-pdf] threw", err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function safeSlug(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
