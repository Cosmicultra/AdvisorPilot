import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { createClient } from "@supabase/supabase-js";
import { extractHoldingsFromFileBuffer } from "@/lib/extract-statement-holdings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const MAX_UPLOADS_PER_TOKEN = 25;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function missingEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function normalizeHoldings(raw: unknown[]) {
  return raw.map((h: any) => ({
    rawName: h.rawName || "Unknown holding",
    suggested: h.suggested || "Needs advisor confirmation",
    confidence: Number(h.confidence || 0),
    assetClass: h.assetClass || "Unknown",
    value: Number(h.value || 0),
    status: Number(h.confidence || 0) >= 75 ? "matched" : "review",
    options:
      Array.isArray(h.options) && h.options.length > 0
        ? h.options
        : [h.suggested || "Needs advisor confirmation", "Manual ticker / CUSIP entry"],
  }));
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
    const file = formData.get("file") as File | null;
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const advisorEmail = String(formData.get("advisorEmail") || "").trim();

    if (!token) {
      return NextResponse.json({ error: "Missing upload link." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Please choose a file to upload." }, { status: 400 });
    }

    const size = file.size ?? 0;
    if (size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File is too large (max 25 MB)." }, { status: 400 });
    }

    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("advisorpilot_upload_tokens")
      .select("id, advisor_owner_email, expires_at, upload_count")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return NextResponse.json({ error: "Invalid or expired upload link." }, { status: 404 });
    }

    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This upload link has expired. Ask your advisor for a new one." }, { status: 410 });
    }

    if (Number(tokenRow.upload_count) >= MAX_UPLOADS_PER_TOKEN) {
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

    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/pdf";

    const extracted = await extractHoldingsFromFileBuffer({
      fileName: file.name || "statement.pdf",
      mimeType,
      bytes,
      clientContext,
    });

    const extractedHoldings = Array.isArray(extracted.holdings) ? extracted.holdings : [];
    if (extractedHoldings.length === 0) {
      return NextResponse.json(
        { error: "No holdings could be read from this file. Try a clearer PDF or photo." },
        { status: 422 }
      );
    }

    const holdings = normalizeHoldings(extractedHoldings);
    const totalValue = holdings.reduce((sum, h) => sum + Number(h.value || 0), 0);

    const client = {
      firstName: firstName || "Client",
      lastName: lastName || "(shared link)",
      dob: "",
      age: "",
      retirementAge: "67",
      riskProfile: "moderate-conservative",
      calibration: "risk-profile",
      goal: "Prepare for retirement income while reducing unnecessary downside risk.",
      advisorEmail,
      magicLinkUpload: true,
    };

    const meetingNotes = `Uploaded by client via advisor magic link (${new Date().toISOString()}). File: ${file.name || "statement"}.`;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("advisorpilot_clients")
      .insert({
        owner_email: ownerEmail,
        client,
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

    const { error: bumpErr } = await supabaseAdmin
      .from("advisorpilot_upload_tokens")
      .update({ upload_count: Number(tokenRow.upload_count) + 1 })
      .eq("id", tokenRow.id);

    if (bumpErr) {
      console.error("MAGIC LINK TOKEN BUMP:", bumpErr);
    }

    return NextResponse.json({
      ok: true,
      message: "Thank you — your advisor will review this shortly.",
      reviewId: inserted?.id,
    });
  } catch (err: any) {
    console.error("CLIENT UPLOAD INGEST:", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed. Try again or use a different file." },
      { status: 500 }
    );
  }
}
