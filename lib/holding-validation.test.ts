import { describe, expect, it } from "vitest";
import { SYNTHETIC_CASH_TICKER } from "./cash-holding-constants";
import {
  applySyntheticCashTickerIfEligible,
  extractLikelyCusip,
  extractLikelySymbol,
  isLikelyDescriptionOnlyTickerSymbol,
  validateHoldingLocally,
} from "./holding-validation";

describe("holding-validation", () => {
  it("extracts ticker-like symbols from selected labels", () => {
    expect(extractLikelySymbol("VFIAX - Vanguard 500 Index Fund")).toBe("VFIAX");
    expect(extractLikelySymbol("Vanguard 500 Index (VOO)")).toBe("VOO");
  });

  it("treats AP_CASH as a single symbol, not AP", () => {
    expect(extractLikelySymbol(SYNTHETIC_CASH_TICKER)).toBe(SYNTHETIC_CASH_TICKER);
    expect(
      validateHoldingLocally({
        suggested: SYNTHETIC_CASH_TICKER,
        assetClass: "Cash / Money Market",
        confidence: 90,
        status: "matched",
      }).normalizedSymbol
    ).toBe(SYNTHETIC_CASH_TICKER);
  });

  it("extracts CUSIP-like identifiers", () => {
    expect(extractLikelyCusip("US Treasury 9128285M8")).toBe("9128285M8");
  });

  it("marks confident ticker matches as locally validated", () => {
    expect(
      validateHoldingLocally({
        suggested: "AAPL - Apple Inc.",
        confidence: 99,
        status: "matched",
      }).validationStatus
    ).toBe("validated");
  });

  it("flags BANK from sweep text as description noise for synthetic decision", () => {
    expect(
      isLikelyDescriptionOnlyTickerSymbol(
        "BANK",
        "BANK DEPOSIT SWEEP PROGRAM",
        "BANK DEPOSIT SWEEP PROGRAM"
      )
    ).toBe(true);
    expect(
      applySyntheticCashTickerIfEligible({
        assetClass: "Cash / Money Market",
        suggested: "BANK DEPOSIT SWEEP PROGRAM",
        rawName: "BANK DEPOSIT SWEEP PROGRAM",
      }).suggested
    ).toBe(SYNTHETIC_CASH_TICKER);
  });

  it("does not replace when a real ticker leads the label", () => {
    const out = applySyntheticCashTickerIfEligible({
      assetClass: "Cash Mutual Fund",
      suggested: "VMFXX - Federal Money Market",
      rawName: "VMFXX - Federal Money Market",
    });
    expect(out.suggested).toBe("VMFXX - Federal Money Market");
  });

  it("does not apply synthetic to non-cash sleeves", () => {
    const out = applySyntheticCashTickerIfEligible({
      assetClass: "U.S. Large Cap Equity",
      suggested: "Some sweep description",
      rawName: "Some sweep description",
    });
    expect(out.suggested).toBe("Some sweep description");
  });
});
