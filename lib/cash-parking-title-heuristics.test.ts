import { describe, expect, it } from "vitest";
import {
  buildCashParkingSyntheticHolding,
  cashParkingTitleMatches,
  CASH_PARKING_SYNTHETIC_ASSET_CLASS,
} from "./cash-parking-title-heuristics";
import { SYNTHETIC_CASH_TICKER } from "./cash-holding-constants";

describe("cashParkingTitleMatches", () => {
  it("matches common sweep and MMF titles", () => {
    expect(cashParkingTitleMatches("Core Position")).toBe(true);
    expect(cashParkingTitleMatches("FDIC Insured Deposit Sweep")).toBe(true);
    expect(cashParkingTitleMatches("Fidelity Government Money Market Fund")).toBe(true);
    expect(cashParkingTitleMatches("Cash")).toBe(true);
  });

  it("rejects unrelated equity names", () => {
    expect(cashParkingTitleMatches("Apple Inc")).toBe(false);
    expect(cashParkingTitleMatches("Vanguard 500 Index Admiral")).toBe(false);
  });
});

describe("buildCashParkingSyntheticHolding", () => {
  it("sets AP_CASH and Money Market Account", () => {
    const out = buildCashParkingSyntheticHolding({
      rawName: "Bank Sweep",
      suggested: "Needs advisor confirmation",
      confidence: 40,
      assetClass: "Unknown",
      options: ["x", "Manual ticker / CUSIP entry"],
    });
    expect(out.suggested).toBe(SYNTHETIC_CASH_TICKER);
    expect(out.assetClass).toBe(CASH_PARKING_SYNTHETIC_ASSET_CLASS);
    expect(out.confidence).toBeGreaterThanOrEqual(90);
    expect(Array.isArray(out.options) && out.options.includes(SYNTHETIC_CASH_TICKER)).toBe(true);
  });
});
