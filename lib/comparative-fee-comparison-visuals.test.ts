import { describe, expect, it } from "vitest";
import {
  buildComparativeFeeAnalysisResponse,
  type ParsedAccountForComparative,
} from "@/lib/comparative-fee-analysis";
import { buildComparativeFeeComparisonVisualData } from "@/lib/comparative-fee-comparison-visuals";

function acct(
  partial: Partial<ParsedAccountForComparative> & Pick<ParsedAccountForComparative, "key" | "totalAccountValue">,
): ParsedAccountForComparative {
  return {
    accountNumber: "111",
    fundRows: [
      {
        ticker: "VOO",
        value: partial.totalAccountValue,
        assetClass: "Equity ETF",
        suggested: "Vanguard S&P 500",
        rawName: "",
        accountNumber: "111",
      },
    ],
    currentManagement: "other_advisor",
    proposedManagement: "transition_to_me",
    currentAdvisorFeeAnnual: 0.0125,
    proposedAdvisorFeeAnnual: 0.01,
    ...partial,
  };
}

const ratioMap = new Map([["VOO", { expenseRatioAnnual: 0.0003, note: "Index ETF" }]]);

describe("buildComparativeFeeComparisonVisualData", () => {
  it("marks savings when proposed total annual cost is lower", () => {
    const res = buildComparativeFeeAnalysisResponse({
      portfolioValue: 1_000_000,
      myAdvisoryFeeAnnual: 0.01,
      accounts: [acct({ key: "a1", totalAccountValue: 1_000_000, currentAdvisorFeeAnnual: 0.02 })],
      ratioByTicker: ratioMap,
      disclaimer: "Test",
      uniqueTickerCount: 1,
      rowsMissingTicker: 0,
    });
    const data = buildComparativeFeeComparisonVisualData(res);

    expect(data.annualCostDelta).toBeGreaterThan(0);
    expect(data.deltaTone).toBe("positive");
    expect(data.deltaLabel).toMatch(/Lower estimated annual cost/i);
    expect(data.deltaHeadline).toMatch(/lower per year/i);
    expect(data.currentTotal).toBe(res.current.totalEstimatedAnnualCostDollars);
    expect(data.proposedTotal).toBe(res.proposed.totalEstimatedAnnualCostDollars);
  });

  it("marks increase when proposed costs more", () => {
    const res = buildComparativeFeeAnalysisResponse({
      portfolioValue: 500_000,
      myAdvisoryFeeAnnual: 0.02,
      accounts: [
        acct({
          key: "a1",
          totalAccountValue: 500_000,
          proposedManagement: "keep_current",
          currentAdvisorFeeAnnual: 0.005,
          proposedAdvisorFeeAnnual: 0.005,
        }),
      ],
      ratioByTicker: ratioMap,
      disclaimer: "Test",
      uniqueTickerCount: 1,
      rowsMissingTicker: 0,
    });
    const data = buildComparativeFeeComparisonVisualData(res);

    if (data.annualCostDelta < 0) {
      expect(data.deltaTone).toBe("negative");
      expect(data.deltaHeadline).toMatch(/higher per year/i);
    }
  });

  it("shows coverage bar and optional chips for partial / self-managed / excluded", () => {
    const res = buildComparativeFeeAnalysisResponse({
      portfolioValue: 600_000,
      myAdvisoryFeeAnnual: 0.01,
      accounts: [
        acct({ key: "a1", totalAccountValue: 100_000, proposedManagement: "transition_to_me" }),
        acct({
          key: "a2",
          totalAccountValue: 400_000,
          proposedManagement: "excluded",
          currentManagement: "unmanaged_employer",
        }),
        acct({
          key: "a3",
          totalAccountValue: 100_000,
          currentManagement: "self_managed",
          proposedManagement: "self_managed",
        }),
      ],
      ratioByTicker: ratioMap,
      disclaimer: "Test",
      uniqueTickerCount: 1,
      rowsMissingTicker: 0,
    });
    const data = buildComparativeFeeComparisonVisualData(res);

    expect(data.showCoverageBar).toBe(true);
    expect(data.proposedCoveragePct).toBeCloseTo(100_000 / 600_000, 5);
    expect(data.showExcluded).toBe(true);
    expect(data.showSelfManaged).toBe(true);
    expect(data.narrativeHints.length).toBeGreaterThan(0);
  });
});
