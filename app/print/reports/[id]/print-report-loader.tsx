"use client";

/**
 * Client-side loader for the print view.
 *
 * Why this exists as a separate file: the print page route
 * (`app/print/reports/[id]/page.tsx`) was triggering a Turbopack
 * first-compile hang because importing <PrintReportView /> directly
 * pulled the entire markdown rendering stack (react-markdown +
 * remark-gfm + chart.js + mermaid + echarts shims) into the page's
 * initial bundle graph. Even though those libraries are lazy-loaded
 * at runtime inside individual fenced-block components, Turbopack
 * still has to resolve and chunk them all at compile time for a brand
 * new route segment — which on first hit took long enough that the
 * advisor saw "spinner spins, never loads".
 *
 * The fix is `next/dynamic` with `ssr: false`. The page renders a
 * tiny shell immediately; this loader then fetches the heavy view in
 * a separate chunk on the client. First paint is fast, the renderer
 * loads in the background, and Turbopack's first-compile work for
 * the route stays bounded to the page + loader + a small "Loading…"
 * placeholder.
 *
 * The trade-off is no SSR for the print body, but that's fine — the
 * print surface is a browser-printing target, not a search-engine
 * target (the page metadata is `robots: noindex` anyway). Browsers
 * waiting on Cmd-P would not benefit from SSR'd HTML they're about
 * to throw away the moment the client component hydrates.
 *
 * If Turbopack improves first-compile budgeting for heavy routes in
 * the future, this loader can be replaced by a direct import from
 * the page file again.
 */

import dynamic from "next/dynamic";

const PrintReportView = dynamic(
  () =>
    import("@/components/crm/reports/print-report-view").then((m) => ({
      default: m.PrintReportView,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-[14px] text-slate-500">
        Preparing report…
      </div>
    ),
  },
);

export function PrintReportLoader({ reportId }: { reportId: string }) {
  return <PrintReportView reportId={reportId} />;
}
