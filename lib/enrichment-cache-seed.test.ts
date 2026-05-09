import { describe, expect, it } from "vitest";
import {
  collectSeedRowsFromHoldings,
  lookupKeyForUiHolding,
  mergeSeedRows,
  seedPayloadQualityScore,
  uiHoldingToSeedCacheRow,
} from "./enrichment-cache-seed";
import type { UiHolding } from "./saved-review-normalize";

const baseHolding = (): UiHolding => ({
  rawName: "Vanguard Total Stock",
  suggested: "VTI",
  confidence: 88,
  assetClass: "Equity ETF",
  value: 10000,
  status: "matched",
  options: [],
});

describe("lookupKeyForUiHolding", () => {
  it("uses figi when present", () => {
    const h = { ...baseHolding(), enrichmentFigi: "BBG123" };
    expect(lookupKeyForUiHolding(h)).toBe("figi:BBG123");
  });

  it("falls back to cusip", () => {
    const h = {
      ...baseHolding(),
      suggested: "CUSIP 037833100 fund",
      enrichmentFigi: "",
    };
    expect(lookupKeyForUiHolding(h)).toBe("cusip:037833100");
  });

  it("falls back to symbol", () => {
    expect(lookupKeyForUiHolding(baseHolding())).toBe("sym:VTI");
  });
});

describe("uiHoldingToSeedCacheRow", () => {
  it("returns null for cash-like", () => {
    const h = {
      ...baseHolding(),
      assetClass: "Cash / Money Market",
      suggested: "Government Money Market",
    };
    expect(uiHoldingToSeedCacheRow(h, { includeUnenriched: true })).toBeNull();
  });

  it("skips unenriched when includeUnenriched false", () => {
    const h = baseHolding();
    delete (h as UiHolding).enrichmentCompletedAt;
    expect(uiHoldingToSeedCacheRow(h, { includeUnenriched: false })).toBeNull();
  });

  it("builds row from enriched holding", () => {
    const h: UiHolding = {
      ...baseHolding(),
      enrichmentCompletedAt: "2026-01-01T00:00:00Z",
      enrichmentResolvedTicker: "VTI",
      enrichmentMappedAssetClass: "Equity ETF",
      enrichmentFigi: "BBGX1",
      enrichmentConfidence: 92,
      enrichmentNeedsReview: false,
      enrichmentNotes: "ok",
    };
    const row = uiHoldingToSeedCacheRow(h, { includeUnenriched: false });
    expect(row?.lookup_key).toBe("figi:BBGX1");
    expect(row?.payload.enrichmentMappedAssetClass).toBe("Equity ETF");
    expect(seedPayloadQualityScore(row!.payload)).toBeGreaterThan(0);
  });

  it("includes unenriched when flag set", () => {
    const h = baseHolding();
    const row = uiHoldingToSeedCacheRow(h, { includeUnenriched: true });
    expect(row?.lookup_key).toBe("sym:VTI");
    expect(row?.payload.enrichmentNotes).toContain("without AI");
  });
});

describe("mergeSeedRows", () => {
  it("prefers higher-quality payload", () => {
    const low = {
      lookup_key: "sym:AAPL",
      payload: {
        enrichmentResolvedTicker: "AAPL",
        enrichmentResolvedName: "Apple",
        enrichmentShareClass: "",
        enrichmentMappedAssetClass: "Individual Stock",
        enrichmentSourceUrls: [],
        enrichmentFigi: "",
        enrichmentFigiSecurityType: "",
        enrichmentFigiSkippedReason: "",
        enrichmentConfidence: 70,
        enrichmentIsProprietaryOrThinData: false,
        enrichmentNeedsReview: true,
        enrichmentNotes: "Seeded from saved holdings without AI enrichment — lower confidence.",
        suggested: "AAPL",
        assetClass: "Individual Stock",
        confidence: 70,
        status: "review",
      },
    };
    const high = {
      lookup_key: "sym:AAPL",
      payload: {
        ...low.payload,
        enrichmentFigi: "FIGI99",
        enrichmentNotes: "Seeded from saved AdvisorPilot holdings (prior enrichment).",
        enrichmentConfidence: 95,
      },
    };
    const merged = mergeSeedRows([low, high]);
    expect(merged).toHaveLength(1);
    expect(merged[0].payload.enrichmentFigi).toBe("FIGI99");
  });
});

describe("collectSeedRowsFromHoldings", () => {
  it("dedupes across list", () => {
    const h1 = baseHolding();
    const h2 = baseHolding();
    const rows = collectSeedRowsFromHoldings([h1, h2], { includeUnenriched: true });
    expect(rows).toHaveLength(1);
  });
});
