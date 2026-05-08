import { describe, expect, it } from "vitest";
import {
  BIGGEST_DRAWDOWN_SCENARIO_YEAR,
  SP500_ANNUAL_TOTAL_RETURN_PCT,
  TEN_YEAR_SCENARIOS,
  annualizedReturnDecimalFromAnnualPcts,
  compoundedReturnFromAnnualPcts,
  scenarioHoldingsPortfolioReturnDecimal,
  scenarioHoldingsPortfolioSingleYearReturnDecimal,
  scenarioProposedPortfolioReturnDecimal,
  scenarioProposedPortfolioSingleYearReturnDecimal,
} from "./ten-year-scenario-models";

describe("ten-year-scenario-models", () => {
  it("compounds annual percentages to cumulative total", () => {
    expect(compoundedReturnFromAnnualPcts([10, 10])).toBeCloseTo(1.1 * 1.1 - 1, 6);
    expect(compoundedReturnFromAnnualPcts([100])).toBeCloseTo(2 - 1, 6);
  });

  it("annualized CAGR from calendar-year percentages", () => {
    expect(annualizedReturnDecimalFromAnnualPcts([10, 10])).toBeCloseTo(0.1, 6);
    const uneven = annualizedReturnDecimalFromAnnualPcts([100, -50]);
    expect(uneven).toBeCloseTo(0, 6);
  });

  it("maps proposed all-equity to firm S&P window CAGR", () => {
    const scenario = TEN_YEAR_SCENARIOS.find((s) => s.id === "low_recent_2000_2009")!;
    const pcts = scenario.years.map((y) => SP500_ANNUAL_TOTAL_RETURN_PCT[y] as number);
    const expected = annualizedReturnDecimalFromAnnualPcts(pcts);
    const proposed = scenarioProposedPortfolioReturnDecimal(scenario.years, {
      equity: 100,
      fixedIncome: 0,
      cash: 0,
    });
    expect(proposed).toBeCloseTo(expected, 12);
    const holdings = scenarioHoldingsPortfolioReturnDecimal(scenario.years, [
      { rawName: "EQ", suggested: "VOO", assetClass: "Equity ETF", value: 100 },
    ]);
    expect(holdings).toBeCloseTo(expected, 12);
  });

  it("uses MM proxy for cash sleeve and aggregate for bond sleeve", () => {
    const scenario = TEN_YEAR_SCENARIOS[0]!;
    const allCash = scenarioProposedPortfolioReturnDecimal(scenario.years, {
      equity: 0,
      fixedIncome: 0,
      cash: 100,
    });
    expect(allCash).toBeGreaterThan(0.01);
    expect(allCash).toBeLessThan(0.05);
    const holdings = scenarioHoldingsPortfolioReturnDecimal(scenario.years, [
      { rawName: "MM", suggested: "VMFXX", assetClass: "Cash / Money Market", value: 100 },
      { rawName: "BD", suggested: "BND ETF", assetClass: "Bond ETF", value: 100 },
    ]);
    expect(Number.isFinite(holdings)).toBe(true);
  });

  it("excludes flagged duplicate holdings from weight base", () => {
    const scenario = TEN_YEAR_SCENARIOS[0]!;
    const dup = scenarioHoldingsPortfolioReturnDecimal(scenario.years, [
      { suggested: "SPY", assetClass: "Equity ETF", value: 100 },
      {
        suggested: "SPY",
        assetClass: "Equity ETF",
        value: 50,
        duplicateOfIndex: 0,
      },
    ]);
    const single = scenarioHoldingsPortfolioReturnDecimal(scenario.years, [
      { suggested: "SPY", assetClass: "Equity ETF", value: 100 },
    ]);
    expect(dup).toBeCloseTo(single, 12);
  });

  it("2008 proposed all-equity uses firm S&P single-year calibration", () => {
    const y = BIGGEST_DRAWDOWN_SCENARIO_YEAR;
    expect(SP500_ANNUAL_TOTAL_RETURN_PCT[y]).toBeCloseTo(-36.55, 6);
    const d = scenarioProposedPortfolioSingleYearReturnDecimal(y, {
      equity: 100,
      fixedIncome: 0,
      cash: 0,
    });
    expect(d).toBeCloseTo(-0.3655, 6);
    const holdings = scenarioHoldingsPortfolioSingleYearReturnDecimal(y, [
      { suggested: "SPY", assetClass: "Equity ETF", value: 100 },
    ]);
    expect(holdings).toBeCloseTo(-0.3655, 6);
  });
});
