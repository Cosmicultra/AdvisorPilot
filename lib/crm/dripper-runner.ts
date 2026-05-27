/**
 * Executes a single dripper enrollment: load client → LLM → run row + activity log + client email.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import { advisorEmailReconnectFlags, resolveEmailProviderForAdvisor, sendAdvisorEmail } from "@/lib/advisor-email/send";
import { complete, resolveAdvisorLlmSelection } from "@/lib/llm";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import { composeDripperClientEmail } from "@/lib/crm/dripper-client-email";
import {
  buildDripperClientContext,
  excerptDripRunOutput,
  excerptText,
  NOTE_EXCERPT_MAX,
  toDripperEmailContext,
} from "@/lib/crm/dripper-context";
import type { ClientDripperRow } from "@/lib/crm/dripper-mapper";
import {
  computeNextRunAfterSuccess,
  shouldDisableAfterRun,
} from "@/lib/crm/dripper-schedule";
import { getDripperTemplate } from "@/lib/crm/dripper-templates";
import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";

export const DRIPPER_OUTPUT_MAX_CHARS = 4000;
export const DRIPPER_CRON_BATCH_LIMIT = 20;

export type DripperEmailStatus = "sent" | "skipped" | "failed";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface RunDripperResult {
  ok: boolean;
  runId?: string;
  error?: string;
  disabled?: boolean;
  emailStatus?: DripperEmailStatus;
  emailError?: string;
  needsGoogleReconnect?: boolean;
  needsOutlookReconnect?: boolean;
}

async function trySendDripperClientEmail(params: {
  identity: AdvisorIdentity;
  clientId: string;
  templateId: string;
  templateTitle: string;
  outputText: string;
  clientEmail: string | null;
  clientFirstName: string;
  dripContext: ReturnType<typeof toDripperEmailContext>;
  selection: Awaited<ReturnType<typeof resolveAdvisorLlmSelection>>;
}): Promise<{
  emailStatus: DripperEmailStatus;
  emailError: string | null;
  clientEmailTo: string | null;
  needsGoogleReconnect?: boolean;
  needsOutlookReconnect?: boolean;
}> {
  if (!params.clientEmail?.trim()) {
    return {
      emailStatus: "skipped",
      emailError: "No client email on file.",
      clientEmailTo: null,
    };
  }

  const to = params.clientEmail.trim();

  try {
    const composed = await composeDripperClientEmail({
      advisorEmail: params.identity.email,
      templateId: params.templateId,
      templateTitle: params.templateTitle,
      advisorBrief: params.outputText,
      clientFirstName: params.clientFirstName,
      dripContext: params.dripContext,
      selection: params.selection,
    });

    const provider = await resolveEmailProviderForAdvisor(params.identity.email);
    if (!provider) {
      return {
        emailStatus: "failed",
        emailError: "No email provider connected for this advisor.",
        clientEmailTo: to,
      };
    }

    const sendResult = await sendAdvisorEmail({
      advisorEmail: params.identity.email,
      to,
      subject: composed.subject,
      plainBody: composed.plainBody,
      htmlBody: composed.htmlBody,
      provider,
    });

    if (!sendResult.ok) {
      const reconnect = advisorEmailReconnectFlags(sendResult);
      return {
        emailStatus: "failed",
        emailError: sendResult.error,
        clientEmailTo: to,
        ...reconnect,
      };
    }

    return {
      emailStatus: "sent",
      emailError: null,
      clientEmailTo: to,
    };
  } catch (err) {
    return {
      emailStatus: "failed",
      emailError: err instanceof Error ? err.message : "Failed to send client email.",
      clientEmailTo: to,
    };
  }
}

export async function runDripperForEnrollment(
  supabase: SupabaseClient,
  enrollment: ClientDripperRow,
  identity: AdvisorIdentity
): Promise<RunDripperResult> {
  const template = getDripperTemplate(enrollment.template_id);
  if (!template) {
    return { ok: false, error: "Unknown dripper template." };
  }

  const visible = await supabase.rpc("clients_visible_to", {
    viewer_email: identity.email,
    client_id: enrollment.client_id,
  });
  if (visible.error || visible.data !== true) {
    return { ok: false, error: "Client not found." };
  }

  const { data: clientRow, error: clientErr } = await supabase
    .from("advisorpilot_clients")
    .select("*")
    .eq("id", enrollment.client_id)
    .maybeSingle();

  if (clientErr || !clientRow) {
    return { ok: false, error: clientErr?.message ?? "Client not found." };
  }

  const detail = toClientDetail(clientRow as ClientRow, {
    openTaskCount: 0,
    recentNoteCount: 0,
  });

  const [notesResult, priorRunsResult] = await Promise.all([
    supabase
      .from("advisorpilot_notes")
      .select("body")
      .eq("client_id", enrollment.client_id)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("advisorpilot_dripper_runs")
      .select("output_text")
      .eq("client_id", enrollment.client_id)
      .eq("template_id", enrollment.template_id)
      .eq("status", "success")
      .not("output_text", "is", null)
      .order("ran_at", { ascending: false })
      .limit(3),
  ]);

  const recentNotesExcerpts = (notesResult.data ?? [])
    .map((row) => (typeof row.body === "string" ? excerptText(row.body, NOTE_EXCERPT_MAX) : ""))
    .filter(Boolean);

  const recentDripAngles = (priorRunsResult.data ?? [])
    .map((row) =>
      typeof row.output_text === "string" ? excerptDripRunOutput(row.output_text) : ""
    )
    .filter(Boolean);

  const dripContextFull = buildDripperClientContext(detail, {
    recentNotesExcerpts,
    recentDripAngles,
  });
  const dripEmailContext = toDripperEmailContext(dripContextFull);
  const contextJson = JSON.stringify(dripContextFull);

  const selection = await resolveAdvisorLlmSelection(identity.email);
  const ranAt = new Date();

  let outputText: string | null = null;
  let errorMessage: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let status: "success" | "failed" = "success";

  try {
    const result = await complete(
      {
        pass: "dripper",
        system: template.prompt,
        user: `Client context JSON:\n${contextJson}`,
        maxOutputTokens: 1200,
      },
      { selection }
    );
    outputText = truncate((result.text ?? "").trim(), DRIPPER_OUTPUT_MAX_CHARS);
    provider = result.context.provider;
    model = result.context.model;
    if (!outputText) {
      status = "failed";
      errorMessage = "Model returned empty output.";
    }
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : "Dripper LLM call failed.";
  }

  let emailStatus: DripperEmailStatus | null = null;
  let emailError: string | null = null;
  let clientEmailTo: string | null = null;
  let needsGoogleReconnect = false;
  let needsOutlookReconnect = false;

  if (status === "success" && outputText) {
    const emailAttempt = await trySendDripperClientEmail({
      identity,
      clientId: enrollment.client_id,
      templateId: enrollment.template_id,
      templateTitle: template.title,
      outputText,
      clientEmail: detail.email,
      clientFirstName: detail.firstName,
      dripContext: dripEmailContext,
      selection,
    });
    emailStatus = emailAttempt.emailStatus;
    emailError = emailAttempt.emailError;
    clientEmailTo = emailAttempt.clientEmailTo;
    needsGoogleReconnect = emailAttempt.needsGoogleReconnect ?? false;
    needsOutlookReconnect = emailAttempt.needsOutlookReconnect ?? false;

    if (emailAttempt.emailStatus === "sent" && clientEmailTo) {
      await writeAuditEvent({
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        actorEmail: identity.email,
        action: "email.dripper_sent",
        entityType: "email",
        entityId: enrollment.client_id,
        metadata: {
          to: normalizeEmail(clientEmailTo),
          templateId: enrollment.template_id,
          templateTitle: template.title,
        },
      });

      await supabase
        .from("advisorpilot_clients")
        .update({
          last_contacted_at: ranAt.toISOString(),
        })
        .eq("id", enrollment.client_id)
        .eq("owner_email", normalizeEmail(identity.email));

      await writeActivityLog(supabase, {
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        clientId: enrollment.client_id,
        type: "email",
        title: `Email sent: ${template.title}`,
        body: `Drip email sent to ${clientEmailTo}.`,
        actorEmail: identity.email,
        metadata: {
          templateId: enrollment.template_id,
          dripType: "dripper",
        },
      });
    }
  }

  const { data: runRow, error: runInsertErr } = await supabase
    .from("advisorpilot_dripper_runs")
    .insert({
      enrollment_id: enrollment.id,
      client_id: enrollment.client_id,
      template_id: enrollment.template_id,
      owner_email: identity.email.toLowerCase(),
      owner_user_id: identity.userId,
      status,
      output_text: outputText,
      error_message: errorMessage,
      provider,
      model,
      ran_at: ranAt.toISOString(),
      email_status: emailStatus,
      email_error: emailError,
      client_email_to: clientEmailTo,
    })
    .select("id")
    .single();

  if (runInsertErr) {
    return { ok: false, error: runInsertErr.message };
  }

  if (status === "success" && outputText) {
    await writeActivityLog(supabase, {
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      clientId: enrollment.client_id,
      type: "dripper",
      title: `Drip: ${template.title}`,
      body: outputText,
      actorEmail: identity.email,
      metadata: {
        templateId: enrollment.template_id,
        runId: runRow.id,
        enrollmentId: enrollment.id,
        emailStatus,
        clientEmailed: emailStatus === "sent",
      },
    });
  }

  const nextRunAt = computeNextRunAfterSuccess(enrollment.frequency_days, ranAt);
  const disable = shouldDisableAfterRun({
    endsAt: enrollment.ends_at,
    nextRunAt,
  });

  const updatePayload: Record<string, unknown> = {
    last_run_at: ranAt.toISOString(),
    next_run_at: disable ? null : nextRunAt.toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (disable) {
    updatePayload.enabled = false;
  }

  await supabase
    .from("advisorpilot_client_drippers")
    .update(updatePayload)
    .eq("id", enrollment.id);

  return {
    ok: status === "success",
    runId: runRow.id,
    error: errorMessage ?? undefined,
    disabled: disable,
    emailStatus: emailStatus ?? undefined,
    emailError: emailError ?? undefined,
    needsGoogleReconnect: needsGoogleReconnect || undefined,
    needsOutlookReconnect: needsOutlookReconnect || undefined,
  };
}

export interface ProcessDueDrippersStats {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function processDueDrippers(
  supabase: SupabaseClient,
  limit: number = DRIPPER_CRON_BATCH_LIMIT
): Promise<ProcessDueDrippersStats> {
  const nowIso = new Date().toISOString();
  const stats: ProcessDueDrippersStats = { processed: 0, succeeded: 0, failed: 0 };

  const { data: dueRows, error } = await supabase
    .from("advisorpilot_client_drippers")
    .select("*")
    .eq("enabled", true)
    .lte("starts_at", nowIso)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error || !dueRows?.length) {
    return stats;
  }

  for (const row of dueRows as ClientDripperRow[]) {
    if (row.ends_at && new Date(row.ends_at).getTime() <= Date.now()) {
      await supabase
        .from("advisorpilot_client_drippers")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      continue;
    }

    const identity: AdvisorIdentity = {
      email: row.owner_email,
      userId: row.owner_user_id,
      provider: row.owner_user_id ? "supabase" : "google",
    };

    stats.processed += 1;
    const result = await runDripperForEnrollment(supabase, row, identity);
    if (result.ok) stats.succeeded += 1;
    else stats.failed += 1;
  }

  return stats;
}
