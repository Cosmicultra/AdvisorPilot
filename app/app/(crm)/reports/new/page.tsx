import { TopHeader } from "@/components/crm/top-header";
import { NewReportContent } from "@/components/crm/reports/new-report-content";

/**
 * /app/reports/new — blank-canvas editor for a brand-new advisor-authored
 * report. Thin server shell + <NewReportContent /> client.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */
export default function NewReportPage() {
  return (
    <>
      <TopHeader
        title="New report"
        subtitle="Draft a report from scratch — Markdown with live preview"
      />
      <NewReportContent />
    </>
  );
}
