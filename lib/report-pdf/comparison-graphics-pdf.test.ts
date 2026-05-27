import { describe, expect, it, vi } from "vitest";
import { buildFiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import {
  buildFiaScenarioSummaries,
  FIA_MOST_RECENT_SCENARIO_ID,
  pickMostRecentFiaScenario,
  simulateFiaTenYearWindow,
} from "@/lib/fia-illustration";
import { buildRothConversionModel } from "@/lib/roth-conversion-analysis";
import { buildRothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import { normalizeFiaWorksheet } from "@/lib/fia-worksheet";
import {
  availableHeight,
  centerBlockOnPage,
  ensureDedicatedPage,
  estimateTableHeight,
  EXHIBIT_PAGE_CAPACITY,
  pickTableSizing,
  type ComparisonGraphicsLayout,
} from "@/lib/report-pdf/comparison-graphics-primitives";
import { appendRothComparisonGraphicsPdf } from "@/lib/report-pdf/roth-comparison-graphics-pdf";
import {
  getFiaDisclosureChunksForPortfolio,
  getRothDisclosureChunksForPortfolio,
} from "@/lib/portfolio-illustration-inlays";
import { colors as reportColors } from "@/lib/report-pdf/theme";

function mockLayout(overrides?: Partial<{ y: number }>): ComparisonGraphicsLayout & {
  getPageCount: () => number;
} {
  let y = overrides?.y ?? 700;
  let pageCount = 1;
  const page = {
    drawText: vi.fn(),
    drawRectangle: vi.fn(),
    drawLine: vi.fn(),
  };
  const font = {
    widthOfTextAtSize: (s: string) => s.length * 4,
  };
  return {
    getPageCount: () => pageCount,
    getPage: () => page as never,
    setPage: () => {},
    getY: () => y,
    setY: (v: number) => {
      y = v;
    },
    addContinuationPage: () => {
      pageCount += 1;
      y = 700;
    },
    margin: 52,
    contentW: 508,
    footerSafeY: 74,
    regular: font as never,
    bold: font as never,
    muted: reportColors.muted,
    ink: reportColors.ink,
    rule: reportColors.rule,
    surface: reportColors.tableZebra,
    pageBg: reportColors.pageBg,
    navyLight: reportColors.navy,
  };
}

describe("comparison-graphics-pdf helpers", () => {
  it("pickMostRecentFiaScenario returns only the most recent window", () => {
    const ws = normalizeFiaWorksheet({ contractCapRatePct: "10" });
    const summaries = buildFiaScenarioSummaries(ws, 100_000, null);
    expect(summaries.length).toBe(3);
    const picked = pickMostRecentFiaScenario(summaries);
    expect(picked?.scenarioId).toBe(FIA_MOST_RECENT_SCENARIO_ID);
    expect(picked?.tabLabel).toBe("Most recent");
  });

  it("buildFiaScenarioVisualData matches ending values for most recent rows", () => {
    const rows = simulateFiaTenYearWindow(
      [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
      {
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
      },
    ).rows;
    const data = buildFiaScenarioVisualData(rows, {
      capPct: 10,
      windowLabel: "2016–2025",
      tabLabel: "Most recent",
      showRider: false,
    });
    expect(data?.endingFia).toBe(rows.at(-1)!.endingContractValue);
    expect(data?.downYearCount).toBeGreaterThan(0);
  });

  it("buildRothComparisonVisualData aligns with model totals", () => {
    const model = buildRothConversionModel({
      totalAccountValue: 500_000,
      currentAge: 65,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 80_000,
      annualSocialSecurityGross: 30_000,
      federalTaxBracketId: "35",
      marriedFilingJointly: true,
      annualAdjustedGrossIncomePreRetirement: 200_000,
      retirementIncomeFromConversionAccount: true,
    });
    const data = buildRothComparisonVisualData(model);
    expect(data.rothEndingWealth).toBe(model.rothConversionTotals.endingTotalRothBalance);
    expect(data.wealthDelta).toBe(data.rothEndingWealth - data.stayEndingWealth);
  });

  it("ensureDedicatedPage starts a new page when block does not fit", () => {
    const L = mockLayout({ y: 120 });
    expect(availableHeight(L)).toBe(46);
    ensureDedicatedPage(L, 200);
    expect(L.getPageCount()).toBe(2);
    expect(L.getY()).toBe(700);
  });

  it("pickTableSizing uses compact mode for long Roth tables", () => {
    const sizing = pickTableSizing(32);
    expect(estimateTableHeight(32, sizing)).toBeLessThanOrEqual(EXHIBIT_PAGE_CAPACITY);
  });

  it("centerBlockOnPage shifts Y down when block is shorter than the page", () => {
    const L = mockLayout({ y: 680 });
    centerBlockOnPage(L, 200, { contentTopY: 680, contentBottomY: 74 });
    expect(L.getY()).toBe(680 - (680 - 74 - 200) / 2);
  });

  it("appendRothComparisonGraphicsPdf starts bracket strategy on a second page", () => {
    const model = buildRothConversionModel({
      totalAccountValue: 500_000,
      currentAge: 65,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 80_000,
      annualSocialSecurityGross: 30_000,
      federalTaxBracketId: "35",
      marriedFilingJointly: true,
      annualAdjustedGrossIncomePreRetirement: 200_000,
      retirementIncomeFromConversionAccount: true,
    });
    const L = mockLayout({ y: 650 });
    appendRothComparisonGraphicsPdf(L, buildRothComparisonVisualData(model), "Jane Doe");
    expect(L.getPageCount()).toBe(2);
  });

  it("disclosure chunks include comparison graphics sections", () => {
    const fiaChunks = getFiaDisclosureChunksForPortfolio();
    expect(fiaChunks.some((c) => c.title.includes("comparison graphics"))).toBe(true);

    const model = buildRothConversionModel({
      totalAccountValue: 400_000,
      currentAge: 62,
      retirementAge: 65,
      retirementSpendableIncomeAnnual: 70_000,
      federalTaxBracketId: "32",
      marriedFilingJointly: false,
      retirementIncomeFromConversionAccount: true,
    });
    const rothChunks = getRothDisclosureChunksForPortfolio(model, 70_000);
    expect(rothChunks.some((c) => c.title.includes("comparison graphics"))).toBe(true);
  });
});
