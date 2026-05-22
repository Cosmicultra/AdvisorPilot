"use client";

/**
 * Per-client Tasks tab. Mounted at /app/crm/[id]/tasks.
 *
 * Enterprise-grade list:
 *   - Search across title + description + tags
 *   - Filter chips: status (Open / In progress / Done / Cancelled / All),
 *     priority (All / High / Medium / Low), due window (All / Today /
 *     This week / Overdue)
 *   - Sort dropdown: Due ↑↓, Created ↑↓, Updated ↑↓, Priority, Title
 *   - Two-section layout: Active items (open + in_progress) on top, Done
 *     section below — completed tasks DO NOT vanish; they get tucked away
 *     in a collapsible group with strikethrough.
 *   - Per-row audit info: created relative + edited indicator + completed
 *     timestamp.
 *   - Click row → edit drawer (full edit on every field, dirty tracking,
 *     delete with confirm).
 *   - Quick-toggle checkbox stays — optimistic + still PATCHes.
 *
 * Auth: every fetch goes through advisorFetch.
 *
 * Spec: docs/crm/20-technical-specs.md §5.3.
 */

import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { EditTaskDrawer } from "@/components/crm/drawers/edit-task-drawer";
import type { Task } from "@/lib/crm/types";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

type StatusFilter = "all" | "open" | "in_progress" | "done" | "cancelled";
type PriorityFilter = "all" | "High" | "Medium" | "Low";
type DueFilter = "all" | "today" | "week" | "overdue";
type SortKey =
  | "due-asc"
  | "due-desc"
  | "created-desc"
  | "created-asc"
  | "updated-desc"
  | "priority-desc"
  | "title-asc";

const STATUS_LABELS: Record<Task["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_BADGE_STYLES: Record<Task["priority"], { bg: string; fg: string }> = {
  High: { bg: "#FDECEC", fg: "#9B1C1C" },
  Medium: { bg: "rgba(12, 25, 41, 0.04)", fg: "var(--ap-gray)" },
  Low: { bg: "rgba(12, 25, 41, 0.04)", fg: "var(--ap-gray)" },
};

const PRIORITY_RANK: Record<Task["priority"], number> = { High: 3, Medium: 2, Low: 1 };

const SORT_LABELS: Record<SortKey, string> = {
  "due-asc": "Due ↑",
  "due-desc": "Due ↓",
  "created-desc": "Newest",
  "created-asc": "Oldest",
  "updated-desc": "Updated",
  "priority-desc": "Priority",
  "title-asc": "Title A→Z",
};

const SORT_KEYS: SortKey[] = [
  "due-asc",
  "due-desc",
  "created-desc",
  "created-asc",
  "updated-desc",
  "priority-desc",
  "title-asc",
];

export type TasksTabProps = {
  clientId: string;
  clientName?: string;
  refreshKey: number;
  onAddTask(): void;
  onMutated(): void;
};

export function TasksTab({
  clientId,
  clientName,
  refreshKey,
  onAddTask,
  onMutated,
}: TasksTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(true);

  // Filters + search + sort.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sort, setSort] = useState<SortKey>("due-asc");

  // Initial mount starts in "loading" via useState; on `refreshKey` /
  // `clientId` change we keep the previous tasks visible until the new
  // fetch resolves. Avoids the react-hooks/set-state-in-effect lint.
  useEffect(() => {
    let cancelled = false;

    // Fetch ALL tasks for the client (no server-side filter); filter/sort
    // client-side for snappy interactivity.
    const url = `/api/tasks?clientId=${encodeURIComponent(clientId)}&limit=200`;

    advisorFetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load tasks (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        setState({ status: "ready", tasks: (body?.tasks ?? []) as Task[] });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load tasks.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  // Apply filters + search.
  const filtered = useMemo(() => {
    if (state.status !== "ready") return [] as Task[];
    return applyFilters(state.tasks, {
      search: search.trim().toLowerCase(),
      statusFilter,
      priorityFilter,
      dueFilter,
    });
  }, [state, search, statusFilter, priorityFilter, dueFilter]);

  // Split into active vs done sections.
  const active = useMemo(
    () => filtered.filter((t) => t.status === "open" || t.status === "in_progress"),
    [filtered]
  );
  const done = useMemo(
    () => filtered.filter((t) => t.status === "done" || t.status === "cancelled"),
    [filtered]
  );

  const sortedActive = useMemo(() => sortTasks(active, sort), [active, sort]);
  const sortedDone = useMemo(() => sortTasks(done, sort), [done, sort]);

  const quickToggle = async (task: Task, nextStatus: Task["status"]) => {
    if (pendingIds.has(task.id)) return;
    setPendingIds((s) => new Set(s).add(task.id));
    try {
      const res = await advisorFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[crm:ui] tasks-tab quick-toggle failed", body?.error ?? res.status);
        return;
      }
      onMutated();
    } catch (err) {
      console.error("[crm:ui] tasks-tab quick-toggle threw", err);
    } finally {
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
    }
  };

  const filtersActive =
    search.trim().length > 0 ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    dueFilter !== "all";

  return (
    <div className="flex flex-1 flex-col gap-3 px-6 py-4">
      <FilterBar
        onAddTask={onAddTask}
        search={search}
        onSearch={setSearch}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilter={setPriorityFilter}
        dueFilter={dueFilter}
        onDueFilter={setDueFilter}
        sort={sort}
        onSort={setSort}
        resultCount={filtered.length}
        onClear={() => {
          setSearch("");
          setStatusFilter("all");
          setPriorityFilter("all");
          setDueFilter("all");
        }}
        filtersActive={filtersActive}
      />

      {state.status === "loading" ? (
        <Block message="Loading tasks…" />
      ) : state.status === "unauthorized" ? (
        <Block message="Sign in to load tasks." />
      ) : state.status === "error" ? (
        <Block message={state.message} tone="error" />
      ) : state.tasks.length === 0 ? (
        <EmptyAll onAddTask={onAddTask} />
      ) : filtered.length === 0 ? (
        <Block
          message="No tasks match these filters. Try clearing or adjusting them."
        />
      ) : (
        <>
          {sortedActive.length > 0 ? (
            <Section label={`Active (${sortedActive.length})`}>
              {sortedActive.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  pending={pendingIds.has(task.id)}
                  onToggleComplete={() => void quickToggle(task, "done")}
                  onEdit={() => setEditing(task)}
                />
              ))}
            </Section>
          ) : null}

          {sortedDone.length > 0 ? (
            <Section
              label={`Done (${sortedDone.length})`}
              collapsible
              collapsed={!showDone}
              onToggle={() => setShowDone((v) => !v)}
            >
              {showDone
                ? sortedDone.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      pending={pendingIds.has(task.id)}
                      onToggleComplete={() => void quickToggle(task, "open")}
                      onEdit={() => setEditing(task)}
                      doneStyle
                    />
                  ))
                : null}
            </Section>
          ) : null}
        </>
      )}

      {editing ? (
        <EditTaskDrawer
          open={editing !== null}
          task={editing}
          clientName={clientName ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onMutated();
          }}
          onDeleted={() => {
            setEditing(null);
            onMutated();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Filter bar (+ Add button) ────────────────────────────────────────────

function FilterBar({
  onAddTask,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  priorityFilter,
  onPriorityFilter,
  dueFilter,
  onDueFilter,
  sort,
  onSort,
  resultCount,
  onClear,
  filtersActive,
}: {
  onAddTask(): void;
  search: string;
  onSearch(v: string): void;
  statusFilter: StatusFilter;
  onStatusFilter(v: StatusFilter): void;
  priorityFilter: PriorityFilter;
  onPriorityFilter(v: PriorityFilter): void;
  dueFilter: DueFilter;
  onDueFilter(v: DueFilter): void;
  sort: SortKey;
  onSort(v: SortKey): void;
  resultCount: number;
  onClear(): void;
  filtersActive: boolean;
}) {
  // Single-row enterprise toolbar: search expands, everything else is a
  // compact native select. Each select's button label includes the selected
  // value when not "All" (e.g. "Priority: High ▼") so users can see active
  // filters without expanding anything. Total height: ~30px.
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 bg-white px-2 py-1.5"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <label className="relative flex min-w-[160px] flex-1 items-center">
        <Search
          size={12}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-2"
          style={{ color: "var(--ap-gray)" }}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search title, description, tags…"
          className="h-7 w-full bg-white py-0 pl-6 pr-2 text-[12px] focus:outline-none"
          style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
        />
      </label>

      <CompactSelect
        prefix="Status"
        value={statusFilter}
        onChange={(v) => onStatusFilter(v as StatusFilter)}
        options={[
          { id: "all", label: "All" },
          { id: "open", label: "Open" },
          { id: "in_progress", label: "In progress" },
          { id: "done", label: "Done" },
          { id: "cancelled", label: "Cancelled" },
        ]}
      />
      <CompactSelect
        prefix="Priority"
        value={priorityFilter}
        onChange={(v) => onPriorityFilter(v as PriorityFilter)}
        options={[
          { id: "all", label: "All" },
          { id: "High", label: "High" },
          { id: "Medium", label: "Medium" },
          { id: "Low", label: "Low" },
        ]}
      />
      <CompactSelect
        prefix="Due"
        value={dueFilter}
        onChange={(v) => onDueFilter(v as DueFilter)}
        options={[
          { id: "all", label: "All" },
          { id: "today", label: "Today" },
          { id: "week", label: "Week" },
          { id: "overdue", label: "Overdue" },
        ]}
      />
      <CompactSelect
        prefix="Sort"
        value={sort}
        onChange={(v) => onSort(v as SortKey)}
        options={SORT_KEYS.map((key) => ({ id: key, label: SORT_LABELS[key] }))}
      />

      <span
        className="ml-auto flex items-center gap-2 text-[10.5px] uppercase tracking-wide"
        style={{ color: "var(--ap-gray)" }}
      >
        {resultCount}
        {filtersActive ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-0.5 normal-case underline-offset-2 hover:underline"
            style={{ color: "var(--ap-royal)" }}
          >
            <X size={9} strokeWidth={2} />
            Clear
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAddTask}
          className="h-7 px-2.5 text-[11.5px] font-semibold normal-case"
          style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
        >
          + Add task
        </button>
      </span>
    </div>
  );
}

/** A compact native-select styled like a dropdown button. The selected
 *  value is rendered inline ("Status: Open") so an active filter is
 *  visible at a glance without expanding the menu. */
function CompactSelect({
  prefix,
  value,
  onChange,
  options,
}: {
  prefix: string;
  value: string;
  onChange(v: string): void;
  options: { id: string; label: string }[];
}) {
  const active = value !== "all" && value !== options[0]?.id;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={prefix}
      className="h-7 cursor-pointer bg-white px-1.5 py-0 text-[11.5px] focus:outline-none"
      style={{
        border: `1px solid ${active ? "var(--ap-royal)" : "var(--ap-border)"}`,
        color: active ? "var(--ap-royal)" : "var(--ap-navy)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {prefix}: {option.label}
        </option>
      ))}
    </select>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────

function Section({
  label,
  collapsible,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--ap-gray)" }}
        >
          {label}
        </p>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className="text-[11px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--ap-royal)" }}
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        ) : null}
      </div>
      {collapsed ? null : (
        <div
          className="flex flex-col bg-white"
          style={{ border: "1px solid var(--ap-border)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────

function TaskRow({
  task,
  pending,
  onToggleComplete,
  onEdit,
  doneStyle = false,
}: {
  task: Task;
  pending: boolean;
  onToggleComplete(): void;
  onEdit(): void;
  doneStyle?: boolean;
}) {
  const priorityStyle = PRIORITY_BADGE_STYLES[task.priority];
  const wasEdited = Date.parse(task.updatedAt) - Date.parse(task.createdAt) > 5_000;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className="flex cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(12,25,41,0.02)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ap-royal)]"
      style={{ borderBottom: "1px solid var(--ap-border)", opacity: pending ? 0.5 : 1 }}
    >
      <input
        type="checkbox"
        checked={doneStyle}
        onChange={onToggleComplete}
        onClick={(e) => e.stopPropagation()}
        disabled={pending}
        aria-label={
          doneStyle
            ? `Reopen "${task.title}"`
            : `Mark "${task.title}" complete`
        }
        className="mt-1 h-3.5 w-3.5 flex-shrink-0"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          className="text-[13px] font-medium"
          style={{
            color: "var(--ap-navy)",
            textDecoration: doneStyle ? "line-through" : "none",
            opacity: doneStyle ? 0.7 : 1,
          }}
        >
          {task.title}
        </p>
        {task.description ? (
          <p
            className="whitespace-pre-wrap text-[12px] leading-snug"
            style={{
              color: "var(--ap-gray)",
              textDecoration: doneStyle ? "line-through" : "none",
            }}
          >
            {task.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {task.dueDate ? (
            <span style={{ color: "var(--ap-gray)" }}>
              {formatDueDate(task.dueDate, task.dueTime, doneStyle)}
            </span>
          ) : null}
          <span
            className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{ backgroundColor: priorityStyle.bg, color: priorityStyle.fg }}
          >
            {task.priority}
          </span>
          <span
            className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: "rgba(12, 25, 41, 0.04)",
              color: "var(--ap-gray)",
            }}
          >
            {STATUS_LABELS[task.status]}
          </span>
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: "rgba(15, 111, 222, 0.08)",
                color: "var(--ap-royal)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]"
          style={{ color: "var(--ap-gray)" }}
        >
          <span>
            {actorLabel(task.ownerEmail)} · created {formatRelative(task.createdAt)}
          </span>
          {wasEdited ? <span>· edited {formatRelative(task.updatedAt)}</span> : null}
          {task.completedAt ? (
            <span>· completed {formatRelative(task.completedAt)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Empty / message blocks ───────────────────────────────────────────────

function Block({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "error";
}) {
  return (
    <p
      className="bg-white px-4 py-6 text-[12.5px]"
      style={{
        border: "1px solid var(--ap-border)",
        color: tone === "error" ? "#9B1C1C" : "var(--ap-gray)",
      }}
    >
      {message}
    </p>
  );
}

function EmptyAll({ onAddTask }: { onAddTask(): void }) {
  return (
    <div
      className="flex flex-col items-center gap-2 bg-white px-4 py-10 text-center"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
        No tasks for this client yet
      </p>
      <button
        type="button"
        onClick={onAddTask}
        className="text-[12.5px] font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        + Add the first task
      </button>
    </div>
  );
}

// ─── Filters / sort logic ─────────────────────────────────────────────────

function applyFilters(
  tasks: Task[],
  f: {
    search: string;
    statusFilter: StatusFilter;
    priorityFilter: PriorityFilter;
    dueFilter: DueFilter;
  }
): Task[] {
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return tasks.filter((task) => {
    if (f.statusFilter !== "all" && task.status !== f.statusFilter) return false;
    if (f.priorityFilter !== "all" && task.priority !== f.priorityFilter) return false;

    if (f.dueFilter === "today") {
      if (task.dueDate !== todayKey) return false;
    } else if (f.dueFilter === "week") {
      if (!task.dueDate || task.dueDate < todayKey || task.dueDate > weekFromNow) return false;
    } else if (f.dueFilter === "overdue") {
      if (!task.dueDate || task.dueDate >= todayKey) return false;
      if (task.status === "done" || task.status === "cancelled") return false;
    }

    if (f.search) {
      const haystack = [
        task.title,
        task.description ?? "",
        task.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(f.search)) return false;
    }

    return true;
  });
}

function sortTasks(tasks: Task[], sort: SortKey): Task[] {
  const cloned = [...tasks];
  switch (sort) {
    case "due-asc":
      cloned.sort(byDueAsc);
      break;
    case "due-desc":
      cloned.sort((a, b) => -byDueAsc(a, b));
      break;
    case "created-desc":
      cloned.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "created-asc":
      cloned.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "updated-desc":
      cloned.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
    case "priority-desc":
      cloned.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
      break;
    case "title-asc":
      cloned.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return cloned;
}

function byDueAsc(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  const c = a.dueDate.localeCompare(b.dueDate);
  if (c !== 0) return c;
  if (!a.dueTime && !b.dueTime) return 0;
  if (!a.dueTime) return 1;
  if (!b.dueTime) return -1;
  return a.dueTime.localeCompare(b.dueTime);
}

// ─── Date formatting ──────────────────────────────────────────────────────

function formatDueDate(iso: string, time: string | null, isDone: boolean): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const date = new Date(ts);
  const todayKey = new Date().toISOString().slice(0, 10);
  const tomorrowKey = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let prefix = `Due ${formatted}`;
  if (iso === todayKey) prefix = "Due today";
  else if (iso === tomorrowKey) prefix = "Due tomorrow";
  else if (!isDone && iso < todayKey) prefix = `Overdue · ${formatted}`;
  return time ? `${prefix} · ${time.slice(0, 5)}` : prefix;
}

function actorLabel(email: string): string {
  const localPart = email.split("@")[0];
  if (!localPart) return email;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) {
      const mins = Math.floor(diff / (60 * 1000));
      if (mins < 1) return "just now";
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
