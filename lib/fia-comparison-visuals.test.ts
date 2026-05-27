import { describe, expect, it } from "vitest";
import {
  buildFiaScenarioVisualData,
  hypotheticalSp500EndValues,
  spDownYearLossTotal,
} from "@/lib/fia-comparison-visuals";
import type { FiaYearSimulationRow } from "@/lib/fia-illustration";
import { simulateFiaTenYearWindow } from "@/lib/fia-illustration";

const tenYears = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;

function simRows(over: Partial<Parameters<typeof simulateFiaTenYearWindow>[1]> = {}) {
  return simulateFiaTenYearWindow(tenYears, {
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
    ...over,
  }).rows;
}

describe("fia-comparison-visuals", () => {
  it("buildFiaScenarioVisualData matches table ending values", () => {
    const rows = simRows();
    const data = buildFiaScenarioVisualData(rows, {
      capPct: 10,
      windowLabel: "2016–2025",
      tabLabel: "Most recent",
      showRider: false,
    });
    expect(data).not.toBeNull();
    const spEnds = hypotheticalSp500EndValues(rows);
    expect(data!.endingFia).toBe(rows[rows.length - 1]!.endingContractValue);
    expect(data!.endingSp500).toBe(spEnds[spEnds.length - 1]);
    expect(data!.wealthDelta).toBeCloseTo(data!.endingFia - data!.endingSp500, 0);
  });

  it("counts down years and S&P losses in a down-year window", () => {
    const downYears = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009] as const;
    const rows = simulateFiaTenYearWindow(downYears, {
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
    }).rows;

    const data = buildFiaScenarioVisualData(rows, {
      capPct: 10,
      windowLabel: "2000–2009",
      tabLabel: "Lowest",
      showRider: false,
    });

    expect(data!.downYearCount).toBeGreaterThan(0);
    expect(data!.spDownYearLossTotal).toBeGreaterThan(0);
    expect(data!.spDownYearLossTotal).toBeCloseTo(spDownYearLossTotal(rows), 0);
    expect(data!.worstDownYear).not.toBeNull();
  });

  it("includes ending rider base only when showRider is true", () => {
    const rows = simRows({ hasRider: true, riderGuaranteePct: 4 });
    const withRider = buildFiaScenarioVisualData(rows, {
      capPct: 10,
      windowLabel: "2016–2025",
      tabLabel: "Most recent",
      showRider: true,
    });
    const withoutRider = buildFiaScenarioVisualData(rows, {
      capPct: 10,
      windowLabel: "2016–2025",
      tabLabel: "Most recent",
      showRider: false,
    });

    expect(withRider!.endingRiderBase).toBe(rows[rows.length - 1]!.riderBenefitBase);
    expect(withoutRider!.endingRiderBase).toBeNull();
  });

  it("returns null for empty rows", () => {
    expect(
      buildFiaScenarioVisualData([] as FiaYearSimulationRow[], {
        capPct: 10,
        windowLabel: "—",
        tabLabel: "—",
        showRider: false,
      })
    ).toBeNull();
  });
});
