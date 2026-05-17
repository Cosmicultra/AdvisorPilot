/**
 * Tests for the pure conversation-grouping helpers used by the chat
 * history sidebar.
 */

import { describe, expect, it } from "vitest";
import {
  bucketForConversation,
  filterConversationsByQuery,
  groupConversations,
  relativeTimestamp,
} from "./conversation-grouping";
import type { ChatConversationSummary } from "./persistence";

/**
 * Fixed "now" anchored in LOCAL time so the bucket boundaries
 * (computed via `setHours(0,0,0,0)`) line up with the fixtures
 * regardless of the test runner's timezone.
 */
const NOW = new Date(2026, 4, 16, 19, 0, 0); // 2026-05-16 19:00 local

/**
 * Helper that builds a local-time ISO offset N days + H hours before NOW
 * so fixtures are TZ-independent.
 */
function localISO(daysAgo: number, hour: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function makeConv(
  overrides: Partial<ChatConversationSummary> & { id: string },
): ChatConversationSummary {
  const base: ChatConversationSummary = {
    id: overrides.id,
    ownerEmail: "a@b",
    title: overrides.title ?? `c-${overrides.id}`,
    displayTitle: overrides.title ?? `c-${overrides.id}`,
    lastClientId: null,
    lastRoute: null,
    lastProvider: null,
    lastModel: null,
    lastProviderResponseId: null,
    messageCount: 2,
    turnCount: 1,
    isArchived: false,
    archivedAt: null,
    isPinned: false,
    pinnedAt: null,
    createdAt: overrides.lastMessageAt ?? "2026-05-16T19:00:00.000Z",
    updatedAt: overrides.lastMessageAt ?? "2026-05-16T19:00:00.000Z",
    lastMessageAt: overrides.lastMessageAt ?? null,
  };
  return { ...base, ...overrides };
}

describe("bucketForConversation", () => {
  it("today: anything from local midnight forward", () => {
    expect(
      bucketForConversation(
        makeConv({ id: "1", lastMessageAt: localISO(0, 10) }),
        NOW,
      ),
    ).toBe("today");
  });

  it("yesterday: 1 day ago window", () => {
    expect(
      bucketForConversation(
        makeConv({ id: "1", lastMessageAt: localISO(1, 12) }),
        NOW,
      ),
    ).toBe("yesterday");
  });

  it("this_week: 2-7 days ago", () => {
    expect(
      bucketForConversation(
        makeConv({ id: "1", lastMessageAt: localISO(4, 12) }),
        NOW,
      ),
    ).toBe("this_week");
  });

  it("this_month: 8-30 days ago", () => {
    expect(
      bucketForConversation(
        makeConv({ id: "1", lastMessageAt: localISO(15, 12) }),
        NOW,
      ),
    ).toBe("this_month");
  });

  it("older: anything beyond 30 days", () => {
    expect(
      bucketForConversation(
        makeConv({ id: "1", lastMessageAt: localISO(60, 12) }),
        NOW,
      ),
    ).toBe("older");
  });

  it("falls back to createdAt when lastMessageAt is null", () => {
    expect(
      bucketForConversation(
        makeConv({
          id: "1",
          lastMessageAt: null,
          createdAt: localISO(0, 10),
        }),
        NOW,
      ),
    ).toBe("today");
  });
});

describe("groupConversations", () => {
  it("returns groups in fixed order, newest within each bucket first, omits empty buckets", () => {
    const groups = groupConversations(
      [
        makeConv({ id: "a", lastMessageAt: localISO(0, 10) }),
        makeConv({ id: "b", lastMessageAt: localISO(0, 18) }),
        makeConv({ id: "c", lastMessageAt: localISO(15, 12) }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["today", "this_month"]);
    // Today bucket: b (18:00) before a (10:00).
    expect(groups[0].conversations.map((c) => c.id)).toEqual(["b", "a"]);
    expect(groups[1].conversations.map((c) => c.id)).toEqual(["c"]);
  });

  it("returns empty array when input is empty", () => {
    expect(groupConversations([], NOW)).toEqual([]);
  });
});

describe("groupConversations — pinned bucket (PR 19)", () => {
  it("lifts pinned conversations into a 'pinned' bucket that renders first", () => {
    const groups = groupConversations(
      [
        makeConv({ id: "a", lastMessageAt: localISO(0, 10) }), // today
        makeConv({
          id: "b",
          lastMessageAt: localISO(15, 12), // would be this_month
          isPinned: true,
          pinnedAt: "2026-05-16T08:00:00.000Z",
        }),
        makeConv({ id: "c", lastMessageAt: localISO(0, 18) }), // today
      ],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["pinned", "today"]);
    // Pinned bucket: just `b`. Today bucket: a + c (recency order).
    expect(groups[0].conversations.map((c) => c.id)).toEqual(["b"]);
    expect(groups[1].conversations.map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("sorts pinned bucket by pinnedAt descending (newest pin first); null pinnedAt last", () => {
    const groups = groupConversations(
      [
        makeConv({
          id: "old-pin",
          isPinned: true,
          pinnedAt: "2026-05-10T12:00:00.000Z",
        }),
        makeConv({
          id: "new-pin",
          isPinned: true,
          pinnedAt: "2026-05-16T08:00:00.000Z",
        }),
        makeConv({
          id: "legacy-pin",
          isPinned: true,
          pinnedAt: null,
        }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("pinned");
    expect(groups[0].conversations.map((c) => c.id)).toEqual([
      "new-pin",
      "old-pin",
      "legacy-pin",
    ]);
  });

  it("does NOT double-render: a pinned conversation appears in 'pinned' and NOT in its recency bucket", () => {
    const groups = groupConversations(
      [
        makeConv({
          id: "pinned-today",
          lastMessageAt: localISO(0, 10),
          isPinned: true,
          pinnedAt: "2026-05-16T08:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["pinned"]);
    expect(groups[0].conversations.map((c) => c.id)).toEqual(["pinned-today"]);
  });

  it("omits the pinned bucket when no conversation is pinned", () => {
    const groups = groupConversations(
      [makeConv({ id: "a", lastMessageAt: localISO(0, 10) })],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["today"]);
  });
});

describe("filterConversationsByQuery (PR 18)", () => {
  const SAMPLE = [
    makeConv({ id: "1", title: "Q3 Review for Jane" }),
    makeConv({ id: "2", title: "Roth conversion timeline" }),
    makeConv({ id: "3", title: "Untitled chat" }),
  ];

  it("returns the input unchanged for empty / whitespace query", () => {
    expect(filterConversationsByQuery(SAMPLE, "")).toEqual(SAMPLE);
    expect(filterConversationsByQuery(SAMPLE, "    ")).toEqual(SAMPLE);
  });

  it("matches case-insensitive substrings against displayTitle", () => {
    const out = filterConversationsByQuery(SAMPLE, "ROTH");
    expect(out.map((c) => c.id)).toEqual(["2"]);
  });

  it("trims query whitespace before matching", () => {
    const out = filterConversationsByQuery(SAMPLE, "  Q3  ");
    expect(out.map((c) => c.id)).toEqual(["1"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterConversationsByQuery(SAMPLE, "nope")).toEqual([]);
  });
});

describe("relativeTimestamp", () => {
  it("Just now for < 1 min", () => {
    const t = new Date(NOW.getTime() - 30 * 1000).toISOString();
    expect(relativeTimestamp(t, NOW)).toBe("Just now");
  });

  it("N min ago for < 1 hour", () => {
    const t = new Date(NOW.getTime() - 15 * 60 * 1000).toISOString();
    expect(relativeTimestamp(t, NOW)).toBe("15 min ago");
  });

  it("N hr ago for < 1 day", () => {
    const t = new Date(NOW.getTime() - 4 * 60 * 60 * 1000).toISOString();
    expect(relativeTimestamp(t, NOW)).toBe("4 hr ago");
  });

  it("singular `day` for exactly 1 day", () => {
    const t = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(relativeTimestamp(t, NOW)).toBe("1 day ago");
  });

  it("falls back to short calendar date for older entries", () => {
    const t = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTimestamp(t, NOW)).toMatch(/[A-Z][a-z]{2}/);
  });

  it("'—' for null", () => {
    expect(relativeTimestamp(null, NOW)).toBe("—");
  });
});
