"use client";

/**
 * Inline create input pinned above the task list.
 *
 * The simplest possible task entry: type a title + press Enter. For
 * anything richer (description, due date, tags, etc.) the advisor
 * opens the full <AddTaskDrawer> via the "+ Details" button.
 *
 * Behavior:
 *   - Enter → submit (POST /api/tasks with the title + optional clientId)
 *   - Esc → clear the input
 *   - Disabled while a POST is in flight
 *   - Inline error below the input on failure
 *   - Cmd/Ctrl+N anywhere on the page focuses this input (see <TaskListView>)
 *
 * Spec: docs/crm/20-technical-specs.md §7.1.
 */

import { ListPlus, Plus } from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Task } from "@/lib/crm/types";

export interface TaskQuickAddHandle {
  /** Programmatic focus — wired by parent's Cmd/Ctrl+N shortcut. */
  focus(): void;
}

export interface TaskQuickAddProps {
  /** When set, the new task is scoped to this client. */
  clientId: string | null;
  /** Display label shown next to the input ("for Jane Doe" / "personal"). */
  scopeLabel: string;
  onCreated(task: Task): void;
  /** Open the full drawer when the advisor wants more than a title. */
  onOpenFullForm(): void;
}

export const TaskQuickAdd = forwardRef<TaskQuickAddHandle, TaskQuickAddProps>(
  function TaskQuickAdd({ clientId, scopeLabel, onCreated, onOpenFullForm }, ref) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [value, setValue] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    const submit = async () => {
      const title = value.trim();
      if (!title || pending) return;
      setPending(true);
      setError(null);
      try {
        const res = await advisorFetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            clientId,
            priority: "Medium",
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        const body = (await res.json()) as { task: Task };
        onCreated(body.task);
        setValue("");
        // Re-focus so power users can rip off several tasks in a row.
        inputRef.current?.focus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add task.");
      } finally {
        setPending(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setValue("");
        setError(null);
      }
    };

    return (
      <div className="flex flex-col gap-1">
        <div
          className="flex items-center gap-2 bg-white px-3 py-2"
          style={{ border: "1px solid var(--ap-border)" }}
        >
          <ListPlus
            size={14}
            strokeWidth={1.75}
            style={{ color: "var(--ap-gray)" }}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={`Add a task ${scopeLabel}…`}
            aria-label={`Add a task ${scopeLabel}`}
            maxLength={200}
            disabled={pending}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            style={{ color: "var(--ap-navy)" }}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!value.trim() || pending}
            className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-semibold disabled:opacity-40"
            style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
            title="Add (Enter)"
          >
            <Plus size={11} strokeWidth={2.25} />
            Add
          </button>
          <button
            type="button"
            onClick={onOpenFullForm}
            disabled={pending}
            className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
              backgroundColor: "#FFFFFF",
            }}
            title="Open the full task form for description, due date, tags, and more"
          >
            + Details
          </button>
        </div>
        {error ? (
          <p className="text-[11.5px]" style={{ color: "#9B1C1C" }}>
            {error}
          </p>
        ) : (
          <p className="text-[10.5px]" style={{ color: "var(--ap-gray)" }}>
            Enter to add · ⌘N from anywhere to focus
          </p>
        )}
      </div>
    );
  },
);
