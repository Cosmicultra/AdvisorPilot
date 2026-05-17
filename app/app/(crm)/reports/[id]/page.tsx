import { TopHeader } from "@/components/crm/top-header";
import { ReportViewer } from "@/components/crm/reports/report-viewer";

/**
 * /app/reports/[id] — single-report viewer.
 *
 * Thin server component — renders the TopHeader and hands off to
 * `<ReportViewer />` (client) which fetches the report via advisorFetch
 * and renders the markdown body via <StreamingMarkdown> (same renderer
 * the chat uses; charts via Chart.js fenced blocks).
 *
 * The viewer owns publish / archive / delete actions; the list view
 * `/app/reports` keeps its actions to browse + delete only.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */
export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <TopHeader title="Report" subtitle="Review, publish, archive, or print" />
      <ReportViewer reportId={id} />
    </>
  );
}
