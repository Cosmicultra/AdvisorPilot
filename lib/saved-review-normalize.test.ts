import { describe, expect, it } from "vitest";
import { normalizeAiAnalysis, normalizeHoldingsForUi, normalizeSavedReviewRow } from "./saved-review-normalize";

describe("normalizeHoldingsForUi", () => {
  it("defaults missing fields for partial rows", () => {
    const out = normalizeHoldingsForUi([
      { rawName: "Fund A", value: "120000" },
      null,
      "bad",
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      rawName: "Fund A",
      suggested: "",
      confidence: 0,
      assetClass: "Unknown",
      value: 120000,
      status: "review",
      options: [],
    });
    expect(out[1].rawName).toBe("");
    expect(out[2].options).toEqual([]);
  });

  it("preserves optional enrichment fields when present", () => {
    const out = normalizeHoldingsForUi([
      {
        rawName: "X",
        suggested: "Y",
        confidence: 90,
        assetClass: "ETF",
        value: 1,
        status: "matched",
        options: ["a"],
        normalizedSymbol: "QQQ",
        duplicateOfIndex: 2,
      },
    ]);
    expect(out[0].normalizedSymbol).toBe("QQQ");
    expect(out[0].duplicateOfIndex).toBe(2);
  });
});

describe("normalizeAiAnalysis", () => {
  it("returns null for null input", () => {
    expect(normalizeAiAnalysis(null)).toBeNull();
  });

  it("fills defaults for sparse stored analysis", () => {
    const out = normalizeAiAnalysis({ synopsis: "Hello." });
    expect(out).not.toBeNull();
    expect(out!.synopsis).toBe("Hello.");
    expect(out!.strategies).toEqual([]);
    expect(out!.recommendations).toEqual([]);
    expect(out!.portfolioHighlights).toEqual([]);
  });
});

describe("normalizeSavedReviewRow", () => {
  it("normalizes nested client and holdings from API shape", () => {
    const row = normalizeSavedReviewRow({
      id: "rid",
      savedAt: "2020-01-01",
      client: { firstName: "Pat", lastName: "Lee" },
      holdings: [{ rawName: "AAA", options: ["opt"], confidence: 80, value: 1000, assetClass: "ETF", status: "matched", suggested: "BBB" }],
      meetingNotes: "Notes",
      demoMode: false,
      analysis: null,
      status: "Draft",
      totalValue: 150000,
    });
    expect(row.client.firstName).toBe("Pat");
    expect(row.holdings[0].options).toEqual(["opt"]);
    expect(row.analysis).toBeNull();
    expect(row.totalValue).toBe(150000);
    expect(row.rothWorksheet).toBeUndefined();
  });

  it("preserves stored Roth worksheet", () => {
    const row = normalizeSavedReviewRow({
      id: "rid",
      savedAt: "2020-01-01",
      client: { firstName: "Pat", lastName: "Lee" },
      holdings: [],
      meetingNotes: "",
      demoMode: false,
      analysis: null,
      totalValue: 0,
      rothWorksheet: {
        useEntireQualifiedBalance: true,
        qualifiedAssetValue: "400000",
        specificConversionAmount: "",
        useFixedIndexContract: false,
        fic: { carrierName: "Acme" },
      },
    });
    expect(row.rothWorksheet?.useEntireQualifiedBalance).toBe(true);
    expect(row.rothWorksheet?.qualifiedAssetValue).toBe("400000");
    expect(row.rothWorksheet?.fic.carrierName).toBe("Acme");
  });
});
