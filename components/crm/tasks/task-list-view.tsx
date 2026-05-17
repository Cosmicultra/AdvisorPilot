"use client";

/**
 * Task list view — the heart of the tasks UX. Shared between the
 * global page (`/app/tasks`) and the per-client tab.
 *
 * Owns:
 *   - Fetch of /api/tasks (filtered by clientId when provided)
 *   - Fetch of /api/clients for the name lookup (only when `clientId`
 *     is null — per-client view doesn't need it)
 *   - Filter / search / sort state via TaskFilters
 *   - Bulk selection state + bulk actions (mark done, mark active, delete)
 *   - Drawer wiring: <AddTaskDrawer> for explicit create, <EditTaskDrawer>
 *     for row-click open / row-click edit
 *   - Status quick-change menu wiring
 *   - Cmd/Ctrl+N keyboard shortcut → focus quick-add
 *   - Cmd/Ctrl+F keyboard shortcut → focus search
 *
 * Spec: docs/crm/20-technical-specs.md §7.1.
 */

import { CheckSquare, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import {
  applyTaskFilters,
  countTasksByTab,
  DEFAULT_TASK_FILTERS,
  type TaskFilters,
} from "@/lib/crm/task-list";
import type { ClientRosterItem, Task } from "@/lib/crm/types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AddTaskDrawer } from "../drawers/add-task-drawer";
import { EditTaskDrawer } from "../drawers/edit-task-drawer";
import { TaskFilterBar } from "./task-filter-bar";
import { TaskQuickAdd, type TaskQuickAddHandle } from "./task-quick-add";
import { TaskRow } from "./task-row";
import { TaskStatusMenu } from "./task-status-menu";

type FetchState =
  | { status: "loading" }
  | {
      status: "ready";
      tasks: Task[];
      clientNames: Map<string, string>;
    }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export interface TaskListViewProps {
  /** When set, the view is scoped to one client (per-client tab); when null, global. */
  clientId: string | null;
  /** Display name for the client; ignored when clientId is null. */
  clientName?: string | null;
}

export function TaskListView({ clientId, clientName = null }: TaskListViewProps) {
  const confirm = useConfirm();
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [statusMenu, setStatusMenu] = useState<{
    task: Task;
    anchorRect: DOMRect;
  } | null>(null);
  const quickAddRef = useRef<TaskQuickAddHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── Fetch ──────────────────────────────────────────────────────────────
  // We don't reset to "loading" synchronously here — the initial mount
  // already starts in "loading" via useState's initial value, and on
  // refetch (refreshKey bump after a mutation) keeping the previous row
  // list visible looks better than a flash of skeleton. Also avoids the
  // react-hooks/set-state-in-effect lint warning.
  useEffect(() => {
    let cancelled = false;

    const tasksUrl = clientId
      ? `/api/tasks?clientId=${clientId}&limit=500`
      : `/api/tasks?limit=500`;
    const needsClients = clientId === null;

    const promises: Promise<Response>[] = [
      advisorFetch(tasksUrl, { cache: "no-store" }),
    ];
    if (needsClients) {
      promises.push(advisorFetch("/api/clients?limit=200", { cache: "no-store" }));
    }

    Promise.all(promises)
      .then(async (responses) => {
        const tasksRes = responses[0];
        if (tasksRes.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!tasksRes.ok) {
          const body = await tasksRes.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load tasks (${tasksRes.status})`);
        }
        const tasksJson = (await tasksRes.json()) as { tasks: Task[] };

        let clientNames = new Map<string, string>();
        if (needsClients && responses[1]) {
          const clientsRes = responses[1];
          if (clientsRes.ok) {
            const cj = (await clientsRes.json()) as { clients: ClientRosterItem[] };
            for (const c of cj.clients) {
              clientNames.set(
                c.id,
                `${c.firstName} ${c.lastName}`.trim() || c.id,
              );
            }
          }
        } else if (clientId && clientName) {
          clientNames = new Map([[clientId, clientName]]);
        }

        return { tasks: tasksJson.tasks, clientNames };
      })
      .then((result) => {
        if (cancelled || result === null) return;
        setState({ status: "ready", ...result });
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
  }, [refreshKey, clientId, clientName]);

  // ── Keyboard shortcuts: Cmd/Ctrl+N (quick-add), Cmd/Ctrl+F (search) ────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isQuickAdd =
        (e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N");
      const isSearch =
        (e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F");
      if (isQuickAdd) {
        e.preventDefault();
        quickAddRef.current?.focus();
      } else if (isSearch) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Derived: counts + filtered + sorted ────────────────────────────────
  const counts = useMemo(
    () =>
      state.status === "ready"
        ? countTasksByTab(state.tasks)
        : { active: 0, done: 0, all: 0, cancelled: 0 },
    [state],
  );

  const visible = useMemo(
    () => (state.status === "ready" ? applyTaskFilters(state.tasks, filters) : []),
    [state, filters],
  );

  // Reconcile selection set against visible IDs — anything not in the
  // current filter shouldn't appear "selected" in the bulk-action bar.
  const visibleIdSet = useMemo(() => new Set(visible.map((t) => t.id)), [visible]);
  const visibleSelectedCount = useMemo(
    () => visible.reduce((n, t) => (selectedIds.has(t.id) ? n + 1 : n), 0),
    [visible, selectedIds],
  );
  const allVisibleSelected =
    visible.length > 0 && visibleSelectedCount === visible.length;

  // ── Mutations ──────────────────────────────────────────────────────────

  const patchTask = async (task: Task, patch: Partial<Task>) => {
    if (pendingIds.has(task.id)) return;
    setPendingIds((s) => new Set(s).add(task.id));
    // Optimistic local update.
    setState((curr) =>
      curr.status === "ready"
        ? {
            ...curr,
            tasks: curr.tasks.map((t) =>
              t.id === task.id ? { ...t, ...patch } : t,
            ),
          }
        : curr,
    );
    try {
      const res = await advisorFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        bumpRefresh();
      }
    } catch {
      bumpRefresh();
    } finally {
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
    }
  };

  const toggleDone = (task: Task) => {
    const next = task.status === "done" ? "open" : "done";
    void patchTask(task, { status: next });
  };

  const changeStatus = (task: Task, status: Task["status"]) => {
    void patchTask(task, { status });
  };

  const deleteTask = async (task: Task) => {
    if (pendingIds.has(task.id)) return;
    const ok = await confirm({
      title: "Delete task?",
      message: (
        <span>
          Delete <strong>&ldquo;{task.title}&rdquo;</strong>? This cannot be
          undone.
        </span>
      ),
      tone: "danger",
      confirmLabel: "Delete task",
    });
    if (!ok) return;
    setPendingIds((s) => new Set(s).add(task.id));
    // Optimistic remove.
    setState((curr) =>
      curr.status === "ready"
        ? { ...curr, tasks: curr.tasks.filter((t) => t.id !== task.id) }
        : curr,
    );
    setSelectedIds((s) => {
      const n = new Set(s);
      n.delete(task.id);
      return n;
    });
    try {
      const res = await advisorFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) bumpRefresh();
    } catch {
      bumpRefresh();
    } finally {
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
    }
  };

  // ── Bulk actions ──────────────────────────────────────────────────────

  const bulkMarkDone = async () => {
    const ids = [...selectedIds].filter((id) => visibleIdSet.has(id));
    if (ids.length === 0) return;
    if (ids.length > 1) {
      const ok = await confirm({
        title: "Mark tasks complete?",
        message: `Mark ${ids.length} tasks as done. You can reopen any of them from the Done tab.`,
        tone: "primary",
        confirmLabel: `Mark ${ids.length} done`,
        defaultFocus: "confirm",
      });
      if (!ok) return;
    }
    setPendingIds((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.add(id));
      return n;
    });
    setState((curr) =>
      curr.status === "ready"
        ? {
            ...curr,
            tasks: curr.tasks.map((t) =>
              ids.includes(t.id) ? { ...t, status: "done" } : t,
            ),
          }
        : curr,
    );
    await Promise.allSettled(
      ids.map((id) =>
        advisorFetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        }),
      ),
    );
    setPendingIds((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    setSelectedIds(new Set());
    bumpRefresh();
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds].filter((id) => visibleIdSet.has(id));
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`,
      message: "This cannot be undone.",
      tone: "danger",
      confirmLabel: `Delete ${ids.length} task${ids.length === 1 ? "" : "s"}`,
    });
    if (!ok) return;
    setPendingIds((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.add(id));
      return n;
    });
    setState((curr) =>
      curr.status === "ready"
        ? { ...curr, tasks: curr.tasks.filter((t) => !ids.includes(t.id)) }
        : curr,
    );
    await Promise.allSettled(
      ids.map((id) =>
        advisorFetch(`/api/tasks/${id}`, { method: "DELETE" }),
      ),
    );
    setPendingIds((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    setSelectedIds(new Set());
    bumpRefresh();
  };

  const selectionMode = selectedIds.size > 0;

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5">
      <TaskQuickAdd
        ref={quickAddRef}
        clientId={clientId}
        scopeLabel={
          clientId && clientName
            ? `for ${clientName}`
            : clientId
              ? "for this client"
              : "(personal or any client)"
        }
        onCreated={(task) => {
          // Inject the new task into local state so the row appears
          // immediately. The list re-sorts on next render via filters.
          setState((curr) =>
            curr.status === "ready"
              ? { ...curr, tasks: [task, ...curr.tasks] }
              : curr,
          );
        }}
        onOpenFullForm={() => setAddDrawerOpen(true)}
      />

      <TaskFilterBar
        filters={filters}
        counts={counts}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        searchInputRef={searchInputRef}
      />

      {/* Bulk-action bar — only when something is selected. */}
      {selectionMode ? (
        <BulkActionBar
          count={visibleSelectedCount}
          allVisibleSelected={allVisibleSelected}
          onSelectAllVisible={() =>
            setSelectedIds(new Set(visible.map((t) => t.id)))
          }
          onClear={() => setSelectedIds(new Set())}
          onMarkDone={() => void bulkMarkDone()}
          onDelete={() => void bulkDelete()}
        />
      ) : null}

      <div
        className="flex flex-col bg-white"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        {state.status === "loading" ? (
          <Status message="Loading tasks…" />
        ) : state.status === "unauthorized" ? (
          <Status message="Sign in to load tasks." />
        ) : state.status === "error" ? (
          <Status message={state.message} tone="error" />
        ) : visible.length === 0 ? (
          <EmptyState
            tab={filters.tab}
            hasAny={state.tasks.length > 0}
            onClearFilters={() => setFilters(DEFAULT_TASK_FILTERS)}
            onOpenFullForm={() => setAddDrawerOpen(true)}
          />
        ) : (
          visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              clientName={
                task.clientId
                  ? state.clientNames.get(task.clientId) ?? "Unknown client"
                  : null
              }
              selectionMode={selectionMode}
              selected={selectedIds.has(task.id)}
              pending={pendingIds.has(task.id)}
              onOpen={(t) => setEditTask(t)}
              onToggleSelect={() =>
                setSelectedIds((s) => {
                  const n = new Set(s);
                  if (n.has(task.id)) n.delete(task.id);
                  else n.add(task.id);
                  return n;
                })
              }
              onToggleDone={() => toggleDone(task)}
              onOpenStatusMenu={(rect) => setStatusMenu({ task, anchorRect: rect })}
              onDelete={() => void deleteTask(task)}
            />
          ))
        )}
      </div>

      <AddTaskDrawer
        open={addDrawerOpen}
        clientId={clientId}
        clientName={clientName}
        onClose={() => setAddDrawerOpen(false)}
        onSaved={() => bumpRefresh()}
      />
      {editTask ? (
        <EditTaskDrawer
          open
          task={editTask}
          clientName={
            editTask.clientId
              ? state.status === "ready"
                ? state.clientNames.get(editTask.clientId) ?? null
                : null
              : null
          }
          onClose={() => setEditTask(null)}
          onSaved={(next) => {
            // Patch local state with the saved row.
            setState((curr) =>
              curr.status === "ready"
                ? {
                    ...curr,
                    tasks: curr.tasks.map((t) => (t.id === next.id ? next : t)),
                  }
                : curr,
            );
            setEditTask(null);
          }}
          onDeleted={(id) => {
            setState((curr) =>
              curr.status === "ready"
                ? { ...curr, tasks: curr.tasks.filter((t) => t.id !== id) }
                : curr,
            );
            setEditTask(null);
          }}
        />
      ) : null}

      {statusMenu ? (
        <TaskStatusMenu
          current={statusMenu.task.status}
          anchorRect={statusMenu.anchorRect}
          onPick={(next) => changeStatus(statusMenu.task, next)}
          onClose={() => setStatusMenu(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Empty + status pieces ────────────────────────────────────────────────

function Status({ message, tone = "info" }: { message: string; tone?: "info" | "error" }) {
  return (
    <p
      className="px-4 py-6 text-[12.5px]"
      style={{ color: tone === "error" ? "#9B1C1C" : "var(--ap-gray)" }}
    >
      {message}
    </p>
  );
}

function EmptyState({
  tab,
  hasAny,
  onClearFilters,
  onOpenFullForm,
}: {
  tab: TaskFilters["tab"];
  hasAny: boolean;
  onClearFilters(): void;
  onOpenFullForm(): void;
}) {
  if (!hasAny) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
          No tasks yet
        </p>
        <p
          className="max-w-[280px] text-[12px]"
          style={{ color: "var(--ap-gray)" }}
        >
          Use the quick-add above for fast capture, or open the full form for
          due dates, priority, tags, and more.
        </p>
        <button
          type="button"
          onClick={onOpenFullForm}
          className="mt-1 text-[12.5px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--ap-royal)" }}
        >
          + Add the first task
        </button>
      </div>
    );
  }
  const labels: Record<TaskFilters["tab"], string> = {
    active: "active",
    done: "completed",
    all: "matching",
    cancelled: "cancelled",
  };
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
        No {labels[tab]} tasks match this filter.
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className="text-[12px] font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        Clear filters
      </button>
    </div>
  );
}

function BulkActionBar({
  count,
  allVisibleSelected,
  onSelectAllVisible,
  onClear,
  onMarkDone,
  onDelete,
}: {
  count: number;
  allVisibleSelected: boolean;
  onSelectAllVisible(): void;
  onClear(): void;
  onMarkDone(): void;
  onDelete(): void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
      style={{
        border: "1px solid var(--ap-border)",
        backgroundColor: "rgba(79, 124, 172, 0.06)",
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={allVisibleSelected ? onClear : onSelectAllVisible}
          className="flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "var(--ap-navy)" }}
        >
          {allVisibleSelected ? (
            <CheckSquare size={12} strokeWidth={1.75} />
          ) : (
            <Square size={12} strokeWidth={1.75} />
          )}
          {allVisibleSelected ? "Clear selection" : "Select all visible"}
        </button>
        <span className="text-[11.5px]" style={{ color: "var(--ap-gray)" }}>
          {count} selected
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMarkDone}
          className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-semibold"
          style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
        >
          <CheckSquare size={11} strokeWidth={2.25} />
          Mark done
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium"
          style={{
            border: "1px solid #F5C2C2",
            color: "#9B1C1C",
            backgroundColor: "#FFFFFF",
          }}
        >
          <Trash2 size={11} strokeWidth={1.75} />
          Delete
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="flex h-6 w-6 items-center justify-center"
          style={{ color: "var(--ap-gray)" }}
        >
          <X size={11} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
