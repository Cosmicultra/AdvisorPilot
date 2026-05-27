import { NextResponse } from "next/server";
import { DEFAULT_NEW_CLIENT_STAGE } from "@/lib/crm/stage";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";
import { writeAuditEvent } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InboundAttachment = {
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath?: string;
};

type InboundEmailPayload = {
  advisorEmail?: string;
  fromEmail?: string;
  subject?: string;
  text?: string;
  attachments?: InboundAttachment[];
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function authorized(req: Request) {
  const configured = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!configured) return false;
  const got = req.headers.get("x-advisorpilot-webhook-secret") || "";
  return got.length > 0 && got === configured;
}

export async function POST(req: Request) {
  try {
    if (missingSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }
    const supabaseAdmin = getSupabaseServiceAdmin()!;
    if (!authorized(req)) {
      return NextResponse.json({ error: "Unauthorized inbound email webhook." }, { status: 401 });
    }

    const body = (await req.json()) as InboundEmailPayload;
    const ownerEmail = normalizeEmail(body.advisorEmail);
    const fromEmail = normalizeEmail(body.fromEmail);
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    if (!ownerEmail) {
      return NextResponse.json({ error: "advisorEmail is required." }, { status: 400 });
    }
    if (attachments.length === 0) {
      return NextResponse.json({ error: "At least one attachment is required." }, { status: 400 });
    }

    const client = {
      firstName: "Inbound",
      lastName: "Email",
      advisorEmail: fromEmail,
      goal: "Review statement received by inbound email.",
      riskProfile: "moderate-conservative",
      calibration: "risk-profile",
      retirementAge: "67",
      inboundEmailUpload: true,
    };

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_clients")
      .insert({
        owner_email: ownerEmail,
        client,
        holdings: [],
        meeting_notes: `Inbound email received. Subject: ${body.subject || "(no subject)"}. Attachments are queued for advisor review/import.`,
        demo_mode: false,
        analysis: null,
        total_value: 0,
        status: "Pending Inbound Import",
        source: "inbound_email",
        stage: DEFAULT_NEW_CLIENT_STAGE,
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await supabaseAdmin.from("advisorpilot_documents").insert(
      attachments.map((attachment, index) => ({
        owner_email: ownerEmail,
        client_id: data.id,
        storage_bucket: "advisorpilot-statements",
        storage_path: attachment.storagePath || `inbound-email/${data.id}/${index + 1}-${attachment.fileName || "attachment"}`,
        original_file_name: attachment.fileName || `attachment-${index + 1}`,
        mime_type: attachment.mimeType || "application/octet-stream",
        file_size_bytes: attachment.sizeBytes || 0,
        source: "inbound_email",
        status: attachment.storagePath ? "queued_for_extraction" : "metadata_only",
        metadata: { fromEmail, subject: body.subject || "" },
      }))
    );

    await writeAuditEvent({
      ownerEmail,
      actorEmail: fromEmail,
      action: "inbound_email.received",
      entityType: "client",
      entityId: data.id,
      metadata: { attachmentCount: attachments.length, subject: body.subject || "" },
    });

    return NextResponse.json({
      ok: true,
      reviewId: data.id,
      message: "Inbound email queued for advisor review.",
    });
  } catch (err: unknown) {
    console.error("INBOUND EMAIL ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Inbound email processing failed." },
      { status: 500 }
    );
  }
}
