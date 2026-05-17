import { ReportsHeaderActions } from "@/components/crm/reports/reports-header-actions";
import { TopHeader } from "@/components/crm/top-header";
import { ReportsContent } from "@/components/crm/reports/reports-content";

/**
 * /app/reports — global reports library across the advisor's entire book.
 *
 * Thin server component — renders the TopHeader and hands off to
 * `<ReportsContent />` (client) which fetches data via advisorFetch, owns
 * the filter state, and renders the list.
 *
 * The viewer route at /app/reports/[id] handles publish / archive /
 * delete; this list view's actions are limited to browse + delete.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */
export default function ReportsPage() {
  return (
    <>
      <TopHeader
        title="Reports"
        subtitle="Every report you and Nova have drafted"
        rightActions={<ReportsHeaderActions />}
      />
      <ReportsContent />
    </>
  );
}
