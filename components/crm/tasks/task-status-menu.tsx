"use client";

/**
 * Quick-change popover for a task's status.
 *
 * Rendered as a small floating menu anchored next to a `<TaskStatusBadge>`
 * when the badge is clicked. Picks fire `onPick(nextStatus)`; the
 * outer caller then PATCHes via /api/tasks/[id] and updates state.
 *
 * Closes on:
 *   - selecting a status
 *   - clicking outside the menu
 *   - Esc
 *
 * v1 is anchored manually via fixed positioning relative to the
 * trigger's bounding rect (avoids pulling in a popover library).
 *
 * Spec: docs/crm/20-technical-specs.md §7.1.
 */

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Task } from "@/lib/crm/types";
import { TASK_STATUS_STYLES } from "@/lib/crm/task-list";

const ORDER: Task["status"][] = ["open", "in_progress", "done", "cancelled"];

export interface TaskStatusMenuProps {
  current: Task["status"];
  anchorRect: DOMRect;
  onPick(next: Task["status"]): void;
  onClose(): void;
}

export function TaskStatusMenu({
  current,
  anchorRect,
  onPick,
  onClose,
}: TaskStatusMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Click-outside to close. Skips the same-tick mount click that
  // opened the menu (avoids immediate self-close).
  useEffect(() => {
    let armed = false;
    const id = window.setTimeout(() => {
      armed = true;
    }, 0);
    const onClick = (e: MouseEvent) => {
      if (!armed) return;
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onClick, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onClick, true);
    };
  }, [onClose]);

  // Place the menu directly BELOW the trigger by default; flip to
  // ABOVE if there isn't room. Width matches the menu's natural
  // size (~180 px) — left-aligned with the trigger.
  const MENU_HEIGHT = 168; // approx height for 4 items + padding
  const fitsBelow =
    typeof window !== "undefined" &&
    anchorRect.bottom + MENU_HEIGHT + 12 < window.innerHeight;
  const top = fitsBelow ? anchorRect.bottom + 4 : anchorRect.top - MENU_HEIGHT - 4;
  const left = Math.max(8, anchorRect.left);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Change task status"
      className="fixed z-[70] flex w-[180px] flex-col bg-white py-1 shadow-xl"
      style={{
        top,
        left,
        border: "1px solid var(--ap-border)",
      }}
    >
      {ORDER.map((status) => {
        const style = TASK_STATUS_STYLES[status];
        const isCurrent = status === current;
        return (
          <button
            key={status}
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              if (status !== current) onPick(status);
              onClose();
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-slate-50"
            style={{ color: "var(--ap-navy)" }}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: style.dotColor }}
            />
            <span className="flex-1">{style.label}</span>
            {isCurrent ? (
              <Check
                size={11}
                strokeWidth={2.5}
                style={{ color: "var(--ap-royal)" }}
                aria-label="Current status"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
