/**
 * Pure helpers for grouping chat conversations in the history sidebar.
 *
 * Lives outside React so the grouping logic is testable in isolation
 * and reusable by any future "history view" surface (e.g. a full-page
 * conversation browser).
 *
 * Buckets, newest first:
 *   - Today        — last_message_at >= local midnight today
 *   - Yesterday    — last_message_at >= local midnight yesterday
 *   - This week    — within the last 7 days
 *   - This month   — within the last 30 days
 *   - Older        — everything else
 */

import type { ChatConversationSummary } from "./persistence";

/**
 * Bucket ids the sidebar uses. `pinned` always renders first when any
 * conversation has `isPinned: true`; recency buckets exclude pinned
 * rows so they don't appear twice.
 */
export type GroupBucket =
  | "pinned"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "older";

export interface ConversationGroup {
  bucket: GroupBucket;
  label: string;
  conversations: ChatConversationSummary[];
}

const BUCKET_LABELS: Record<GroupBucket, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  this_month: "This month",
  older: "Older",
};

/**
 * Assign one conversation to a bucket based on its `lastMessageAt`
 * (falling back to `createdAt` when no messages have landed yet).
 *
 * `now` is parameterized so tests are deterministic. Production callers
 * pass `new Date()`.
 */
export function bucketForConversation(
  c: ChatConversationSummary,
  now: Date,
): GroupBucket {
  const refIso = c.lastMessageAt ?? c.createdAt;
  const refMs = Date.parse(refIso);
  if (!Number.isFinite(refMs)) return "older";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  if (refMs >= startOfTodayMs) return "today";

  const startOfYesterday = startOfTodayMs - 24 * 60 * 60 * 1000;
  if (refMs >= startOfYesterday) return "yesterday";

  const sevenDaysAgo = startOfTodayMs - 7 * 24 * 60 * 60 * 1000;
  if (refMs >= sevenDaysAgo) return "this_week";

  const thirtyDaysAgo = startOfTodayMs - 30 * 24 * 60 * 60 * 1000;
  if (refMs >= thirtyDaysAgo) return "this_month";

  return "older";
}

/**
 * Group + sort conversations for the sidebar.
 *
 * Sort rules:
 *   - Pinned bucket: by `pinnedAt desc nulls last` (newest pins first;
 *     pre-PR-19 rows fall to the end because their pinned_at is null)
 *   - Recency buckets: by `lastMessageAt desc` (newest activity first;
 *     falls back to createdAt when no messages yet)
 *
 * Bucket order: `pinned` → `today` → `yesterday` → `this_week` →
 * `this_month` → `older`. Empty buckets are omitted.
 *
 * Pinned conversations are LIFTED out of their recency bucket so they
 * appear once in `pinned` and NOT again under the date group they'd
 * otherwise belong to.
 *
 * Input is expected to be already deduped by id (the list RPC enforces
 * this) — we don't guard against duplicates.
 */
export function groupConversations(
  conversations: ChatConversationSummary[],
  now: Date = new Date(),
): ConversationGroup[] {
  const buckets = new Map<GroupBucket, ChatConversationSummary[]>();
  for (const c of conversations) {
    const b = c.isPinned ? "pinned" : bucketForConversation(c, now);
    const arr = buckets.get(b) ?? [];
    arr.push(c);
    buckets.set(b, arr);
  }
  // Pinned bucket: newest pins first, with pre-PR-19 null pinned_at last.
  const pinned = buckets.get("pinned");
  if (pinned) {
    pinned.sort((a, b) => {
      const aMs = a.pinnedAt ? Date.parse(a.pinnedAt) : 0;
      const bMs = b.pinnedAt ? Date.parse(b.pinnedAt) : 0;
      return bMs - aMs;
    });
  }
  // Recency buckets: newest activity first.
  for (const [bucket, arr] of buckets.entries()) {
    if (bucket === "pinned") continue;
    arr.sort((a, b) => {
      const aMs = Date.parse(a.lastMessageAt ?? a.createdAt) || 0;
      const bMs = Date.parse(b.lastMessageAt ?? b.createdAt) || 0;
      return bMs - aMs;
    });
  }
  const order: GroupBucket[] = [
    "pinned",
    "today",
    "yesterday",
    "this_week",
    "this_month",
    "older",
  ];
  return order
    .filter((b) => (buckets.get(b)?.length ?? 0) > 0)
    .map((b) => ({
      bucket: b,
      label: BUCKET_LABELS[b],
      conversations: buckets.get(b) ?? [],
    }));
}

/**
 * Filter a conversation list by title (case-insensitive substring).
 * Trims + lower-cases the query so "  Q3  " matches "Q3 Review for Jane".
 * Empty / whitespace-only query returns the input unchanged.
 *
 * Pure — drives the sidebar's client-side search input. v1 only matches
 * the `displayTitle`; a future cut could extend to message content via
 * an FTS index on `chat_messages.content`.
 */
export function filterConversationsByQuery<T extends { displayTitle: string }>(
  conversations: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => c.displayTitle.toLowerCase().includes(q));
}

/**
 * Human-readable relative timestamp ("2 min ago", "3 days ago"). Used
 * as the secondary line in each sidebar row.
 */
export function relativeTimestamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diffMs = now.getTime() - ms;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  // Fall back to short calendar date for older entries.
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
