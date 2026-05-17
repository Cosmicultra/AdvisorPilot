"use client";

/**
 * Chat history sidebar — slides out from the LEFT edge of the chat widget
 * showing the advisor's past conversations grouped by recency.
 *
 * v2 polish (PR 18):
 *   - Search input with 200ms debounce + Cmd/Ctrl+K shortcut
 *   - Skeleton rows during the initial fetch (no plain "Loading…")
 *   - Inline rename — click a row's title to edit, Enter to save, Esc to cancel
 *   - Richer empty state (icon + heading + secondary copy)
 *   - "Open elsewhere" pill for conversations another tab has open
 *   - Hover-reveal delete is unchanged from v1
 *
 * Multi-session note: this list reflects EVERY conversation the advisor
 * owns regardless of which tab created it. The current tab's active
 * conversation is highlighted with a royal stripe; conversations open in
 * a DIFFERENT tab show a small pill (sourced from BroadcastChannel
 * `tab_opened_conversation` events).
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.16 + §B.17 + §B.18 (PR 18).
 */

import { History, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import {
  getConversationBroadcast,
  type BroadcastEvent,
} from "@/lib/chat/conversation-broadcast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  filterConversationsByQuery,
  groupConversations,
  relativeTimestamp,
} from "@/lib/chat/conversation-grouping";
import type { ChatConversationSummary } from "@/lib/chat/persistence";

export interface ChatHistorySidebarProps {
  /** Advisor email — scopes the BroadcastChannel + REST list. */
  advisorEmail: string;
  /** Currently open conversation id — gets the highlight. */
  activeConversationId: string | null;
  /** Called when the advisor clicks a conversation row. */
  onOpen(conversationId: string): void;
  /** Called when the advisor clicks "+ New chat". */
  onNewChat(): void;
  /**
   * Called when a conversation is deleted — parent can clear the chat
   * if the deleted conversation was the active one.
   */
  onDeleted?(conversationId: string): void;
  /** Optional class applied to the root container. */
  className?: string;
}

type FetchState =
  | { status: "loading" }
  | { status: "ready"; conversations: ChatConversationSummary[] }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

const SEARCH_DEBOUNCE_MS = 200;
/**
 * Threshold at which the sidebar switches from client-side title filter
 * (instant) to server-side FTS (covers message content + title). Matches
 * the cap in `lib/chat/persistence.ts:FTS_MIN_QUERY_LENGTH`.
 */
const FTS_MIN_QUERY_LENGTH = 3;

export function ChatHistorySidebar({
  advisorEmail,
  activeConversationId,
  onOpen,
  onNewChat,
  onDeleted,
  className,
}: ChatHistorySidebarProps) {
  const confirm = useConfirm();
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [otherTabConversationIds, setOtherTabConversationIds] = useState<Set<string>>(
    new Set(),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Stable broadcast instance per advisor (cached across re-mounts).
  const broadcast = useMemo(
    () => getConversationBroadcast(advisorEmail),
    [advisorEmail],
  );

  // Cmd/Ctrl+K focuses the search input (when the sidebar is mounted).
  // Capture phase so we beat the underlying chat-input's keyboard
  // handlers without interfering with form-typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      const isFocusSearch =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isFocusSearch) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey as EventListener, true);
    return () => window.removeEventListener("keydown", onKey as EventListener, true);
  }, []);

  // Debounce the search input → debouncedQuery.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // Fetch the list. Re-runs when an external event signals a refresh OR
  // when the debounced server-search query changes. Long-enough queries
  // (≥3 chars) round-trip to the FTS endpoint so we surface
  // message-content hits; shorter queries pull the full list and let
  // the client-side title filter run instantly.
  const serverSearch =
    debouncedQuery.trim().length >= FTS_MIN_QUERY_LENGTH
      ? debouncedQuery.trim()
      : "";
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "200" });
    if (serverSearch) params.set("search", serverSearch);
    advisorFetch(`/api/chat/conversations?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthorized" });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load chats (${res.status})`);
        }
        const body = (await res.json()) as {
          conversations: ChatConversationSummary[];
        };
        setState({ status: "ready", conversations: body.conversations });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load chats.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, serverSearch]);

  // BroadcastChannel — refresh on cross-tab events.
  useEffect(() => {
    const unsub = broadcast.subscribe((event: BroadcastEvent) => {
      switch (event.type) {
        case "turn_completed":
        case "conversation_created":
          setRefreshKey((k) => k + 1);
          break;
        case "conversation_deleted":
          setState((curr) =>
            curr.status === "ready"
              ? {
                  ...curr,
                  conversations: curr.conversations.filter(
                    (c) => c.id !== event.conversationId,
                  ),
                }
              : curr,
          );
          onDeleted?.(event.conversationId);
          break;
        case "conversation_renamed":
          setState((curr) =>
            curr.status === "ready"
              ? {
                  ...curr,
                  conversations: curr.conversations.map((c) =>
                    c.id === event.conversationId
                      ? {
                          ...c,
                          title: event.title,
                          displayTitle:
                            event.title && event.title.trim()
                              ? event.title
                              : "Untitled chat",
                        }
                      : c,
                  ),
                }
              : curr,
          );
          break;
        case "conversation_pinned":
          setState((curr) =>
            curr.status === "ready"
              ? {
                  ...curr,
                  conversations: curr.conversations.map((c) =>
                    c.id === event.conversationId
                      ? {
                          ...c,
                          isPinned: event.isPinned,
                          pinnedAt: event.pinnedAt,
                        }
                      : c,
                  ),
                }
              : curr,
          );
          break;
        case "tab_opened_conversation":
          if (event.tabId === broadcast.tabId) return;
          setOtherTabConversationIds((prev) => {
            const next = new Set(prev);
            next.add(event.conversationId);
            return next;
          });
          break;
      }
    });
    return unsub;
  }, [broadcast, onDeleted]);

  // Announce that THIS tab adopted the active conversation.
  useEffect(() => {
    if (!activeConversationId) return;
    broadcast.send({
      type: "tab_opened_conversation",
      conversationId: activeConversationId,
      tabId: broadcast.tabId,
    });
  }, [activeConversationId, broadcast]);

  const filteredGroups = useMemo(() => {
    if (state.status !== "ready") return [];
    // Two-tier search:
    //   - query length >= FTS_MIN_QUERY_LENGTH → server already filtered
    //     (covers title + message content); render the result set as-is
    //   - shorter / empty → client-side title-substring filter for the
    //     instant feel during typing
    const isServerSearched =
      debouncedQuery.trim().length >= FTS_MIN_QUERY_LENGTH;
    const filtered = isServerSearched
      ? state.conversations
      : filterConversationsByQuery(state.conversations, debouncedQuery);
    return groupConversations(filtered);
  }, [state, debouncedQuery]);

  const totalCount = state.status === "ready" ? state.conversations.length : 0;
  const filteredCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.conversations.length, 0),
    [filteredGroups],
  );

  const handleDelete = useCallback(
    async (conv: ChatConversationSummary) => {
      if (pendingDeletes.has(conv.id)) return;
      const ok = await confirm({
        title: "Delete chat?",
        message: (
          <span>
            Delete <strong>&ldquo;{conv.displayTitle}&rdquo;</strong>? This
            permanently removes the conversation and every message in it.
          </span>
        ),
        tone: "danger",
        confirmLabel: "Delete chat",
      });
      if (!ok) return;
      setPendingDeletes((prev) => new Set(prev).add(conv.id));
      // Optimistic remove.
      setState((curr) =>
        curr.status === "ready"
          ? {
              ...curr,
              conversations: curr.conversations.filter((c) => c.id !== conv.id),
            }
          : curr,
      );
      try {
        const res = await advisorFetch(`/api/chat/conversations/${conv.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          setRefreshKey((k) => k + 1);
          return;
        }
        broadcast.send({ type: "conversation_deleted", conversationId: conv.id });
        if (activeConversationId === conv.id) onDeleted?.(conv.id);
      } catch {
        setRefreshKey((k) => k + 1);
      } finally {
        setPendingDeletes((prev) => {
          const next = new Set(prev);
          next.delete(conv.id);
          return next;
        });
      }
    },
    [pendingDeletes, broadcast, activeConversationId, onDeleted, confirm],
  );

  const handleTogglePin = useCallback(
    async (conv: ChatConversationSummary) => {
      const nextPinned = !conv.isPinned;
      const nextPinnedAt = nextPinned ? new Date().toISOString() : null;
      // Optimistic update — re-grouping is automatic because the
      // sidebar re-runs `groupConversations` on state change.
      setState((curr) =>
        curr.status === "ready"
          ? {
              ...curr,
              conversations: curr.conversations.map((c) =>
                c.id === conv.id
                  ? { ...c, isPinned: nextPinned, pinnedAt: nextPinnedAt }
                  : c,
              ),
            }
          : curr,
      );
      try {
        const res = await advisorFetch(`/api/chat/conversations/${conv.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPinned: nextPinned }),
        });
        if (!res.ok) {
          setRefreshKey((k) => k + 1);
          return;
        }
        broadcast.send({
          type: "conversation_pinned",
          conversationId: conv.id,
          isPinned: nextPinned,
          pinnedAt: nextPinnedAt,
        });
      } catch {
        setRefreshKey((k) => k + 1);
      }
    },
    [broadcast],
  );

  const handleRename = useCallback(
    async (conv: ChatConversationSummary, nextTitle: string) => {
      const trimmed = nextTitle.trim();
      // No-op on empty AND no-change (keeps existing title; tap-to-rename
      // is a discoverability cost we don't want to punish with deletions).
      if (!trimmed || trimmed === (conv.title ?? "").trim()) {
        setRenamingId(null);
        return;
      }
      // Optimistic update.
      setState((curr) =>
        curr.status === "ready"
          ? {
              ...curr,
              conversations: curr.conversations.map((c) =>
                c.id === conv.id ? { ...c, title: trimmed, displayTitle: trimmed } : c,
              ),
            }
          : curr,
      );
      setRenamingId(null);
      try {
        const res = await advisorFetch(`/api/chat/conversations/${conv.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) {
          // Roll back.
          setRefreshKey((k) => k + 1);
          return;
        }
        broadcast.send({
          type: "conversation_renamed",
          conversationId: conv.id,
          title: trimmed,
        });
      } catch {
        setRefreshKey((k) => k + 1);
      }
    },
    [broadcast],
  );

  return (
    <aside
      className={`flex flex-col bg-white ${className ?? ""}`}
      style={{ borderRight: "1px solid var(--ap-line, #E5E7EB)" }}
    >
      <header
        className="flex items-center justify-between gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--ap-line, #E5E7EB)" }}
      >
        <h3
          className="text-[12px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: "var(--ap-navy)" }}
        >
          Chats
        </h3>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="Start a new chat"
          className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium"
          style={{
            border: "1px solid var(--ap-line, #E5E7EB)",
            color: "var(--ap-royal)",
            backgroundColor: "#FFFFFF",
          }}
        >
          <Plus size={11} strokeWidth={2.25} />
          New
        </button>
      </header>

      {/* Search — only after the first load lands so we don't show
          search-over-nothing during skeleton state. */}
      {state.status === "ready" && state.conversations.length > 0 ? (
        <SearchInput
          ref={searchInputRef}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {state.status === "loading" ? (
          <SkeletonRows />
        ) : state.status === "unauthorized" ? (
          <p className="px-3 py-4 text-[11.5px]" style={{ color: "var(--ap-gray)" }}>
            Sign in to see your chats.
          </p>
        ) : state.status === "error" ? (
          <p className="px-3 py-4 text-[11.5px]" style={{ color: "#9B1C1C" }}>
            {state.message}
          </p>
        ) : state.conversations.length === 0 ? (
          <EmptyState />
        ) : filteredGroups.length === 0 ? (
          <NoMatchesState query={debouncedQuery} totalCount={totalCount} />
        ) : (
          <>
            {filteredGroups.map((g) => (
              <section key={g.bucket} className="py-1.5">
                <h4
                  className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-[0.07em]"
                  style={{ color: "var(--ap-gray)" }}
                >
                  {g.label}
                </h4>
                {g.conversations.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conversation={c}
                    isActive={c.id === activeConversationId}
                    openElsewhere={otherTabConversationIds.has(c.id)}
                    pending={pendingDeletes.has(c.id)}
                    isRenaming={renamingId === c.id}
                    onOpen={onOpen}
                    onStartRename={() => setRenamingId(c.id)}
                    onCancelRename={() => setRenamingId(null)}
                    onRename={(next) => void handleRename(c, next)}
                    onDelete={handleDelete}
                    onTogglePin={() => void handleTogglePin(c)}
                  />
                ))}
              </section>
            ))}
            {/* Footer count — helpful at scale ("17 chats · 3 matching") */}
            {debouncedQuery.trim() ? (
              <p
                className="px-3 py-2 text-[10.5px]"
                style={{ color: "var(--ap-gray)" }}
              >
                {filteredCount} matching {totalCount}
              </p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Search input — `forwardRef` to support Cmd/Ctrl+K focus from the parent.
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef } from "react";

const SearchInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange(next: string): void;
    onClear(): void;
  }
>(function SearchInput({ value, onChange, onClear }, ref) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5"
      style={{ borderBottom: "1px solid var(--ap-line, #E5E7EB)" }}
    >
      <Search size={11} strokeWidth={1.75} style={{ color: "var(--ap-gray)" }} />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search chats…"
        aria-label="Search chats by title"
        className="w-full bg-transparent text-[12px] outline-none placeholder:text-slate-400"
      />
      {value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="text-slate-400 hover:text-slate-600"
        >
          <X size={11} strokeWidth={1.75} />
        </button>
      ) : (
        <kbd
          className="hidden rounded border border-slate-200 px-1 py-px text-[9px] font-medium text-slate-400 md:inline-block"
          title="Focus search (Cmd/Ctrl+K)"
        >
          ⌘K
        </kbd>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton + empty + no-matches states
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonRows() {
  // Five fake rows at slightly varying widths. Pure CSS pulse — no
  // animation libraries.
  const widths = ["80%", "65%", "75%", "55%", "70%"];
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {widths.map((w, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div
            className="h-2.5 animate-pulse rounded-full bg-slate-200"
            style={{ width: w }}
          />
          <div className="h-2 w-1/4 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(79, 124, 172, 0.10)" }}
      >
        <History size={16} strokeWidth={1.75} style={{ color: "var(--ap-royal)" }} />
      </span>
      <p
        className="text-[12.5px] font-semibold"
        style={{ color: "var(--ap-navy)" }}
      >
        No chats yet
      </p>
      <p
        className="max-w-[180px] text-[11px] leading-snug"
        style={{ color: "var(--ap-gray)" }}
      >
        Send a message in the chat — your conversations will land here for
        later resume.
      </p>
    </div>
  );
}

function NoMatchesState({ query, totalCount }: { query: string; totalCount: number }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
      <p
        className="text-[12px] font-medium"
        style={{ color: "var(--ap-navy)" }}
      >
        No chats match &ldquo;{query}&rdquo;
      </p>
      <p className="text-[11px]" style={{ color: "var(--ap-gray)" }}>
        {totalCount} {totalCount === 1 ? "chat" : "chats"} total — try a
        different search.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation row (with inline rename + hover-reveal delete)
// ─────────────────────────────────────────────────────────────────────────────

function ConversationRow({
  conversation,
  isActive,
  openElsewhere,
  pending,
  isRenaming,
  onOpen,
  onStartRename,
  onCancelRename,
  onRename,
  onDelete,
  onTogglePin,
}: {
  conversation: ChatConversationSummary;
  isActive: boolean;
  openElsewhere: boolean;
  pending: boolean;
  isRenaming: boolean;
  onOpen(id: string): void;
  onStartRename(): void;
  onCancelRename(): void;
  onRename(nextTitle: string): void;
  onDelete(c: ChatConversationSummary): void;
  onTogglePin(): void;
}) {
  // Meta-line count: use turn_count (user-visible turns) when available.
  // Falls back to message_count for any pre-PR-19 rows that haven't yet
  // had a fresh turn recorded against them. message_count includes
  // tool-role rows the user can't see — using it can produce confusing
  // counts like "8 msgs" for a 2-turn conversation that fired 6 tool
  // calls.
  const turnCount =
    conversation.turnCount && conversation.turnCount > 0
      ? conversation.turnCount
      : null;
  const countLabel = turnCount !== null
    ? `${turnCount} ${turnCount === 1 ? "turn" : "turns"}`
    : `${conversation.messageCount} ${conversation.messageCount === 1 ? "msg" : "msgs"}`;

  return (
    <div
      className="group relative flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-slate-50"
      style={{
        backgroundColor: isActive ? "rgba(79, 124, 172, 0.08)" : undefined,
        opacity: pending ? 0.5 : 1,
      }}
    >
      {/* Active stripe */}
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[2px]"
          style={{ backgroundColor: "var(--ap-royal)" }}
        />
      ) : null}

      {isRenaming ? (
        <RenameInput
          initial={conversation.title ?? ""}
          onCommit={onRename}
          onCancel={onCancelRename}
        />
      ) : (
        <button
          type="button"
          onClick={() => onOpen(conversation.id)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
        >
          <span
            className="line-clamp-1 flex w-full items-center gap-1.5 text-[12.5px] font-medium leading-snug"
            style={{ color: "var(--ap-navy)" }}
          >
            {/* Tiny pin indicator next to the title when pinned. Helps the
                pinned bucket header (above) feel less load-bearing if the
                advisor scrolls past it. */}
            {conversation.isPinned ? (
              <Pin
                size={9}
                strokeWidth={2}
                className="flex-shrink-0"
                style={{ color: "var(--ap-royal)" }}
                aria-hidden="true"
              />
            ) : null}
            <span className="line-clamp-1">{conversation.displayTitle}</span>
          </span>
          <span
            className="text-[10.5px]"
            style={{ color: "var(--ap-gray)" }}
          >
            {relativeTimestamp(conversation.lastMessageAt)} · {countLabel}
            {openElsewhere ? " · open elsewhere" : ""}
          </span>
        </button>
      )}

      {/* Hover action buttons — only when not renaming, to avoid layout
          jumps + duplicate keyboard interactions. The pin toggle stays
          VISIBLE (not just on hover) when the conversation is already
          pinned so the advisor can find the unpin affordance without
          guessing.  */}
      {!isRenaming ? (
        <div
          className={`flex flex-shrink-0 items-start gap-0.5 transition-opacity ${
            conversation.isPinned
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            disabled={pending}
            aria-label={
              conversation.isPinned
                ? `Unpin chat: ${conversation.displayTitle}`
                : `Pin chat: ${conversation.displayTitle}`
            }
            title={conversation.isPinned ? "Unpin" : "Pin to top"}
            className="flex h-6 w-6 items-center justify-center"
            style={{
              color: conversation.isPinned ? "var(--ap-royal)" : "var(--ap-gray)",
            }}
          >
            {conversation.isPinned ? (
              <PinOff size={11} strokeWidth={1.75} />
            ) : (
              <Pin size={11} strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            disabled={pending}
            aria-label={`Rename chat: ${conversation.displayTitle}`}
            className="flex h-6 w-6 items-center justify-center"
            style={{ color: "var(--ap-gray)" }}
          >
            <Pencil size={11} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(conversation);
            }}
            disabled={pending}
            aria-label={`Delete chat: ${conversation.displayTitle}`}
            className="flex h-6 w-6 items-center justify-center"
            style={{ color: "var(--ap-gray)" }}
          >
            <Trash2 size={11} strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(nextTitle: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={onKeyDown}
      aria-label="Rename chat"
      maxLength={250}
      className="flex-1 rounded-sm border border-slate-300 px-1.5 py-0.5 text-[12.5px] font-medium leading-snug outline-none focus:border-[var(--ap-royal)]"
      style={{ color: "var(--ap-navy)" }}
    />
  );
}
