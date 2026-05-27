import { describe, expect, it } from "vitest";
import { emptyFiaWorksheet } from "@/lib/fia-worksheet";
import {
  buildFiaScenarioSummaries,
  creditedIndexRatePct,
  defaultPremiumForWorksheet,
  simulateFiaTenYearWindow,
} from "@/lib/fia-illustration";

describe("fia-illustration", () => {
  it("credits zero when index is down", () => {
    expect(creditedIndexRatePct(-10, 10)).toBe(0);
  });

  it("applies cap when index is up", () => {
    expect(creditedIndexRatePct(8, 5)).toBe(5);
    expect(creditedIndexRatePct(3, 10)).toBe(3);
  });

  it("runs a ten-year window with premium", () => {
    const sim = simulateFiaTenYearWindow([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], {
      premium: 100_000,
      capPct: 10,
      premiumBonusPct: 0,
      trailingBonusPct: 0,
      trailBonusYears: 0,
      hasRider: false,
      incomeBaseBonusPct: 0,
      riderGuaranteePct: 0,
      contractEarningsAddToRider: false,
      riderFeePct: 0,
      rmdClientStartingAge: null,
    });
    expect(sim.rows).toHaveLength(10);
    expect(sim.endingContractValue).toBeGreaterThan(0);
    expect(Number.isFinite(sim.annualizedCreditedReturnPct)).toBe(true);
  });

  it("adds trailing bonus only for contract years 1..N", () => {
    const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
    const sim = simulateFiaTenYearWindow(years, {
      premium: 100_000,
      capPct: 10,
      premiumBonusPct: 0,
      trailingBonusPct: 4,
      trailBonusYears: 3,
      hasRider: false,
      incomeBaseBonusPct: 0,
      riderGuaranteePct: 0,
      contractEarningsAddToRider: false,
      riderFeePct: 0,
      rmdClientStartingAge: null,
    });
    expect(sim.rows[0]!.creditedRatePct).toBe(creditedIndexRatePct(sim.rows[0]!.sp500TotalReturnPct, 10) + 4);
    expect(sim.rows[2]!.creditedRatePct).toBe(creditedIndexRatePct(sim.rows[2]!.sp500TotalReturnPct, 10) + 4);
    expect(sim.rows[3]!.creditedRatePct).toBe(creditedIndexRatePct(sim.rows[3]!.sp500TotalReturnPct, 10));
  });

  it("uses partial qualified premium when override is set", () => {
    const ws = emptyFiaWorksheet();
    ws.premiumSource = "qualified";
    ws.registrationPremiumOverride = "500000";
    expect(defaultPremiumForWorksheet(ws, 1_112_997, 0)).toBe(500_000);
  });

  it("caps registration premium override at qualified total", () => {
    const ws = emptyFiaWorksheet();
    ws.premiumSource = "qualified";
    ws.registrationPremiumOverride = "2000000";
    expect(defaultPremiumForWorksheet(ws, 1_112_997, 0)).toBe(1_112_997);
  });

  it("exposes tab labels on summaries", () => {
    const ws = emptyFiaWorksheet();
    ws.contractCapRatePct = "10";
    ws.premiumSource = "custom";
    ws.premiumAmount = "100000";
    const rows = buildFiaScenarioSummaries(ws, 100_000);
    expect(rows.map((r) => r.tabLabel)).toEqual(["Lowest", "Highest", "Most recent"]);
  });

  it("buildFiaScenarioSummaries returns three decades", () => {
    const ws = emptyFiaWorksheet();
    ws.contractCapRatePct = "10";
    ws.premiumSource = "custom";
    ws.premiumAmount = "100000";
    const rows = buildFiaScenarioSummaries(ws, 100_000);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.rows.length).toBe(10);
    expect(rows[0]?.totalRmdDuringWindow).toBe(0);
  });

  it("models illustrative RMD on qualified premium when client is 73+", () => {
    const ws = emptyFiaWorksheet();
    ws.contractCapRatePct = "10";
    ws.premiumSource = "qualified";
    ws.registrationPremiumOverride = "500000";
    const rows = buildFiaScenarioSummaries(ws, 500_000, 73);
    expect(rows[0]!.totalRmdDuringWindow).toBeGreaterThan(0);
    expect(rows[0]!.rows[0]!.rmdWithdrawal).toBeGreaterThan(0);
    expect(rows[0]!.rows[0]!.contractAge).toBe(73);
  });

  it("does not model RMD for non-qualified premium", () => {
    const ws = emptyFiaWorksheet();
    ws.contractCapRatePct = "10";
    ws.premiumSource = "non_qualified";
    ws.registrationPremiumOverride = "500000";
    const rows = buildFiaScenarioSummaries(ws, 500_000, 75);
    expect(rows[0]!.totalRmdDuringWindow).toBe(0);
    expect(rows[0]!.rows.every((r) => r.rmdWithdrawal === 0)).toBe(true);
  });

  const tenYears = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;

  it("applies income base bonus on premium at issue only", () => {
    const sim = simulateFiaTenYearWindow(tenYears, {
      premium: 100_000,
      capPct: 10,
      premiumBonusPct: 0,
      trailingBonusPct: 0,
      trailBonusYears: 0,
      hasRider: true,
      incomeBaseBonusPct: 20,
      riderGuaranteePct: 0,
      contractEarningsAddToRider: false,
      riderFeePct: 0,
      rmdClientStartingAge: null,
    });
    expect(sim.rows[0]!.startingContractValue).toBe(100_000);
    expect(sim.rows[0]!.riderBenefitBase).toBe(120_000);
  });

  it("keeps contract premium bonus and income base bonus independent", () => {
    const sim = simulateFiaTenYearWindow(tenYears, {
      premium: 100_000,
      capPct: 10,
      premiumBonusPct: 10,
      trailingBonusPct: 0,
      trailBonusYears: 0,
      hasRider: true,
      incomeBaseBonusPct: 20,
      riderGuaranteePct: 0,
      contractEarningsAddToRider: false,
      riderFeePct: 0,
      rmdClientStartingAge: null,
    });
    expect(sim.rows[0]!.startingContractValue).toBeCloseTo(110_000, 0);
    expect(sim.rows[0]!.riderBenefitBase).toBe(120_000);
  });

  it("falls back to contract after premium bonus when income base bonus is blank", () => {
    const sim = simulateFiaTenYearWindow(tenYears, {
      premium: 100_000,
      capPct: 10,
      premiumBonusPct: 10,
      trailingBonusPct: 0,
      trailBonusYears: 0,
      hasRider: true,
      incomeBaseBonusPct: 0,
      riderGuaranteePct: 0,
      contractEarningsAddToRider: false,
      riderFeePct: 0,
      rmdClientStartingAge: null,
    });
    expect(sim.rows[0]!.startingContractValue).toBeCloseTo(110_000, 0);
    expect(sim.rows[0]!.riderBenefitBase).toBeCloseTo(110_000, 0);
  });
});
