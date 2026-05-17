"use client";

/**
 * Print-optimized report view — opens in a new tab from the action bar
 * Print button. Renders the same markdown the in-app viewer renders but
 * in a chromeless, forced-light layout with print-tuned CSS.
 *
 * Design lineage: control_tower/src/pages/reports/print.tsx — the
 * separate-route pattern is the one battle-tested choice for printing
 * mixed markdown + charts + Mermaid + tables reliably. Earlier we tried
 * `window.print()` from the viewer page directly; that produced a mess
 * because the CRM sidebar, header chrome, badges, gradient backgrounds,
 * and dark-mode-ready styles all came along for the ride. A dedicated
 * route lets us treat print as a first-class output target with its
 * own theme, page geometry, and rendering schedule.
 *
 * Lifecycle:
 *   1. Mount → fetch /api/reports/:id (same endpoint the viewer uses).
 *   2. While loading, show a minimal "Preparing report…" splash.
 *   3. After the report fetches, render it via <StreamingMarkdown> with
 *      `isStreaming={false}`. ChartJS/Mermaid/ECharts blocks start
 *      lazy-loading.
 *   4. Wait 2s for charts + Mermaid SVGs to finish rendering, then
 *      reveal the floating "Print / Save as PDF" button. The advisor
 *      can always Cmd-P sooner — the delay only gates the convenience
 *      button so we don't suggest "go!" before the document is ready.
 *
 * Authentication: this route is OUTSIDE /app/* so it doesn't inherit
 * the authenticated app layout. The fetch itself relies on the same
 * advisorFetch wrapper used everywhere else (cookies-based session for
 * both NextAuth/Google and the Supabase JWT path). If the cookie is
 * missing or expired the page renders an "Unauthorized" splash with a
 * link back to /signin — same friendly behavior as the in-app viewer.
 *
 * Styling: the entire print CSS lives in a single inline <style> block
 * scoped to `.print-view-container` plus an unscoped `@media print`
 * section. Inline because Next.js global CSS modules don't compose
 * nicely with route-segment-only overrides, and we want zero risk that
 * these rules leak to other routes.
 */

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { requestTokenFromOtherTabs } from "@/lib/auth/token-bridge";
import { StreamingMarkdown } from "@/lib/markdown/streaming-markdown";
import type { Report } from "@/lib/crm/types";

/**
 * Time we wait between the report rendering and revealing the floating
 * "Print" button. Long enough to let Mermaid finish its async svg
 * generation and Chart.js to size its canvases; short enough that
 * advisors don't sit watching a blank page wondering if anything's
 * happening. Matches the Control Tower default — borrowed because it
 * was tuned empirically against the same renderer stack.
 */
const RENDER_SETTLE_MS = 2000;

type FetchState =
  | { status: "loading" }
  | { status: "ready"; report: Report; clientName: string | null }
  | { status: "not_found" }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export interface PrintReportViewProps {
  reportId: string;
}

export function PrintReportView({ reportId }: PrintReportViewProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [readyToPrint, setReadyToPrint] = useState(false);

  // Fetch the report on mount / when the id changes. Mirrors the
  // in-app viewer's fetch path so visibility, errors, and shape stay
  // in lockstep — any change to /api/reports/[id] applies to both
  // surfaces without us having to remember to update two callers.
  //
  // BEFORE the fetch we always ask sibling tabs for a Supabase token
  // via the cross-tab bridge. This is a no-op for Google-auth users
  // (their session lives in cookies that forward across tabs already)
  // and a critical step for email/password users (sessionStorage is
  // per-tab — see .cursor/rules/50-authentication.mdc). The bridge
  // resolves in ≤1.5s either way; if it returns nothing and we don't
  // have a Google cookie, the first fetch will 401 and we render the
  // unauthorized splash with a clear "session expired" message.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await requestTokenFromOtherTabs();
      if (cancelled) return;

      try {
        const res = await advisorFetch(`/api/reports/${reportId}`, {
          cache: "no-store",
        });
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
        // Best-effort client name lookup. If it fails, the printed page
        // just shows nothing in that slot — no need to block the print
        // for a missing meta detail.
        const clientName = await fetchClientName(report.clientId);
        if (cancelled) return;
        setState({ status: "ready", report, clientName });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load report.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reportId]);

  // 2-second settling delay before showing the Print button. Tied to
  // the report id so re-fetches reset the timer (advisor printing
  // multiple reports in quick succession via a script, etc.).
  useEffect(() => {
    if (state.status !== "ready") return;
    const t = window.setTimeout(() => setReadyToPrint(true), RENDER_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [state.status, reportId]);

  return (
    <>
      <PrintStyles />
      <div className="print-view-container min-h-screen bg-white">
        {state.status === "loading" ? (
          <Splash title="Preparing report…" />
        ) : state.status === "unauthorized" ? (
          <Splash
            title="Sign in required"
            body="Open this report from inside AdvisorPilot to print it. If you're already signed in, your other tab may have been closed — sign back in and try again."
            actionHref="/signin"
            actionLabel="Open sign in"
          />
        ) : state.status === "not_found" ? (
          <Splash
            title="Report not found"
            body="It may have been deleted or you no longer have access."
          />
        ) : state.status === "error" ? (
          <Splash title="Couldn't load report" body={state.message} />
        ) : (
          <ReportBody report={state.report} clientName={state.clientName} />
        )}

        {state.status === "ready" && readyToPrint ? (
          <div className="print-float-button no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 px-5 py-3 text-[13px] font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "var(--ap-navy)",
                border: "1px solid var(--ap-navy)",
                borderRadius: 999,
              }}
            >
              <Printer size={16} strokeWidth={1.75} />
              Print / Save as PDF
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ReportBody({
  report,
  clientName,
}: {
  report: Report;
  clientName: string | null;
}) {
  return (
    <div className="mx-auto max-w-[800px] px-8 py-10 print-content">
      <header className="print-header mb-6 pb-4">
        <div className="flex items-center gap-3">
          {report.icon ? (
            <span aria-hidden className="text-[26px] leading-none">
              {report.icon}
            </span>
          ) : null}
          <h1 className="font-display text-[26px] font-semibold leading-tight">
            {report.title || "Untitled report"}
          </h1>
        </div>
        {/*
         * Print meta line — deliberately minimal. A printed document
         * going to a client doesn't need (and shouldn't volunteer)
         * "AI generated", "You wrote", or the model id; those are
         * internal authorship metadata, not something the recipient
         * cares about. We surface only the client name (if the report
         * is tied to one) and the most relevant date (the latest
         * updatedAt, falling back to createdAt for never-edited
         * drafts).
         */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] print-meta">
          {clientName ? (
            <>
              <span>{clientName}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span>{formatFullDate(report.updatedAt || report.createdAt)}</span>
        </div>
      </header>

      <main className="prose max-w-none">
        {report.content.trim() ? (
          <StreamingMarkdown text={report.content} isStreaming={false} />
        ) : (
          <p>This report has no content.</p>
        )}
      </main>
    </div>
  );
}

function Splash({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-display text-[22px] font-semibold">{title}</h1>
        {body ? (
          <p className="max-w-[420px] text-[14px]" style={{ color: "#6b7280" }}>
            {body}
          </p>
        ) : null}
        {actionHref && actionLabel ? (
          <a
            href={actionHref}
            className="mt-1 px-4 py-2 text-[13px] font-semibold text-white"
            style={{
              backgroundColor: "var(--ap-royal)",
              border: "1px solid var(--ap-royal)",
            }}
          >
            {actionLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Lookup the client name. Swallows errors and returns null — the print
 * page renders fine without it.
 */
async function fetchClientName(
  clientId: string | null,
): Promise<string | null> {
  if (!clientId) return null;
  try {
    const res = await advisorFetch(`/api/clients/${clientId}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      client?: {
        name?: string;
        firstName?: string;
        lastName?: string;
      };
    };
    if (!body.client) return null;
    if (body.client.name) return body.client.name;
    const first = body.client.firstName ?? "";
    const last = body.client.lastName ?? "";
    const full = `${first} ${last}`.trim();
    return full.length > 0 ? full : null;
  } catch {
    return null;
  }
}

function formatFullDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The whole print stylesheet. Lives inline so it's scoped to
 * `.print-view-container` and only mounts when the print page does.
 *
 * Three concerns:
 *   1. **Screen view** — what the advisor sees in the new tab BEFORE
 *      hitting Cmd-P. Force a light palette regardless of any dark-mode
 *      preference; cap chart sizes so the on-screen layout matches the
 *      printed output.
 *   2. **Mermaid theming** — Mermaid is initialized once per page load
 *      with a single theme. We init with the brand-tuned theme for the
 *      app; here we override the resulting SVG fills/strokes so they
 *      print in a light, high-contrast palette.
 *   3. **`@media print`** — page geometry, page-break hints, and the
 *      `-webkit-print-color-adjust: exact` declarations that prevent
 *      browsers from stripping table backgrounds and tinted blockquotes
 *      "to save ink".
 *
 * Brand palette mapping (Control Tower → AdvisorPilot):
 *   - CT used orange-500 (#f97316) for accents. AP uses royal blue
 *     (--ap-royal #0f6fde) — that's the link/code/blockquote rule.
 *   - CT used gray-900 for headings. AP uses navy (--ap-navy #0c1929).
 *   - CT used gray-700 for body. AP uses #1f2937 (slate-800) here for
 *     paper legibility — slightly darker than the in-app meta gray.
 */
function PrintStyles() {
  return (
    <style>{`
      /* ─────────────────────────────────────────────────────────────
         1. Screen overrides — force light palette + brand accents
         ───────────────────────────────────────────────────────────── */

      .print-view-container,
      .print-view-container * {
        color-scheme: light !important;
      }

      .print-view-container {
        font-family: var(--font-inter), system-ui, -apple-system, sans-serif;
        color: #1f2937;
      }

      .print-view-container h1,
      .print-view-container h2,
      .print-view-container h3,
      .print-view-container h4,
      .print-view-container h5,
      .print-view-container h6 {
        color: #0c1929 !important;
        font-family: var(--font-fraunces), Georgia, serif;
      }

      .print-view-container p,
      .print-view-container li,
      .print-view-container td,
      .print-view-container th,
      .print-view-container span:not(.chart-container *),
      .print-view-container div:not(.chart-container) {
        color: #1f2937;
      }

      .print-view-container .print-meta {
        color: #6b7280;
      }

      .print-view-container .print-header {
        border-bottom: 2px solid #e5e7eb;
      }

      .print-view-container a {
        color: #0f6fde !important;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      /* Inline code: subtle gray tint, dark text — readable on paper
         and barely tints the page. */
      .print-view-container code {
        color: #0c1929 !important;
        background-color: #f3f4f6 !important;
        padding: 0.1em 0.3em;
        border-radius: 3px;
        font-family: var(--font-geist-mono), ui-monospace, monospace;
        font-size: 0.92em;
      }

      /* Code blocks (<pre>): light gray background, dark text. The
         in-app chat / chrome uses a dark Code-IDE style for code
         blocks; we deliberately reverse that for print so we don't
         waste a quarter cup of toner per page on filled rectangles
         and so the printed code actually scans well. */
      .print-view-container pre {
        background-color: #f3f4f6 !important;
        color: #0c1929 !important;
        border: 1px solid #e5e7eb !important;
        border-radius: 6px;
        padding: 0.85rem 1rem;
        overflow-x: auto;
      }

      .print-view-container pre code {
        color: #0c1929 !important;
        background-color: transparent !important;
        padding: 0;
        border: 0;
      }

      /* ─────────────────────────────────────────────────────────────
         Defensive overrides: some LLM-supplied chart specs may set a
         dark backgroundColor (e.g. #0f172a from a default ECharts
         theme), and the chart container own bg-white wont beat
         the canvas pixel-fill. Force chart surfaces to stay light no
         matter what the spec said.
         NOTE: do not use backticks inside this <style> template
         literal -- they terminate the JS template string early.
         ───────────────────────────────────────────────────────────── */

      .print-view-container .my-4,
      .print-view-container .my-6 {
        background-color: #ffffff !important;
        border-color: #e5e7eb !important;
      }

      .print-view-container [class*="echarts"],
      .print-view-container [class*="echarts"] > div,
      .print-view-container [class*="echarts"] canvas {
        background-color: transparent !important;
      }

      .print-view-container canvas {
        background-color: transparent !important;
      }

      .print-view-container blockquote {
        border-left: 4px solid #0f6fde !important;
        background-color: #eef4fc !important;
        margin: 1rem 0;
        padding: 0.5rem 1rem;
        font-style: italic;
      }

      .print-view-container table {
        border-collapse: collapse;
        width: 100%;
        margin: 1rem 0;
      }

      .print-view-container table th {
        background-color: #f3f4f6 !important;
        color: #1f2937 !important;
        padding: 10px 12px;
        text-align: left;
        font-weight: 600;
        border: 1px solid #e5e7eb;
      }

      .print-view-container table td {
        color: #1f2937 !important;
        padding: 10px 12px;
        border: 1px solid #e5e7eb;
        vertical-align: top;
      }

      .print-view-container table tr:nth-child(even) {
        background-color: #f9fafb;
      }

      .print-view-container hr {
        border: 0;
        border-top: 1px solid #e5e7eb !important;
        margin: 1.5rem 0;
      }

      .print-view-container ul,
      .print-view-container ol {
        margin: 0.75rem 0;
        padding-left: 1.5rem;
      }

      .print-view-container li {
        margin: 0.25rem 0;
      }

      /* ─────────────────────────────────────────────────────────────
         2. Chart sizing — keep canvases / svgs from dominating pages
         ───────────────────────────────────────────────────────────── */

      .print-view-container canvas {
        max-height: 380px !important;
        max-width: 100% !important;
        width: 100% !important;
        height: auto !important;
        margin: 0 auto;
        display: block;
      }

      /* ECharts wrapper — use class-name-prefix match since react-echarts
         emits an autogenerated div with an echarts-flavored class. */
      .print-view-container [class*="echarts"] {
        max-height: 380px !important;
        width: 100% !important;
      }

      /* ─────────────────────────────────────────────────────────────
         3. Mermaid — force a light, high-contrast palette regardless
            of which theme the app initialized Mermaid with.
         ───────────────────────────────────────────────────────────── */

      .print-view-container svg[id^="mermaid"],
      .print-view-container svg[aria-roledescription="flowchart-v2"],
      .print-view-container svg[aria-roledescription="sequence"],
      .print-view-container svg[aria-roledescription="er"],
      .print-view-container svg[aria-roledescription="gantt"] {
        background-color: transparent !important;
        max-width: 100%;
        margin: 0 auto;
        display: block;
      }

      .print-view-container svg .node rect,
      .print-view-container svg .node polygon,
      .print-view-container svg .node circle,
      .print-view-container svg .node ellipse {
        fill: #f1f5f9 !important;
        stroke: #94a3b8 !important;
      }

      .print-view-container svg .nodeLabel,
      .print-view-container svg .node .label,
      .print-view-container svg text,
      .print-view-container svg .edgeLabel {
        fill: #0c1929 !important;
        color: #0c1929 !important;
      }

      .print-view-container svg .edge path,
      .print-view-container svg .flowchart-link,
      .print-view-container svg path.path {
        stroke: #64748b !important;
      }

      .print-view-container svg marker path {
        fill: #64748b !important;
        stroke: #64748b !important;
      }

      .print-view-container svg .edgeLabel rect {
        fill: #f8fafc !important;
      }

      .print-view-container svg .cluster rect {
        fill: #f1f5f9 !important;
        stroke: #cbd5e1 !important;
      }

      .print-view-container svg .cluster text {
        fill: #334155 !important;
      }

      /* ─────────────────────────────────────────────────────────────
         4. Print-only rules
         ───────────────────────────────────────────────────────────── */

      @media print {
        @page {
          margin: 0.5in;
          size: letter;
        }

        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
        }

        .no-print {
          display: none !important;
        }

        .print-view-container {
          padding: 0 !important;
          margin: 0 !important;
          min-height: auto !important;
        }

        .print-content {
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0.25in !important;
          box-sizing: border-box !important;
        }

        .print-header {
          margin: 0 0 1.25rem 0 !important;
          padding: 0 0 0.75rem 0 !important;
          border-bottom: 2px solid #d1d5db !important;
        }

        .print-header h1 {
          margin: 0 !important;
          padding: 0 !important;
        }

        h1, h2, h3, h4, h5, h6 {
          page-break-after: avoid;
        }

        img, svg, table, pre, blockquote, canvas {
          page-break-inside: avoid;
        }

        p {
          orphans: 3;
          widows: 3;
        }

        /* Tighter chart caps in print than on screen — printers handle
           ~320px of vertical canvas comfortably, much more than that and
           a chart hogs an entire sheet. */
        canvas {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          max-height: 320px !important;
          max-width: 100% !important;
          width: 100% !important;
          margin: 0.5rem auto !important;
          display: block !important;
        }

        [class*="echarts"] {
          max-height: 320px !important;
        }

        svg[id^="mermaid"],
        svg[aria-roledescription="flowchart-v2"],
        svg[aria-roledescription="sequence"],
        svg[aria-roledescription="er"],
        svg[aria-roledescription="gantt"] {
          max-height: 420px !important;
          max-width: 100% !important;
        }

        /* Re-apply Mermaid light theme inside @media print — some browsers
           (Safari historically) don't carry screen-mode rules into the
           print stylesheet computation. */
        svg .node rect, svg .node polygon {
          fill: #f1f5f9 !important;
          stroke: #94a3b8 !important;
        }
        svg .nodeLabel, svg text {
          fill: #0c1929 !important;
        }
        svg .edge path, svg .flowchart-link {
          stroke: #64748b !important;
        }

        /* Tables: force the alternating-row background to survive
           ink-saver mode, and snap any inline color to the dark-on-light
           we computed for screen so cell text never disappears. */
        table tr:nth-child(even) {
          background-color: #f9fafb !important;
        }
        table th {
          background-color: #f3f4f6 !important;
        }
        blockquote {
          background-color: #eef4fc !important;
        }

        /* Code blocks stay light on paper. The dark IDE-style
           in-app variant burns toner and prints poorly on most
           inkjets; light-gray with dark text is faster to print and
           reads as well. */
        pre {
          background-color: #f3f4f6 !important;
          color: #0c1929 !important;
          border: 1px solid #e5e7eb !important;
        }
        pre code {
          color: #0c1929 !important;
          background-color: transparent !important;
        }

        /* Chart surfaces stay light regardless of any
           spec-supplied backgroundColor. */
        .my-4,
        .my-6 {
          background-color: #ffffff !important;
          border-color: #e5e7eb !important;
        }
        canvas,
        [class*="echarts"],
        [class*="echarts"] > div,
        [class*="echarts"] canvas {
          background-color: transparent !important;
        }
      }

      /* ─────────────────────────────────────────────────────────────
         5. Screen-only chrome — the floating "Print" button
         ───────────────────────────────────────────────────────────── */

      @media screen {
        .print-float-button {
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          z-index: 50;
        }
      }
    `}</style>
  );
}
