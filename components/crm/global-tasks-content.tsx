"use client";

/**
 * Global /app/tasks content — flat list of EVERY task across the
 * advisor's entire book.
 *
 * Thin wrapper over `<TaskListView clientId={null} />` — all the heavy
 * lifting (filters, search, bulk ops, drawer wiring, status menu,
 * quick-add, keyboard shortcuts) lives in the shared list component
 * so the per-client tab gets the same UX for free.
 *
 * Spec: docs/crm/00-fundamentals.md §5 ("What do I owe people?")
 *       docs/crm/20-technical-specs.md §7.1.
 */

import { TaskListView } from "./tasks/task-list-view";

export function GlobalTasksContent() {
  return <TaskListView clientId={null} />;
}
