import { describe, expect, it } from "vitest";
import {
  assertHoldingsReconcileToVerifiedTotal,
  extractPrintedEndingTotalsFromEmbeddedPdfText,
  parseUsdAmount,
  reconciliationToleranceUsd,
} from "./statement-extraction-verify";

describe("parseUsdAmount", () => {
  it("parses comma-separated dollars", () => {
    expect(parseUsdAmount("1,284,905.17")).toBeCloseTo(1284905.17, 2);
  });
});

describe("extractPrintedEndingTotalsFromEmbeddedPdfText", () => {
  it("captures Schwab Positions headline under Account Summary (no colon)", () => {
    const text = `
Group by Asset Type
Account Summary
$3,510.84
$216.41$3,294.43
Positions Details
GOLDMAN SACHS GROUP INC
`;
    expect(extractPrintedEndingTotalsFromEmbeddedPdfText(text)).toEqual([3510.84]);
  });

  it("pairs Account Number blocks with Ending Account Value", () => {
    const text = `
Traditional IRA
Account Number: IRA-4827-1945
stuff
Ending Account Value: $684,251.42
Brokerage
Account Number: BRK-9914-5502
Ending Account Value: $1,284,905.17
401(k)
Account Number: 401K-2281-7710
Ending Account Value: $428,745.91
`;
    const totals = extractPrintedEndingTotalsFromEmbeddedPdfText(text);
    expect(totals).toHaveLength(3);
    expect(totals[0]).toBeCloseTo(684251.42, 2);
    expect(totals[1]).toBeCloseTo(1284905.17, 2);
    expect(totals[2]).toBeCloseTo(428745.91, 2);
  });
});

describe("reconciliationToleranceUsd", () => {
  it("uses 2% floor with $500 minimum", () => {
    expect(reconciliationToleranceUsd(10_000)).toBe(500);
    expect(reconciliationToleranceUsd(50_000)).toBe(1000);
  });
});

describe("assertHoldingsReconcileToVerifiedTotal", () => {
  it("accepts when holdings sum matches summed anchors", () => {
    const text = `
Account Number: IRA-4827-1945
Ending Account Value: $684,251.42
Account Number: BRK-9914-5502
Ending Account Value: $1,284,905.17
`;
    const expected = 684251.42 + 1284905.17;
    assertHoldingsReconcileToVerifiedTotal({
      holdings: [{ value: 500_000 }, { value: expected - 500_000 }],
      embeddedPdfText: text,
      modelStatementEndingValue: undefined,
    });
  });

  it("accepts when model total matches even if parsed PDF anchor total does not", () => {
    assertHoldingsReconcileToVerifiedTotal({
      holdings: [{ value: 10_000 }],
      embeddedPdfText: "Ending Account Value: $99,999.99",
      modelStatementEndingValue: 10_000,
    });
  });

  it("throws when sum mismatches anchors beyond tolerance", () => {
    expect(() =>
      assertHoldingsReconcileToVerifiedTotal({
        holdings: [{ value: 100 }],
        embeddedPdfText: "Ending Account Value: $999.99",
        modelStatementEndingValue: undefined,
      })
    ).toThrow(/reconcile/i);
  });

  it("falls back to model total when anchors absent", () => {
    assertHoldingsReconcileToVerifiedTotal({
      holdings: [{ value: 1234.56 }],
      embeddedPdfText: null,
      modelStatementEndingValue: 1234.56,
    });
  });

  it("rejects partial extraction when multiple account anchors exist (no model-only escape)", () => {
    const text = `
Account Number: IRA-4827-1945
Ending Account Value: $684,251.42
Account Number: BRK-9914-5502
Ending Account Value: $1,284,905.17
`;
    expect(() =>
      assertHoldingsReconcileToVerifiedTotal({
        holdings: [
          { value: 400_000 },
          { value: 284_251.42 },
        ],
        embeddedPdfText: text,
        modelStatementEndingValue: 684_251.42,
      })
    ).toThrow(/reconcile/i);
  });
});
