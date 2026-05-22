import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  isDripperTablesMissingError,
  toClientDripperEnrollment,
  toDripperRun,
  type ClientDripperRow,
  type DripperRunRow,
} from "@/lib/crm/dripper-mapper";
import {
  computeInitialNextRunAt,
} from "@/lib/crm/dripper-schedule";
import {
  DRIPPER_TEMPLATES,
  getDripperTemplate,
  isAnnuityEventTemplateId,
  isKnownDripperTemplateId,
  toPublicDripperTemplate,
} from "@/lib/crm/dripper-templates";
import { getCrmSupabaseAdmin, missingCrmSupabaseEnv } from "@/lib/crm/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS_PER_TEMPLATE = 5;

/**
 * GET /api/clients/[id]/drippers — templates, enrollments, recent runs.
 * PATCH body targets a single template via ?templateId= or nested route.
 */

export const GET = async (
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
      return NextResponse.json({ error: "Sign in to load drippers." }, { status: 401 });
    }

    const { id: clientId } = await context.params;
    if (!isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid client id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();
    const visible = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: clientId,
    });
    if (visible.error || visible.data !== true) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const templates = DRIPPER_TEMPLATES.map(toPublicDripperTemplate);

    const { data: enrollRows, error: enrollErr } = await supabase
      .from("advisorpilot_client_drippers")
      .select("*")
      .eq("client_id", clientId)
      .eq("owner_email", identity.email.toLowerCase());

    if (enrollErr) {
      if (isDripperTablesMissingError(enrollErr)) {
        console.warn("[crm:drippers] tables missing — run supabase/advisorpilot_client_drippers.sql");
        return NextResponse.json({
          templates,
          enrollments: [],
          recentRunsByTemplate: {},
          tablesMissing: true,
        });
      }
      return NextResponse.json({ error: enrollErr.message }, { status: 400 });
    }

    const enrollments = ((enrollRows ?? []) as ClientDripperRow[]).map(toClientDripperEnrollment);

    const { data: runRows, error: runErr } = await supabase
      .from("advisorpilot_dripper_runs")
      .select("*")
      .eq("client_id", clientId)
      .eq("owner_email", identity.email.toLowerCase())
      .order("ran_at", { ascending: false })
      .limit(RUNS_PER_TEMPLATE * DRIPPER_TEMPLATES.length);

    if (runErr && !isDripperTablesMissingError(runErr)) {
      return NextResponse.json({ error: runErr.message }, { status: 400 });
    }

    const recentRunsByTemplate: Record<string, ReturnType<typeof toDripperRun>[]> = {};
    for (const t of DRIPPER_TEMPLATES) {
      recentRunsByTemplate[t.id] = [];
    }
    for (const row of (runRows ?? []) as DripperRunRow[]) {
      const list = recentRunsByTemplate[row.template_id];
      if (list && list.length < RUNS_PER_TEMPLATE) {
        list.push(toDripperRun(row));
      }
    }

    return NextResponse.json({
      templates,
      enrollments,
      recentRunsByTemplate,
    });
  } catch (err) {
    console.error("[crm:api] GET /api/clients/[id]/drippers", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load drippers." },
      { status: 500 }
    );
  }
};

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
      return NextResponse.json({ error: "Sign in to update drippers." }, { status: 401 });
    }

    const { id: clientId } = await context.params;
    if (!isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid client id." }, { status: 400 });
    }

    const params = new URL(req.url).searchParams;
    const templateId = params.get("templateId")?.trim();
    if (!templateId || !isKnownDripperTemplateId(templateId)) {
      return NextResponse.json({ error: "Invalid or missing templateId." }, { status: 400 });
    }

    const template = getDripperTemplate(templateId)!;
    const body = await req.json();

    const supabase = getCrmSupabaseAdmin();
    const visible = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: clientId,
    });
    if (visible.error || visible.data !== true) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const enabled =
      typeof body.enabled === "boolean" ? body.enabled : undefined;
    const startsAt =
      typeof body.startsAt === "string" ? body.startsAt : undefined;
    const endsAt =
      body.endsAt === null
        ? null
        : typeof body.endsAt === "string"
          ? body.endsAt
          : undefined;
    const frequencyDays =
      typeof body.frequencyDays === "number" && body.frequencyDays > 0
        ? Math.floor(body.frequencyDays)
        : undefined;

    const { data: existing } = await supabase
      .from("advisorpilot_client_drippers")
      .select("*")
      .eq("client_id", clientId)
      .eq("template_id", templateId)
      .maybeSingle();

    const now = new Date();
    const resolvedStarts =
      startsAt ?? (existing as ClientDripperRow | null)?.starts_at ?? now.toISOString();
    const resolvedFrequency =
      frequencyDays ??
      (existing as ClientDripperRow | null)?.frequency_days ??
      template.defaultFrequencyDays;
    const resolvedEnabled =
      enabled ?? (existing as ClientDripperRow | null)?.enabled ?? false;
    const resolvedEnds =
      endsAt !== undefined ? endsAt : (existing as ClientDripperRow | null)?.ends_at ?? null;

    let nextRunAt: string | null =
      (existing as ClientDripperRow | null)?.next_run_at ?? null;

    const isAnnuityEvent = isAnnuityEventTemplateId(templateId);

    if (resolvedEnabled && !isAnnuityEvent) {
      nextRunAt = computeInitialNextRunAt(resolvedStarts, now).toISOString();
    } else if (enabled === false || isAnnuityEvent) {
      nextRunAt = null;
    }

    if (
      !isAnnuityEvent &&
      (startsAt !== undefined || frequencyDays !== undefined || enabled === true)
    ) {
      if (resolvedEnabled) {
        nextRunAt = computeInitialNextRunAt(resolvedStarts, now).toISOString();
      }
    }

    const payload = {
      client_id: clientId,
      template_id: templateId,
      owner_email: identity.email.toLowerCase(),
      owner_user_id: identity.userId,
      enabled: resolvedEnabled,
      starts_at: resolvedStarts,
      ends_at: resolvedEnds,
      frequency_days: resolvedFrequency,
      next_run_at: resolvedEnabled ? nextRunAt : null,
      updated_at: now.toISOString(),
    };

    const { data: upserted, error: upsertErr } = await supabase
      .from("advisorpilot_client_drippers")
      .upsert(payload, { onConflict: "client_id,template_id" })
      .select("*")
      .single();

    if (upsertErr) {
      if (isDripperTablesMissingError(upsertErr)) {
        return NextResponse.json(
          {
            error:
              "Dripper tables are not installed. Run supabase/advisorpilot_client_drippers.sql in Supabase.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: upsertErr.message }, { status: 400 });
    }

    return NextResponse.json({
      enrollment: toClientDripperEnrollment(upserted as ClientDripperRow),
    });
  } catch (err) {
    console.error("[crm:api] PATCH /api/clients/[id]/drippers", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update dripper." },
      { status: 500 }
    );
  }
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
