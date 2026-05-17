"use client";

/**
 * Log Note drawer — slide-in form to add a note to the current client.
 * POSTs to /api/notes via advisorFetch (Bearer-aware for email/password
 * users). On success, calls onSaved so the parent can bump its refresh
 * counter and the Pinned Note + Timeline cards re-fetch.
 *
 * Fields: body (required), pinned (checkbox), tags (comma-separated).
 *
 * Spec: docs/crm/20-technical-specs.md §5.4.
 */

import { useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Note } from "@/lib/crm/types";
import { DrawerShell } from "./drawer-shell";

const MAX_BODY = 20_000;

export type LogNoteDrawerProps = {
  open: boolean;
  clientId: string;
  clientName: string;
  onClose(): void;
  onSaved(note: Note): void;
};

export function LogNoteDrawer({
  open,
  clientId,
  clientName,
  onClose,
  onSaved,
}: LogNoteDrawerProps) {
  const [body, setBody] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedBody = body.trim();
  const isValid = trimmedBody.length > 0 && trimmedBody.length <= MAX_BODY;

  const reset = () => {
    setBody("");
    setTagsRaw("");
    setPinned(false);
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

    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      const res = await advisorFetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          body: trimmedBody,
          pinned,
          tags,
          source: "manual",
        }),
      });

      if (res.status === 401) {
        setError("Your session has expired. Sign in again.");
        setSubmitting(false);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.note) {
        setError(json?.error ?? `Failed to save note (${res.status}).`);
        setSubmitting(false);
        return;
      }

      onSaved(json.note as Note);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note.");
      setSubmitting(false);
    }
  };

  return (
    <DrawerShell
      open={open}
      title="Log a note"
      subtitle={`For ${clientName}`}
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
            {submitting ? "Saving…" : "Save note"}
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
            Note
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did you discuss with the client?"
            rows={8}
            maxLength={MAX_BODY}
            disabled={submitting}
            className="w-full resize-y bg-white px-3 py-2 text-[13px] leading-snug focus:outline-none focus:ring-1"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
              minHeight: "180px",
            }}
            autoFocus
          />
          <span
            className="self-end text-[10.5px]"
            style={{ color: "var(--ap-gray)" }}
          >
            {trimmedBody.length}/{MAX_BODY}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span
            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--ap-gray)" }}
          >
            Tags (comma-separated, optional)
          </span>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="rmd, retirement, follow-up"
            disabled={submitting}
            className="w-full bg-white px-3 py-1.5 text-[13px] focus:outline-none"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
            }}
          />
        </label>

        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            disabled={submitting}
            className="h-3.5 w-3.5"
          />
          <span style={{ color: "var(--ap-navy)" }}>
            Pin this note to the Overview tab
          </span>
        </label>

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
