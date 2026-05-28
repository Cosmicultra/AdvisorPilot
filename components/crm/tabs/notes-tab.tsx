"use client";

/**
 * Per-client Notes tab. Mounted at /app/crm/[id]/notes.
 *
 * Enterprise-grade list:
 *   - Search across body + tags + author
 *   - Filter chips: pinned-only toggle, source (Manual / Voice agent /
 *     Meeting recap / All), tag chips (multi-select)
 *   - Sort dropdown: Pinned-first (default), Newest, Oldest, Author A→Z
 *   - Each note: full body (no truncation), source chip, "Edited" badge
 *     when updated_at > created_at, author + relative dates
 *   - Click row → edit drawer (full edit on body/tags/pinned, dirty
 *     tracking, delete with confirm)
 *   - Quick-toggle pin via icon button (no full edit needed for one-off pin)
 *
 * Auth: every fetch goes through advisorFetch.
 *
 * Spec: docs/crm/20-technical-specs.md §5.3.
 */

import { Pencil, Pin, PinOff, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { EditNoteDrawer } from "@/components/crm/drawers/edit-note-drawer";
import type { Note } from "@/lib/crm/types";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; notes: Note[] }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

type SourceFilter = "all" | "manual" | "voice_agent" | "meeting_recap";
type SortKey = "pinned-first" | "newest" | "oldest" | "author-asc";

const SOURCE_LABELS: Record<Note["source"], string> = {
  manual: "Manual",
  voice_agent: "Voice agent",
  meeting_recap: "Meeting recap",
};

const SORT_LABELS: Record<SortKey, string> = {
  "pinned-first": "Pinned",
  newest: "Newest",
  oldest: "Oldest",
  "author-asc": "Author A→Z",
};

const SORT_KEYS: SortKey[] = ["pinned-first", "newest", "oldest", "author-asc"];

export type NotesTabProps = {
  clientId: string;
  clientName: string;
  refreshKey: number;
  onLogNote(): void;
  onMutated(): void;
};

export function NotesTab({
  clientId,
  clientName,
  refreshKey,
  onLogNote,
  onMutated,
}: NotesTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Note | null>(null);

  const [search, setSearch] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("pinned-first");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(`/api/notes?clientId=${encodeURIComponent(clientId)}&limit=500`, {
      cache: "no-store",
    })
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
        setState({ status: "ready", notes: (body?.notes ?? []) as Note[] });
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
  }, [clientId, refreshKey]);

  // Aggregate the universe of tags for the filter chips.
  const allTags = useMemo(() => {
    if (state.status !== "ready") return [] as string[];
    const set = new Set<string>();
    state.notes.forEach((n) => n.tags.forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [state]);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [] as Note[];
    return applyFilters(state.notes, {
      search: search.trim().toLowerCase(),
      pinnedOnly,
      sourceFilter,
      tagFilters,
    });
  }, [state, search, pinnedOnly, sourceFilter, tagFilters]);

  const sorted = useMemo(() => sortNotes(filtered, sort), [filtered, sort]);

  const togglePin = async (note: Note) => {
    if (pendingIds.has(note.id)) return;
    setPendingIds((s) => new Set(s).add(note.id));
    try {
      const res = await advisorFetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !note.pinned }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[crm:ui] notes-tab PATCH failed", body?.error ?? res.status);
        return;
      }
      onMutated();
    } catch (err) {
      console.error("[crm:ui] notes-tab PATCH threw", err);
    } finally {
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(note.id);
        return n;
      });
    }
  };

  const toggleTagFilter = (tag: string) => {
    setTagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const clearAllFilters = () => {
    setSearch("");
    setPinnedOnly(false);
    setSourceFilter("all");
    setTagFilters(new Set());
  };

  const filtersActive =
    search.trim().length > 0 ||
    pinnedOnly ||
    sourceFilter !== "all" ||
    tagFilters.size > 0;

  return (
    <div className="flex flex-1 flex-col gap-3 px-6 py-4">
      <FilterBar
        onLogNote={onLogNote}
        search={search}
        onSearch={setSearch}
        pinnedOnly={pinnedOnly}
        onPinnedOnly={setPinnedOnly}
        sourceFilter={sourceFilter}
        onSourceFilter={setSourceFilter}
        allTags={allTags}
        tagFilters={tagFilters}
        onToggleTag={toggleTagFilter}
        sort={sort}
        onSort={setSort}
        resultCount={filtered.length}
        onClear={clearAllFilters}
        filtersActive={filtersActive}
      />

      {state.status === "loading" ? (
        <Block message="Loading notes…" />
      ) : state.status === "unauthorized" ? (
        <Block message="Sign in to load notes." />
      ) : state.status === "error" ? (
        <Block message={state.message} tone="error" />
      ) : state.notes.length === 0 ? (
        <EmptyAll onLogNote={onLogNote} />
      ) : sorted.length === 0 ? (
        <Block message="No notes match these filters." />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              pending={pendingIds.has(note.id)}
              onTogglePin={() => void togglePin(note)}
              onEdit={() => setEditing(note)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <EditNoteDrawer
          open={editing !== null}
          note={editing}
          clientName={clientName}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onMutated();
          }}
          onDeleted={() => {
            setEditing(null);
            onMutated();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Filter bar (+ Log button) ───────────────────────────────────────────

function FilterBar({
  onLogNote,
  search,
  onSearch,
  pinnedOnly,
  onPinnedOnly,
  sourceFilter,
  onSourceFilter,
  allTags,
  tagFilters,
  onToggleTag,
  sort,
  onSort,
  resultCount,
  onClear,
  filtersActive,
}: {
  onLogNote(): void;
  search: string;
  onSearch(v: string): void;
  pinnedOnly: boolean;
  onPinnedOnly(v: boolean): void;
  sourceFilter: SourceFilter;
  onSourceFilter(v: SourceFilter): void;
  allTags: string[];
  tagFilters: Set<string>;
  onToggleTag(tag: string): void;
  sort: SortKey;
  onSort(v: SortKey): void;
  resultCount: number;
  onClear(): void;
  filtersActive: boolean;
}) {
  // Single-row enterprise toolbar. Tags collapse into their own 2nd line
  // ONLY when they exist AND there's at least one to filter by; otherwise
  // total height is ~30px.
  return (
    <div
      className="flex flex-col gap-1.5 bg-white px-2 py-1.5"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative flex min-w-[160px] flex-1 items-center">
          <Search
            size={12}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2"
            style={{ color: "var(--ap-gray)" }}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search notes, tags, author…"
            className="h-7 w-full bg-white py-0 pl-6 pr-2 text-[12px] focus:outline-none"
            style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
          />
        </label>

        <CompactSelect
          prefix="Source"
          value={sourceFilter}
          onChange={(v) => onSourceFilter(v as SourceFilter)}
          options={[
            { id: "all", label: "All" },
            { id: "manual", label: "Manual" },
            { id: "voice_agent", label: "Voice" },
            { id: "meeting_recap", label: "Meeting" },
          ]}
        />

        <button
          type="button"
          onClick={() => onPinnedOnly(!pinnedOnly)}
          aria-pressed={pinnedOnly}
          title={pinnedOnly ? "Showing pinned only" : "Show pinned only"}
          className="flex h-7 items-center gap-1 px-2 text-[11.5px] font-medium transition-colors"
          style={{
            backgroundColor: pinnedOnly ? "var(--ap-royal)" : "#FFFFFF",
            color: pinnedOnly ? "#FFFFFF" : "var(--ap-gray)",
            border: `1px solid ${pinnedOnly ? "var(--ap-royal)" : "var(--ap-border)"}`,
          }}
        >
          <Pin size={11} strokeWidth={2} />
          Pinned
        </button>

        <CompactSelect
          prefix="Sort"
          value={sort}
          onChange={(v) => onSort(v as SortKey)}
          options={SORT_KEYS.map((key) => ({ id: key, label: SORT_LABELS[key] }))}
        />

        <span
          className="ml-auto flex items-center gap-2 text-[10.5px] uppercase tracking-wide"
          style={{ color: "var(--ap-gray)" }}
        >
          {resultCount}
          {filtersActive ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-0.5 normal-case underline-offset-2 hover:underline"
              style={{ color: "var(--ap-royal)" }}
            >
              <X size={9} strokeWidth={2} />
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogNote}
            className="flex h-7 items-center gap-1 px-2.5 text-[11.5px] font-semibold normal-case"
            style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
          >
            <Pencil size={11} strokeWidth={2.25} />
            Log
          </button>
        </span>
      </div>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--ap-gray)" }}
          >
            Tags
          </span>
          {allTags.map((tag) => {
            const active = tagFilters.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                className="px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide transition-colors"
                style={{
                  backgroundColor: active ? "var(--ap-royal)" : "rgba(15, 111, 222, 0.08)",
                  color: active ? "#FFFFFF" : "var(--ap-royal)",
                  border: `1px solid ${active ? "var(--ap-royal)" : "transparent"}`,
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Compact native select styled like a dropdown button. Selected value is
 *  shown inline ("Source: Manual") so active filters are visible without
 *  expanding. Active state styled with the royal accent. */
function CompactSelect({
  prefix,
  value,
  onChange,
  options,
}: {
  prefix: string;
  value: string;
  onChange(v: string): void;
  options: { id: string; label: string }[];
}) {
  const active = value !== "all" && value !== options[0]?.id;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={prefix}
      className="h-7 cursor-pointer bg-white px-1.5 py-0 text-[11.5px] focus:outline-none"
      style={{
        border: `1px solid ${active ? "var(--ap-royal)" : "var(--ap-border)"}`,
        color: active ? "var(--ap-royal)" : "var(--ap-navy)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {prefix}: {option.label}
        </option>
      ))}
    </select>
  );
}

// ─── Note card ────────────────────────────────────────────────────────────

function NoteCard({
  note,
  pending,
  onTogglePin,
  onEdit,
}: {
  note: Note;
  pending: boolean;
  onTogglePin(): void;
  onEdit(): void;
}) {
  const wasEdited = Date.parse(note.updatedAt) - Date.parse(note.createdAt) > 5_000;

  return (
    <article
      className="flex flex-col gap-2 bg-white px-4 py-3"
      style={{
        border: "1px solid var(--ap-border)",
        borderLeft: note.pinned
          ? "3px solid var(--ap-royal)"
          : "1px solid var(--ap-border)",
        opacity: pending ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {note.pinned ? (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: "var(--ap-pilot-light)",
                color: "var(--ap-navy)",
              }}
            >
              <Pin size={10} strokeWidth={2} />
              Pinned
            </span>
          ) : null}
          <span
            className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: "rgba(12, 25, 41, 0.04)",
              color: "var(--ap-gray)",
            }}
          >
            {SOURCE_LABELS[note.source]}
          </span>
          <span className="text-[11px]" style={{ color: "var(--ap-gray)" }}>
            {actorLabel(note.authorEmail)} · {formatRelative(note.createdAt)}
          </span>
          {wasEdited ? (
            <span
              className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: "rgba(255, 245, 230, 0.8)",
                color: "#92400E",
              }}
              title={`Edited ${formatRelative(note.updatedAt)}`}
            >
              Edited
            </span>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePin}
            disabled={pending}
            aria-label={note.pinned ? "Unpin this note" : "Pin this note"}
            title={note.pinned ? "Unpin" : "Pin"}
            className="flex h-7 w-7 items-center justify-center disabled:opacity-50"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            {note.pinned ? <PinOff size={12} strokeWidth={1.75} /> : <Pin size={12} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            aria-label="Edit this note"
            title="Edit note"
            className="flex h-7 w-7 items-center justify-center disabled:opacity-50"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            <Pencil size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="text-left"
      >
        <p
          className="whitespace-pre-wrap text-[13px] leading-snug"
          style={{ color: "var(--ap-navy)" }}
        >
          {note.body}
        </p>
      </button>

      {note.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: "rgba(15, 111, 222, 0.08)",
                color: "var(--ap-royal)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

// ─── Empty / message blocks ───────────────────────────────────────────────

function Block({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "error";
}) {
  return (
    <p
      className="bg-white px-4 py-6 text-[12.5px]"
      style={{
        border: "1px solid var(--ap-border)",
        color: tone === "error" ? "#9B1C1C" : "var(--ap-gray)",
      }}
    >
      {message}
    </p>
  );
}

function EmptyAll({ onLogNote }: { onLogNote(): void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 bg-white px-6 py-10 text-center"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
        No notes for this client yet
      </p>
      <p className="max-w-[360px] text-[12px]" style={{ color: "var(--ap-gray)" }}>
        Logged notes capture the gist of conversations and surface in the
        Overview&apos;s Pinned Note card and Activity.
      </p>
      <button
        type="button"
        onClick={onLogNote}
        className="text-[12.5px] font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        + Log the first note
      </button>
    </div>
  );
}

// ─── Filter logic ─────────────────────────────────────────────────────────

function applyFilters(
  notes: Note[],
  f: {
    search: string;
    pinnedOnly: boolean;
    sourceFilter: SourceFilter;
    tagFilters: Set<string>;
  }
): Note[] {
  return notes.filter((note) => {
    if (f.pinnedOnly && !note.pinned) return false;
    if (f.sourceFilter !== "all" && note.source !== f.sourceFilter) return false;
    if (f.tagFilters.size > 0) {
      const hasTag = note.tags.some((t) => f.tagFilters.has(t));
      if (!hasTag) return false;
    }
    if (f.search) {
      const haystack = [note.body, note.tags.join(" "), note.authorEmail]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(f.search)) return false;
    }
    return true;
  });
}

function sortNotes(notes: Note[], sort: SortKey): Note[] {
  const cloned = [...notes];
  switch (sort) {
    case "pinned-first":
      cloned.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
      break;
    case "newest":
      cloned.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "oldest":
      cloned.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "author-asc":
      cloned.sort((a, b) => a.authorEmail.localeCompare(b.authorEmail));
      break;
  }
  return cloned;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
    if (hours < 1) {
      const mins = Math.floor(diff / (60 * 1000));
      if (mins < 1) return "just now";
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
