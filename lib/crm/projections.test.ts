import { describe, expect, it } from "vitest";
import {
  buildAllocationSummary,
  buildHoldingsBreakdown,
  summarizeAccounts,
} from "./projections";
import type { ClientDetail } from "./types";

/**
 * Projection helper tests.
 *
 * These functions are PURE — no IO, no Date.now() reads. Every input is a
 * `ClientDetail` shape; every output is the same as what the UI Overview
 * cards display. Coverage:
 *
 *   1. buildAllocationSummary buckets known asset classes; passes unknowns through
 *   2. Allocation buckets sorted by valueUsd descending
 *   3. Weight % computes to 0 when totalValue is 0 (no division-by-zero)
 *   4. buildHoldingsBreakdown returns top-N by value; default N=5
 *   5. topN argument is clamped to [1, 50]
 *   6. Ticker prefers enrichmentResolvedTicker, falls back to suggested
 *   7. summarizeAccounts groups by accountNumber, sorted by value desc
 *   8. summarizeAccounts SKIPS holdings without an accountNumber (no ghost "Unknown" entry)
 *   9. Empty holdings → all three return empty/zero shapes safely
 */

const BASE_CLIENT: ClientDetail = {
  id: "c_test",
  firstName: "John",
  lastName: "Smith",
  initials: "JS",
  householdLabel: null,
  stage: null,
  status: null,
  aum: null,
  ytdReturn: null,
  accountsCount: null,
  custodians: [],
  ownerEmail: "jane@firm.com",
  ownerInitials: "JS",
  lastContactedAt: null,
  nextMeetingAt: null,
  reviewDueAt: null,
  isOverdue: false,
  tags: [],
  // ClientDetail extension fields
  client: {} as ClientDetail["client"],
  holdings: [],
  analysis: null,
  rothWorksheet: null,
  meetingNotes: "",
  email: null,
  phone: null,
  location: null,
  relationshipSummary: null,
  inceptionYear: null,
  openTaskCount: 0,
  recentNoteCount: 0,
};

// Loose record so tests can use literal-strings for registrationType (the
// projections accept any string at runtime; the strict UiHolding enum
// matters only for the analysis pipeline that produces it).
type LooseHolding = Record<string, unknown>;

function withHoldings(holdings: LooseHolding[]): ClientDetail {
  return {
    ...BASE_CLIENT,
    holdings: holdings as ClientDetail["holdings"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildAllocationSummary
// ─────────────────────────────────────────────────────────────────────────────

describe("buildAllocationSummary", () => {
  it("buckets known asset classes (equity / fixed / cash / etc.)", () => {
    const out = buildAllocationSummary(
      withHoldings([
        { value: 300_000, assetClass: "US Stock" },
        { value: 200_000, assetClass: "Bond Fund" },
        { value: 100_000, assetClass: "Cash" },
        { value: 50_000, assetClass: "ETF" },
        { value: 75_000, assetClass: "Annuity (SPIA)" },
      ]),
    );
    const names = out.buckets.map((b) => b.name);
    expect(names).toContain("Equity");
    expect(names).toContain("Fixed");
    expect(names).toContain("Cash");
    expect(names).toContain("ETF");
    expect(names).toContain("Annuity");
  });

  it("sums values within each bucket and sorts buckets by valueUsd desc", () => {
    const out = buildAllocationSummary(
      withHoldings([
        { value: 100_000, assetClass: "US Stock" }, // Equity
        { value: 200_000, assetClass: "Equity Mutual Fund" }, // Equity (300k total)
        { value: 50_000, assetClass: "Bond" }, // Fixed
        { value: 800_000, assetClass: "Cash" }, // Cash (800k)
      ]),
    );
    expect(out.buckets[0].name).toBe("Cash");
    expect(out.buckets[0].valueUsd).toBe(800_000);
    const equity = out.buckets.find((b) => b.name === "Equity")!;
    expect(equity.valueUsd).toBe(300_000);
    // Total value reflects the sum.
    expect(out.totalValue).toBe(1_150_000);
  });

  it("passes unknown asset-class strings through verbatim", () => {
    const out = buildAllocationSummary(
      withHoldings([
        { value: 50_000, assetClass: "Cryptocurrency" },
        { value: 25_000, assetClass: "Limited Partnership" },
      ]),
    );
    const names = out.buckets.map((b) => b.name);
    expect(names).toContain("Cryptocurrency");
    expect(names).toContain("Limited Partnership");
  });

  it("returns weightPct=0 (no NaN/Infinity) when totalValue is 0", () => {
    const out = buildAllocationSummary(
      withHoldings([{ value: 0, assetClass: "US Stock" }]),
    );
    expect(out.totalValue).toBe(0);
    expect(out.buckets[0].weightPct).toBe(0);
    expect(Number.isFinite(out.buckets[0].weightPct)).toBe(true);
  });

  it("empty holdings → zero totalValue + empty buckets", () => {
    const out = buildAllocationSummary(withHoldings([]));
    expect(out.totalValue).toBe(0);
    expect(out.buckets).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildHoldingsBreakdown
// ─────────────────────────────────────────────────────────────────────────────

describe("buildHoldingsBreakdown", () => {
  it("returns top-5 by default, sorted by value desc", () => {
    const positions = Array.from({ length: 8 }, (_, i) => ({
      value: (i + 1) * 100_000, // 100k, 200k, ..., 800k
      enrichmentResolvedTicker: `T${i + 1}`,
      rawName: `Position ${i + 1}`,
      assetClass: "US Stock",
    }));
    const out = buildHoldingsBreakdown(withHoldings(positions));
    expect(out.topPositions).toHaveLength(5);
    expect(out.topPositions.map((p) => p.ticker)).toEqual(["T8", "T7", "T6", "T5", "T4"]);
    expect(out.holdingCount).toBe(8);
  });

  it("topN argument controls the cut", () => {
    const positions = Array.from({ length: 10 }, (_, i) => ({
      value: (i + 1) * 100_000,
      suggested: `S${i + 1}`,
    }));
    const out = buildHoldingsBreakdown(withHoldings(positions), 3);
    expect(out.topPositions).toHaveLength(3);
  });

  it("ticker prefers enrichmentResolvedTicker over suggested", () => {
    const out = buildHoldingsBreakdown(
      withHoldings([
        { value: 100_000, enrichmentResolvedTicker: "spy", suggested: "fallback" },
        { value: 50_000, suggested: "voo" }, // no enrichment
      ]),
    );
    expect(out.topPositions[0].ticker).toBe("SPY");
    expect(out.topPositions[1].ticker).toBe("VOO");
  });

  it("name prefers enrichmentResolvedName, falls back to rawName, then suggested", () => {
    const out = buildHoldingsBreakdown(
      withHoldings([
        {
          value: 100_000,
          enrichmentResolvedName: "S&P 500 ETF",
          rawName: "Old name",
          suggested: "ticker",
        },
      ]),
    );
    expect(out.topPositions[0].name).toBe("S&P 500 ETF");
  });

  it("weightPct=0 when totalValue is 0", () => {
    const out = buildHoldingsBreakdown(withHoldings([{ value: 0, suggested: "X" }]));
    expect(out.topPositions[0].weightPct).toBe(0);
    expect(Number.isFinite(out.topPositions[0].weightPct)).toBe(true);
  });

  it("clamps topN below 1 to at least 1 (Math.max(1, topN))", () => {
    const positions = Array.from({ length: 10 }, (_, i) => ({
      value: 1000,
      suggested: `S${i}`,
    }));
    // 0 → 1 result; negative same. Default (5) only applies when topN is omitted.
    const out0 = buildHoldingsBreakdown(withHoldings(positions), 0);
    expect(out0.topPositions).toHaveLength(1);
    const outNeg = buildHoldingsBreakdown(withHoldings(positions), -5);
    expect(outNeg.topPositions).toHaveLength(1);
    // Omitted topN uses the default of 5.
    const outDefault = buildHoldingsBreakdown(withHoldings(positions));
    expect(outDefault.topPositions).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summarizeAccounts
// ─────────────────────────────────────────────────────────────────────────────

describe("summarizeAccounts", () => {
  it("groups holdings by accountNumber, sums totalValue + holdingCount", () => {
    const out = summarizeAccounts(
      withHoldings([
        { value: 100_000, accountNumber: "1234", registrationType: "ira" },
        { value: 50_000, accountNumber: "1234", registrationType: "ira" },
        { value: 200_000, accountNumber: "5678", registrationType: "joint" },
      ]),
    );
    expect(out).toHaveLength(2);
    // Sorted by value desc, so 5678 comes first.
    expect(out[0]).toEqual({
      accountNumber: "5678",
      registrationType: "Joint",
      totalValue: 200_000,
      holdingCount: 1,
    });
    expect(out[1]).toEqual({
      accountNumber: "1234",
      registrationType: "Ira",
      totalValue: 150_000,
      holdingCount: 2,
    });
  });

  it("humanizes underscored registration types ('roth_ira' → 'Roth ira')", () => {
    const out = summarizeAccounts(
      withHoldings([
        { value: 100, accountNumber: "1", registrationType: "roth_ira" },
        { value: 100, accountNumber: "2", registrationType: "joint_with_rights_of_survivorship" },
      ]),
    );
    expect(out.find((a) => a.accountNumber === "1")?.registrationType).toBe("Roth ira");
    expect(out.find((a) => a.accountNumber === "2")?.registrationType).toBe(
      "Joint with rights of survivorship",
    );
  });

  it("SKIPS holdings without an accountNumber (no synthetic 'Unknown' entry)", () => {
    const out = summarizeAccounts(
      withHoldings([
        { value: 100_000, accountNumber: "1234", registrationType: "ira" },
        { value: 50_000, accountNumber: null, registrationType: "ira" },
        { value: 25_000, accountNumber: "", registrationType: "ira" },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].accountNumber).toBe("1234");
    expect(out[0].totalValue).toBe(100_000);
  });

  it("returns empty array when no holdings", () => {
    expect(summarizeAccounts(withHoldings([]))).toEqual([]);
  });

  it("renders 'Unknown registration' when registrationType is empty/null", () => {
    const out = summarizeAccounts(
      withHoldings([{ value: 100, accountNumber: "X", registrationType: null }]),
    );
    expect(out[0].registrationType).toBe("Unknown registration");
  });
});
