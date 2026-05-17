import { describe, expect, it } from "vitest";
import { computeStage, isOverdue, type StageInput } from "./stage";
import type { ClientStage } from "./types";

/**
 * Stage-computation rule tests. Table-driven per docs/crm/40-path-forward.md
 * §2 Phase 1 (R2 mitigation: "Unit tests for `computeStage` cover the 6
 * stage values with 3 cases each").
 *
 * Reference "now" is fixed to 2026-05-15 so every relative date in the
 * tests is unambiguous.
 */

const NOW = new Date("2026-05-15T12:00:00.000Z");

function input(overrides: Partial<StageInput> = {}): StageInput {
  return {
    status: "Analyzed",
    reviewDueAt: null,
    nextMeetingAt: null,
    lastContactedAt: null,
    inceptionYear: null,
    ...overrides,
  };
}

describe("computeStage", () => {
  // ─── Prospect (rule 1) — beats every other rule ──────────────────────
  describe("'Prospect'", () => {
    it("returns 'Prospect' when status is 'Prospect'", () => {
      expect(computeStage(input({ status: "Prospect" }), NOW)).toBe("Prospect");
    });

    it("returns 'Prospect' even when review_due_at is overdue", () => {
      // Status takes priority over the overdue review rule.
      expect(
        computeStage(
          input({ status: "Prospect", reviewDueAt: "2026-01-01" }),
          NOW
        )
      ).toBe("Prospect");
    });

    it("returns 'Prospect' even when last_contacted_at is stale", () => {
      expect(
        computeStage(
          input({ status: "Prospect", lastContactedAt: "2025-01-01T00:00:00Z" }),
          NOW
        )
      ).toBe("Prospect");
    });
  });

  // ─── Review due (rule 2) — review_due_at is in the past ──────────────
  describe("'Review due'", () => {
    it("returns 'Review due' when reviewDueAt is yesterday", () => {
      expect(
        computeStage(input({ reviewDueAt: "2026-05-14" }), NOW)
      ).toBe("Review due");
    });

    it("returns 'Review due' when reviewDueAt is months in the past", () => {
      expect(
        computeStage(input({ reviewDueAt: "2025-12-01" }), NOW)
      ).toBe("Review due");
    });

    it("returns 'Review due' even with a future meeting (overdue review wins)", () => {
      expect(
        computeStage(
          input({
            reviewDueAt: "2026-04-01",
            nextMeetingAt: "2026-05-20T14:00:00Z",
          }),
          NOW
        )
      ).toBe("Review due");
    });
  });

  // ─── Upcoming (rules 3 + 5) ──────────────────────────────────────────
  describe("'Upcoming'", () => {
    it("returns 'Upcoming' when reviewDueAt is within 14 days", () => {
      expect(
        computeStage(input({ reviewDueAt: "2026-05-22" }), NOW)
      ).toBe("Upcoming");
    });

    it("returns 'Upcoming' when nextMeetingAt is within 14 days (no review pressure)", () => {
      expect(
        computeStage(input({ nextMeetingAt: "2026-05-20T10:00:00Z" }), NOW)
      ).toBe("Upcoming");
    });

    it("returns 'Stable' when reviewDueAt is exactly 15 days out (boundary)", () => {
      // 14d window is inclusive; day 15 falls through to later rules.
      expect(
        computeStage(input({ reviewDueAt: "2026-05-30" }), NOW)
      ).toBe("Stable");
    });
  });

  // ─── At risk (rule 4) ────────────────────────────────────────────────
  describe("'At risk'", () => {
    it("returns 'At risk' when last_contacted_at is older than 90 days", () => {
      // 100 days before NOW = 2026-02-04
      expect(
        computeStage(input({ lastContactedAt: "2026-02-04T00:00:00Z" }), NOW)
      ).toBe("At risk");
    });

    it("returns 'At risk' when last_contacted_at is many months stale", () => {
      expect(
        computeStage(input({ lastContactedAt: "2025-06-01T00:00:00Z" }), NOW)
      ).toBe("At risk");
    });

    it("returns 'Stable' when last_contacted_at is exactly 90 days ago (boundary)", () => {
      // 90d before NOW = 2026-02-14
      expect(
        computeStage(input({ lastContactedAt: "2026-02-14T12:00:00Z" }), NOW)
      ).toBe("Stable");
    });
  });

  // ─── Onboarding (rule 6) ─────────────────────────────────────────────
  describe("'Onboarding'", () => {
    it("returns 'Onboarding' when inception_year started this calendar year", () => {
      // 2026 started Jan 1; NOW is May 15, so inceptionStart is ~134d ago.
      // That's > 90d so this should be 'Stable', not 'Onboarding'.
      // Verify the boundary by using a year that starts within the 90d window.
      // Hint: with NOW=2026-05-15, only the current year's Jan 1 is candidate;
      // it's 134d ago → 'Stable'. We need a synthetic case.
      // Instead, freeze NOW closer to year-start to exercise the rule.
      const earlyYear = new Date("2026-02-15T12:00:00.000Z");
      expect(
        computeStage(input({ inceptionYear: 2026 }), earlyYear)
      ).toBe("Onboarding");
    });

    it("returns 'Stable' when inception_year was last year (>90d)", () => {
      expect(
        computeStage(input({ inceptionYear: 2025 }), NOW)
      ).toBe("Stable");
    });

    it("returns 'Stable' when inception_year is in the future (negative days)", () => {
      // Defensive: future inception_year shouldn't crash the rule.
      expect(
        computeStage(input({ inceptionYear: 2030 }), NOW)
      ).toBe("Stable");
    });
  });

  // ─── Stable (rule 7) — fallback ──────────────────────────────────────
  describe("'Stable'", () => {
    it("returns 'Stable' for an empty input (no signals)", () => {
      expect(computeStage(input(), NOW)).toBe("Stable");
    });

    it("returns 'Stable' when contact is recent and review is far out", () => {
      expect(
        computeStage(
          input({
            lastContactedAt: "2026-05-01T12:00:00Z", // 14d ago
            reviewDueAt: "2027-01-15", // months out
          }),
          NOW
        )
      ).toBe("Stable");
    });

    it("returns 'Stable' when nextMeetingAt is past (not 'Upcoming')", () => {
      // A meeting in the past is irrelevant — 'Upcoming' requires future.
      expect(
        computeStage(input({ nextMeetingAt: "2026-04-01T10:00:00Z" }), NOW)
      ).toBe("Stable");
    });
  });

  // ─── Robustness ──────────────────────────────────────────────────────
  describe("input edge cases", () => {
    it("handles malformed date strings as if NULL", () => {
      expect(
        computeStage(input({ reviewDueAt: "not-a-date" }), NOW)
      ).toBe("Stable");
    });

    it("treats unknown status as no special handling (falls through to other rules)", () => {
      // 'Analyzed' (the default) doesn't trigger Prospect, so other rules apply.
      expect(
        computeStage(
          input({ status: "Archived", reviewDueAt: "2026-05-22" }),
          NOW
        )
      ).toBe("Upcoming");
    });

    it("returns the correct ClientStage type (compile-time + runtime)", () => {
      const result: ClientStage = computeStage(input(), NOW);
      // If the type changed, this assignment would fail to compile.
      expect(result).toBe("Stable");
    });
  });
});

describe("isOverdue", () => {
  it("is true when review_due_at is in the past", () => {
    expect(isOverdue({ reviewDueAt: "2026-05-14" }, NOW)).toBe(true);
  });

  it("is false when review_due_at is today", () => {
    expect(isOverdue({ reviewDueAt: "2026-05-15" }, NOW)).toBe(false);
  });

  it("is false when review_due_at is in the future", () => {
    expect(isOverdue({ reviewDueAt: "2026-05-22" }, NOW)).toBe(false);
  });

  it("is false when review_due_at is null", () => {
    expect(isOverdue({ reviewDueAt: null }, NOW)).toBe(false);
  });

  it("is false when review_due_at is malformed", () => {
    expect(isOverdue({ reviewDueAt: "garbage" }, NOW)).toBe(false);
  });
});
