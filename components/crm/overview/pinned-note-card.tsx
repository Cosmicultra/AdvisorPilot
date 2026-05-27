"use client";

/**
 * Pinned-note card on the Overview tab. Shows the most recent pinned note
 * for this client; falls back to the most recent unpinned note if none are
 * pinned. "Log note" button in the header opens the LogNoteDrawer via the
 * parent's onLogNote handler.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body, right column).
 */

import { Pencil, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Note } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; note: Note | null }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type PinnedNoteCardProps = {
  clientId: string;
  refreshKey: number;
  onLogNote(): void;
};

export function PinnedNoteCard({
  clientId,
  refreshKey,
  onLogNote,
  prefetchedNote,
  bundleLoading = false,
}: PinnedNoteCardProps & {
  prefetchedNote?: Note | null;
  bundleLoading?: boolean;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (prefetchedNote !== undefined) {
      setState({ status: "ready", note: prefetchedNote });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(
      `/api/notes?clientId=${encodeURIComponent(clientId)}&limit=1`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load notes (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        const notes = (body?.notes ?? []) as Note[];
        setState({ status: "ready", note: notes[0] ?? null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load notes.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey, prefetchedNote]);

  if (bundleLoading && prefetchedNote === undefined) {
    return (
      <OverviewCard title="Latest note">
        <p className="text-[12px] text-slate-500">Loading…</p>
      </OverviewCard>
    );
  }

  return (
    <OverviewCard
      title={state.status === "ready" && state.note?.pinned ? "Pinned note" : "Latest note"}
      rightSlot={
        <button
          type="button"
          onClick={onLogNote}
          className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium"
          style={{
            border: "1px solid var(--ap-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--ap-navy)",
          }}
        >
          <Pencil size={12} strokeWidth={2} />
          Log note
        </button>
      }
    >
      {state.status === "loading" ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          Loading…
        </p>
      ) : state.status === "unauthorized" ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          Sign in to load notes.
        </p>
      ) : state.status === "error" ? (
        <p className="text-[12.5px]" style={{ color: "#9B1C1C" }}>
          {state.message}
        </p>
      ) : !state.note ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          No notes yet. Log one to capture the gist of your last conversation.
        </p>
      ) : (
        <NoteBody note={state.note} />
      )}
    </OverviewCard>
  );
}

function NoteBody({ note }: { note: Note }) {
  const truncated = note.body.length > 280;
  const display = truncated ? `${note.body.slice(0, 280)}…` : note.body;

  return (
    <div className="flex flex-col gap-2">
      {note.pinned ? (
        <span
          className="flex items-center gap-1 self-start px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{
            backgroundColor: "var(--ap-pilot-light)",
            color: "var(--ap-navy)",
          }}
        >
          <Pin size={10} strokeWidth={2} />
          Pinned
        </span>
      ) : null}
      <p
        className="whitespace-pre-wrap text-[12.5px] leading-snug"
        style={{ color: "var(--ap-navy)" }}
      >
        {display}
      </p>
      <p
        className="text-[11px]"
        style={{ color: "var(--ap-gray)" }}
      >
        {actorLabel(note.authorEmail)} · {formatRelative(note.createdAt)}
      </p>
    </div>
  );
}

function actorLabel(email: string): string {
  const localPart = email.split("@")[0];
  if (!localPart) return email;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) return "just now";
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
