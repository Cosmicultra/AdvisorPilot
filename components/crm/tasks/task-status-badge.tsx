"use client";

/**
 * Compact status pill used in the task row + status menu trigger.
 *
 * Click handler is optional: provide it to surface the quick-change
 * menu; omit to render a static badge (e.g. inside the edit drawer
 * header where the full status select lives separately).
 *
 * Spec: docs/crm/20-technical-specs.md §7.1.
 */

import { ChevronDown } from "lucide-react";
import type { Task } from "@/lib/crm/types";
import { TASK_STATUS_STYLES } from "@/lib/crm/task-list";

export interface TaskStatusBadgeProps {
  status: Task["status"];
  /** When set, renders as a button with a tiny chevron + click handler. */
  onClick?(): void;
  /** Disable interaction (e.g. during an in-flight PATCH). */
  disabled?: boolean;
  size?: "sm" | "md";
}

export function TaskStatusBadge({
  status,
  onClick,
  disabled = false,
  size = "sm",
}: TaskStatusBadgeProps) {
  const style = TASK_STATUS_STYLES[status];
  const padding = size === "md" ? "px-2 py-0.5 text-[11.5px]" : "px-1.5 py-0.5 text-[10.5px]";

  const content = (
    <>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: style.dotColor }}
      />
      <span>{style.label}</span>
      {onClick ? (
        <ChevronDown size={10} strokeWidth={2} className="opacity-70" aria-hidden="true" />
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <span
        className={`inline-flex items-center gap-1 font-medium uppercase tracking-[0.06em] ${padding}`}
        style={{ backgroundColor: style.bg, color: style.fg }}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-haspopup="menu"
      aria-label={`Change status (currently ${style.label})`}
      className={`inline-flex items-center gap-1 font-medium uppercase tracking-[0.06em] transition-opacity hover:opacity-80 disabled:opacity-40 ${padding}`}
      style={{
        backgroundColor: style.bg,
        color: style.fg,
        border: `1px solid ${style.border}`,
      }}
    >
      {content}
    </button>
  );
}
