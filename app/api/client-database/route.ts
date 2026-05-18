import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import {
  clientSaveChangedSections,
  clientSaveUpdateSummary,
  type ClientSaveSnapshot,
} from "@/lib/crm/client-update-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function missingSupabaseEnv() {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

type ClientRecord = {
  id: string;
  updated_at?: string | null;
  created_at?: string | null;
  client?: unknown;
  holdings?: unknown;
  meeting_notes?: string | null;
  demo_mode?: boolean | null;
  analysis?: unknown;
  total_value?: number | string | null;
  status?: string | null;
  last_contacted_at?: string | null;
  roth_worksheet?: unknown | null;
};

type ClientPayload = {
  owner_email: string;
  owner_user_id?: string | null;
  client: unknown;
  holdings: unknown[];
  meeting_notes: string;
  demo_mode: boolean;
  analysis: unknown;
  total_value: number;
  status?: string;
  last_contacted_at?: string;
  roth_worksheet?: unknown | null;
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function isMissingUpdatedRow(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST116") return true;
  const m = String(error.message || "").toLowerCase();
  return m.includes("0 rows") || m.includes("json object requested");
}

function snapshotFromRecord(record: ClientRecord): ClientSaveSnapshot {
  return {
    client: record.client ?? {},
    holdings: Array.isArray(record.holdings) ? record.holdings : [],
    meeting_notes: record.meeting_notes || "",
    demo_mode: Boolean(record.demo_mode),
    analysis: record.analysis ?? null,
    total_value: Number(record.total_value || 0),
    status: record.status || "Analyzed",
    last_contacted_at: record.last_contacted_at || null,
    roth_worksheet: record.roth_worksheet ?? null,
  };
}

function snapshotFromPayload(
  payload: ClientPayload,
  existing: ClientRecord | null,
  body: Record<string, unknown>
): ClientSaveSnapshot {
  const status =
    typeof payload.status === "string"
      ? payload.status
      : existing?.status || "Analyzed";
  const lastContacted =
    typeof body.lastContactedAt === "string" && body.lastContactedAt
      ? String(body.lastContactedAt)
      : existing?.last_contacted_at || null;
  const rothWorksheet = Object.prototype.hasOwnProperty.call(body, "rothWorksheet")
    ? (payload.roth_worksheet ?? null)
    : (existing?.roth_worksheet ?? null);

  return {
    client: payload.client,
    holdings: payload.holdings,
    meeting_notes: payload.meeting_notes,
    demo_mode: payload.demo_mode,
    analysis: payload.analysis,
    total_value: payload.total_value,
    status,
    last_contacted_at: lastContacted,
    roth_worksheet: rothWorksheet,
  };
}

function mapRecord(record: ClientRecord) {
  return {
    id: record.id,
    savedAt: record.updated_at || record.created_at,
    client: record.client || {},
    holdings: Array.isArray(record.holdings) ? record.holdings : [],
    meetingNotes: record.meeting_notes || "",
    demoMode: Boolean(record.demo_mode),
    analysis: record.analysis || null,
    totalValue: Number(record.total_value || 0),
    status: record.status || "Analyzed",
    lastContactedAt: record.last_contacted_at || null,
    rothWorksheet: record.roth_worksheet ?? null,
  };
}

export const GET = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json(
        { error: "Sign in before opening the Client Database." },
        { status: 401 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_clients")
      .select("*")
      .eq("owner_email", identity.email)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      clients: ((data || []) as ClientRecord[]).map(mapRecord),
    });
  } catch (err: unknown) {
    console.error("CLIENT DATABASE GET ERROR:", err);

    return NextResponse.json(
      { error: errorMessage(err, "Failed to load client database.") },
      { status: 500 }
    );
  }
};

export const POST = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json(
        { error: "Sign in before saving a client profile." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const existingId = (typeof body?.id === "string" && body.id) || null;

    let existingRecord: ClientRecord | null = null;
    if (existingId) {
      const { data: existingRow, error: existingErr } = await supabaseAdmin
        .from("advisorpilot_clients")
        .select("*")
        .eq("id", existingId)
        .eq("owner_email", identity.email)
        .maybeSingle();
      if (existingErr) {
        return NextResponse.json({ error: existingErr.message }, { status: 400 });
      }
      if (!existingRow) {
        return NextResponse.json(
          { error: "Saved client not found or access denied." },
          { status: 404 }
        );
      }
      existingRecord = existingRow as ClientRecord;
    }

    const payload: ClientPayload = {
      owner_email: identity.email,
      owner_user_id: identity.userId,
      client: body?.client || {},
      holdings: Array.isArray(body?.holdings) ? body.holdings : [],
      meeting_notes:
        typeof body?.meetingNotes === "string" ? body.meetingNotes : "",
      demo_mode: Boolean(body?.demoMode),
      analysis: body?.analysis || null,
      total_value: Number(body?.totalValue || 0),
    };

    if (Object.prototype.hasOwnProperty.call(body || {}, "rothWorksheet")) {
      payload.roth_worksheet = body?.rothWorksheet ?? null;
    }

    if (typeof body?.status === "string" && body.status.trim()) {
      payload.status = body.status.trim();
    } else if (!existingId) {
      payload.status = "Analyzed";
    }

    if (typeof body?.lastContactedAt === "string" && body.lastContactedAt) {
      payload.last_contacted_at = body.lastContactedAt;
    }

    const result = existingId
      ? await supabaseAdmin
          .from("advisorpilot_clients")
          .update(payload)
          .eq("id", existingId)
          .eq("owner_email", identity.email)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("advisorpilot_clients")
          .insert(payload)
          .select("*")
          .single();

    if (result.error) {
      if (existingId && isMissingUpdatedRow(result.error)) {
        return NextResponse.json(
          { error: "Saved client not found or access denied." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: result.error.message },
        { status: 400 }
      );
    }

    const saved = mapRecord(result.data as ClientRecord);
    const afterSnapshot = snapshotFromPayload(payload, result.data as ClientRecord, body);
    const changedSections = existingRecord
      ? clientSaveChangedSections(snapshotFromRecord(existingRecord), afterSnapshot)
      : [];
    const updateSummary = clientSaveUpdateSummary(changedSections);

    await writeAuditEvent({
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      action: existingId ? "client.updated" : "client.created",
      entityType: "client",
      entityId: saved.id,
      metadata: {
        status: afterSnapshot.status,
        holdingsCount: payload.holdings.length,
        ...(existingId
          ? {
              changedSections,
              summary: updateSummary || undefined,
            }
          : {}),
      },
    });

    return NextResponse.json({
      client: saved,
      message: "Client profile saved.",
    });
  } catch (err: unknown) {
    console.error("CLIENT DATABASE POST ERROR:", err);

    return NextResponse.json(
      { error: errorMessage(err, "Failed to save client profile.") },
      { status: 500 }
    );
  }
};

export const DELETE = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const id = body?.id;
    const identity = await resolveAdvisorIdentity(req);

    if (!identity) {
      return NextResponse.json(
        { error: "Sign in before deleting a client profile." },
        { status: 401 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { error: "Missing id." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("advisorpilot_clients")
      .delete()
      .eq("id", id)
      .eq("owner_email", identity.email);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await writeAuditEvent({
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      action: "client.deleted",
      entityType: "client",
      entityId: String(id),
    });

    return NextResponse.json({
      ok: true,
      message: "Client profile deleted.",
    });
  } catch (err: unknown) {
    console.error("CLIENT DATABASE DELETE ERROR:", err);

    return NextResponse.json(
      { error: errorMessage(err, "Failed to delete client profile.") },
      { status: 500 }
    );
  }
};
