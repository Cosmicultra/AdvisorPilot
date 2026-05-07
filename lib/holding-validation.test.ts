import { describe, expect, it } from "vitest";
import { extractLikelyCusip, extractLikelySymbol, validateHoldingLocally } from "./holding-validation";

describe("holding-validation", () => {
  it("extracts ticker-like symbols from selected labels", () => {
    expect(extractLikelySymbol("VFIAX - Vanguard 500 Index Fund")).toBe("VFIAX");
    expect(extractLikelySymbol("Vanguard 500 Index (VOO)")).toBe("VOO");
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
});
