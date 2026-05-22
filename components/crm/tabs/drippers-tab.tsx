"use client";

/**
 * Per-client Drippers tab — template cards with on/off toggles and schedule drawer.
 */

import {
  BarChart3,
  CalendarCheck,
  CalendarClock,
  Clock,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ClientDripperEnrollment, DripperRun } from "@/lib/crm/types";
import type { UiHolding } from "@/lib/saved-review-normalize";
import {
  DripperDetailDrawer,
  type DripperTemplatePublic,
} from "../drawers/dripper-detail-drawer";

const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  MessageSquareText,
  Clock,
  CalendarClock,
  CalendarCheck,
};

type DrippersPayload = {
  templates: DripperTemplatePublic[];
  enrollments: ClientDripperEnrollment[];
  recentRunsByTemplate: Record<string, DripperRun[]>;
  tablesMissing?: boolean;
};

type FetchState =
  | { status: "loading" }
  | { status: "ready"; data: DrippersPayload }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type DrippersTabProps = {
  clientId: string;
  clientEmail?: string | null;
  holdings?: UiHolding[];
  refreshKey: number;
};

export function DrippersTab({ clientId, clientEmail, holdings = [], refreshKey }: DrippersTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [drawerTemplateId, setDrawerTemplateId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback((options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setState({ status: "loading" });
    }
    advisorFetch(`/api/clients/${encodeURIComponent(clientId)}/drippers`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 401) return { kind: "unauthorized" as const };
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            kind: "error" as const,
            message: body?.error ?? `Failed to load drippers (${res.status})`,
          };
        }
        return { kind: "ok" as const, data: body as DrippersPayload };
      })
      .then((result) => {
        if (result.kind === "unauthorized") {
          setState({ status: "unauthorized" });
          return;
        }
        if (result.kind === "error") {
          setState({ status: "error", message: result.message });
          return;
        }
        setState({ status: "ready", data: result.data });
      })
      .catch((err) => {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load drippers.",
        });
      });
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const enrollmentFor = (templateId: string): ClientDripperEnrollment | null => {
    if (state.status !== "ready") return null;
    return state.data.enrollments.find((e) => e.templateId === templateId) ?? null;
  };

  const handleToggle = async (template: DripperTemplatePublic, nextEnabled: boolean) => {
    if (state.status !== "ready") return;
    setTogglingId(template.id);

    const existing = enrollmentFor(template.id);
    const now = new Date();
    const startsAt = existing?.startsAt ?? now.toISOString();

    try {
      const res = await advisorFetch(
        `/api/clients/${encodeURIComponent(clientId)}/drippers?templateId=${encodeURIComponent(template.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: nextEnabled,
            startsAt,
            endsAt: existing?.endsAt ?? null,
            frequencyDays: existing?.frequencyDays ?? template.defaultFrequencyDays,
          }),
        }
      );
      if (res.status === 401) {
        setState({ status: "unauthorized" });
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.enrollment) {
        throw new Error(json?.error ?? `Failed to update (${res.status})`);
      }
      const updated = json.enrollment as ClientDripperEnrollment;
      setState({
        status: "ready",
        data: {
          ...state.data,
          enrollments: [
            ...state.data.enrollments.filter((e) => e.templateId !== template.id),
            updated,
          ],
        },
      });
    } catch (err) {
      console.error("[crm:drippers] toggle failed", err);
    } finally {
      setTogglingId(null);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="px-6 py-8 text-[13px]" style={{ color: "var(--ap-gray)" }}>
        Loading drippers…
      </div>
    );
  }

  if (state.status === "unauthorized") {
    return (
      <div className="px-6 py-8 text-[13px]" style={{ color: "var(--ap-gray)" }}>
        Sign in to manage drippers.
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="px-6 py-8 text-[13px] text-red-700" role="alert">
        {state.message}
      </div>
    );
  }

  const { templates, recentRunsByTemplate, tablesMissing } = state.data;
  const drawerTemplate = drawerTemplateId
    ? templates.find((t) => t.id === drawerTemplateId)
    : null;

  return (
    <div className="flex flex-1 flex-col gap-5 px-6 py-5">
      <div
        className="flex flex-col gap-1 bg-white px-4 py-3"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <p
          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--ap-royal)" }}
        >
          Drippers
        </p>
        <p className="text-[12.5px] leading-snug" style={{ color: "var(--ap-navy)" }}>
          Turn on AI-assisted templates that run on a schedule. Each successful run
          emails your client at their CRM address via your connected Gmail (same as
          Client Snapshot). Requires Google sign-in with Gmail send permission.
        </p>
        {clientEmail ? (
          <p className="text-[11px]" style={{ color: "var(--ap-gray)" }}>
            Client email on file: <strong>{clientEmail}</strong>
          </p>
        ) : (
          <p className="text-[11px] text-amber-800">
            No client email on file — drips will run but client email will be skipped.
            Add an email on the Overview or Contacts tab.
          </p>
        )}
        {tablesMissing ? (
          <p className="mt-2 text-[11.5px] text-amber-800">
            Database tables are not installed yet. Run{" "}
            <code className="text-[10px]">supabase/advisorpilot_client_drippers.sql</code>{" "}
            in Supabase.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => {
          const enrollment = enrollmentFor(template.id);
          const enabled = enrollment?.enabled ?? false;
          const Icon = ICONS[template.icon] ?? BarChart3;
          return (
            <DripperCard
              key={template.id}
              template={template}
              enabled={enabled}
              toggling={togglingId === template.id}
              Icon={Icon}
              onOpen={() => setDrawerTemplateId(template.id)}
              onToggle={(next) => void handleToggle(template, next)}
            />
          );
        })}
      </div>

      {drawerTemplate ? (
        <DripperDetailDrawer
          open
          clientId={clientId}
          clientEmail={clientEmail}
          holdings={holdings}
          template={drawerTemplate}
          enrollment={enrollmentFor(drawerTemplate.id)}
          recentRuns={recentRunsByTemplate[drawerTemplate.id] ?? []}
          onClose={() => setDrawerTemplateId(null)}
          onSaved={(enrollment) => {
            setState({
              status: "ready",
              data: {
                ...state.data,
                enrollments: [
                  ...state.data.enrollments.filter(
                    (e) => e.templateId !== enrollment.templateId
                  ),
                  enrollment,
                ],
              },
            });
          }}
          onRan={() => load({ silent: true })}
        />
      ) : null}
    </div>
  );
}

function DripperCard({
  template,
  enabled,
  toggling,
  Icon,
  onOpen,
  onToggle,
}: {
  template: DripperTemplatePublic;
  enabled: boolean;
  toggling: boolean;
  Icon: LucideIcon;
  onOpen(): void;
  onToggle(next: boolean): void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-start gap-3 bg-white px-4 py-3 transition-colors hover:bg-[rgba(15,111,222,0.04)]"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <span
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center"
        style={{
          backgroundColor: "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
        }}
      >
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
            {template.title}
          </p>
          <label
            className="flex flex-shrink-0 items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span className="sr-only">Enable {template.title}</span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={toggling}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </div>
        <p className="text-[11.5px] leading-snug" style={{ color: "var(--ap-gray)" }}>
          {template.description}
        </p>
        {enabled ? (
          <p className="text-[10.5px] font-medium" style={{ color: "var(--ap-royal)" }}>
            Active
          </p>
        ) : null}
      </div>
    </div>
  );
}
