/**
 * Pure types + helpers for the global + per-client task list views.
 *
 * The components in `components/crm/tasks/*` are thin shells over these
 * helpers — same pattern as the report-editor-state / conversation-
 * grouping modules. Pure functions are unit-testable without RTL and
 * reusable across both the global page (`/app/tasks`) and the per-
 * client tab.
 *
 * Spec: docs/crm/00-fundamentals.md §5 + docs/crm/20-technical-specs.md §7.1.
 */

import type { Task } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Filter + sort vocab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status tabs shown above the list. `active` is the default and covers
 * everything that's NOT done or cancelled (open + in_progress); `done`
 * shows completed tasks (so they don't vanish on click); `all` shows
 * everything; `cancelled` is a stretch surface (rarely useful day-to-day
 * but available).
 */
export type TaskFilterTab = "active" | "done" | "all" | "cancelled";

/** Optional due-date narrowing applied on top of the status tab. */
export type TaskDueFilter = "any" | "today" | "week" | "overdue";

/** Sort keys exposed in the filter bar dropdown. */
export type TaskSort =
  | "due_asc"
  | "due_desc"
  | "priority"
  | "created_desc"
  | "title_asc";

export interface TaskFilters {
  tab: TaskFilterTab;
  due: TaskDueFilter;
  search: string;
  sort: TaskSort;
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  tab: "active",
  due: "any",
  search: "",
  sort: "due_asc",
};

// ─────────────────────────────────────────────────────────────────────────────
// Status palette — shared between the badge + the row + the quick-change menu
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskStatusStyle {
  label: string;
  bg: string;
  fg: string;
  /** Border color — used by the dropdown trigger pill. */
  border: string;
  /** Short marker for skim-readability ("●" pulled into a colored dot). */
  dotColor: string;
}

export const TASK_STATUS_STYLES: Record<Task["status"], TaskStatusStyle> = {
  open: {
    label: "Open",
    bg: "rgba(12, 25, 41, 0.06)",
    fg: "var(--ap-navy)",
    border: "var(--ap-border)",
    dotColor: "var(--ap-navy)",
  },
  in_progress: {
    label: "In progress",
    bg: "rgba(79, 124, 172, 0.12)",
    fg: "var(--ap-royal)",
    border: "rgba(79, 124, 172, 0.30)",
    dotColor: "var(--ap-royal)",
  },
  done: {
    label: "Done",
    bg: "rgba(31, 122, 58, 0.10)",
    fg: "#1f7a3a",
    border: "rgba(31, 122, 58, 0.30)",
    dotColor: "#1f7a3a",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgba(12, 25, 41, 0.04)",
    fg: "var(--ap-gray)",
    border: "var(--ap-border)",
    dotColor: "var(--ap-gray)",
  },
};

export interface TaskPriorityStyle {
  bg: string;
  fg: string;
}

export const TASK_PRIORITY_STYLES: Record<Task["priority"], TaskPriorityStyle> = {
  High: { bg: "#FDECEC", fg: "#9B1C1C" },
  Medium: { bg: "rgba(12, 25, 41, 0.04)", fg: "var(--ap-gray)" },
  Low: { bg: "rgba(12, 25, 41, 0.04)", fg: "var(--ap-gray)" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure filtering + sorting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply every filter + sort criterion to the task list. Pure and
 * deterministic given `now`. The `now` parameter is what makes
 * date-relative filters (today / week / overdue) testable without
 * mocking `Date`.
 */
export function applyTaskFilters(
  tasks: Task[],
  filters: TaskFilters,
  now: Date = new Date(),
): Task[] {
  const todayKey = ymd(now);
  const weekFromNow = ymd(addDays(now, 7));
  const searchLower = filters.search.trim().toLowerCase();

  const filtered = tasks.filter((t) => {
    // Status tab.
    if (filters.tab === "active") {
      if (t.status !== "open" && t.status !== "in_progress") return false;
    } else if (filters.tab === "done") {
      if (t.status !== "done") return false;
    } else if (filters.tab === "cancelled") {
      if (t.status !== "cancelled") return false;
    }
    // Due-date narrowing.
    if (filters.due === "today") {
      if (t.dueDate !== todayKey) return false;
    } else if (filters.due === "week") {
      if (!t.dueDate || t.dueDate < todayKey || t.dueDate > weekFromNow) return false;
    } else if (filters.due === "overdue") {
      if (!t.dueDate || t.dueDate >= todayKey) return false;
      // Done / cancelled tasks aren't "overdue" semantically.
      if (t.status === "done" || t.status === "cancelled") return false;
    }
    // Search (title + description).
    if (searchLower) {
      const hay =
        (t.title ?? "").toLowerCase() + " " + (t.description ?? "").toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  return [...filtered].sort(taskComparator(filters.sort));
}

/** Priority sort weight — High first when the user sorts by priority. */
const PRIORITY_WEIGHT: Record<Task["priority"], number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};

function taskComparator(sort: TaskSort): (a: Task, b: Task) => number {
  switch (sort) {
    case "due_asc":
      return (a, b) => compareDue(a, b, /*asc*/ true);
    case "due_desc":
      return (a, b) => compareDue(a, b, /*asc*/ false);
    case "priority":
      // Done/cancelled always sink to the bottom regardless of priority
      // (otherwise a done Medium would land above an active Low —
      // confusing for an "active first" mental model).
      return (a, b) => {
        const aSunk = a.status === "done" || a.status === "cancelled";
        const bSunk = b.status === "done" || b.status === "cancelled";
        if (aSunk !== bSunk) return aSunk ? 1 : -1;
        const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        if (pw !== 0) return pw;
        return compareDue(a, b, true);
      };
    case "created_desc":
      return (a, b) => b.createdAt.localeCompare(a.createdAt);
    case "title_asc":
      return (a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  }
}

/**
 * Due-date comparator. Done/cancelled tasks ALWAYS sink to the bottom
 * regardless of due date (keeps active work above the historical pile).
 * Within active vs done groups: nulls sort last (no due date), then by
 * date asc or desc per the caller's preference.
 */
function compareDue(a: Task, b: Task, asc: boolean): number {
  const aSunk = a.status === "done" || a.status === "cancelled";
  const bSunk = b.status === "done" || b.status === "cancelled";
  if (aSunk !== bSunk) return aSunk ? 1 : -1;
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return asc
    ? a.dueDate.localeCompare(b.dueDate)
    : b.dueDate.localeCompare(a.dueDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Counts for the tab badges ("Active 7 · Done 24 · All 31")
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskTabCounts {
  active: number;
  done: number;
  all: number;
  cancelled: number;
}

export function countTasksByTab(tasks: Task[]): TaskTabCounts {
  let active = 0;
  let done = 0;
  let cancelled = 0;
  for (const t of tasks) {
    if (t.status === "open" || t.status === "in_progress") active += 1;
    else if (t.status === "done") done += 1;
    else if (t.status === "cancelled") cancelled += 1;
  }
  return { active, done, cancelled, all: tasks.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers (kept local — single file should be enough)
// ─────────────────────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Human-friendly due-date label. "Today" / "Tomorrow" / weekday
 * within 7 days / "Mon DD" otherwise / "Overdue · Mon DD" when past
 * AND status is still active (done/cancelled show the raw date).
 */
export function formatDueLabel(
  task: Pick<Task, "dueDate" | "dueTime" | "status">,
  now: Date = new Date(),
): { label: string; tone: "overdue" | "soon" | "later" | "none" } {
  if (!task.dueDate) return { label: "No due date", tone: "none" };
  const due = new Date(`${task.dueDate}T00:00:00`);
  const todayKey = ymd(now);
  const tomorrowKey = ymd(addDays(now, 1));
  const weekFromNow = ymd(addDays(now, 7));

  const isOverdue =
    task.dueDate < todayKey &&
    task.status !== "done" &&
    task.status !== "cancelled";

  const baseFormatted = due.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (task.dueDate === todayKey) {
    return { label: "Today", tone: "soon" };
  }
  if (task.dueDate === tomorrowKey) {
    return { label: "Tomorrow", tone: "soon" };
  }
  if (task.dueDate > todayKey && task.dueDate <= weekFromNow) {
    const weekday = due.toLocaleDateString("en-US", { weekday: "short" });
    return { label: weekday, tone: "later" };
  }
  if (isOverdue) {
    return { label: `Overdue · ${baseFormatted}`, tone: "overdue" };
  }
  return { label: baseFormatted, tone: "later" };
}
