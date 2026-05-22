import { describe, expect, it } from "vitest";
import { formatAccountHeaderLabel, parseAccountNumberParts } from "./account-display";
import type { UiHolding } from "@/lib/saved-review-normalize";
import { brokerageFinancialInstitutionLabel } from "./account-display";

describe("parseAccountNumberParts", () => {
  it("parses hyphenated masked account numbers", () => {
    expect(parseAccountNumberParts("BRK-****-5502")).toEqual({
      prefix: "BRK",
      maskedSuffix: "****-5502",
    });
  });
});

describe("formatAccountHeaderLabel", () => {
  it("inserts institution between prefix and masked suffix", () => {
    expect(formatAccountHeaderLabel("BRK-****-5502", "Schwab")).toBe("BRK Schwab ****-5502");
    expect(formatAccountHeaderLabel("IRA-****-2222", "Fidelity")).toBe("IRA Fidelity ****-2222");
  });

  it("falls back to mask when institution omitted", () => {
    expect(formatAccountHeaderLabel("BRK-****-5502", null)).toBe("BRK-****-5502");
  });
});

describe("brokerageFinancialInstitutionLabel", () => {
  const holding = (
    partial: Partial<UiHolding> & Pick<UiHolding, "rawName" | "suggested" | "value">
  ): UiHolding => ({
    confidence: 90,
    assetClass: "Equity ETF",
    status: "matched",
    options: [],
    ...partial,
  });

  it("picks institution from highest-value brokerage row", () => {
    const label = brokerageFinancialInstitutionLabel([
      holding({
        rawName: "A",
        suggested: "AAPL",
        value: 100,
        accountNumber: "BRK-****-1111",
        financialInstitution: "Fidelity",
      }),
      holding({
        rawName: "B",
        suggested: "MSFT",
        value: 500,
        accountNumber: "BRK-****-1111",
        financialInstitution: "Schwab",
      }),
    ]);
    expect(label).toBe("Schwab");
  });

  it("returns null for annuity-only accounts", () => {
    const label = brokerageFinancialInstitutionLabel([
      holding({
        rawName: "Contract",
        suggested: "C",
        value: 100_000,
        documentKind: "annuity",
        annuityContract: {
          carrierName: "Athene",
          contractNumber: "123",
          productName: "FIA",
          contractType: "fia",
          qualifiedStatus: "qualified",
          issueDate: "2020-01-01",
          currentValue: 100_000,
          initialPremium: 100_000,
          surrenderValue: 95_000,
          indexingStrategies: [],
        },
      }),
    ]);
    expect(label).toBeNull();
  });
});
