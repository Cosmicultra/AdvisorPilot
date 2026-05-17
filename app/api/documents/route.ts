import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { toDocument, type DocumentRow } from "@/lib/crm/document-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { Document, DocumentWithUrls } from "@/lib/crm/types";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * GET /api/documents?clientId=&source=&includeStatements=&limit=&offset=
 *
 * Returns documents in advisorpilot_documents the viewer can see.
 *
 * - When clientId is set, filter to that client AND verify the viewer can
 *   see the client (via clients_visible_to). Returns 404 for not-visible.
 * - When clientId is NOT set, returns documents where owner_email = viewer
 *   (no shared-document model in v1; documents stay per-advisor).
 *
 * **Default filter — statement uploads are EXCLUDED.**
 *
 * Statement PDFs (`source: 'advisor_upload'` and `source: 'client_upload'`)
 * are personal financial documents the advisor receives, runs through AI
 * for extraction, and DISCARDS for compliance reasons. They live in
 * advisorpilot_documents transiently while extraction runs but should
 * never surface in the Documents tab — that's reserved for documents the
 * system generates (reports, meeting prep PDFs, client snapshots, etc.).
 *
 * To see the raw set including statements, pass `includeStatements=true`.
 *
 * Filter params:
 *   - source:            exact-match a source string (overrides the default exclusion)
 *   - includeStatements: 'true' to include 'advisor_upload' + 'client_upload' rows
 *   - limit:             max rows (default 50, max 200)
 *   - offset:            pagination
 *
 * Response shape:
 *   { documents: Document[], total: number, hasMore: boolean }
 *
 * Spec: docs/crm/30-backward-compat.md §2.1 (advisorpilot_documents schema).
 * Auth per .cursor/rules/50-authentication.mdc.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = async (req: Request) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json(
        { error: "Sign in to load documents." },
        { status: 401 }
      );
    }

    const params = new URL(req.url).searchParams;

    const clientId = trimOrNull(params.get("clientId"));
    if (clientId !== null && !isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid clientId." }, { status: 400 });
    }

    const sourceFilter = trimOrNull(params.get("source"));
    const includeStatements = params.get("includeStatements") === "true";
    const withSignedUrls = params.get("withSignedUrls") === "true";

    const limit = clamp(numOr(params.get("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT);
    const offset = Math.max(0, numOr(params.get("offset"), 0));

    const supabase = getCrmSupabaseAdmin();

    // If clientId is set, gate via client visibility first.
    if (clientId) {
      const visibleResult = await supabase.rpc("clients_visible_to", {
        viewer_email: identity.email,
        client_id: clientId,
      });
      if (visibleResult.error) {
        console.error(
          "[crm:api] route=/api/documents visibility-rpc-error",
          visibleResult.error
        );
        return NextResponse.json(
          { error: visibleResult.error.message },
          { status: 400 }
        );
      }
      if (visibleResult.data !== true) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }
    }

    let query = supabase
      .from("advisorpilot_documents")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (clientId) {
      query = query.eq("client_id", clientId);
    } else {
      // No clientId — restrict to documents this advisor owns.
      // (Documents aren't part of the org/sharing model in v1.)
      query = query.eq("owner_email", identity.email);
    }

    if (sourceFilter) {
      // Explicit source override — return exactly what was asked for.
      query = query.eq("source", sourceFilter);
    } else if (!includeStatements) {
      // Default: hide ephemeral statement uploads (compliance — see top-of-file
      // doc comment). The Documents tab only shows documents we generate.
      query = query.not("source", "in", "(advisor_upload,client_upload)");
    }

    const startedAt = Date.now();
    const { data, error, count } = await query;
    const fetchMs = Date.now() - startedAt;

    if (error) {
      console.error("[crm:api] route=/api/documents query-error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const documents: Document[] = ((data ?? []) as DocumentRow[]).map(toDocument);
    const total = typeof count === "number" ? count : documents.length;
    const hasMore = offset + documents.length < total;

    // Optionally enrich each document with short-lived signed URLs for inline
    // preview (iframe-loadable) and forced download (uses Supabase storage's
    // `?download=` query). Best-effort per row — a single signing failure
    // returns null for that document's URLs instead of failing the whole
    // request.
    let payload: Document[] | DocumentWithUrls[] = documents;
    if (withSignedUrls && documents.length > 0) {
      const signed = await Promise.all(
        documents.map(async (doc): Promise<DocumentWithUrls> => {
          const [previewUrl, downloadUrl] = await Promise.all([
            signOne(supabase, doc.storageBucket, doc.storagePath, undefined),
            signOne(
              supabase,
              doc.storageBucket,
              doc.storagePath,
              doc.originalFileName || "document.pdf"
            ),
          ]);
          return { ...doc, previewUrl, downloadUrl };
        })
      );
      payload = signed;
    }

    console.info(
      `[crm:api] route=/api/documents status=200 fetchMs=${fetchMs} returned=${documents.length} total=${total}${
        withSignedUrls ? " signed=true" : ""
      }`
    );

    return NextResponse.json({ documents: payload, total, hasMore });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/documents error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load documents." },
      { status: 500 }
    );
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function numOr(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Number(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Sign a single object path. When `downloadFilename` is set, returns a
 *  URL that forces download (Content-Disposition: attachment); otherwise
 *  returns a URL that loads inline. Returns null on failure (logged). */
async function signOne(
  supabase: ReturnType<typeof getCrmSupabaseAdmin>,
  bucket: string,
  path: string,
  downloadFilename?: string
): Promise<string | null> {
  try {
    const options = downloadFilename ? { download: downloadFilename } : undefined;
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, options);
    if (error || !data?.signedUrl) {
      console.warn(
        `[crm:api] route=/api/documents sign-url-failed bucket=${bucket} path=${path}: ${error?.message ?? "unknown"}`
      );
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.warn("[crm:api] route=/api/documents sign-url-threw", err);
    return null;
  }
}
