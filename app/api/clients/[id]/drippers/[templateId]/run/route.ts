import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  isDripperTablesMissingError,
  toClientDripperEnrollment,
  type ClientDripperRow,
} from "@/lib/crm/dripper-mapper";
import { runAnnuityRemindersForEnrollment } from "@/lib/crm/annuity-reminder-runner";
import { runDripperForEnrollment } from "@/lib/crm/dripper-runner";
import {
  computeInitialNextRunAt,
} from "@/lib/crm/dripper-schedule";
import {
  getDripperTemplate,
  isAnnuityEventTemplateId,
  isKnownDripperTemplateId,
} from "@/lib/crm/dripper-templates";
import { getCrmSupabaseAdmin, missingCrmSupabaseEnv } from "@/lib/crm/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clients/[id]/drippers/[templateId]/run — run drip now.
 */
export const POST = async (
  req: Request,
  context: { params: Promise<{ id: string; templateId: string }> }
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
      return NextResponse.json({ error: "Sign in to run drippers." }, { status: 401 });
    }

    const { id: clientId, templateId } = await context.params;
    if (!isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid client id." }, { status: 400 });
    }
    if (!isKnownDripperTemplateId(templateId)) {
      return NextResponse.json({ error: "Unknown dripper template." }, { status: 400 });
    }

    const template = getDripperTemplate(templateId)!;
    const supabase = getCrmSupabaseAdmin();

    const visible = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: clientId,
    });
    if (visible.error || visible.data !== true) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from("advisorpilot_client_drippers")
      .select("*")
      .eq("client_id", clientId)
      .eq("template_id", templateId)
      .maybeSingle();

    const now = new Date();
    let enrollment = existing as ClientDripperRow | null;

    if (!enrollment) {
      const startsAt = now.toISOString();
      const { data: created, error: createErr } = await supabase
        .from("advisorpilot_client_drippers")
        .insert({
          client_id: clientId,
          template_id: templateId,
          owner_email: identity.email.toLowerCase(),
          owner_user_id: identity.userId,
          enabled: false,
          starts_at: startsAt,
          ends_at: null,
          frequency_days: template.defaultFrequencyDays,
          next_run_at: computeInitialNextRunAt(startsAt, now).toISOString(),
        })
        .select("*")
        .single();

      if (createErr) {
        if (isDripperTablesMissingError(createErr)) {
          return NextResponse.json(
            {
              error:
                "Dripper tables are not installed. Run supabase/advisorpilot_client_drippers.sql in Supabase.",
            },
            { status: 503 }
          );
        }
        return NextResponse.json({ error: createErr.message }, { status: 400 });
      }
      enrollment = created as ClientDripperRow;
    }

    const result = isAnnuityEventTemplateId(templateId)
      ? await runAnnuityRemindersForEnrollment(supabase, enrollment, identity, {
          forceEnabled: true,
          manualRun: true,
        })
      : await runDripperForEnrollment(supabase, enrollment, identity);

    const { data: refreshed } = await supabase
      .from("advisorpilot_client_drippers")
      .select("*")
      .eq("id", enrollment.id)
      .single();

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error ?? "Dripper run failed.",
          enrollment: refreshed
            ? toClientDripperEnrollment(refreshed as ClientDripperRow)
            : toClientDripperEnrollment(enrollment),
          runId: result.runId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      disabled: "disabled" in result ? result.disabled : undefined,
      emailStatus: result.emailStatus,
      emailError: result.emailError,
      needsGoogleReconnect: result.needsGoogleReconnect,
      needsOutlookReconnect: result.needsOutlookReconnect,
      contractsProcessed:
        "contractsProcessed" in result ? result.contractsProcessed : undefined,
      contractsSent: "contractsSent" in result ? result.contractsSent : undefined,
      enrollment: refreshed
        ? toClientDripperEnrollment(refreshed as ClientDripperRow)
        : toClientDripperEnrollment(enrollment),
    });
  } catch (err) {
    console.error("[crm:api] POST drippers run", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to run dripper." },
      { status: 500 }
    );
  }
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
