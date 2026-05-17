"use client";

/**
 * Collapsible stack of tool executions for one assistant message.
 *
 * Replaces the per-tool inline rows from the original chat-message-bubble
 * with a single card that summarizes every tool call in the turn. Two
 * levels of progressive disclosure:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [●●●]  Tools (3) · all succeeded            234ms  ▶ │   ← collapsed (default)
 *   └────────────────────────────────────────────────────────┘
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [●●●]  Tools (3) · all succeeded            234ms  ▼ │   ← stack expanded
 *   │  ┌──────────────────────────────────────────────────┐ │
 *   │  │  ● query_crm (list:tasks)              42ms    ▶ │ │
 *   │  │  ● query_crm (get:clients)            156ms    ▶ │ │
 *   │  │  ● query_crm (list:notes)              89ms    ▶ │ │
 *   │  └──────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────────┘
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [●●●]  Tools (3) · all succeeded            234ms  ▼ │
 *   │  ┌──────────────────────────────────────────────────┐ │
 *   │  │  ● query_crm (list:tasks)              42ms    ▼ │ │   ← tool expanded
 *   │  │  ┌────────────────────────────────────────────┐ │ │
 *   │  │  │ Request                                     │ │ │
 *   │  │  │ { "operation": "list", "entity": "tasks" } │ │ │
 *   │  │  │ Response                                    │ │ │
 *   │  │  │ { "rows": [...], "count": 5 }              │ │ │
 *   │  │  └────────────────────────────────────────────┘ │ │
 *   │  └──────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────────┘
 *
 * Status colors per user spec:
 *   - pending   → blue  (var(--ap-royal)) with subtle pulse
 *   - completed → green (#16A34A)
 *   - error     → red   (#E11D48)
 *
 * Aggregate summary:
 *   - "running" if ANY tool is pending
 *   - "{N} failed" if ANY tool errored (no pending)
 *   - "all succeeded" if all completed
 *
 * Both disclosure levels are LOCAL UI state — no persistence across messages.
 * Stays collapsed by default so the chat scroll-back doesn't get noisy.
 */

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { ToolExecution } from "@/lib/chat/chat-message-types";
import { StreamingMarkdown } from "@/lib/markdown/streaming-markdown";

interface ChatToolStackProps {
  tools: ToolExecution[];
}

export function ChatToolStack({ tools }: ChatToolStackProps) {
  const [stackOpen, setStackOpen] = useState(false);
  const [openCallIds, setOpenCallIds] = useState<Set<string>>(() => new Set());

  const summary = useMemo(() => summarize(tools), [tools]);

  if (tools.length === 0) return null;

  const toggleTool = (callId: string) => {
    setOpenCallIds((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  };

  return (
    <div
      className="overflow-hidden rounded-sm border border-slate-200 bg-slate-50 text-[11.5px] text-slate-700"
      style={{ borderColor: "var(--ap-line, #E5E7EB)" }}
    >
      {/* ─── Stack header (always visible) ─────────────────────────────── */}
      <button
        type="button"
        onClick={() => setStackOpen((v) => !v)}
        aria-expanded={stackOpen}
        aria-label={`${stackOpen ? "Collapse" : "Expand"} tools (${tools.length})`}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-slate-100"
      >
        <StatusDotCluster tools={tools} />
        <span className="flex-1 font-medium">
          Tools ({tools.length}) ·{" "}
          <span style={{ color: summary.tone }}>{summary.label}</span>
        </span>
        {summary.totalMs !== null ? (
          <span className="tabular-nums text-slate-500">{summary.totalMs}ms</span>
        ) : null}
        <Chevron open={stackOpen} />
      </button>

      {/* ─── Tool rows (level-1 disclosure) ────────────────────────────── */}
      {stackOpen ? (
        <ul className="flex flex-col divide-y divide-slate-200 border-t border-slate-200">
          {tools.map((tool) => (
            <li key={tool.callId}>
              <ToolRow
                tool={tool}
                open={openCallIds.has(tool.callId)}
                onToggle={() => toggleTool(tool.callId)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool row (level-1) + detail (level-2)
// ─────────────────────────────────────────────────────────────────────────────

interface ToolRowProps {
  tool: ToolExecution;
  open: boolean;
  onToggle: () => void;
}

function ToolRow({ tool, open, onToggle }: ToolRowProps) {
  const duration = deriveDurationMs(tool);
  const subtitle = deriveCallSubtitle(tool);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${tool.name}`}
        className="flex w-full items-center gap-2 bg-white px-2.5 py-1.5 text-left transition-colors hover:bg-slate-50"
      >
        <StatusDot status={tool.status} />
        <span className="flex-1 font-mono text-slate-800">
          {tool.name}
          {subtitle ? (
            <span className="ml-1 font-sans text-slate-500">({subtitle})</span>
          ) : null}
        </span>
        {tool.status === "pending" && tool.progress ? (
          <span className="tabular-nums text-slate-500">
            {tool.progress.progress}/{tool.progress.total}
          </span>
        ) : null}
        {duration !== null ? (
          <span className="tabular-nums text-slate-500">{duration}ms</span>
        ) : null}
        <Chevron open={open} />
      </button>

      {open ? <ToolDetail tool={tool} /> : null}
    </>
  );
}

function ToolDetail({ tool }: { tool: ToolExecution }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-2.5 py-2">
      <DetailSection label="Request">
        <CodeBlock content={prettyJson(tool.args)} />
      </DetailSection>

      {/* Live preview while the tool is still streaming output. Tools
          that emit partial text (e.g. generate_report_content writing
          the report markdown live) populate `partialText` via the
          tool:result_partial SSE event. Renders via the same
          <StreamingMarkdown> the chat bubble uses, so charts and
          mermaid blocks render as the model produces them. */}
      {tool.status === "pending" && tool.partialText ? (
        <DetailSection label="Live draft">
          <div className="rounded border border-slate-200 bg-white p-3 text-[12.5px] leading-relaxed text-slate-800">
            <StreamingMarkdown text={tool.partialText} isStreaming />
          </div>
        </DetailSection>
      ) : null}

      {tool.status === "completed" ? (
        <DetailSection label="Response">
          <CodeBlock content={prettyJson(tool.result)} />
        </DetailSection>
      ) : null}

      {tool.status === "error" ? (
        <DetailSection label="Error" tone="error">
          <CodeBlock content={tool.error ?? "(no error message)"} mono={false} />
        </DetailSection>
      ) : null}

      {tool.status === "pending" && tool.progress ? (
        <DetailSection label="Progress">
          <CodeBlock
            content={`${tool.progress.message} (${tool.progress.progress}/${tool.progress.total}${
              tool.progress.phase ? ` — ${tool.progress.phase}` : ""
            })`}
            mono={false}
          />
        </DetailSection>
      ) : null}
    </div>
  );
}

function DetailSection({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[10px] font-medium uppercase tracking-[0.06em]"
        style={{ color: tone === "error" ? "#E11D48" : "#475569" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function CodeBlock({ content, mono = true }: { content: string; mono?: boolean }) {
  return (
    <pre
      className={`max-h-48 overflow-auto rounded-sm border border-slate-200 bg-white px-2 py-1.5 text-[10.5px] leading-snug text-slate-700 ${mono ? "font-mono" : "font-sans"} whitespace-pre-wrap break-all`}
      style={{ borderColor: "var(--ap-line, #E5E7EB)" }}
    >
      {content}
    </pre>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status indicators
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ToolExecution["status"], string> = {
  pending: "var(--ap-royal)",
  completed: "#16A34A",
  error: "#E11D48",
};

function StatusDot({ status }: { status: ToolExecution["status"] }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
        status === "pending" ? "animate-pulse" : ""
      }`}
      style={{ backgroundColor: STATUS_COLOR[status] }}
    />
  );
}

/**
 * Up to three overlapping dots representing the FIRST three tools' statuses.
 * Lets the advisor read the aggregate health at a glance without expanding.
 * For 4+ tools we show the first three + a "+N" badge later (rare case).
 */
function StatusDotCluster({ tools }: { tools: ToolExecution[] }) {
  const visible = tools.slice(0, 3);
  return (
    <span
      aria-hidden="true"
      className="inline-flex flex-shrink-0 items-center"
      style={{ width: visible.length === 1 ? 10 : visible.length * 6 + 4 }}
    >
      {visible.map((t, i) => (
        <span
          key={t.callId}
          className={`inline-block h-2 w-2 rounded-full border border-white ${
            t.status === "pending" ? "animate-pulse" : ""
          }`}
          style={{
            backgroundColor: STATUS_COLOR[t.status],
            marginLeft: i === 0 ? 0 : -2,
          }}
        />
      ))}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={12}
      strokeWidth={2.25}
      className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation helpers
// ─────────────────────────────────────────────────────────────────────────────

interface StackSummary {
  /** "running" / "all succeeded" / "{N} failed" */
  label: string;
  /** Color matching the label tone — for the stack header. */
  tone: string;
  /** Sum of all completed/errored durations in ms; null when nothing has a duration yet. */
  totalMs: number | null;
}

function summarize(tools: ToolExecution[]): StackSummary {
  const counts = tools.reduce(
    (acc, t) => {
      acc[t.status] += 1;
      return acc;
    },
    { pending: 0, completed: 0, error: 0 } as Record<
      ToolExecution["status"],
      number
    >,
  );

  let totalMs: number | null = null;
  for (const t of tools) {
    const ms = deriveDurationMs(t);
    if (ms !== null) totalMs = (totalMs ?? 0) + ms;
  }

  if (counts.pending > 0) {
    return {
      label: counts.pending === tools.length ? "running" : "running…",
      tone: STATUS_COLOR.pending,
      totalMs,
    };
  }
  if (counts.error > 0) {
    return {
      label: counts.error === tools.length ? "failed" : `${counts.error} failed`,
      tone: STATUS_COLOR.error,
      totalMs,
    };
  }
  return {
    label: "all succeeded",
    tone: STATUS_COLOR.completed,
    totalMs,
  };
}

/**
 * Best-effort wall-clock from the tool's start/complete timestamps. Returns
 * null for still-pending calls with no progress info. The runner emits
 * `tool:result` with a `durationMs` field in its SSE payload — we don't
 * carry that into `ToolExecution` today (the hook only stores
 * `startedAt`/`completedAt`), so we synthesize from the timestamps.
 */
function deriveDurationMs(tool: ToolExecution): number | null {
  if (!tool.completedAt) return null;
  return Math.max(0, tool.completedAt - tool.startedAt);
}

/**
 * Pull a short human-readable subtitle out of `args` so the row is more
 * informative than just the bare tool name. For `query_crm` we render
 * `operation:entity`; for unknown tools we omit the subtitle.
 */
function deriveCallSubtitle(tool: ToolExecution): string | null {
  if (tool.name === "query_crm") {
    const op = typeof tool.args.operation === "string" ? tool.args.operation : "?";
    const entity = typeof tool.args.entity === "string" ? tool.args.entity : "?";
    return `${op}:${entity}`;
  }
  return null;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
