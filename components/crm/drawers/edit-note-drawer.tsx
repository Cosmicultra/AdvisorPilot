"use client";

/**
 * Edit Note drawer — slide-in form to update an existing note. Mirrors
 * LogNoteDrawer's shape but pre-fills from the existing Note and PATCHes
 * /api/notes/[id] with only the fields that changed.
 *
 * Editable fields: body, tags, pinned. clientId / authorEmail / source are
 * immutable per the API contract (note ownership doesn't transfer; source
 * indicates how the note was originally captured).
 *
 * Adds enterprise behaviors:
 *   - Dirty-state tracking with confirm-on-dismiss
 *   - Inline Delete with second confirmation
 *   - Surfaces audit info (created/updated timestamps + author + source)
 *
 * Spec: docs/crm/20-technical-specs.md §5.4 (drawers).
 */

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Note } from "@/lib/crm/types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DrawerShell } from "./drawer-shell";

const MAX_BODY = 20_000;

interface FormState {
  body: string;
  tagsRaw: string;
  pinned: boolean;
}

export type EditNoteDrawerProps = {
  open: boolean;
  note: Note;
  clientName: string;
  onClose(): void;
  onSaved(note: Note): void;
  onDeleted(noteId: string): void;
};

export function EditNoteDrawer({
  open,
  note,
  clientName,
  onClose,
  onSaved,
  onDeleted,
}: EditNoteDrawerProps) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => initialForm(note));
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialForm(note));
      setError(null);
      setSubmitting(false);
      setDeleting(false);
    }
    // Re-hydrate ONLY on open. Edits during the session shouldn't be wiped
    // by parent re-renders that pass a new note reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedBody = form.body.trim();
  const isValid = trimmedBody.length > 0 && trimmedBody.length <= MAX_BODY;
  const isDirty = formIsDirty(form, note);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleClose = async () => {
    if (submitting || deleting) return;
    if (isDirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message:
          "You have edits to this note that haven't been saved. Discard them?",
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
    const initial = initialForm(note);
    if (form.body.trim() !== initial.body.trim()) patch.body = form.body.trim();
    if (form.pinned !== initial.pinned) patch.pinned = form.pinned;

    const newTags = parseTags(form.tagsRaw);
    if (!arraysEqual(newTags, parseTags(initial.tagsRaw))) patch.tags = newTags;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await advisorFetch(`/api/notes/${note.id}`, {
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
      if (!res.ok || !json?.note) {
        setError(json?.error ?? `Failed to update note (${res.status}).`);
        setSubmitting(false);
        return;
      }

      onSaved(json.note as Note);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update note.");
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (submitting || deleting) return;
    const ok = await confirm({
      title: "Delete note?",
      message: "Permanently delete this note? This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete note",
    });
    if (!ok) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await advisorFetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (res.status === 401) {
        setError("Your session has expired. Sign in again.");
        setDeleting(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed to delete note (${res.status}).`);
        setDeleting(false);
        return;
      }
      onDeleted(note.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note.");
      setDeleting(false);
    }
  };

  return (
    <DrawerShell
      open={open}
      title="Edit note"
      subtitle={`For ${clientName}`}
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
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
            Note
          </span>
          <textarea
            value={form.body}
            onChange={(e) => update("body", e.target.value)}
            rows={10}
            maxLength={MAX_BODY}
            disabled={submitting || deleting}
            className="w-full resize-y bg-white px-3 py-2 text-[13px] leading-snug focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)", minHeight: "200px" }}
            autoFocus
          />
          <span className="self-end text-[10.5px]" style={{ color: "var(--ap-gray)" }}>
            {trimmedBody.length}/{MAX_BODY}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: "var(--ap-navy)" }}>
            Tags (comma-separated)
          </span>
          <input
            type="text"
            value={form.tagsRaw}
            onChange={(e) => update("tagsRaw", e.target.value)}
            disabled={submitting || deleting}
            placeholder="rmd, retirement, follow-up"
            className="w-full bg-white px-3 py-1.5 text-[13px] focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
          />
        </label>

        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={form.pinned}
            onChange={(e) => update("pinned", e.target.checked)}
            disabled={submitting || deleting}
            className="h-3.5 w-3.5"
          />
          <span style={{ color: "var(--ap-navy)" }}>
            Pin this note to the Overview tab
          </span>
        </label>

        <AuditFooter note={note} />

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

function AuditFooter({ note }: { note: Note }) {
  const wasEdited = Date.parse(note.updatedAt) - Date.parse(note.createdAt) > 5_000;
  const sourceLabel = SOURCE_LABELS[note.source] ?? note.source;
  return (
    <div
      className="flex flex-col gap-1 pt-2 text-[11px]"
      style={{ borderTop: "1px solid var(--ap-border)", color: "var(--ap-gray)" }}
    >
      <p>
        Logged {formatAbsolute(note.createdAt)} by {actorLabel(note.authorEmail)} ·{" "}
        {sourceLabel}
      </p>
      {wasEdited ? <p>Updated {formatAbsolute(note.updatedAt)}</p> : null}
    </div>
  );
}

const SOURCE_LABELS: Record<Note["source"], string> = {
  manual: "Manual entry",
  voice_agent: "Voice agent",
  meeting_recap: "Meeting recap",
};

// ─── Form helpers ─────────────────────────────────────────────────────────

function initialForm(note: Note): FormState {
  return {
    body: note.body,
    tagsRaw: note.tags.join(", "),
    pinned: note.pinned,
  };
}

function formIsDirty(form: FormState, note: Note): boolean {
  const initial = initialForm(note);
  if (form.body.trim() !== initial.body.trim()) return true;
  if (form.pinned !== initial.pinned) return true;
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
