"use client";

/**
 * Edit Task drawer — slide-in form to update an existing task. Mirrors
 * AddTaskDrawer's shape but pre-fills from the existing Task and PATCHes
 * /api/tasks/[id] with only the fields that changed.
 *
 * Adds enterprise behaviors missing from the v1 toggle:
 *   - Full edit on every field (title, description, due, priority, status, tags)
 *   - Dirty-state tracking with confirm-on-dismiss
 *   - Inline Delete with second confirmation
 *   - Surfaces audit info (created/updated/completed timestamps)
 *
 * Spec: docs/crm/20-technical-specs.md §5.4 (drawers).
 */

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Task } from "@/lib/crm/types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DrawerShell } from "./drawer-shell";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;

const PRIORITY_OPTIONS: Task["priority"][] = ["High", "Medium", "Low"];
const STATUS_OPTIONS: Task["status"][] = ["open", "in_progress", "done", "cancelled"];
const STATUS_LABELS: Record<Task["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

interface FormState {
  title: string;
  description: string;
  dueDate: string;
  dueTime: string;
  priority: Task["priority"];
  status: Task["status"];
  tagsRaw: string;
}

export type EditTaskDrawerProps = {
  open: boolean;
  task: Task;
  /** Display name for the subtitle; pass null for personal tasks. */
  clientName: string | null;
  onClose(): void;
  onSaved(task: Task): void;
  onDeleted(taskId: string): void;
};

export function EditTaskDrawer({
  open,
  task,
  clientName,
  onClose,
  onSaved,
  onDeleted,
}: EditTaskDrawerProps) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => initialForm(task));
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialForm(task));
      setError(null);
      setSubmitting(false);
      setDeleting(false);
    }
    // Re-hydrate ONLY on open. Edits during the session shouldn't be wiped
    // by parent re-renders that happen to pass a new task reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedTitle = form.title.trim();
  const isValid = trimmedTitle.length > 0 && trimmedTitle.length <= MAX_TITLE;
  const isDirty = formIsDirty(form, task);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleClose = async () => {
    if (submitting || deleting) return;
    if (isDirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message:
          "You have edits that haven't been saved. Close the drawer and lose them?",
        tone: "danger",
        confirmLabel: "Discard changes",
      });
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid || submitting || deleting) return;

    const patch: Record<string, unknown> = {};
    const initial = initialForm(task);

    if (form.title.trim() !== initial.title.trim()) patch.title = form.title.trim();
    if (form.description.trim() !== initial.description.trim()) {
      patch.description = form.description.trim() || null;
    }
    if (form.dueDate !== initial.dueDate) patch.dueDate = form.dueDate || null;
    if (form.dueTime !== initial.dueTime) patch.dueTime = form.dueTime || null;
    if (form.priority !== initial.priority) patch.priority = form.priority;
    if (form.status !== initial.status) patch.status = form.status;

    const newTags = parseTags(form.tagsRaw);
    if (!arraysEqual(newTags, parseTags(initial.tagsRaw))) patch.tags = newTags;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await advisorFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (res.status === 401) {
        setError("Your session has expired. Sign in again.");
        setSubmitting(false);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.task) {
        setError(json?.error ?? `Failed to update task (${res.status}).`);
        setSubmitting(false);
        return;
      }

      onSaved(json.task as Task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task.");
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (submitting || deleting) return;
    const ok = await confirm({
      title: "Delete task?",
      message: (
        <span>
          Permanently delete <strong>&ldquo;{task.title}&rdquo;</strong>? This
          cannot be undone.
        </span>
      ),
      tone: "danger",
      confirmLabel: "Delete task",
    });
    if (!ok) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await advisorFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (res.status === 401) {
        setError("Your session has expired. Sign in again.");
        setDeleting(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed to delete task (${res.status}).`);
        setDeleting(false);
        return;
      }
      onDeleted(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task.");
      setDeleting(false);
    }
  };

  const subtitle = clientName ? `For ${clientName}` : "Personal task";

  return (
    <DrawerShell
      open={open}
      title="Edit task"
      subtitle={subtitle}
      onClose={handleClose}
      widthPx={460}
      footer={
        <>
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting || deleting}
            className="mr-auto flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              border: "1px solid #FDECEC",
              backgroundColor: "#FFFFFF",
              color: "#9B1C1C",
            }}
          >
            <Trash2 size={12} strokeWidth={1.75} />
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting || deleting}
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
            disabled={!isValid || submitting || deleting}
            className="px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              backgroundColor: "var(--ap-royal)",
              color: "#FFFFFF",
            }}
          >
            {submitting ? "Saving…" : "Save changes"}
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
        <Field label="Title">
          <input
            type="text"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            maxLength={MAX_TITLE}
            disabled={submitting || deleting}
            className="w-full bg-white px-3 py-1.5 text-[13px] focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            autoFocus
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={4}
            maxLength={MAX_DESCRIPTION}
            disabled={submitting || deleting}
            className="w-full resize-y bg-white px-3 py-2 text-[13px] leading-snug focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => update("dueDate", e.target.value)}
              disabled={submitting || deleting}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
          <Field label="Due time">
            <input
              type="time"
              value={form.dueTime}
              onChange={(e) => update("dueTime", e.target.value)}
              disabled={submitting || deleting || !form.dueDate}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none disabled:opacity-50"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            />
          </Field>
        </div>

        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value as Task["status"])}
            disabled={submitting || deleting}
            className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
            Priority
          </span>
          <div className="flex gap-1.5">
            {PRIORITY_OPTIONS.map((option) => {
              const active = option === form.priority;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => update("priority", option)}
                  disabled={submitting || deleting}
                  className="flex-1 px-3 py-1.5 text-[12px] font-medium uppercase tracking-wide transition-colors"
                  style={{
                    backgroundColor: active ? "var(--ap-royal)" : "rgba(12, 25, 41, 0.04)",
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

        <Field label="Tags (comma-separated)">
          <input
            type="text"
            value={form.tagsRaw}
            onChange={(e) => update("tagsRaw", e.target.value)}
            disabled={submitting || deleting}
            placeholder="follow-up, rmd"
            className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
          />
        </Field>

        <AuditFooter task={task} />

        {error ? (
          <p className="text-[12px]" style={{ color: "#9B1C1C" }} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </DrawerShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function AuditFooter({ task }: { task: Task }) {
  const wasEdited = Date.parse(task.updatedAt) - Date.parse(task.createdAt) > 5_000;
  return (
    <div
      className="flex flex-col gap-1 pt-2 text-[11px]"
      style={{ borderTop: "1px solid var(--ap-border)", color: "var(--ap-gray)" }}
    >
      <p>Created {formatAbsolute(task.createdAt)} by {actorLabel(task.ownerEmail)}</p>
      {wasEdited ? <p>Updated {formatAbsolute(task.updatedAt)}</p> : null}
      {task.completedAt ? (
        <p>Completed {formatAbsolute(task.completedAt)}</p>
      ) : null}
    </div>
  );
}

// ─── Form helpers ─────────────────────────────────────────────────────────

function initialForm(task: Task): FormState {
  return {
    title: task.title,
    description: task.description ?? "",
    dueDate: task.dueDate ?? "",
    dueTime: task.dueTime ? task.dueTime.slice(0, 5) : "",
    priority: task.priority,
    status: task.status,
    tagsRaw: task.tags.join(", "),
  };
}

function formIsDirty(form: FormState, task: Task): boolean {
  const initial = initialForm(task);
  if (form.title.trim() !== initial.title.trim()) return true;
  if (form.description.trim() !== initial.description.trim()) return true;
  if (form.dueDate !== initial.dueDate) return true;
  if (form.dueTime !== initial.dueTime) return true;
  if (form.priority !== initial.priority) return true;
  if (form.status !== initial.status) return true;
  if (!arraysEqual(parseTags(form.tagsRaw), parseTags(initial.tagsRaw))) return true;
  return false;
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function actorLabel(email: string): string {
  const localPart = email.split("@")[0];
  if (!localPart) return email;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function formatAbsolute(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
