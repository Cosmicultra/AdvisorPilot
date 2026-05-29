"use client";

/**
 * Reports list view — the client surface mounted by /app/reports/page.tsx.
 *
 * Responsibilities:
 *   - Fetch /api/reports (filter + sort applied server-side) and
 *     /api/clients (for the client-name lookup) in parallel on mount.
 *   - Re-fetch when filters change (debounced search; instant chips).
 *   - Render the filter bar + a list of <ReportRow />.
 *   - Wire delete with optimistic removal.
 *
 * The viewer route (`/app/reports/[id]`) handles publish/archive — keeping
 * the list view focused on browse + filter + delete + open. (Delete from
 * the list is hard-confirmed via the in-app <ConfirmDialog>.)
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ClientRosterItem, Report } from "@/lib/crm/types";
import {
  ReportFilterBar,
  reportFiltersToQuery,
  type SortKey,
  type SourceFilter,
  type StatusFilter,
} from "./report-filter-bar";
import { ReportRow } from "./report-row";

type FetchState =
  | { status: "loading" }
  | {
      status: "ready";
      reports: Report[];
      total: number;
      clientNames: Map<string, string>;
    }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

/** Debounce the search input so each keystroke doesn't refetch the list. */
const SEARCH_DEBOUNCE_MS = 250;

export function ReportsContent() {
  const confirm = useConfirm();
  const [state, setState] = useState<FetchState>({ status: "loading" });

  // Filter state — local; URL persistence is a follow-up.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Debounce search.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  // Fetch when filters change. We intentionally do NOT reset state to
  // "loading" synchronously here — keeping the previously-rendered list
  // visible during a refetch is the better UX (no flash of empty list)
  // and avoids the cascading-render warning from react-hooks lint. The
  // FIRST mount starts in "loading" via useState's initial value.
  useEffect(() => {
    let cancelled = false;

    const query = reportFiltersToQuery({
      status: statusFilter,
      source: sourceFilter,
      sort,
      search: debouncedSearch,
    });
    query.set("limit", "200");
    const reportsUrl = `/api/reports?${query.toString()}`;

    Promise.all([
      advisorFetch(reportsUrl, { cache: "no-store" }),
      advisorFetch("/api/clients?limit=200", { cache: "no-store" }),
    ])
      .then(async ([reportsRes, clientsRes]) => {
        if (reportsRes.status === 401 || clientsRes.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!reportsRes.ok) {
          const body = await reportsRes.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load reports (${reportsRes.status})`);
        }
        if (!clientsRes.ok) {
          const body = await clientsRes.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load clients (${clientsRes.status})`);
        }
        const reportsJson = (await reportsRes.json()) as {
          reports: Report[];
          total: number;
        };
        const clientsJson = (await clientsRes.json()) as { clients: ClientRosterItem[] };
        return { reportsJson, clientsJson };
      })
      .then((result) => {
        if (cancelled || result === null) return;
        const clientNames = new Map<string, string>();
        for (const c of result.clientsJson.clients) {
          clientNames.set(c.id, `${c.firstName} ${c.lastName}`.trim() || c.id);
        }
        setState({
          status: "ready",
          reports: result.reportsJson.reports,
          total: result.reportsJson.total,
          clientNames,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load reports.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, sourceFilter, sort, debouncedSearch, refreshKey]);

  const filteredCount = useMemo(
    () => (state.status === "ready" ? state.reports.length : 0),
    [state],
  );

  /**
   * Status breakdown of the CURRENT filtered list — surfaces in the
   * summary strip above the list so the advisor sees "5 drafts · 3
   * published · 1 archived" at a glance instead of just a total.
   */
  const statusCounts = useMemo(() => {
    const counts = { draft: 0, published: 0, archived: 0 };
    if (state.status !== "ready") return counts;
    for (const r of state.reports) {
      counts[r.status] += 1;
    }
    return counts;
  }, [state]);

  const deleteReport = async (report: Report) => {
    if (pendingIds.has(report.id)) return;
    const ok = await confirm({
      title: "Delete report?",
      message: (
        <span>
          Permanently delete <strong>&ldquo;{report.title}&rdquo;</strong>?
          This cannot be undone — consider <em>Archive</em> instead if you
          might want it back.
        </span>
      ),
      tone: "danger",
      confirmLabel: "Delete report",
    });
    if (!ok) return;
    setPendingIds((s) => new Set(s).add(report.id));
    // Optimistic removal so the UI feels snappy.
    setState((current) =>
      current.status === "ready"
        ? { ...current, reports: current.reports.filter((r) => r.id !== report.id) }
        : current,
    );
    try {
      const res = await advisorFetch(`/api/reports/${report.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[crm:ui] reports DELETE failed", body?.error ?? res.status);
        // Roll back the optimistic removal by refetching.
        bumpRefresh();
      }
    } catch (err) {
      console.error("[crm:ui] reports DELETE threw", err);
      bumpRefresh();
    } finally {
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(report.id);
        return n;
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
      <ReportFilterBar
        status={statusFilter}
        source={sourceFilter}
        sort={sort}
        search={search}
        resultCount={filteredCount}
        onStatusChange={setStatusFilter}
        onSourceChange={setSourceFilter}
        onSortChange={setSort}
        onSearchChange={setSearch}
      />

      {/* Summary strip — status breakdown + manual refresh. Skipped
          during the very first load so it doesn't flash "0 drafts" while
          the fetch is in flight. */}
      {state.status === "ready" ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-wide"
          style={{ color: "var(--ap-gray)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <CountChip
              label="Draft"
              count={statusCounts.draft}
              color="var(--ap-navy)"
            />
            <CountChip
              label="Published"
              count={statusCounts.published}
              color="var(--ap-royal)"
            />
            <CountChip
              label="Archived"
              count={statusCounts.archived}
              color="var(--ap-gray)"
            />
          </div>
          <button
            type="button"
            onClick={bumpRefresh}
            aria-label="Refresh the reports list"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium hover:bg-slate-50"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-gray)",
            }}
          >
            <RefreshCw size={11} strokeWidth={1.75} />
            Refresh
          </button>
        </div>
      ) : null}

      <div
        className="flex flex-col bg-white"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        {state.status === "loading" ? (
          <Status message="Loading reports…" />
        ) : state.status === "unauthorized" ? (
          <Status message="Sign in to load reports." />
        ) : state.status === "error" ? (
          <Status message={state.message} tone="error" />
        ) : state.reports.length === 0 ? (
          <EmptyState
            statusFilter={statusFilter}
            sourceFilter={sourceFilter}
            search={debouncedSearch}
          />
        ) : (
          state.reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              clientName={
                report.clientId
                  ? state.clientNames.get(report.clientId) ?? "Unknown client"
                  : null
              }
              pending={pendingIds.has(report.id)}
              onDelete={() => void deleteReport(report)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CountChip({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: "var(--ap-gray)" }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="font-semibold tabular-nums" style={{ color: "var(--ap-navy)" }}>
        {count}
      </span>
      <span>{label}</span>
    </span>
  );
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

function EmptyState({
  statusFilter,
  sourceFilter,
  search,
}: {
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  search: string;
}) {
  // When the user has any filter applied, prefer the "try a different filter"
  // copy. Otherwise this is a fresh advisor with no reports yet.
  const hasFilter =
    statusFilter !== "active" || sourceFilter !== "all" || search.trim().length > 0;
  if (hasFilter) {
    return (
      <p
        className="px-4 py-8 text-center text-[12.5px]"
        style={{ color: "var(--ap-gray)" }}
      >
        No reports match these filters. Try widening them or clear the search.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-10 text-center">
      <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
        No reports yet
      </p>
      <p className="text-[12px]" style={{ color: "var(--ap-gray)" }}>
        Use <strong>New report</strong> (top right) to write one yourself, or ask
        Nova in the chat to draft one — try
        <em> &ldquo;Write me a Q3 review for &lt;client&gt;&rdquo;</em>.
      </p>
    </div>
  );
}
