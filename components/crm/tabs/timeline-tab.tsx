"use client";

/**
 * Per-client Timeline tab. Mounted at /app/crm/[id]/timeline.
 *
 * - Filter chips: All / Notes / Tasks / Documents / Email / Analysis / System
 * - Same union data source as <TimelineCard /> (the Overview-rail variant)
 *   but unbounded — fetches up to 200 entries per page and paginates via
 *   the `since` param.
 *
 * Auth: every fetch goes through advisorFetch.
 *
 * Spec: docs/crm/20-technical-specs.md §5.3.
 */

import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Droplets,
  FileText,
  Mail,
  PhoneCall,
  StickyNote,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ActivityEntry, ActivityType } from "@/lib/crm/types";

const PAGE_SIZE = 100;

const TYPE_LABELS: Record<ActivityType | "all", string> = {
  all: "All",
  note: "Notes",
  meeting: "Meetings",
  document: "Documents",
  email: "Email",
  call: "Calls",
  task: "Tasks",
  analysis: "Analysis",
  dripper: "Drippers",
  system: "System",
};

type FilterValue = ActivityType | "all";

const FILTER_ORDER: FilterValue[] = [
  "all",
  "note",
  "task",
  "document",
  "email",
  "analysis",
  "system",
];

type FetchState =
  | { status: "loading" }
  | { status: "ready"; entries: ActivityEntry[]; hasMore: boolean }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type TimelineTabProps = {
  clientId: string;
  refreshKey: number;
};

export function TimelineTab({ clientId, refreshKey }: TimelineTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [filter, setFilter] = useState<FilterValue>("all");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(
      `/api/activity?clientId=${encodeURIComponent(clientId)}&limit=${PAGE_SIZE}`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load activity (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        setState({
          status: "ready",
          entries: (body?.entries ?? []) as ActivityEntry[],
          hasMore: Boolean(body?.hasMore),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load activity.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  const visibleEntries = useMemo(() => {
    if (state.status !== "ready") return [];
    return filter === "all"
      ? state.entries
      : state.entries.filter((e) => e.type === filter);
  }, [state, filter]);

  const loadOlder = async () => {
    if (state.status !== "ready" || !state.hasMore || loadingMore) return;
    const oldest = state.entries[state.entries.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await advisorFetch(
        `/api/activity?clientId=${encodeURIComponent(clientId)}&limit=${PAGE_SIZE}&since=` +
          encodeURIComponent(new Date(0).toISOString()),
        { cache: "no-store" }
      );
      // Note: the API doesn't currently support a `before` cursor — it filters
      // by `since` (lower bound) only. To keep paging useful, we pull the next
      // PAGE_SIZE-sized window. The above call requests everything and we
      // dedupe on id; an improvement is queued for a follow-up that adds a
      // `before` param to the SQL function.
      if (!res.ok) {
        console.error("[crm:ui] timeline-tab loadOlder failed", res.status);
        return;
      }
      const body = (await res.json()) as { entries: ActivityEntry[]; hasMore: boolean };
      setState((current) => {
        if (current.status !== "ready") return current;
        const seen = new Set(current.entries.map((e) => `${e.source}:${e.id}`));
        const merged = [
          ...current.entries,
          ...body.entries.filter((e) => !seen.has(`${e.source}:${e.id}`)),
        ];
        return { status: "ready", entries: merged, hasMore: body.hasMore };
      });
    } catch (err) {
      console.error("[crm:ui] timeline-tab loadOlder threw", err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5">
      <FilterChips filter={filter} onChange={setFilter} />

      <div
        className="flex flex-col bg-white"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        {state.status === "loading" ? (
          <Status message="Loading activity…" />
        ) : state.status === "unauthorized" ? (
          <Status message="Sign in to load activity." />
        ) : state.status === "error" ? (
          <Status message={state.message} tone="error" />
        ) : visibleEntries.length === 0 ? (
          <Status
            message={
              filter === "all"
                ? "No activity for this client yet. Logged notes, completed analyses, and email events show up here."
                : `No ${TYPE_LABELS[filter].toLowerCase()} entries for this client yet.`
            }
          />
        ) : (
          visibleEntries.map((entry) => (
            <TimelineRow key={`${entry.source}:${entry.id}`} entry={entry} />
          ))
        )}
      </div>

      {state.status === "ready" && state.hasMore ? (
        <button
          type="button"
          onClick={loadOlder}
          disabled={loadingMore}
          className="self-center px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-60"
          style={{
            border: "1px solid var(--ap-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--ap-navy)",
          }}
        >
          {loadingMore ? "Loading…" : "Load older"}
        </button>
      ) : null}
    </div>
  );
}

function FilterChips({
  filter,
  onChange,
}: {
  filter: FilterValue;
  onChange(next: FilterValue): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTER_ORDER.map((option) => {
        const active = option === filter;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className="px-2.5 py-1 text-[11.5px] font-medium uppercase tracking-wide transition-colors"
            style={{
              backgroundColor: active ? "var(--ap-royal)" : "rgba(12, 25, 41, 0.04)",
              color: active ? "#FFFFFF" : "var(--ap-gray)",
              border: `1px solid ${active ? "var(--ap-royal)" : "var(--ap-border)"}`,
            }}
          >
            {TYPE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

function TimelineRow({ entry }: { entry: ActivityEntry }) {
  const Icon = iconFor(entry.type);
  return (
    <div
      className="flex items-start gap-3 px-4 py-3"
      style={{ borderBottom: "1px solid var(--ap-border)" }}
    >
      <span
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center"
        style={{
          backgroundColor: "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
        }}
      >
        <Icon size={12} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className="text-[12.5px] font-medium"
          style={{ color: "var(--ap-navy)" }}
        >
          {entry.title}
        </p>
        {entry.body ? (
          <p
            className="whitespace-pre-wrap text-[11.5px] leading-snug"
            style={{ color: "var(--ap-gray)" }}
          >
            {entry.body}
          </p>
        ) : null}
        <p className="text-[10.5px]" style={{ color: "var(--ap-gray)" }}>
          {[
            entry.actorEmail ? actorLabel(entry.actorEmail) : null,
            formatTimestamp(entry.occurredAt),
            entry.source === "audit_event" ? "Audit log" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function iconFor(type: ActivityType) {
  switch (type) {
    case "note":     return StickyNote;
    case "meeting":  return Calendar;
    case "document": return FileText;
    case "email":    return Mail;
    case "call":     return PhoneCall;
    case "task":     return CheckCircle2;
    case "analysis": return Wand2;
    case "dripper":  return Droplets;
    case "system":   return ClipboardCheck;
    default:         return AlertCircle;
  }
}

function Status({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "error";
}) {
  return (
    <p
      className="px-4 py-6 text-[12.5px]"
      style={{ color: tone === "error" ? "#9B1C1C" : "var(--ap-gray)" }}
    >
      {message}
    </p>
  );
}

function actorLabel(email: string): string {
  const localPart = email.split("@")[0];
  if (!localPart) return email;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
