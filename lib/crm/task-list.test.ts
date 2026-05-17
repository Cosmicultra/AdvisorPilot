/**
 * Tests for the pure task-list helpers (filter / sort / count / due
 * formatting). These drive the global + per-client task UIs; lives
 * outside React so behavior is unit-testable without RTL.
 */

import { describe, expect, it } from "vitest";
import {
  applyTaskFilters,
  countTasksByTab,
  DEFAULT_TASK_FILTERS,
  formatDueLabel,
  TASK_PRIORITY_STYLES,
  TASK_STATUS_STYLES,
  type TaskFilters,
} from "./task-list";
import type { Task } from "./types";

/** Local-time anchor so the date filters are TZ-stable. */
const NOW = new Date(2026, 4, 17, 12, 0, 0); // 2026-05-17 12:00 local

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dayOffset(days: number, hours = 12): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return ymd(d);
}

function task(overrides: Partial<Task> & { id: string }): Task {
  const base: Task = {
    id: overrides.id,
    ownerEmail: "a@b",
    clientId: null,
    title: `task ${overrides.id}`,
    description: null,
    dueDate: null,
    dueTime: null,
    priority: "Medium",
    status: "open",
    completedAt: null,
    reminderAt: null,
    tags: [],
    visibility: "private",
    createdAt: "2026-05-15T10:00:00Z",
    updatedAt: "2026-05-15T10:00:00Z",
  };
  return { ...base, ...overrides };
}

describe("status + priority style maps", () => {
  it("ships a style entry for every Task['status']", () => {
    expect(TASK_STATUS_STYLES.open).toBeDefined();
    expect(TASK_STATUS_STYLES.in_progress).toBeDefined();
    expect(TASK_STATUS_STYLES.done).toBeDefined();
    expect(TASK_STATUS_STYLES.cancelled).toBeDefined();
  });
  it("ships a style entry for every priority", () => {
    expect(TASK_PRIORITY_STYLES.High).toBeDefined();
    expect(TASK_PRIORITY_STYLES.Medium).toBeDefined();
    expect(TASK_PRIORITY_STYLES.Low).toBeDefined();
  });
});

describe("countTasksByTab", () => {
  it("groups by active / done / cancelled correctly", () => {
    const counts = countTasksByTab([
      task({ id: "1", status: "open" }),
      task({ id: "2", status: "in_progress" }),
      task({ id: "3", status: "done" }),
      task({ id: "4", status: "done" }),
      task({ id: "5", status: "cancelled" }),
    ]);
    expect(counts).toEqual({ active: 2, done: 2, cancelled: 1, all: 5 });
  });
  it("handles empty input", () => {
    expect(countTasksByTab([])).toEqual({ active: 0, done: 0, cancelled: 0, all: 0 });
  });
});

describe("applyTaskFilters — tabs", () => {
  const all = [
    task({ id: "a", status: "open" }),
    task({ id: "b", status: "in_progress" }),
    task({ id: "c", status: "done" }),
    task({ id: "d", status: "cancelled" }),
  ];

  it("'active' tab returns open + in_progress only", () => {
    const f: TaskFilters = { ...DEFAULT_TASK_FILTERS, tab: "active" };
    const out = applyTaskFilters(all, f, NOW);
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
  it("'done' tab returns done only", () => {
    const out = applyTaskFilters(all, { ...DEFAULT_TASK_FILTERS, tab: "done" }, NOW);
    expect(out.map((t) => t.id)).toEqual(["c"]);
  });
  it("'cancelled' tab returns cancelled only", () => {
    const out = applyTaskFilters(all, { ...DEFAULT_TASK_FILTERS, tab: "cancelled" }, NOW);
    expect(out.map((t) => t.id)).toEqual(["d"]);
  });
  it("'all' tab returns every status", () => {
    const out = applyTaskFilters(all, { ...DEFAULT_TASK_FILTERS, tab: "all" }, NOW);
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("applyTaskFilters — due narrowing", () => {
  it("'today' matches only tasks whose dueDate is today", () => {
    const all = [
      task({ id: "today", dueDate: dayOffset(0) }),
      task({ id: "tom", dueDate: dayOffset(1) }),
      task({ id: "next", dueDate: dayOffset(7) }),
    ];
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", due: "today" },
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual(["today"]);
  });
  it("'week' matches today through +7 days", () => {
    const all = [
      task({ id: "today", dueDate: dayOffset(0) }),
      task({ id: "in3", dueDate: dayOffset(3) }),
      task({ id: "in10", dueDate: dayOffset(10) }),
    ];
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", due: "week" },
      NOW,
    );
    expect(out.map((t) => t.id).sort()).toEqual(["in3", "today"]);
  });
  it("'overdue' excludes done + cancelled", () => {
    const all = [
      task({ id: "past_open", dueDate: dayOffset(-3), status: "open" }),
      task({ id: "past_done", dueDate: dayOffset(-3), status: "done" }),
      task({ id: "future", dueDate: dayOffset(3) }),
    ];
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", due: "overdue" },
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual(["past_open"]);
  });
});

describe("applyTaskFilters — search", () => {
  it("matches title OR description case-insensitively", () => {
    const all = [
      task({ id: "a", title: "Roth conversion review" }),
      task({ id: "b", title: "Meeting prep", description: "ROTH followups" }),
      task({ id: "c", title: "Estate plan" }),
    ];
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", search: "roth" },
      NOW,
    );
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
  it("trims whitespace before matching", () => {
    const all = [task({ id: "a", title: "Pricing" })];
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", search: "  PRICING  " },
      NOW,
    );
    expect(out).toHaveLength(1);
  });
  it("empty search returns all", () => {
    const all = [task({ id: "a" }), task({ id: "b" })];
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", search: "   " },
      NOW,
    );
    expect(out).toHaveLength(2);
  });
});

describe("applyTaskFilters — sort", () => {
  const all = [
    task({ id: "high_today", priority: "High", dueDate: dayOffset(0) }),
    task({ id: "low_next", priority: "Low", dueDate: dayOffset(3) }),
    task({ id: "med_no_due", priority: "Medium" }),
    task({ id: "done_today", status: "done", dueDate: dayOffset(0) }),
  ];

  it("due_asc puts soonest first, NULL last, done at the very bottom", () => {
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", sort: "due_asc" },
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual([
      "high_today",
      "low_next",
      "med_no_due",
      "done_today",
    ]);
  });

  it("due_desc reverses the active group; done still sinks to the bottom", () => {
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", sort: "due_desc" },
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual([
      "low_next",
      "high_today",
      "med_no_due",
      "done_today",
    ]);
  });

  it("priority sort puts High before Medium before Low (active section), with date as tiebreaker", () => {
    const out = applyTaskFilters(
      all,
      { ...DEFAULT_TASK_FILTERS, tab: "all", sort: "priority" },
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual([
      "high_today",
      "med_no_due",
      "low_next",
      "done_today",
    ]);
  });

  it("title_asc is case-insensitive", () => {
    const ts = [
      task({ id: "Zeta", title: "Zeta" }),
      task({ id: "alpha", title: "alpha" }),
      task({ id: "Mu", title: "Mu" }),
    ];
    const out = applyTaskFilters(
      ts,
      { ...DEFAULT_TASK_FILTERS, tab: "all", sort: "title_asc" },
      NOW,
    );
    expect(out.map((t) => t.title)).toEqual(["alpha", "Mu", "Zeta"]);
  });
});

describe("formatDueLabel", () => {
  it("returns 'No due date' tone:none for null dueDate", () => {
    expect(formatDueLabel({ dueDate: null, dueTime: null, status: "open" }, NOW)).toEqual({
      label: "No due date",
      tone: "none",
    });
  });
  it("labels today + tomorrow", () => {
    expect(
      formatDueLabel({ dueDate: dayOffset(0), dueTime: null, status: "open" }, NOW),
    ).toMatchObject({ label: "Today", tone: "soon" });
    expect(
      formatDueLabel({ dueDate: dayOffset(1), dueTime: null, status: "open" }, NOW),
    ).toMatchObject({ label: "Tomorrow", tone: "soon" });
  });
  it("labels within-week as weekday + tone:later", () => {
    const out = formatDueLabel(
      { dueDate: dayOffset(3), dueTime: null, status: "open" },
      NOW,
    );
    expect(out.tone).toBe("later");
    expect(out.label).toMatch(/^[A-Z][a-z]{2}$/);
  });
  it("labels overdue (only for active tasks) as 'Overdue · …' with tone:overdue", () => {
    expect(
      formatDueLabel({ dueDate: dayOffset(-3), dueTime: null, status: "open" }, NOW)
        .tone,
    ).toBe("overdue");
    expect(
      formatDueLabel({ dueDate: dayOffset(-3), dueTime: null, status: "done" }, NOW)
        .tone,
    ).toBe("later");
  });
});
