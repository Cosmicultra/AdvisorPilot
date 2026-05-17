"use client";

/**
 * One row in the task list. Click the BODY to open the detail drawer.
 * The interactive controls (checkbox, status badge, delete button)
 * stopPropagation so they don't double-fire the open action.
 *
 * Layout (left → right):
 *   - Bulk-select checkbox (visible on hover OR when any row is selected)
 *   - Status checkbox (the click target that toggles done ↔ open)
 *   - Title + meta (description preview, client link, due, priority)
 *   - Status badge (click → quick-change menu)
 *   - Hover actions (edit pencil, delete trash)
 *
 * Strikethrough applies to done/cancelled rows so they stay legible
 * but visually de-emphasized. Tasks DO NOT vanish on complete —
 * they re-bucket into the Done tab via the parent's filter.
 *
 * Spec: docs/crm/20-technical-specs.md §7.1.
 */

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import type { Ref } from "react";
import type { Task } from "@/lib/crm/types";
import {
  formatDueLabel,
  TASK_PRIORITY_STYLES,
} from "@/lib/crm/task-list";
import { TaskStatusBadge } from "./task-status-badge";

export interface TaskRowProps {
  task: Task;
  clientName: string | null;
  /** When true, the bulk-select checkbox stays visible (parent is in selection mode). */
  selectionMode: boolean;
  selected: boolean;
  pending: boolean;
  onOpen(task: Task): void;
  onToggleSelect(): void;
  onToggleDone(): void;
  onOpenStatusMenu(anchor: DOMRect): void;
  onDelete(): void;
  /** Forward a ref to the status-badge button so the menu can anchor to it. */
  statusBadgeRef?: Ref<HTMLButtonElement | null>;
}

export function TaskRow({
  task,
  clientName,
  selectionMode,
  selected,
  pending,
  onOpen,
  onToggleSelect,
  onToggleDone,
  onOpenStatusMenu,
  onDelete,
}: TaskRowProps) {
  const isComplete = task.status === "done" || task.status === "cancelled";
  const priorityStyle = TASK_PRIORITY_STYLES[task.priority];
  const due = formatDueLabel(task);

  const dueColor =
    due.tone === "overdue"
      ? "#9B1C1C"
      : due.tone === "soon"
        ? "var(--ap-royal)"
        : "var(--ap-gray)";

  return (
    <div
      className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
      style={{
        borderBottom: "1px solid var(--ap-border)",
        opacity: pending ? 0.5 : 1,
        backgroundColor: selected ? "rgba(79, 124, 172, 0.06)" : undefined,
      }}
    >
      {/* Active stripe when selected — matches the chat sidebar. */}
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[2px]"
          style={{ backgroundColor: "var(--ap-royal)" }}
        />
      ) : null}

      {/* Bulk-select checkbox — visible on hover OR when ANY row is selected. */}
      <label
        className={`mt-1 flex flex-shrink-0 items-center transition-opacity ${
          selectionMode ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        aria-label={`Select "${task.title}"`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5"
        />
      </label>

      {/* Status checkbox — the "tick" affordance. Toggles done ↔ open
          but DOES NOT remove the row (the parent's filter handles
          bucketing). Cmd-click could in future open a chooser; today
          it's a binary toggle. */}
      <input
        type="checkbox"
        checked={isComplete}
        onChange={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        onClick={(e) => e.stopPropagation()}
        disabled={pending}
        aria-label={isComplete ? `Reopen "${task.title}"` : `Mark "${task.title}" complete`}
        className="mt-1 h-3.5 w-3.5 flex-shrink-0"
      />

      {/* Body — clicking ANYWHERE in here opens the detail drawer. */}
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
      >
        <p
          className="text-[13px] font-medium leading-snug"
          style={{
            color: "var(--ap-navy)",
            textDecoration: isComplete ? "line-through" : "none",
            opacity: isComplete ? 0.65 : 1,
          }}
        >
          {task.title}
        </p>

        {task.description ? (
          <p
            className="line-clamp-1 text-[11.5px]"
            style={{ color: "var(--ap-gray)" }}
          >
            {task.description}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          {task.clientId ? (
            <Link
              href={`/app/crm/${task.clientId}/tasks`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--ap-royal)" }}
            >
              {clientName ?? "Unknown client"}
            </Link>
          ) : (
            <span style={{ color: "var(--ap-gray)" }}>Personal</span>
          )}
          <span aria-hidden="true" style={{ color: "var(--ap-gray)" }}>
            ·
          </span>
          <span style={{ color: dueColor }}>{due.label}</span>
          {task.priority !== "Medium" ? (
            <>
              <span aria-hidden="true" style={{ color: "var(--ap-gray)" }}>
                ·
              </span>
              <span
                className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style={{
                  backgroundColor: priorityStyle.bg,
                  color: priorityStyle.fg,
                }}
              >
                {task.priority}
              </span>
            </>
          ) : null}
          {task.tags.length > 0 ? (
            <>
              <span aria-hidden="true" style={{ color: "var(--ap-gray)" }}>
                ·
              </span>
              <span style={{ color: "var(--ap-gray)" }}>
                {task.tags.length} {task.tags.length === 1 ? "tag" : "tags"}
              </span>
            </>
          ) : null}
        </div>
      </button>

      {/* Status badge — click opens the quick-change menu via the parent.
          We capture the badge's bounding rect to anchor the menu next
          to the click target. */}
      <TaskStatusBadge
        status={task.status}
        disabled={pending}
        onClick={() => {
          // The TaskStatusBadge renders as a <button> — the click event
          // we'd ideally use to get its bounding rect lives in the
          // synthetic handler above. We use document.activeElement at
          // call time, which is safe because click handlers always set
          // it just before dispatch.
          const el = document.activeElement as HTMLElement | null;
          if (el && el.getBoundingClientRect) {
            onOpenStatusMenu(el.getBoundingClientRect());
          }
        }}
      />

      {/* Hover actions — edit pencil + delete trash. Stop propagation
          so clicks don't also open the drawer. */}
      <div className="flex flex-shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(task);
          }}
          disabled={pending}
          aria-label={`Edit "${task.title}"`}
          className="flex h-6 w-6 items-center justify-center"
          style={{ color: "var(--ap-gray)" }}
        >
          <Pencil size={11} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={pending}
          aria-label={`Delete "${task.title}"`}
          className="flex h-6 w-6 items-center justify-center"
          style={{ color: "var(--ap-gray)" }}
        >
          <Trash2 size={11} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
