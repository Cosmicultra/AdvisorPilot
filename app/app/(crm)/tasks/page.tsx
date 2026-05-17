import { TopHeader } from "@/components/crm/top-header";
import { GlobalTasksContent } from "@/components/crm/global-tasks-content";

/**
 * /app/tasks — global tasks list across the advisor's entire book.
 *
 * Thin server component — renders the TopHeader and hands off to
 * <GlobalTasksContent /> (client) which fetches data via advisorFetch and
 * owns the AddTaskDrawer for personal-task creation.
 *
 * Spec: docs/crm/00-fundamentals.md §5 ("What do I owe people?").
 */
export default function TasksPage() {
  return (
    <>
      <TopHeader
        title="Tasks"
        subtitle="Every open task across your book"
      />
      <GlobalTasksContent />
    </>
  );
}
