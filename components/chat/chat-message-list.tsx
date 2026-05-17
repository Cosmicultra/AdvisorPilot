"use client";

/**
 * Scrollable list of message bubbles with sticky-bottom auto-scroll.
 *
 * Behavior:
 *   - When the user is at (or near) the bottom and new content arrives,
 *     the list auto-scrolls to follow.
 *   - When the user has scrolled UP, auto-scroll is suspended — the user
 *     is reading older content. A "↓ New messages" jump button appears
 *     and clicks return to the bottom.
 *   - Empty state renders a brief "How can Nova help?" prompt with example
 *     questions to set expectations.
 *
 * Performance:
 *   - Re-rendering on every delta is fine at v1's message counts (<200 in
 *     a typical session). If sessions grow longer (PR 3+ when history
 *     persists across reloads), this becomes a candidate for windowing
 *     via react-window.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/chat-message-types";
import { ChatEmptyState } from "./chat-empty-state";
import { ChatMessageBubble } from "./chat-message-bubble";

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Advisor's display name — surfaced in the empty-state greeting (PR 23). */
  advisorName?: string | null;
  /** Currently-focused client name — drives the empty state's suggested prompts. */
  clientName?: string | null;
  /** Send a suggested prompt from the empty state. */
  onPrompt?: (text: string) => void;
}

/** How close to the bottom (in px) we consider "stuck to the bottom". */
const STICK_THRESHOLD_PX = 64;

export function ChatMessageList({
  messages,
  advisorName = null,
  clientName = null,
  onPrompt,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const lastSeenLenRef = useRef(messages.length);

  // ─── Detect scroll position; toggle stuckToBottom + new-message count ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const isStuck = distance < STICK_THRESHOLD_PX;
      setStuckToBottom(isStuck);
      if (isStuck) setNewCount(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ─── Auto-follow bottom when new content arrives + stuck ───────────────
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > lastSeenLenRef.current;
    lastSeenLenRef.current = messages.length;
    if (stuckToBottom) {
      el.scrollTop = el.scrollHeight;
    } else if (grew) {
      setNewCount((n) => n + 1);
    }
  }, [messages, stuckToBottom]);

  const isEmpty = messages.length === 0;

  // PR 23 — group messages into day-bucketed renderable rows so the list
  // can interleave date separators ("Today", "Yesterday", "Mar 12") when
  // a resumed conversation spans multiple days. Returns a flat array of
  // either `{kind: "separator", label}` or `{kind: "message", message}`.
  const rowsWithSeparators = useMemo(
    () => insertDateSeparators(messages),
    [messages],
  );

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-3 py-3"
        // Light off-white background — lets the white assistant bubbles
        // still feel like cards.
        style={{ backgroundColor: "#F8FAFC" }}
      >
        {isEmpty ? (
          <ChatEmptyState
            advisorName={advisorName}
            clientName={clientName}
            onPrompt={onPrompt ?? (() => undefined)}
          />
        ) : (
          <ol className="flex flex-col gap-2.5">
            {rowsWithSeparators.map((row) =>
              row.kind === "separator" ? (
                <li key={row.key} aria-hidden="true">
                  <DateSeparator label={row.label} />
                </li>
              ) : (
                <li key={row.message.id}>
                  <ChatMessageBubble message={row.message} />
                </li>
              ),
            )}
          </ol>
        )}
      </div>

      {!stuckToBottom && newCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <ArrowDown size={11} strokeWidth={2.5} />
          {newCount === 1 ? "1 new message" : `${newCount} new messages`}
        </button>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date separators (PR 23) — when a resumed conversation spans days, insert
// "Today" / "Yesterday" / "Mar 12" rows so the advisor's eye lands on
// session boundaries.
// ─────────────────────────────────────────────────────────────────────────────

type MessageRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "message"; message: ChatMessage };

/**
 * Walk the message list, inserting a `separator` row whenever the date
 * (in the LOCAL timezone) of message N differs from message N-1. The
 * first separator is emitted before the first message so the very top
 * of a conversation always has a date anchor.
 *
 * For live chats that start fresh today, the separator says "Today" —
 * a small UX nicety that signals "this is the start of this thread."
 *
 * Pure — tested separately if/when we need it; today the integration
 * via <ChatMessageList> is enough.
 */
export function insertDateSeparators(messages: ChatMessage[], now: Date = new Date()): MessageRow[] {
  if (messages.length === 0) return [];
  const rows: MessageRow[] = [];
  let lastDayKey: string | null = null;
  for (const m of messages) {
    const ts = m.ts ?? Date.now();
    const d = new Date(ts);
    const dayKey = ymdKey(d);
    if (dayKey !== lastDayKey) {
      rows.push({
        kind: "separator",
        key: `sep-${dayKey}`,
        label: formatDayLabel(d, now),
      });
      lastDayKey = dayKey;
    }
    rows.push({ kind: "message", message: m });
  }
  return rows;
}

function ymdKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(d: Date, now: Date): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const msgDay = new Date(d);
  msgDay.setHours(0, 0, 0, 0);
  if (msgDay.getTime() === today.getTime()) return "Today";
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
        {label}
      </span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
