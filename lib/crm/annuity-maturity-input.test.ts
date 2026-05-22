import { describe, expect, it } from "vitest";
import {
  accountNeedsMaturityDateInput,
  applyMaturityDateToAccountHoldings,
  hasParsableMaturityDate,
} from "./annuity-maturity-input";
import type { UiHolding } from "@/lib/saved-review-normalize";

function annuityHolding(accountNumber: string, maturityDate?: string): UiHolding {
  return {
    rawName: "Athene — Product",
    suggested: "****1234",
    confidence: 90,
    assetClass: "Annuity",
    value: 100000,
    status: "matched",
    options: [],
    accountNumber,
    documentKind: "annuity",
    annuityContract: {
      contractNumber: "1234567890",
      carrierName: "Athene",
      qualifiedStatus: "qualified",
      productName: "Allocation Pro",
      contractType: "fia",
      issueDate: "2020-01-15",
      currentValue: 100000,
      initialPremium: 90000,
      surrenderValue: 95000,
      indexingStrategies: [{ name: "S&P 500" }],
      ...(maturityDate ? { maturityDate } : {}),
    },
  };
}

describe("annuity-maturity-input", () => {
  it("hasParsableMaturityDate accepts ISO dates", () => {
    const c = annuityHolding("acct1", "2029-06-01").annuityContract as NonNullable<
      UiHolding["annuityContract"]
    >;
    expect(hasParsableMaturityDate(c)).toBe(true);
  });

  it("accountNeedsMaturityDateInput when annuity lacks maturity", () => {
    const holdings = [annuityHolding("acct1")];
    expect(accountNeedsMaturityDateInput(holdings, "acct1")).toBe(true);
  });

  it("accountNeedsMaturityDateInput false when maturity present", () => {
    const holdings = [annuityHolding("acct1", "2029-06-01")];
    expect(accountNeedsMaturityDateInput(holdings, "acct1")).toBe(false);
  });

  it("applyMaturityDateToAccountHoldings sets maturity on primary holding", () => {
    const holdings = [annuityHolding("acct1")];
    const next = applyMaturityDateToAccountHoldings(holdings, "acct1", "2030-12-31");
    const contract = next[0].annuityContract as { maturityDate?: string };
    expect(contract.maturityDate).toBe("2030-12-31");
    expect(accountNeedsMaturityDateInput(next, "acct1")).toBe(false);
  });
});
