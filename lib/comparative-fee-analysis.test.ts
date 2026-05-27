import { describe, expect, it } from "vitest";
import {
  buildComparativeFeeAnalysisResponse,
  currentScenarioAdvisorFeeRate,
  defaultProposedForCurrent,
  proposedScenarioAdvisorFeeRate,
  synthesizeLegacyAccounts,
  accountIncludedInProposedRollup,
  isProposedManagedAsset,
  isSelfManagedAsset,
  type ParsedAccountForComparative,
} from "./comparative-fee-analysis";

function acct(
  partial: Partial<ParsedAccountForComparative> & Pick<ParsedAccountForComparative, "key" | "totalAccountValue">
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

const ratioMap = new Map([
  ["VOO", { expenseRatioAnnual: 0.0003, note: "Index ETF" }],
]);

describe("comparative-fee-analysis", () => {
  it("defaultProposedForCurrent maps smart defaults", () => {
    expect(defaultProposedForCurrent("other_advisor")).toBe("transition_to_me");
    expect(defaultProposedForCurrent("self_managed")).toBe("self_managed");
    expect(defaultProposedForCurrent("managed_by_me")).toBe("keep_current");
    expect(defaultProposedForCurrent("excluded")).toBe("excluded");
  });

  it("currentScenarioAdvisorFeeRate: other_advisor uses current fee", () => {
    const a = acct({ currentManagement: "other_advisor", currentAdvisorFeeAnnual: 0.015 });
    expect(currentScenarioAdvisorFeeRate(a, 0.01)).toBe(0.015);
  });

  it("currentScenarioAdvisorFeeRate: self_managed is zero", () => {
    const a = acct({ currentManagement: "self_managed", currentAdvisorFeeAnnual: null });
    expect(currentScenarioAdvisorFeeRate(a, 0.01)).toBe(0);
  });

  it("proposedScenarioAdvisorFeeRate: keep_current mirrors other_advisor", () => {
    const a = acct({
      currentManagement: "other_advisor",
      proposedManagement: "keep_current",
      currentAdvisorFeeAnnual: 0.012,
    });
    expect(proposedScenarioAdvisorFeeRate(a, 0.01)).toBe(0.012);
  });

  it("proposedScenarioAdvisorFeeRate: excluded is zero", () => {
    const a = acct({ proposedManagement: "excluded" });
    expect(proposedScenarioAdvisorFeeRate(a, 0.01)).toBe(0);
  });

  it("excluded account omitted from proposed household denominator", () => {
    const accounts = [
      acct({ key: "a1", totalAccountValue: 100_000, proposedManagement: "transition_to_me" }),
      acct({
        key: "a2",
        totalAccountValue: 500_000,
        proposedManagement: "excluded",
        currentManagement: "unmanaged_employer",
      }),
    ];
    const res = buildComparativeFeeAnalysisResponse({
      portfolioValue: 600_000,
      myAdvisoryFeeAnnual: 0.01,
      accounts,
      ratioByTicker: ratioMap,
      disclaimer: "Test",
      uniqueTickerCount: 1,
      rowsMissingTicker: 0,
    });
    expect(res.coverage.excludedAssets).toBe(500_000);
    expect(res.coverage.proposedCoveragePct).toBeCloseTo(100_000 / 600_000, 5);
    expect(res.proposed.householdValue).toBe(100_000);
    expect(res.proposed.totalAdvisorFeesDollars).toBeCloseTo(1000, 0);
    expect(res.accounts[1]!.includedInProposedRollup).toBe(false);
  });

  it("fund fees identical in current vs proposed for same holdings", () => {
    const accounts = [acct({ key: "a1", totalAccountValue: 200_000 })];
    const res = buildComparativeFeeAnalysisResponse({
      portfolioValue: 200_000,
      myAdvisoryFeeAnnual: 0.01,
      accounts,
      ratioByTicker: ratioMap,
      disclaimer: "Test",
      uniqueTickerCount: 1,
      rowsMissingTicker: 0,
    });
    expect(res.current.totalEstimatedFundFeesDollars).toBe(
      res.proposed.totalEstimatedFundFeesDollars
    );
    expect(res.comparison.narrativeHints[0]).toMatch(/held constant/i);
  });

  it("transition_to_me uses proposed fee not other advisor current fee", () => {
    const accounts = [
      acct({
        key: "a1",
        totalAccountValue: 100_000,
        currentAdvisorFeeAnnual: 0.02,
        proposedAdvisorFeeAnnual: 0.008,
      }),
    ];
    const res = buildComparativeFeeAnalysisResponse({
      portfolioValue: 100_000,
      myAdvisoryFeeAnnual: 0.01,
      accounts,
      ratioByTicker: ratioMap,
      disclaimer: "Test",
      uniqueTickerCount: 1,
      rowsMissingTicker: 0,
    });
    expect(res.current.totalAdvisorFeesDollars).toBeCloseTo(2000, 0);
    expect(res.proposed.totalAdvisorFeesDollars).toBeCloseTo(800, 0);
    expect(res.comparison.annualCostDifferenceDollars).toBeGreaterThan(0);
  });

  it("synthesizeLegacyAccounts sets transition_to_me", () => {
    const legacy = synthesizeLegacyAccounts(
      [
        {
          key: "k1",
          accountNumber: "1",
          totalAccountValue: 50_000,
          fundRows: [],
        },
      ],
      0.01
    );
    expect(legacy[0]!.currentManagement).toBe("other_advisor");
    expect(legacy[0]!.proposedManagement).toBe("transition_to_me");
    expect(legacy[0]!.currentAdvisorFeeAnnual).toBe(0.01);
  });

  it("isProposedManagedAsset and isSelfManagedAsset", () => {
    const managed = acct({ proposedManagement: "transition_to_me" });
    const self = acct({
      currentManagement: "self_managed",
      proposedManagement: "self_managed",
    });
    expect(isProposedManagedAsset(managed)).toBe(true);
    expect(isSelfManagedAsset(self)).toBe(true);
    expect(accountIncludedInProposedRollup(self)).toBe(true);
  });
});
