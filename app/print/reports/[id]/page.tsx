import type { Metadata } from "next";
import { PrintReportLoader } from "./print-report-loader";

/**
 * /print/reports/[id] — chromeless print view.
 *
 * Server shell only — the actual rendering is in <PrintReportView />
 * which fetches /api/reports/[id] via advisorFetch and mounts the
 * Control-Tower-style print layout (forced light theme, capped chart
 * sizes, page-break-aware @media print rules, floating Print button
 * after a 2-second render-settle delay).
 *
 * Lives OUTSIDE /app/* on purpose so it doesn't inherit:
 *   - ConfirmProvider, ChatLocationProvider, GlobalChatLauncher
 *     (mounted in app/app/layout.tsx)
 *   - CrmShell sidebar (mounted in app/app/(crm)/layout.tsx)
 *
 * Note: there is intentionally NO `app/print/layout.tsx`. The root
 * `app/layout.tsx` provides `<html>` and `<body>`, which is everything
 * the print surface needs. A fragment-only intermediate layout was
 * tried initially but caused Turbopack to hang on first compile — an
 * empty layout segment provides zero value and only adds a compile
 * step. If we ever need print-specific shared chrome (e.g. a /print
 * landing index or a /print/reports/[id]/v/[version] route), add a
 * real layout then.
 *
 * Opened in a new tab via the Print button in the in-app viewer.
 *
 * Why the dynamic loader: importing the heavy print view directly here
 * caused Turbopack to hang on first-compile of this brand-new route
 * (the print view transitively pulls in react-markdown, chart.js,
 * mermaid, and echarts shim chunks). The <PrintReportLoader /> client
 * component fetches the real view with `next/dynamic` so this page's
 * own bundle stays trivial and compiles in well under a second.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 * Pattern lineage: control_tower/src/pages/reports/print.tsx.
 */
export const metadata: Metadata = {
  title: "Print report — AdvisorPilot",
  // Tell crawlers to skip; this surface is for printing, not browsing.
  robots: { index: false, follow: false },
};

export default async function PrintReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PrintReportLoader reportId={id} />;
}
