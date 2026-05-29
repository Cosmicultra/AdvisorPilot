"use client";

/**
 * Report viewer — the client surface mounted by /app/reports/[id]/page.tsx.
 *
 * Layout:
 *   - Back link to the list
 *   - Header card: icon · title · status badge · meta (created, source,
 *     model, client link if any, tags)
 *   - Actions bar (publish / archive / copy link / print / delete)
 *   - Article body — markdown rendered via <StreamingMarkdown> (same
 *     renderer the chat uses; charts render via Chart.js fenced blocks)
 *
 * Fetches /api/reports/[id] once on mount (and again whenever `id` changes).
 * The viewer is otherwise stateless — actions live in <ReportActions />
 * which updates the local report state via the `onUpdated` callback so
 * the user sees the new status without a full refetch.
 *
 * Print path: printing is handled by a separate /print/reports/[id]
 * route (chromeless, forced-light, tuned @media print rules). The Print
 * button in <ReportActions /> opens that route in a new tab. The in-app
 * viewer is NOT print-targeted — `print:hidden` classes left over from
 * the previous direct `window.print()` pattern are still here as
 * defense in case anyone hits Cmd-P while looking at the viewer, but
 * the supported flow is the dedicated print page.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { StreamingMarkdown } from "@/lib/markdown/streaming-markdown";
import type { Report } from "@/lib/crm/types";
import { ReportActions } from "./report-actions";
import { ReportEditor } from "./report-editor";
import { ReportStatusBadge } from "./report-status-badge";

interface FetchedClientName {
  id: string;
  name: string;
}

type FetchState =
  | { status: "loading" }
  | { status: "ready"; report: Report; clientName: string | null }
  | { status: "not_found" }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export interface ReportViewerProps {
  reportId: string;
}

export function ReportViewer({ reportId }: ReportViewerProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  // We intentionally do NOT reset state to "loading" synchronously here
  // — the initial useState value already starts in "loading", and on a
  // reportId change keeping the previous report visible until the new
  // fetch resolves looks better than a flash of skeleton. Avoids the
  // react-hooks/set-state-in-effect lint warning too.
  useEffect(() => {
    let cancelled = false;

    advisorFetch(`/api/reports/${reportId}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthorized" });
          return;
        }
        if (res.status === 404) {
          setState({ status: "not_found" });
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          report?: Report;
          error?: string;
        };
        if (!res.ok || !body.report) {
          setState({
            status: "error",
            message: body.error ?? `Failed to load report (${res.status})`,
          });
          return;
        }
        const report = body.report;
        const clientName = await fetchClientName(report.clientId);
        if (cancelled) return;
        setState({ status: "ready", report, clientName });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load report.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [reportId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
      <BackLink />

      {state.status === "loading" ? (
        <Status message="Loading report…" />
      ) : state.status === "unauthorized" ? (
        <Status message="Sign in to load this report." />
      ) : state.status === "not_found" ? (
        <Status
          message="Report not found. It may have been deleted or you no longer have access."
          tone="warn"
        />
      ) : state.status === "error" ? (
        <Status message={state.message} tone="error" />
      ) : (
        <ReadyView
          report={state.report}
          clientName={state.clientName}
          onUpdated={(next) =>
            setState((current) =>
              current.status === "ready" ? { ...current, report: next } : current,
            )
          }
        />
      )}
    </div>
  );
}

function ReadyView({
  report,
  clientName,
  onUpdated,
}: {
  report: Report;
  clientName: string | null;
  onUpdated(next: Report): void;
}) {
  const [editing, setEditing] = useState(false);

  // Save handler for the editor — PATCH /api/reports/[id] with the new
  // title + content, then bubble the fresh report back to the parent so
  // the viewer re-renders. Returns the editor-state result shape.
  const onEditorSave = async ({
    title,
    content,
  }: {
    title: string;
    content: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const res = await advisorFetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        report?: Report;
        error?: string;
      };
      if (!res.ok || !body.report) {
        return {
          ok: false,
          error: body.error ?? `Save failed (${res.status})`,
        };
      }
      onUpdated(body.report);
      // Stay in edit mode after a successful save (advisor often makes
      // multiple passes); they can hit the "Done" button to exit.
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Save failed.",
      };
    }
  };

  if (editing) {
    return (
      <>
        <header
          className="flex items-center justify-between gap-2 bg-white p-3"
          style={{ border: "1px solid var(--ap-border)" }}
        >
          <div className="flex items-center gap-2">
            <ReportStatusBadge status={report.status} size="md" />
            <span
              className="text-[11.5px] uppercase tracking-[0.06em]"
              style={{ color: "var(--ap-gray)" }}
            >
              Editing
            </span>
          </div>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-2.5 py-1.5 text-[12px] font-medium"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            Done editing
          </button>
        </header>
        <ReportEditor
          mode="existing"
          initialTitle={report.title}
          initialContent={report.content}
          icon={report.icon}
          onSave={onEditorSave}
          onCancel={() => setEditing(false)}
          saveLabel="Save changes"
        />
      </>
    );
  }

  return (
    <>
      <header
        className="flex flex-col gap-3 bg-white p-5"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-[22px] leading-none"
            style={{
              backgroundColor: "rgba(12, 25, 41, 0.04)",
              border: "1px solid var(--ap-border)",
            }}
          >
            {report.icon}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                className="font-display text-[18px] font-semibold leading-tight"
                style={{ color: "var(--ap-navy)" }}
              >
                {report.title || "Untitled report"}
              </h2>
              <ReportStatusBadge status={report.status} size="md" />
            </div>
            <MetaLine report={report} clientName={clientName} />
            {report.tags.length > 0 ? <TagPills tags={report.tags} /> : null}
          </div>

          {/* Edit button sits in the top-right of the header card; we lean
              on the Lucide pencil so the advisor's eye lands on it immediately. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex flex-shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium print:hidden"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            <Pencil size={12} strokeWidth={1.75} />
            Edit
          </button>
        </div>

        <ReportActions report={report} onUpdated={onUpdated} />
      </header>

      <article
        className="bg-white p-6 text-[13.5px] leading-relaxed print:border-0 print:p-0"
        style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
      >
        {report.content.trim() ? (
          <StreamingMarkdown text={report.content} isStreaming={false} />
        ) : (
          <p style={{ color: "var(--ap-gray)" }}>
            This report has no content yet. Click <em>Edit</em> to add some.
          </p>
        )}
      </article>
    </>
  );
}

function MetaLine({
  report,
  clientName,
}: {
  report: Report;
  clientName: string | null;
}) {
  const parts: React.ReactNode[] = [];

  if (report.clientId) {
    parts.push(
      <Link
        key="client"
        href={`/app/crm/${report.clientId}/overview`}
        className="font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        {clientName ?? "Unknown client"}
      </Link>,
    );
  } else {
    parts.push(<span key="standalone">Standalone</span>);
  }

  parts.push(<span key="source">{formatSourceLabel(report.source)}</span>);

  if (report.generatedByModel) {
    parts.push(
      <span key="model" title={report.generatedByProvider ?? undefined}>
        {report.generatedByModel}
      </span>,
    );
  }

  parts.push(
    <span key="created">Created {formatFullDate(report.createdAt)}</span>,
  );
  if (report.updatedAt !== report.createdAt) {
    parts.push(
      <span key="updated">Updated {formatFullDate(report.updatedAt)}</span>,
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]"
      style={{ color: "var(--ap-gray)" }}
    >
      {parts.map((node, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden>·</span> : null}
          {node}
        </span>
      ))}
    </div>
  );
}

function TagPills({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em]"
          style={{
            backgroundColor: "rgba(12, 25, 41, 0.04)",
            color: "var(--ap-gray)",
            border: "1px solid var(--ap-border)",
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/app/reports"
      className="inline-flex items-center gap-1 self-start text-[12px] font-medium underline-offset-2 hover:underline print:hidden"
      style={{ color: "var(--ap-royal)" }}
    >
      <ArrowLeft size={12} strokeWidth={1.75} />
      Back to reports
    </Link>
  );
}

function Status({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "warn" | "error";
}) {
  const color =
    tone === "error" ? "#9B1C1C" : tone === "warn" ? "#92400E" : "var(--ap-gray)";
  return (
    <div
      className="bg-white px-4 py-6 text-[12.5px]"
      style={{ border: "1px solid var(--ap-border)", color }}
    >
      {message}
    </div>
  );
}

/**
 * Look up the client's display name via /api/clients/[id]. Soft-fails
 * (returns null) — the viewer renders fine without a name in the meta
 * line; just shows "Unknown client" link text.
 *
 * Single-row fetch keeps the viewer fast; we don't need the full roster.
 */
async function fetchClientName(clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  try {
    const res = await advisorFetch(`/api/clients/${clientId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { client?: FetchedClientName | { firstName?: string; lastName?: string } };
    if (!body.client) return null;
    if ("name" in body.client && typeof body.client.name === "string") {
      return body.client.name;
    }
    const first = "firstName" in body.client ? body.client.firstName ?? "" : "";
    const last = "lastName" in body.client ? body.client.lastName ?? "" : "";
    const full = `${first} ${last}`.trim();
    return full.length > 0 ? full : null;
  } catch {
    return null;
  }
}

function formatSourceLabel(source: Report["source"]): string {
  switch (source) {
    case "ai_generated":
      return "AI generated";
    case "advisor_authored":
      return "You wrote";
    case "imported":
      return "Imported";
  }
}

function formatFullDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
