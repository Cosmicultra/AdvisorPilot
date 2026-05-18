import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { createClient } from "@supabase/supabase-js";
import { extractHoldingsFromFileBuffer } from "@/lib/extract-statement-holdings";
import { writeAuditEvent } from "@/lib/audit-log";
import { flagLikelyDuplicateHoldings } from "@/lib/holding-merge";
import { applySyntheticCashTickerIfEligible, extractLikelySymbol, validateHoldingLocally } from "@/lib/holding-validation";
import { normalizeRegistrationType } from "@/lib/holding-registration";
import { canonicalizeAssetClass } from "@/lib/asset-classes";
import { deriveHoldingStatus } from "@/lib/holding-status";
import {
  CLIENT_LINK_INTAKE_STEPS,
  normalizeIntakeClient,
  isIntakeComplete,
  intakeIncompleteStepTitles,
} from "@/lib/intake-config";
import { SYNTHETIC_CASH_TICKER } from "@/lib/cash-holding-constants";
import {
  buildCashParkingSyntheticHolding,
  cashParkingTitleMatches,
} from "@/lib/cash-parking-title-heuristics";
import {
  applyMasterResolutionToHolding,
  createSupabaseAdminForSecuritiesMaster,
  resolveFromSecuritiesMaster,
  securitiesMasterFeatureEnabled,
} from "@/lib/securities-master";
import { enforceUploadSize } from "@/lib/llm/attachments";
import { LlmAttachmentError } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const MAX_UPLOADS_PER_TOKEN = 25;

function missingEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function normalizeHoldings(raw: unknown[]) {
  const masterOn = securitiesMasterFeatureEnabled();
  const sb = masterOn ? createSupabaseAdminForSecuritiesMaster() : null;

  const out: Array<Record<string, unknown>> = [];
  for (const holding of raw) {
    const h = holding && typeof holding === "object" ? (holding as Record<string, unknown>) : {};
    const confidence = Number(h.confidence || 0);
    const rawName = String(h.rawName ?? "").trim() || "Unknown holding";
    const suggestedBase = String(h.suggested ?? "").trim() || "Needs advisor confirmation";
    const opts =
      Array.isArray(h.options) && h.options.length > 0
        ? h.options
        : [suggestedBase, "Manual ticker / CUSIP entry"];

    const overlay: Record<string, unknown> = {};
    if (cashParkingTitleMatches(rawName)) {
      const sym = extractLikelySymbol(suggestedBase, rawName);
      const baseRec: Record<string, unknown> = { ...h, rawName, suggested: suggestedBase };
      if (sb && sym && sym !== SYNTHETIC_CASH_TICKER) {
        const hit = await resolveFromSecuritiesMaster(sb, {
          inferredSymbol: sym,
          suggested: suggestedBase,
          rawName,
        });
        if (hit) Object.assign(overlay, applyMasterResolutionToHolding(baseRec, hit));
        else Object.assign(overlay, buildCashParkingSyntheticHolding(baseRec));
      } else {
        Object.assign(overlay, buildCashParkingSyntheticHolding(baseRec));
      }
    }

    const mergedIn = { ...h, ...overlay };
    const confUse = Number(mergedIn.confidence ?? confidence);
    const normalized = applySyntheticCashTickerIfEligible({
      rawName,
      suggested: String(mergedIn.suggested ?? suggestedBase),
      confidence: confUse,
      assetClass: canonicalizeAssetClass(String(mergedIn.assetClass ?? h.assetClass ?? "Unknown")),
      value: Number(mergedIn.value ?? h.value ?? 0),
      status: deriveHoldingStatus(mergedIn.status ?? h.status, confUse),
      options:
        Array.isArray(mergedIn.options) && mergedIn.options.length > 0 ? mergedIn.options : opts,
      registrationType: normalizeRegistrationType(h.registrationType),
    });

    const acct = typeof h.accountNumber === "string" ? h.accountNumber.trim() : "";
    const cbRaw = Number(h.costBasis);
    const costBasis = Number.isFinite(cbRaw) && cbRaw > 0 ? cbRaw : undefined;

    out.push({
      ...mergedIn,
      ...normalized,
      ...validateHoldingLocally(normalized),
      ...(acct ? { accountNumber: acct } : {}),
      ...(costBasis !== undefined ? { costBasis } : {}),
      ...(typeof h.sourceFileName === "string" ? { sourceFileName: h.sourceFileName } : {}),
      ...(typeof h.sourceFileIndex === "number" && Number.isFinite(h.sourceFileIndex)
        ? { sourceFileIndex: h.sourceFileIndex }
        : {}),
    });
  }
  return out;
}

/**
 * Public endpoint: client uploads a statement using a server-minted token.
 * Creates a Draft row on the advisor's client list (same table as manual saves).
 */
export async function POST(request: Request) {
  try {
    if (missingEnv()) {
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }

    const formData = await request.formData();
    const token = String(formData.get("token") || "").trim();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const legacyFile = formData.get("file");
    if (files.length === 0 && legacyFile instanceof File) files.push(legacyFile);

    let filePageHints: string[] = [];
    const hintsRaw = formData.get("filePageHints");
    if (typeof hintsRaw === "string" && hintsRaw.trim()) {
      try {
        const parsed = JSON.parse(hintsRaw) as unknown;
        if (Array.isArray(parsed)) {
          filePageHints = parsed.map((x) => String(x ?? ""));
        }
      } catch {
        filePageHints = [];
      }
    }
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const advisorEmail = String(formData.get("advisorEmail") || "").trim();
    const intakeJsonRaw = formData.get("intakeJson");

    if (!token) {
      return NextResponse.json({ error: "Missing upload link." }, { status: 400 });
    }
    if (files.length === 0) {
      return NextResponse.json({ error: "Please choose at least one file to upload." }, { status: 400 });
    }

    for (const file of files) {
      try {
        enforceUploadSize(file.size ?? 0, file.name);
      } catch (err) {
        if (err instanceof LlmAttachmentError) {
          return NextResponse.json({ error: err.message }, { status: 413 });
        }
        throw err;
      }
    }

    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("advisorpilot_upload_tokens")
      .select("id, advisor_user_id, advisor_owner_email, expires_at, upload_count, max_upload_count, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return NextResponse.json({ error: "Invalid or expired upload link." }, { status: 404 });
    }

    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This upload link has expired. Ask your advisor for a new one." }, { status: 410 });
    }

    if (tokenRow.revoked_at) {
      return NextResponse.json({ error: "This upload link has been revoked. Ask your advisor for a new one." }, { status: 410 });
    }

    const maxUploadCount = Number(tokenRow.max_upload_count || MAX_UPLOADS_PER_TOKEN);
    if (Number(tokenRow.upload_count) >= maxUploadCount) {
      return NextResponse.json(
        { error: "This link has reached its upload limit. Ask your advisor for a new link." },
        { status: 429 }
      );
    }

    const ownerEmail = String(tokenRow.advisor_owner_email || "").trim().toLowerCase();
    if (!ownerEmail) {
      return NextResponse.json({ error: "Invalid link configuration." }, { status: 500 });
    }

    const clientContext = {
      source: "client_magic_link",
      firstName: firstName || undefined,
      lastName: lastName || undefined,
    };

    let clientPayload: Record<string, unknown>;

    if (typeof intakeJsonRaw === "string" && intakeJsonRaw.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(intakeJsonRaw);
      } catch {
        return NextResponse.json(
          { error: "Could not read your profile answers. Refresh the page and try again." },
          { status: 400 }
        );
      }
      const profile = normalizeIntakeClient(parsed);
      const emailFromIntake = String(profile.advisorEmail || "").trim();
      const effectiveAdvisorEmail =
        emailFromIntake || advisorEmail.trim() || "";

      const profileForValidate =
        effectiveAdvisorEmail && !emailFromIntake
          ? { ...profile, advisorEmail: effectiveAdvisorEmail }
          : profile;

      if (!isIntakeComplete(profileForValidate)) {
        return NextResponse.json(
          {
            error: "Please complete every profile section before uploading.",
            missingSteps: intakeIncompleteStepTitles(profileForValidate, CLIENT_LINK_INTAKE_STEPS),
          },
          { status: 400 }
        );
      }

      clientPayload = {
        ...profileForValidate,
        advisorEmail: effectiveAdvisorEmail || profileForValidate.advisorEmail,
        magicLinkUpload: true,
      };
      const fn = profileForValidate.firstName.trim();
      const ln = profileForValidate.lastName.trim();
      if (fn) clientContext.firstName = fn;
      if (ln) clientContext.lastName = ln;
    } else {
      clientPayload = {
        firstName: firstName || "Client",
        lastName: lastName || "(shared link)",
        dob: "",
        age: "",
        retirementAge: "67",
        riskProfile: "moderate-conservative",
        calibration: "risk-profile",
        goal: "Prepare for retirement income while reducing unnecessary downside risk.",
        advisorEmail: advisorEmail,
        magicLinkUpload: true,
      };
    }

    const extractedHoldings: unknown[] = [];
    for (const [index, file] of files.entries()) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || "application/pdf";
      const pageHint = filePageHints[index]?.trim() || "";
      const extracted = await extractHoldingsFromFileBuffer({
        fileName: file.name || `statement-${index + 1}.pdf`,
        mimeType,
        bytes,
        clientContext: {
          ...clientContext,
          sourceFileName: file.name,
          sourceFileIndex: index + 1,
          ...(pageHint ? { holdingsPagesWithPositions: pageHint } : {}),
        },
      });
      const holdingsForFile = Array.isArray(extracted.holdings) ? extracted.holdings : [];
      extractedHoldings.push(
        ...holdingsForFile.map((holding) => ({
          ...holding,
          sourceFileName: file.name || `statement-${index + 1}.pdf`,
          sourceFileIndex: index + 1,
        }))
      );
    }

    if (extractedHoldings.length === 0) {
      return NextResponse.json(
        { error: "No holdings could be read from this file. Try a clearer PDF or photo." },
        { status: 422 }
      );
    }

    const holdings = flagLikelyDuplicateHoldings(await normalizeHoldings(extractedHoldings));
    const totalValue = holdings.reduce((sum, h) => sum + Number(h.value || 0), 0);

    const meetingNotes = `Uploaded by client via advisor magic link (${new Date().toISOString()}). Files: ${files.map((file) => file.name || "statement").join(", ")}.`;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("advisorpilot_clients")
      .insert({
        owner_email: ownerEmail,
        owner_user_id: tokenRow.advisor_user_id || null,
        client: clientPayload,
        holdings,
        meeting_notes: meetingNotes,
        demo_mode: false,
        analysis: null,
        total_value: totalValue,
        status: "Draft",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("MAGIC LINK CLIENT INSERT:", insertErr);
      return NextResponse.json({ error: insertErr.message || "Could not save upload." }, { status: 400 });
    }

    await supabaseAdmin.from("advisorpilot_documents").insert(
      files.map((file, index) => ({
        owner_email: ownerEmail,
        owner_user_id: tokenRow.advisor_user_id || null,
        client_id: inserted.id,
        storage_bucket: "advisorpilot-statements",
        storage_path: `client-link/${inserted.id}/${index + 1}-${file.name || "statement"}`,
        original_file_name: file.name || `statement-${index + 1}`,
        mime_type: file.type || "application/octet-stream",
        file_size_bytes: file.size || 0,
        source: "client_magic_link",
        status: "processed_in_memory",
        metadata: { tokenId: tokenRow.id, storedBytes: false },
      }))
    );

    const { error: bumpErr } = await supabaseAdmin
      .from("advisorpilot_upload_tokens")
      .update({ upload_count: Number(tokenRow.upload_count) + 1, last_used_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    if (bumpErr) {
      console.error("MAGIC LINK TOKEN BUMP:", bumpErr);
    }

    const clientEmailForAudit =
      String((clientPayload.advisorEmail as string | undefined) ?? advisorEmail ?? "").trim() || null;

    await writeAuditEvent({
      ownerEmail,
      ownerUserId: tokenRow.advisor_user_id || null,
      actorEmail: clientEmailForAudit,
      action: "client_upload.ingested",
      entityType: "client",
      entityId: inserted.id,
      metadata: { fileCount: files.length, holdingsCount: holdings.length, tokenId: tokenRow.id },
    });

    return NextResponse.json({
      ok: true,
      message: "Thank you. Your advisor will review this shortly.",
      reviewId: inserted?.id,
    });
  } catch (err: unknown) {
    if (err instanceof LlmAttachmentError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("CLIENT UPLOAD INGEST:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed. Try again or use a different file." },
      { status: 500 }
    );
  }
}

