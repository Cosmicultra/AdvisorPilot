"use client";

/**
 * Open-tasks card on the Overview tab. Lists this client's open + in_progress
 * tasks (max 5), with checkboxes to mark complete and a "+ Add task" button
 * in the header that calls the parent's onAddTask handler.
 *
 * Optimistic toggle on completion: flip the UI immediately, PATCH in the
 * background, refetch on success or revert on failure.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body, right column).
 */

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Task } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

const TOP_N = 5;

type FetchState =
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type TasksCardProps = {
  clientId: string;
  /** Bumped by parent after a drawer save so the card re-fetches. */
  refreshKey: number;
  onAddTask(): void;
};

export function TasksCard({ clientId, refreshKey, onAddTask }: TasksCardProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(
      `/api/tasks?clientId=${encodeURIComponent(clientId)}&status=open&limit=${TOP_N}`,
      { cache: "no-store" }
    )
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
        setState({
          status: "ready",
          tasks: (body?.tasks ?? []) as Task[],
        });
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

  const handleToggle = async (task: Task) => {
    if (pendingIds.has(task.id)) return;

    // Optimistic: drop the task from the list (since we only show open ones).
    setPendingIds((s) => new Set(s).add(task.id));
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", tasks: current.tasks.filter((t) => t.id !== task.id) }
        : current
    );

    try {
      const res = await advisorFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });

      if (!res.ok) {
        // Revert: put the task back into the list.
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                tasks: [...current.tasks, task].sort(sortOpen),
              }
            : current
        );
        const body = await res.json().catch(() => ({}));
        console.error("[crm:ui] tasks-card PATCH failed", body?.error ?? res.status);
      }
    } catch (err) {
      console.error("[crm:ui] tasks-card PATCH threw", err);
    } finally {
      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(task.id);
        return next;
      });
    }
  };

  return (
    <OverviewCard
      title="Open tasks"
      rightSlot={
        <button
          type="button"
          onClick={onAddTask}
          className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium"
          style={{
            border: "1px solid var(--ap-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--ap-navy)",
          }}
        >
          <Plus size={12} strokeWidth={2} />
          Add task
        </button>
      }
    >
      {state.status === "loading" ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          Loading…
        </p>
      ) : state.status === "unauthorized" ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          Sign in to load tasks.
        </p>
      ) : state.status === "error" ? (
        <p className="text-[12.5px]" style={{ color: "#9B1C1C" }}>
          {state.message}
        </p>
      ) : state.tasks.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          No open tasks for this client. Add one to keep follow-ups on your radar.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              pending={pendingIds.has(task.id)}
              onToggle={() => void handleToggle(task)}
            />
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

function TaskRow({
  task,
  pending,
  onToggle,
}: {
  task: Task;
  pending: boolean;
  onToggle(): void;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={false}
        onChange={onToggle}
        disabled={pending}
        aria-label={`Mark "${task.title}" complete`}
        className="mt-1 h-3.5 w-3.5 flex-shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className="text-[12.5px] font-medium"
          style={{
            color: "var(--ap-navy)",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {task.title}
        </p>
        <p
          className="text-[11px]"
          style={{ color: "var(--ap-gray)" }}
        >
          {[
            task.dueDate ? formatDueDate(task.dueDate) : null,
            task.priority !== "Medium" ? `${task.priority} priority` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "No due date"}
        </p>
      </div>
    </li>
  );
}

function sortOpen(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}

function formatDueDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const date = new Date(ts);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  if (iso === todayKey) return "Due today";
  if (iso === tomorrowKey) return "Due tomorrow";
  if (ts < today.setHours(0, 0, 0, 0)) return `Overdue · ${formatShortDate(date)}`;
  return `Due ${formatShortDate(date)}`;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
