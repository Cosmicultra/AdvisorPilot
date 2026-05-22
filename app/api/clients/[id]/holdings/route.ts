import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_NOTE_WINDOW_DAYS = 30;

/**
 * PATCH /api/clients/[id]/holdings
 *
 * Replaces the holdings JSONB array (e.g. after moving a full account).
 * Recalculates total_value. Same visibility + ownership gates as PATCH /api/clients/[id].
 */
export const PATCH = async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
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
        { error: "Sign in to update holdings." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid client id." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    if (!Array.isArray(body.holdings)) {
      return NextResponse.json(
        { error: "holdings must be an array." },
        { status: 400 }
      );
    }

    const holdings = body.holdings;
    const moveSummary =
      typeof body.moveSummary === "string" && body.moveSummary.trim()
        ? body.moveSummary.trim()
        : null;
    const clearAnalysis = body.clearAnalysis === true;

    const supabase = getCrmSupabaseAdmin();

    const visibleResult = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: id,
    });
    if (visibleResult.error) {
      return NextResponse.json({ error: visibleResult.error.message }, { status: 400 });
    }
    if (visibleResult.data !== true) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const { data: ownerRow, error: ownerErr } = await supabase
      .from("advisorpilot_clients")
      .select("owner_email")
      .eq("id", id)
      .maybeSingle();
    if (ownerErr || !ownerRow) {
      return NextResponse.json(
        { error: ownerErr?.message ?? "Client not found." },
        { status: ownerErr ? 400 : 404 }
      );
    }
    if (String(ownerRow.owner_email).toLowerCase() !== identity.email) {
      return NextResponse.json(
        { error: "Only the client's owner can update holdings." },
        { status: 403 }
      );
    }

    const totalValue = holdings.reduce(
      (sum: number, row: unknown) => sum + (Number((row as { value?: unknown })?.value) || 0),
      0
    );

    const updatePayload: Record<string, unknown> = {
      holdings,
      total_value: totalValue,
    };
    if (clearAnalysis) {
      updatePayload.analysis = null;
      updatePayload.status = "Draft";
    }

    const { error: updateErr } = await supabase
      .from("advisorpilot_clients")
      .update(updatePayload)
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    await writeAuditEvent({
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      action: "client.holdings_updated",
      entityType: "client",
      entityId: id,
      metadata: {
        holdingsCount: holdings.length,
        totalValue,
        ...(moveSummary ? { moveSummary } : {}),
        ...(clearAnalysis ? { clearAnalysis: true } : {}),
      },
    });

    return await respondWithDetail(supabase, id);
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/clients/[id]/holdings PATCH error", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to update holdings.",
      },
      { status: 500 }
    );
  }
};

async function respondWithDetail(
  supabase: ReturnType<typeof getCrmSupabaseAdmin>,
  id: string
) {
  const [rowResult, taskCount, noteCount] = await Promise.all([
    supabase.from("advisorpilot_clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("advisorpilot_tasks")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("advisorpilot_notes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .gte(
        "created_at",
        new Date(
          Date.now() - RECENT_NOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000
        ).toISOString()
      ),
  ]);
  if (rowResult.error || !rowResult.data) {
    return NextResponse.json(
      { error: rowResult.error?.message ?? "Client not found." },
      { status: rowResult.error ? 400 : 404 }
    );
  }
  const detail = toClientDetail(rowResult.data as ClientRow, {
    openTaskCount: taskCount.count ?? 0,
    recentNoteCount: noteCount.count ?? 0,
  });
  return NextResponse.json({ client: detail });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
