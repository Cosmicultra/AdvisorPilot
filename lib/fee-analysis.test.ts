import { describe, expect, it } from "vitest";
import {
  groupFeeAnalysisFundRowsByAccount,
  isEtfOrMutualFundAssetClass,
  parseAdvisorFeePercentPoints,
  resolveFeeAnalysisTicker,
} from "./fee-analysis";

describe("fee-analysis", () => {
  it("classifies ETF and mutual fund wrappers", () => {
    expect(isEtfOrMutualFundAssetClass("Equity ETF")).toBe(true);
    expect(isEtfOrMutualFundAssetClass("Mutual Fund")).toBe(true);
    expect(isEtfOrMutualFundAssetClass("Individual Stock")).toBe(false);
  });

  it("parses advisor fee percent points", () => {
    expect(parseAdvisorFeePercentPoints("1")).toBe(0.01);
    expect(parseAdvisorFeePercentPoints("1%")).toBe(0.01);
    expect(parseAdvisorFeePercentPoints("0.25")).toBe(0.0025);
  });

  it("resolves ticker precedence", () => {
    expect(
      resolveFeeAnalysisTicker({
        assetClass: "Equity ETF",
        enrichmentResolvedTicker: "qqq",
        normalizedSymbol: "SPY",
        suggested: "VOO - Vanguard",
      })
    ).toBe("QQQ");
  });

  it("groups fund rows by account and includes full account value in total", () => {
    const holdings = [
      {
        assetClass: "Equity ETF",
        value: 1000,
        accountNumber: "111",
        suggested: "VOO - Vanguard S&P 500 ETF",
        rawName: "",
        normalizedSymbol: "VOO",
      },
      {
        assetClass: "Individual Stock",
        value: 4000,
        accountNumber: "111",
        suggested: "AAPL",
        rawName: "",
        normalizedSymbol: "AAPL",
      },
    ];
    const groups = groupFeeAnalysisFundRowsByAccount(holdings);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.totalAccountValue).toBe(5000);
    expect(groups[0]!.fundRows).toHaveLength(1);
  });
});
