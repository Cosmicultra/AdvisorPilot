"use client";

/**
 * Edit Client drawer — lets the advisor manually set the CRM-only top-level
 * columns on advisorpilot_clients (stage, tags, location, email, phone,
 * next meeting, review due date, household label, owner initials, inception
 * year, YTD return). Intake fields (name, DOB, etc.) are NOT editable here
 * — those still go through the legacy Intake flow.
 *
 * Hydrates from the current ClientDetail prop. PATCHes /api/clients/[id]
 * with only the fields the user changed. On success, calls onSaved so the
 * parent refresh counter bumps and chrome (Profile header, Roster row,
 * Overview cards) re-fetch.
 *
 * Spec: docs/crm/20-technical-specs.md §5.4 (edit-client-drawer.tsx).
 */

import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ClientDetail, ClientStage } from "@/lib/crm/types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DrawerShell } from "./drawer-shell";

const STAGE_OPTIONS: ClientStage[] = [
  "Review due",
  "Upcoming",
  "Stable",
  "At risk",
  "Onboarding",
  "Prospect",
];

interface FormState {
  stage: ClientStage | "";
  tagsRaw: string;
  location: string;
  email: string;
  phone: string;
  householdLabel: string;
  ownerInitials: string;
  inceptionYearRaw: string;
  ytdReturnPctRaw: string;        // user enters as percent (6.2 = 6.2%)
  nextMeetingAtLocal: string;     // <input type="datetime-local">
  reviewDueAtLocal: string;       // <input type="date">
}

export type EditClientDrawerProps = {
  open: boolean;
  client: ClientDetail;
  onClose(): void;
  onSaved(client: ClientDetail): void;
};

export function EditClientDrawer({
  open,
  client,
  onClose,
  onSaved,
}: EditClientDrawerProps) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => initialForm(client));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-hydrate ONLY when the drawer opens (not when `client` reference
  // changes mid-edit — that would clobber user input). Reopening after a
  // save picks up the fresh values because the parent passes the new
  // client when re-opening.
  useEffect(() => {
    if (open) {
      setForm(initialForm(client));
      setError(null);
      setSubmitting(false);
    }
    // Intentionally not including `client` — re-hydration must be triggered
    // by the open→true transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Compare form against initial values to detect unsaved changes.
  const isDirty = formIsDirty(form, client);

  const handleClose = async () => {
    if (submitting) return;
    if (isDirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message:
          "You have edits to this client that haven't been saved. Discard them?",
        tone: "danger",
        confirmLabel: "Discard changes",
      });
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting) return;

    // Build patch — send only fields that differ from the current client.
    const patch: Record<string, unknown> = {};
    const initial = initialForm(client);

    if (form.stage !== initial.stage) {
      patch.stage = form.stage === "" ? null : form.stage;
    }

    const formTags = parseTags(form.tagsRaw);
    const initialTags = client.tags ?? [];
    if (!arraysEqual(formTags, initialTags)) {
      patch.tags = formTags;
    }

    addStringDiff(patch, "location", form.location, initial.location);
    addStringDiff(patch, "email", form.email, initial.email);
    addStringDiff(patch, "phone", form.phone, initial.phone);
    addStringDiff(patch, "householdLabel", form.householdLabel, initial.householdLabel);
    addStringDiff(patch, "ownerInitials", form.ownerInitials, initial.ownerInitials);

    // inceptionYear (int)
    if (form.inceptionYearRaw.trim() !== initial.inceptionYearRaw) {
      if (!form.inceptionYearRaw.trim()) {
        patch.inceptionYear = null;
      } else {
        const n = Number(form.inceptionYearRaw);
        if (!Number.isInteger(n) || n < 1900 || n > 2100) {
          setError("Inception year must be a 4-digit year between 1900 and 2100.");
          return;
        }
        patch.inceptionYear = n;
      }
    }

    // ytdReturn — user enters percent, server stores decimal
    if (form.ytdReturnPctRaw.trim() !== initial.ytdReturnPctRaw) {
      if (!form.ytdReturnPctRaw.trim()) {
        patch.ytdReturn = null;
      } else {
        const pct = Number(form.ytdReturnPctRaw);
        if (!Number.isFinite(pct)) {
          setError("YTD return must be a number (e.g. 6.2 for 6.2%).");
          return;
        }
        if (pct < -100 || pct > 500) {
          setError("YTD return must be between -100 and 500 (percent).");
          return;
        }
        patch.ytdReturn = pct / 100;
      }
    }

    // datetime-local → ISO
    if (form.nextMeetingAtLocal !== initial.nextMeetingAtLocal) {
      if (!form.nextMeetingAtLocal) {
        patch.nextMeetingAt = null;
      } else {
        const parsed = Date.parse(form.nextMeetingAtLocal);
        if (Number.isNaN(parsed)) {
          setError("Next meeting must be a valid date/time.");
          return;
        }
        patch.nextMeetingAt = new Date(parsed).toISOString();
      }
    }

    // date → YYYY-MM-DD
    if (form.reviewDueAtLocal !== initial.reviewDueAtLocal) {
      patch.reviewDueAt = form.reviewDueAtLocal || null;
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await advisorFetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (res.status === 401) {
        setError("Your session has expired. Sign in again.");
        setSubmitting(false);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.client) {
        setError(json?.error ?? `Failed to update client (${res.status}).`);
        setSubmitting(false);
        return;
      }

      onSaved(json.client as ClientDetail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update client.");
      setSubmitting(false);
    }
  };

  const fullName = `${client.firstName} ${client.lastName}`.trim() || "this client";

  return (
    <DrawerShell
      open={open}
      title="Edit client"
      subtitle={fullName}
      onClose={handleClose}
      widthPx={460}
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-60"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              backgroundColor: "var(--ap-royal)",
              color: "#FFFFFF",
            }}
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <FieldGroup label="Lifecycle">
          <Field label="Stage">
            <select
              value={form.stage}
              onChange={(e) => update("stage", e.target.value as ClientStage | "")}
              disabled={submitting}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            >
              <option value="">— Auto (computed) —</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tags (comma-separated)">
            <input
              type="text"
              value={form.tagsRaw}
              onChange={(e) => update("tagsRaw", e.target.value)}
              disabled={submitting}
              placeholder="vip, ria, retirement"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
        </FieldGroup>

        <FieldGroup label="Schedule">
          <Field label="Next meeting">
            <input
              type="datetime-local"
              value={form.nextMeetingAtLocal}
              onChange={(e) => update("nextMeetingAtLocal", e.target.value)}
              disabled={submitting}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
          <Field label="Review due">
            <input
              type="date"
              value={form.reviewDueAtLocal}
              onChange={(e) => update("reviewDueAtLocal", e.target.value)}
              disabled={submitting}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
        </FieldGroup>

        <FieldGroup label="Contact info">
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              disabled={submitting}
              placeholder="client@example.com"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              disabled={submitting}
              placeholder="(555) 123-4567"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
          <Field label="Location">
            <input
              type="text"
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              disabled={submitting}
              placeholder="Austin, TX"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
        </FieldGroup>

        <FieldGroup label="Relationship">
          <Field label="Household label">
            <input
              type="text"
              value={form.householdLabel}
              onChange={(e) => update("householdLabel", e.target.value)}
              disabled={submitting}
              placeholder="Chen Family Trust"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
          <Field label="Owner initials">
            <input
              type="text"
              value={form.ownerInitials}
              onChange={(e) => update("ownerInitials", e.target.value)}
              disabled={submitting}
              placeholder="D. Patel"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
          <Field label="Client since (year)">
            <input
              type="number"
              min={1900}
              max={2100}
              value={form.inceptionYearRaw}
              onChange={(e) => update("inceptionYearRaw", e.target.value)}
              disabled={submitting}
              placeholder="2019"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
        </FieldGroup>

        <FieldGroup label="Performance">
          <Field label="YTD return (%)" hint="e.g. 6.2 for +6.2%; -3.5 for -3.5%">
            <input
              type="number"
              step="0.1"
              value={form.ytdReturnPctRaw}
              onChange={(e) => update("ytdReturnPctRaw", e.target.value)}
              disabled={submitting}
              placeholder="6.2"
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
        </FieldGroup>

        {error ? (
          <p className="text-[12px]" style={{ color: "#9B1C1C" }} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </DrawerShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p
        className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--ap-gray)" }}
      >
        {label}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[11px]" style={{ color: "var(--ap-gray)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

// ─── Form helpers ─────────────────────────────────────────────────────────

function initialForm(client: ClientDetail): FormState {
  return {
    stage: isStage(client.stage) ? client.stage : "",
    tagsRaw: (client.tags ?? []).join(", "),
    location: client.location ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    householdLabel: client.householdLabel ?? "",
    ownerInitials: client.ownerInitials ?? "",
    inceptionYearRaw: client.inceptionYear !== null ? String(client.inceptionYear) : "",
    ytdReturnPctRaw:
      client.ytdReturn !== null && Number.isFinite(client.ytdReturn)
        ? String(roundTo(client.ytdReturn * 100, 4))
        : "",
    nextMeetingAtLocal: toDateTimeLocal(client.nextMeetingAt),
    reviewDueAtLocal: client.reviewDueAt ?? "",
  };
}

function isStage(value: unknown): value is ClientStage {
  return STAGE_OPTIONS.includes(value as ClientStage);
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function addStringDiff<K extends string>(
  patch: Record<string, unknown>,
  key: K,
  formValue: string,
  initialValue: string
): void {
  if (formValue.trim() !== initialValue.trim()) {
    patch[key] = formValue.trim().length > 0 ? formValue.trim() : null;
  }
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const d = new Date(ts);
  // <input type="datetime-local"> expects YYYY-MM-DDTHH:MM in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** True when any field in the form differs from the client's current state.
 *  Compares against `initialForm(client)` so the result is exactly what the
 *  PATCH payload would change. */
function formIsDirty(form: FormState, client: ClientDetail): boolean {
  const initial = initialForm(client);
  if (form.stage !== initial.stage) return true;
  if (!arraysEqual(parseTags(form.tagsRaw), parseTags(initial.tagsRaw))) return true;
  if (form.location.trim() !== initial.location.trim()) return true;
  if (form.email.trim() !== initial.email.trim()) return true;
  if (form.phone.trim() !== initial.phone.trim()) return true;
  if (form.householdLabel.trim() !== initial.householdLabel.trim()) return true;
  if (form.ownerInitials.trim() !== initial.ownerInitials.trim()) return true;
  if (form.inceptionYearRaw.trim() !== initial.inceptionYearRaw) return true;
  if (form.ytdReturnPctRaw.trim() !== initial.ytdReturnPctRaw) return true;
  if (form.nextMeetingAtLocal !== initial.nextMeetingAtLocal) return true;
  if (form.reviewDueAtLocal !== initial.reviewDueAtLocal) return true;
  return false;
}
