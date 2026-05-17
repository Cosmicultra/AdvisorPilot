/**
 * Tests for the pure `insertDateSeparators` helper that drives the
 * "Today / Yesterday / Mar 12" rows in the chat message list. The
 * component itself is exercised in the chat widget end-to-end; this
 * file pins the separator-emission contract (PR 23).
 */

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat/chat-message-types";
import { insertDateSeparators } from "./chat-message-list";

/** Fixed "now" anchored in local time so tests are TZ-deterministic. */
const NOW = new Date(2026, 4, 17, 14, 0, 0); // 2026-05-17 14:00 local

function msg(id: string, daysAgo: number, hour = 12): ChatMessage {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return {
    id,
    role: "user",
    text: id,
    ts: d.getTime(),
  };
}

describe("insertDateSeparators (PR 23)", () => {
  it("returns empty array for empty input", () => {
    expect(insertDateSeparators([], NOW)).toEqual([]);
  });

  it("emits ONE separator above a same-day conversation", () => {
    const rows = insertDateSeparators(
      [msg("a", 0, 9), msg("b", 0, 10), msg("c", 0, 11)],
      NOW,
    );
    const seps = rows.filter((r) => r.kind === "separator");
    expect(seps).toHaveLength(1);
    expect(seps[0]).toMatchObject({ label: "Today" });
    expect(rows.filter((r) => r.kind === "message")).toHaveLength(3);
  });

  it("emits a fresh separator at every day boundary", () => {
    const rows = insertDateSeparators(
      [
        msg("a", 2, 9), // 2 days ago
        msg("b", 1, 9), // yesterday
        msg("c", 0, 9), // today
        msg("d", 0, 10), // still today
      ],
      NOW,
    );
    const labels = rows
      .filter((r): r is { kind: "separator"; key: string; label: string } => r.kind === "separator")
      .map((r) => r.label);
    expect(labels).toEqual([
      // 2 days ago — neither Today nor Yesterday → calendar date
      expect.stringMatching(/[A-Z][a-z]+/),
      "Yesterday",
      "Today",
    ]);
  });

  it("interleaves separator rows in correct positions (separator BEFORE each new day's first message)", () => {
    const rows = insertDateSeparators([msg("a", 1, 9), msg("b", 0, 9)], NOW);
    expect(rows.map((r) => (r.kind === "separator" ? "SEP" : r.message.id))).toEqual([
      "SEP",
      "a",
      "SEP",
      "b",
    ]);
  });

  it("includes the year on separators from a different calendar year", () => {
    const lastYear = new Date(NOW);
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    const oldMsg: ChatMessage = {
      id: "old",
      role: "user",
      text: "older",
      ts: lastYear.getTime(),
    };
    const rows = insertDateSeparators([oldMsg, msg("today", 0)], NOW);
    const seps = rows.filter(
      (r): r is { kind: "separator"; key: string; label: string } => r.kind === "separator",
    );
    expect(seps[0].label).toMatch(/2025|\d{4}/);
    expect(seps[1].label).toBe("Today");
  });
});
