/**
 * Event-scheduled annuity reminders (no LLM): 30 days before reallocation or maturity per contract.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import {
  accountKeyForHolding,
  normalizeAnnuityContractFromStorage,
} from "@/lib/annuity-contract-types";
import { advisorEmailReconnectFlags, resolveEmailProviderForAdvisor, sendAdvisorEmail } from "@/lib/advisor-email/send";
import { buildSignedEmailBodies } from "@/lib/gmail/signature";
import { plainParagraphsToHtml } from "@/lib/gmail/mime";
import {
  dueAnnuityEventsForToday,
  listAnnuityReminderEvents,
} from "@/lib/crm/annuity-reminder-dates";
import {
  buildAnnuityReminderEmail,
  isAnnuityReminderHolding,
  type AnnuityReminderKind,
} from "@/lib/crm/annuity-reminder-email";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";
import type { ClientDripperRow } from "@/lib/crm/dripper-mapper";
import {
  ANNUITY_EVENT_TEMPLATE_IDS,
  getDripperTemplate,
  reminderKindForTemplateId,
} from "@/lib/crm/dripper-templates";
import type { UiHolding } from "@/lib/saved-review-normalize";

export const ANNUITY_REMINDER_CRON_BATCH = 30;

export type AnnuityReminderEmailStatus = "sent" | "skipped" | "failed";

export interface AnnuityReminderRunResult {
  ok: boolean;
  runId?: string;
  error?: string;
  emailStatus?: AnnuityReminderEmailStatus;
  emailError?: string;
  contractsProcessed?: number;
  contractsSent?: number;
  needsGoogleReconnect?: boolean;
  needsOutlookReconnect?: boolean;
}

export interface ProcessAnnuityRemindersStats {
  enrollmentsProcessed: number;
  contractsSent: number;
  contractsSkipped: number;
  failed: number;
}

function normalizeContractKey(holding: UiHolding): string {
  const key = accountKeyForHolding(holding);
  if (key) return key.trim().toLowerCase();
  const contract = normalizeAnnuityContractFromStorage(holding.annuityContract);
  return (contract?.contractNumber ?? holding.suggested ?? holding.rawName ?? "unknown")
    .trim()
    .toLowerCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function wasReminderAlreadySent(
  supabase: SupabaseClient,
  params: {
    clientId: string;
    templateId: string;
    contractKey: string;
    reminderKind: AnnuityReminderKind;
    eventDateKey: string;
  }
): Promise<boolean> {
  const { data, error } = await supabase
    .from("advisorpilot_annuity_reminder_sends")
    .select("id")
    .eq("client_id", params.clientId)
    .eq("template_id", params.templateId)
    .eq("contract_key", params.contractKey)
    .eq("reminder_kind", params.reminderKind)
    .eq("event_date", params.eventDateKey)
    .maybeSingle();

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("could not find") && msg.includes("annuity_reminder_sends")) {
      return false;
    }
    throw new Error(error.message);
  }
  return Boolean(data);
}

async function recordAnnuitySkippedRun(
  supabase: SupabaseClient,
  params: {
    enrollment: ClientDripperRow;
    identity: AdvisorIdentity;
    templateTitle: string;
    emailError: string;
  }
): Promise<string | undefined> {
  const ranAt = new Date();
  const { data, error } = await supabase
    .from("advisorpilot_dripper_runs")
    .insert({
      enrollment_id: params.enrollment.id,
      client_id: params.enrollment.client_id,
      template_id: params.enrollment.template_id,
      owner_email: params.identity.email.toLowerCase(),
      owner_user_id: params.identity.userId,
      status: "success",
      output_text: null,
      error_message: params.emailError,
      provider: null,
      model: null,
      ran_at: ranAt.toISOString(),
      email_status: "skipped",
      email_error: params.emailError,
      client_email_to: null,
    })
    .select("id")
    .single();

  if (error) return undefined;
  return data?.id;
}

async function recordReminderSend(
  supabase: SupabaseClient,
  params: {
    clientId: string;
    templateId: string;
    contractKey: string;
    reminderKind: AnnuityReminderKind;
    eventDateKey: string;
    runId: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("advisorpilot_annuity_reminder_sends").insert({
    client_id: params.clientId,
    template_id: params.templateId,
    contract_key: params.contractKey,
    reminder_kind: params.reminderKind,
    event_date: params.eventDateKey,
    run_id: params.runId,
  });
  if (error && !error.message?.includes("duplicate")) {
    throw new Error(error.message);
  }
}

export async function runAnnuityRemindersForEnrollment(
  supabase: SupabaseClient,
  enrollment: ClientDripperRow,
  identity: AdvisorIdentity,
  options: { today?: Date; forceEnabled?: boolean; manualRun?: boolean } = {}
): Promise<AnnuityReminderRunResult> {
  const template = getDripperTemplate(enrollment.template_id);
  const reminderKind = reminderKindForTemplateId(enrollment.template_id);
  if (!template || !reminderKind) {
    return { ok: false, error: "Unknown annuity reminder template." };
  }

  if (!options.forceEnabled && !enrollment.enabled) {
    return { ok: false, error: "Dripper is not enabled." };
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

  const today = options.today ?? new Date();
  let contractsProcessed = 0;
  let contractsSent = 0;
  let lastRunId: string | undefined;
  let lastError: string | undefined;
  let lastEmailStatus: AnnuityReminderEmailStatus | undefined;
  let lastEmailError: string | undefined;
  let needsGoogleReconnect = false;
  let needsOutlookReconnect = false;

  const includeReallocation = reminderKind === "reallocation";
  const includeMaturity = reminderKind === "maturity";
  const manualRun = options.manualRun === true;

  for (const holding of detail.holdings) {
    if (!isAnnuityReminderHolding(holding)) continue;
    const contract = normalizeAnnuityContractFromStorage(holding.annuityContract);
    if (!contract) continue;

    const events = manualRun
      ? listAnnuityReminderEvents(contract.issueDate, contract.maturityDate, {
          includeReallocation,
          includeMaturity,
        }).filter((e) => e.kind === reminderKind)
      : dueAnnuityEventsForToday(contract.issueDate, contract.maturityDate, today, {
          includeReallocation,
          includeMaturity,
        }).filter((e) => e.kind === reminderKind);

    if (!events.length) continue;

    const contractKey = normalizeContractKey(holding);
    const carrierName = contract.carrierName || "your carrier";

    for (const event of events) {
      contractsProcessed += 1;

      try {
        const already = await wasReminderAlreadySent(supabase, {
          clientId: enrollment.client_id,
          templateId: enrollment.template_id,
          contractKey,
          reminderKind: event.kind,
          eventDateKey: event.eventDateKey,
        });
        if (already) continue;

        const emailContent = buildAnnuityReminderEmail({
          clientFirstName: detail.firstName,
          kind: event.kind,
          carrierName,
          holding,
        });

        let emailStatus: AnnuityReminderEmailStatus = "skipped";
        let emailError: string | null = "No client email on file.";
        let clientEmailTo: string | null = null;

        if (detail.email?.trim()) {
          clientEmailTo = detail.email.trim();
          const messageHtmlCore = plainParagraphsToHtml(emailContent.plainBody);
          const signed = await buildSignedEmailBodies(
            identity.email,
            emailContent.plainBody,
            messageHtmlCore
          );
          const provider = await resolveEmailProviderForAdvisor(identity.email);
          if (!provider) {
            emailStatus = "failed";
            emailError = "No email provider connected for this advisor.";
          } else {
            const sendResult = await sendAdvisorEmail({
              advisorEmail: identity.email,
              to: clientEmailTo,
              subject: emailContent.subject,
              plainBody: signed.plainBody,
              htmlBody: signed.htmlBody,
              provider,
            });
            if (sendResult.ok) {
              emailStatus = "sent";
              emailError = null;
              contractsSent += 1;
            } else {
              emailStatus = "failed";
              emailError = sendResult.error;
              const reconnect = advisorEmailReconnectFlags(sendResult);
              needsGoogleReconnect = reconnect.needsGoogleReconnect ?? false;
              needsOutlookReconnect = reconnect.needsOutlookReconnect ?? false;
            }
          }
        }

        const ranAt = new Date();
        const { data: runRow, error: runInsertErr } = await supabase
          .from("advisorpilot_dripper_runs")
          .insert({
            enrollment_id: enrollment.id,
            client_id: enrollment.client_id,
            template_id: enrollment.template_id,
            owner_email: identity.email.toLowerCase(),
            owner_user_id: identity.userId,
            status: emailStatus === "failed" ? "failed" : "success",
            output_text: emailContent.plainBody,
            error_message: emailError,
            provider: null,
            model: null,
            ran_at: ranAt.toISOString(),
            email_status: emailStatus,
            email_error: emailError,
            client_email_to: clientEmailTo,
          })
          .select("id")
          .single();

        if (runInsertErr) {
          lastError = runInsertErr.message;
          continue;
        }

        lastRunId = runRow.id;

        if (emailStatus === "sent") {
          await recordReminderSend(supabase, {
            clientId: enrollment.client_id,
            templateId: enrollment.template_id,
            contractKey,
            reminderKind: event.kind,
            eventDateKey: event.eventDateKey,
            runId: runRow.id,
          });

          await writeAuditEvent({
            ownerEmail: identity.email,
            ownerUserId: identity.userId,
            actorEmail: identity.email,
            action: "email.dripper_sent",
            entityType: "email",
            entityId: enrollment.client_id,
            metadata: {
              to: normalizeEmail(clientEmailTo!),
              templateId: enrollment.template_id,
              templateTitle: template.title,
              annuityReminder: event.kind,
              contractKey,
              eventDate: event.eventDateKey,
            },
          });

          await supabase
            .from("advisorpilot_clients")
            .update({ last_contacted_at: ranAt.toISOString() })
            .eq("id", enrollment.client_id)
            .eq("owner_email", normalizeEmail(identity.email));

          await writeActivityLog(supabase, {
            ownerEmail: identity.email,
            ownerUserId: identity.userId,
            clientId: enrollment.client_id,
            type: "email",
            title: `Email sent: ${template.title}`,
            body: `Reminder for ${carrierName} (${event.kind}).`,
            actorEmail: identity.email,
            metadata: {
              templateId: enrollment.template_id,
              dripType: "annuity_reminder",
              contractKey,
              eventDate: event.eventDateKey,
            },
          });
        }

        await writeActivityLog(supabase, {
          ownerEmail: identity.email,
          ownerUserId: identity.userId,
          clientId: enrollment.client_id,
          type: "dripper",
          title: `Drip: ${template.title}`,
          body: emailContent.plainBody,
          actorEmail: identity.email,
          metadata: {
            templateId: enrollment.template_id,
            runId: runRow.id,
            enrollmentId: enrollment.id,
            emailStatus,
            contractKey,
            eventDate: event.eventDateKey,
          },
        });

        lastEmailStatus = emailStatus;
        lastEmailError = emailError ?? undefined;

        if (manualRun) break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Annuity reminder failed.";
        if (manualRun) break;
      }
    }
  }

  if (contractsProcessed === 0) {
    const skipReason = manualRun
      ? includeReallocation
        ? "No annuity contracts with issue dates found for this client."
        : "No annuity contracts with maturity dates found for this client."
      : includeReallocation
        ? "No reallocation reminders due today. Automatic sends run 30 days before each annual window."
        : "No maturity reminders due today. Automatic sends run 30 days before maturity.";

    await recordAnnuitySkippedRun(supabase, {
      enrollment,
      identity,
      templateTitle: template.title,
      emailError: skipReason,
    });

    return {
      ok: true,
      contractsProcessed: 0,
      contractsSent: 0,
      emailStatus: "skipped",
      emailError: skipReason,
    };
  }

  if (manualRun && contractsSent === 0 && contractsProcessed > 0 && !lastRunId) {
    const allSentReason =
      "All scheduled reminders for this drip have already been sent. Check Recent runs or wait for the next date in Upcoming reminders.";
    const runId = await recordAnnuitySkippedRun(supabase, {
      enrollment,
      identity,
      templateTitle: template.title,
      emailError: allSentReason,
    });
    return {
      ok: true,
      contractsProcessed,
      contractsSent: 0,
      runId,
      emailStatus: "skipped",
      emailError: allSentReason,
    };
  }

  return {
    ok: contractsSent > 0 || lastEmailStatus !== "failed",
    runId: lastRunId,
    error: lastError,
    emailStatus: lastEmailStatus,
    emailError: lastEmailError,
    contractsProcessed,
    contractsSent,
    needsGoogleReconnect: needsGoogleReconnect || undefined,
    needsOutlookReconnect: needsOutlookReconnect || undefined,
  };
}

export async function processAnnuityReminderDrippers(
  supabase: SupabaseClient,
  limit: number = ANNUITY_REMINDER_CRON_BATCH
): Promise<ProcessAnnuityRemindersStats> {
  const stats: ProcessAnnuityRemindersStats = {
    enrollmentsProcessed: 0,
    contractsSent: 0,
    contractsSkipped: 0,
    failed: 0,
  };

  const { data: enrollRows, error } = await supabase
    .from("advisorpilot_client_drippers")
    .select("*")
    .eq("enabled", true)
    .in("template_id", [...ANNUITY_EVENT_TEMPLATE_IDS])
    .limit(limit);

  if (error || !enrollRows?.length) {
    return stats;
  }

  for (const row of enrollRows as ClientDripperRow[]) {
    stats.enrollmentsProcessed += 1;
    const identity: AdvisorIdentity = {
      email: row.owner_email,
      userId: row.owner_user_id,
      provider: row.owner_user_id ? "supabase" : "google",
    };
    try {
      const result = await runAnnuityRemindersForEnrollment(supabase, row, identity);
      if (result.contractsSent) stats.contractsSent += result.contractsSent;
      if (result.contractsProcessed && !result.contractsSent) {
        stats.contractsSkipped += result.contractsProcessed;
      }
      if (!result.ok && result.error) stats.failed += 1;
    } catch {
      stats.failed += 1;
    }
  }

  return stats;
}
