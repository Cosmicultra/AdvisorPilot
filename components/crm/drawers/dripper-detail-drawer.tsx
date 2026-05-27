"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState, type ReactNode } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import {
  GOOGLE_GMAIL_REAUTHORIZE_PARAMS,
  googleGmailReconnectCallbackUrl,
} from "@/lib/google-gmail-signin";
import {
  MICROSOFT_OUTLOOK_REAUTHORIZE_PARAMS,
  microsoftOutlookReconnectCallbackUrl,
} from "@/lib/microsoft-outlook-signin";
import { buildAnnuityReminderPreview } from "@/lib/crm/annuity-reminder-preview";
import type { ClientDripperEnrollment, DripperRun } from "@/lib/crm/types";
import type { UiHolding } from "@/lib/saved-review-normalize";
import { DrawerShell } from "./drawer-shell";

export interface DripperTemplatePublic {
  id: string;
  title: string;
  description: string;
  icon: string;
  prompt: string;
  defaultFrequencyDays: number;
  frequencyExamples: { label: string; days: number }[];
  scheduleMode?: "frequency" | "annuity_event";
  reminderKind?: "reallocation" | "maturity";
  defaultEndDateOffsetDays?: number;
  endDateHelperText?: string;
}

export type DripperDetailDrawerProps = {
  open: boolean;
  clientId: string;
  clientEmail?: string | null;
  holdings?: UiHolding[];
  template: DripperTemplatePublic;
  enrollment: ClientDripperEnrollment | null;
  recentRuns: DripperRun[];
  onClose(): void;
  onSaved(enrollment: ClientDripperEnrollment): void;
  onRan(): void;
};

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

function addDaysToDateInput(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatEmailStatus(run: DripperRun): string {
  if (!run.emailStatus) return "";
  if (run.emailStatus === "sent") {
    return run.clientEmailTo ? `Email sent to ${run.clientEmailTo}` : "Email sent";
  }
  if (run.emailStatus === "skipped") {
    return run.emailError ?? "Email skipped";
  }
  return run.emailError ?? "Email failed";
}

export function DripperDetailDrawer({
  open,
  clientId,
  clientEmail,
  holdings = [],
  template,
  enrollment,
  recentRuns,
  onClose,
  onSaved,
  onRan,
}: DripperDetailDrawerProps) {
  const [enabled, setEnabled] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [frequencyDays, setFrequencyDays] = useState(template.defaultFrequencyDays);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gmailHint, setGmailHint] = useState<string | null>(null);
  const [outlookHint, setOutlookHint] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<{
    tone: "success" | "info" | "error";
    text: string;
  } | null>(null);

  const isAnnuityEvent = template.scheduleMode === "annuity_event";
  const upcomingPreview =
    isAnnuityEvent && template.reminderKind
      ? buildAnnuityReminderPreview(holdings, template.reminderKind)
      : [];

  useEffect(() => {
    if (!open) return;
    setEnabled(enrollment?.enabled ?? false);
    const start =
      isoToDateInput(enrollment?.startsAt ?? null) ||
      isoToDateInput(new Date().toISOString());
    setStartsAt(start);
    const savedEnd = isoToDateInput(enrollment?.endsAt ?? null);
    if (savedEnd) {
      setEndsAt(savedEnd);
    } else if (template.defaultEndDateOffsetDays && start) {
      setEndsAt(addDaysToDateInput(start, template.defaultEndDateOffsetDays));
    } else {
      setEndsAt("");
    }
    setFrequencyDays(enrollment?.frequencyDays ?? template.defaultFrequencyDays);
    setError(null);
    setGmailHint(null);
    setOutlookHint(null);
    setRunMessage(null);
  }, [open, enrollment, template]);

  useEffect(() => {
    if (!open || !template.defaultEndDateOffsetDays) return;
    if (enrollment?.endsAt) return;
    if (!startsAt) return;
    setEndsAt(addDaysToDateInput(startsAt, template.defaultEndDateOffsetDays));
  }, [open, startsAt, template.defaultEndDateOffsetDays, enrollment?.endsAt]);

  const handleClose = () => {
    if (submitting || running) return;
    onClose();
  };

  const patchEnrollment = async (patch: Record<string, unknown>) => {
    const res = await advisorFetch(
      `/api/clients/${encodeURIComponent(clientId)}/drippers?templateId=${encodeURIComponent(template.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    if (res.status === 401) {
      throw new Error("Your session has expired. Sign in again.");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.enrollment) {
      throw new Error(json?.error ?? `Failed to save (${res.status}).`);
    }
    return json.enrollment as ClientDripperEnrollment;
  };

  const handleSave = async () => {
    if (submitting || !startsAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await patchEnrollment({
        enabled,
        startsAt: dateInputToIso(startsAt),
        endsAt: endsAt ? dateInputToIso(endsAt) : null,
        frequencyDays,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunNow = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setRunMessage(null);
    try {
      const res = await advisorFetch(
        `/api/clients/${encodeURIComponent(clientId)}/drippers/${encodeURIComponent(template.id)}/run`,
        { method: "POST" }
      );
      if (res.status === 401) {
        throw new Error("Your session has expired. Sign in again.");
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.needsGoogleReconnect) {
          setGmailHint(json?.error ?? "Reconnect Google with Gmail send access, then try again.");
        }
        if (json?.needsOutlookReconnect) {
          setOutlookHint(json?.error ?? "Reconnect Microsoft with Mail.Send access, then try again.");
        }
        throw new Error(json?.error ?? `Run failed (${res.status}).`);
      }
      if (json.needsGoogleReconnect) {
        setGmailHint(json.emailError ?? "Drip completed but Gmail could not send. Reconnect Google below.");
        setRunMessage({
          tone: "error",
          text: json.emailError ?? "Reconnect Google with Gmail send access.",
        });
      } else if (json.needsOutlookReconnect) {
        setOutlookHint(json.emailError ?? "Drip completed but Outlook could not send. Reconnect Microsoft below.");
        setRunMessage({
          tone: "error",
          text: json.emailError ?? "Reconnect Microsoft with Mail.Send access.",
        });
      } else if (json.emailStatus === "failed") {
        setGmailHint(json.emailError ?? "Client email failed to send.");
        setRunMessage({
          tone: "error",
          text: json.emailError ?? "Client email failed to send.",
        });
      } else if (json.emailStatus === "sent") {
        setGmailHint(null);
        const sentCount =
          typeof json.contractsSent === "number" ? json.contractsSent : 1;
        setRunMessage({
          tone: "success",
          text:
            sentCount > 1
              ? `Sent ${sentCount} reminder emails via Gmail.`
              : "Reminder email sent via Gmail.",
        });
      } else if (json.emailStatus === "skipped") {
        setGmailHint(null);
        setRunMessage({
          tone: "info",
          text:
            json.emailError ??
            "No email was sent. Check client email, contract dates, or Recent runs.",
        });
      } else {
        setGmailHint(null);
        setRunMessage({
          tone: "success",
          text: "Run completed.",
        });
      }
      if (json.enrollment) onSaved(json.enrollment as ClientDripperEnrollment);
      onRan();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run dripper.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <DrawerShell
      open={open}
      title={template.title}
      subtitle={template.description}
      onClose={handleClose}
      widthPx={440}
      footer={
        <DrawerFooter
          onCancel={handleClose}
          onSave={handleSave}
          onRunNow={handleRunNow}
          submitting={submitting}
          running={running}
          saveDisabled={!isAnnuityEvent && !startsAt}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {clientEmail ? (
          <p className="text-[11.5px]" style={{ color: "var(--ap-gray)" }}>
            Emails send to: <strong style={{ color: "var(--ap-navy)" }}>{clientEmail}</strong>
          </p>
        ) : (
          <p className="text-[11.5px] text-amber-800">
            No client email on file — add one before enabling drips that should reach the client.
          </p>
        )}

        {runMessage ? (
          <div
            className="rounded border px-3 py-2 text-[11.5px]"
            style={{
              borderColor:
                runMessage.tone === "success"
                  ? "rgb(187 247 208)"
                  : runMessage.tone === "error"
                    ? "rgb(254 202 202)"
                    : "rgb(254 243 199)",
              backgroundColor:
                runMessage.tone === "success"
                  ? "rgb(240 253 244)"
                  : runMessage.tone === "error"
                    ? "rgb(254 242 242)"
                    : "rgb(255 251 235)",
              color:
                runMessage.tone === "success"
                  ? "rgb(22 101 52)"
                  : runMessage.tone === "error"
                    ? "rgb(153 27 27)"
                    : "rgb(146 64 14)",
            }}
          >
            {runMessage.text}
          </div>
        ) : null}

        {gmailHint ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
            <p>{gmailHint}</p>
            <button
              type="button"
              className="mt-2 text-[12px] font-medium underline"
              onClick={() =>
                void signIn(
                  "google",
                  { callbackUrl: googleGmailReconnectCallbackUrl() },
                  GOOGLE_GMAIL_REAUTHORIZE_PARAMS
                )
              }
            >
              Reconnect Google for Gmail
            </button>
          </div>
        ) : null}

        {outlookHint ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
            <p>{outlookHint}</p>
            <button
              type="button"
              className="mt-2 text-[12px] font-medium underline"
              onClick={() =>
                void signIn(
                  "azure-ad",
                  { callbackUrl: microsoftOutlookReconnectCallbackUrl() },
                  MICROSOFT_OUTLOOK_REAUTHORIZE_PARAMS
                )
              }
            >
              Reconnect Microsoft for Outlook
            </button>
          </div>
        ) : null}

        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-[12.5px] font-medium" style={{ color: "var(--ap-navy)" }}>
            Enabled
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
        </label>

        <FieldBlock>
          <p
            className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--ap-royal)" }}
          >
            Prompt (read-only)
          </p>
          <pre
            className="max-h-[200px] overflow-auto whitespace-pre-wrap border px-3 py-2 text-[11px] leading-relaxed"
            style={{
              borderColor: "var(--ap-border)",
              color: "var(--ap-gray)",
              backgroundColor: "var(--ap-pilot-light)",
            }}
          >
            {template.prompt}
          </pre>
        </FieldBlock>

        {isAnnuityEvent ? (
          <>
            <p className="text-[11.5px]" style={{ color: "var(--ap-gray)" }}>
              Runs automatically <strong>30 days before</strong> each annuity contract&apos;s{" "}
              {template.reminderKind === "maturity"
                ? "maturity date"
                : "annual reallocation window"}
              . One email per contract when due. No AI — fixed email template.{" "}
              <strong>Run now</strong> sends the next unsent reminder for each contract (for
              testing or early send).
            </p>
            {upcomingPreview.length > 0 ? (
              <FieldBlock>
                <p
                  className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ color: "var(--ap-royal)" }}
                >
                  Upcoming reminders
                </p>
                <ul className="space-y-1.5 text-[11px]" style={{ color: "var(--ap-gray)" }}>
                  {upcomingPreview.map((row, i) => (
                    <li key={`${row.contractLabel}-${row.remindDate}-${i}`}>
                      <span style={{ color: "var(--ap-navy)" }}>{row.contractLabel}</span>
                      {" — "}email on {row.remindDate} (event {row.eventDate})
                    </li>
                  ))}
                </ul>
              </FieldBlock>
            ) : (
              <p className="text-[11px] text-amber-800">
                No upcoming dates found. Add annuity contracts with{" "}
                {template.reminderKind === "maturity" ? "maturity" : "issue"} dates on the
                Portfolio tab.
              </p>
            )}
          </>
        ) : (
          <>
            <FieldBlock>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
                Start date
              </label>
              <input
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full border px-2 py-1.5 text-[13px]"
                style={{ borderColor: "var(--ap-border)" }}
              />
            </FieldBlock>

            <FieldBlock>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
                End date <span className="font-normal text-[var(--ap-gray)]">(optional)</span>
              </label>
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full border px-2 py-1.5 text-[13px]"
                style={{ borderColor: "var(--ap-border)" }}
              />
              {template.endDateHelperText ? (
                <p className="mt-1 text-[11px]" style={{ color: "var(--ap-gray)" }}>
                  {template.endDateHelperText}
                </p>
              ) : (
                <p className="mt-1 text-[11px]" style={{ color: "var(--ap-gray)" }}>
                  Leave blank to run indefinitely until you turn it off.
                </p>
              )}
            </FieldBlock>

            <FieldBlock>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
                Frequency
              </label>
              <select
                value={frequencyDays}
                onChange={(e) => setFrequencyDays(Number(e.target.value))}
                className="w-full border px-2 py-1.5 text-[13px]"
                style={{ borderColor: "var(--ap-border)" }}
              >
                {template.frequencyExamples.map((ex) => (
                  <option key={ex.days} value={ex.days}>
                    {ex.label} ({ex.days} days)
                  </option>
                ))}
              </select>
            </FieldBlock>
          </>
        )}

        {recentRuns.length > 0 ? (
          <FieldBlock>
            <p
              className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--ap-gray)" }}
            >
              Recent runs
            </p>
            <ul className="flex flex-col gap-2">
              {recentRuns.slice(0, 3).map((run) => (
                <li
                  key={run.id}
                  className="border px-3 py-2 text-[11px]"
                  style={{ borderColor: "var(--ap-border)" }}
                >
                  <p className="font-medium" style={{ color: "var(--ap-navy)" }}>
                    {new Date(run.ranAt).toLocaleString()} — {run.status}
                    {run.emailStatus ? ` · ${formatEmailStatus(run)}` : ""}
                  </p>
                  {run.outputText ? (
                    <p
                      className="mt-1 line-clamp-4 whitespace-pre-wrap"
                      style={{ color: "var(--ap-gray)" }}
                    >
                      {run.outputText}
                    </p>
                  ) : run.errorMessage ? (
                    <p className="mt-1 text-red-700">{run.errorMessage}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </FieldBlock>
        ) : null}

        {error ? (
          <p className="text-[12px] text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </DrawerShell>
  );
}

function FieldBlock({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

function DrawerFooter({
  onCancel,
  onSave,
  onRunNow,
  submitting,
  running,
  saveDisabled,
}: {
  onCancel(): void;
  onSave(): void;
  onRunNow(): void;
  submitting: boolean;
  running: boolean;
  saveDisabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting || running}
        className="px-3 py-1.5 text-[12.5px]"
        style={{ color: "var(--ap-gray)" }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onRunNow}
        disabled={submitting || running}
        className="border px-3 py-1.5 text-[12.5px] font-medium"
        style={{ borderColor: "var(--ap-border)", color: "var(--ap-navy)" }}
      >
        {running ? "Running…" : "Run now"}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={submitting || running || saveDisabled}
        className="px-3 py-1.5 text-[12.5px] font-medium text-white"
        style={{ backgroundColor: "var(--ap-royal)" }}
      >
        {submitting ? "Saving…" : "Save schedule"}
      </button>
    </div>
  );
}
