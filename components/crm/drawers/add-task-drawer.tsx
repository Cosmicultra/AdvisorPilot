"use client";

/**
 * Add Task drawer — slide-in form to create a task. clientId is optional;
 * personal tasks (no client) appear in /app/tasks but not on any client's
 * tab.
 *
 * POSTs to /api/tasks via advisorFetch. On success, calls onSaved so the
 * parent can bump its refresh counter.
 *
 * Spec: docs/crm/20-technical-specs.md §5.4.
 */

import { useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Task } from "@/lib/crm/types";
import { DrawerShell } from "./drawer-shell";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;

const PRIORITY_OPTIONS: Task["priority"][] = ["High", "Medium", "Low"];

export type AddTaskDrawerProps = {
  open: boolean;
  /** Null = personal task (no client). */
  clientId: string | null;
  /** Display name for the subtitle. Pass null for personal-task wording. */
  clientName: string | null;
  onClose(): void;
  onSaved(task: Task): void;
};

export function AddTaskDrawer({
  open,
  clientId,
  clientName,
  onClose,
  onSaved,
}: AddTaskDrawerProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("Medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const isValid = trimmedTitle.length > 0 && trimmedTitle.length <= MAX_TITLE;

  const reset = () => {
    setTitle("");
    setDescription("");
    setDueDate("");
    setDueTime("");
    setPriority("Medium");
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await advisorFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          title: trimmedTitle,
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
          dueTime: dueTime || undefined,
          priority,
        }),
      });

      if (res.status === 401) {
        setError("Your session has expired. Sign in again.");
        setSubmitting(false);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.task) {
        setError(json?.error ?? `Failed to create task (${res.status}).`);
        setSubmitting(false);
        return;
      }

      onSaved(json.task as Task);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task.");
      setSubmitting(false);
    }
  };

  const subtitle = clientName ? `For ${clientName}` : "Personal task (no client)";

  return (
    <DrawerShell
      open={open}
      title="Add a task"
      subtitle={subtitle}
      onClose={handleClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-60"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              backgroundColor: "var(--ap-royal)",
              color: "#FFFFFF",
            }}
          >
            {submitting ? "Saving…" : "Create task"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span
            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--ap-gray)" }}
          >
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Send the IPS update"
            maxLength={MAX_TITLE}
            disabled={submitting}
            className="w-full bg-white px-3 py-1.5 text-[13px] focus:outline-none"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
            }}
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span
            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--ap-gray)" }}
          >
            Description (optional)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any context the future-you should remember"
            rows={4}
            maxLength={MAX_DESCRIPTION}
            disabled={submitting}
            className="w-full resize-y bg-white px-3 py-2 text-[13px] leading-snug focus:outline-none"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
            }}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span
              className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--ap-gray)" }}
            >
              Due date
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={submitting}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{
                border: "1px solid var(--ap-border)",
                color: "var(--ap-navy)",
              }}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span
              className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--ap-gray)" }}
            >
              Due time
            </span>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              disabled={submitting || !dueDate}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none disabled:opacity-50"
              style={{
                border: "1px solid var(--ap-border)",
                color: "var(--ap-navy)",
              }}
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span
            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--ap-gray)" }}
          >
            Priority
          </span>
          <div className="flex gap-1.5">
            {PRIORITY_OPTIONS.map((option) => {
              const active = option === priority;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPriority(option)}
                  disabled={submitting}
                  className="flex-1 px-3 py-1.5 text-[12px] font-medium uppercase tracking-wide transition-colors"
                  style={{
                    backgroundColor: active
                      ? "var(--ap-royal)"
                      : "rgba(12, 25, 41, 0.04)",
                    color: active ? "#FFFFFF" : "var(--ap-gray)",
                    border: `1px solid ${active ? "var(--ap-royal)" : "var(--ap-border)"}`,
                  }}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p
            className="text-[12px]"
            style={{ color: "#9B1C1C" }}
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </form>
    </DrawerShell>
  );
}
