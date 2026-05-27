/**
 * Embeds hypothetical FIA + Roth illustration pages into the portfolio Client Snapshot /
 * Advisor Deep Dive PDF (same document flow, before Disclosures). Disclosure text is returned
 * for merging into the report's Disclosures section.
 */

import type { PDFPage, PDFFont } from "pdf-lib";
import { rgb } from "pdf-lib";
import type { RothConversionModelResult } from "@/lib/roth-conversion-analysis";
import { ROTH_ASSUMPTION_VERSION } from "@/lib/roth-conversion-analysis";
import { buildFiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import {
  buildFiaScenarioSummaries,
  formatFiaYearWindowLabel,
  pickMostRecentFiaScenario,
} from "@/lib/fia-illustration";
import { fiaInputValue, normalizeFiaWorksheet, parsePct } from "@/lib/fia-worksheet";
import { buildRothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import { appendFiaComparisonGraphicsPdf } from "@/lib/report-pdf/fia-comparison-graphics-pdf";
import {
  drawTitledTableAtomic,
  startDedicatedPage,
  type ComparisonGraphicsLayout,
} from "@/lib/report-pdf/comparison-graphics-primitives";
import { appendRothComparisonGraphicsPdf } from "@/lib/report-pdf/roth-comparison-graphics-pdf";
import { colors as reportColors } from "@/lib/report-pdf/theme";

const rothTheme = {
  navy: reportColors.navy,
  navyLight: reportColors.navy,
  ink: reportColors.ink,
  muted: reportColors.muted,
  rule: reportColors.rule,
  ruleStrong: reportColors.rule,
  surface: reportColors.tableZebra,
  pageBg: reportColors.pageBg,
  tableHeadText: reportColors.tableHeadText,
  stayBar: reportColors.accent,
  stayBarSoft: reportColors.synopsisBg,
  scoreRed: reportColors.scoreRed,
  rothBar: reportColors.accent,
  rothBarSoft: reportColors.synopsisBg,
};

const FIA_GRAPHICS_DISCLOSURE =
  "The FIA comparison graphics show an illustrative side-by-side view of contract value versus a fully exposed S&P 500 path using the same premium, illustrative RMD withdrawals, and calendar years from the most recent decade window only. The S&P path is hypothetical and is not an investable product or a carrier illustration.";

const FIA_GRAPHICS_DISCLOSURE_2 =
  "Stacked-bar and protection visuals summarize credited interest, illustrative RMDs, and 0% floor / cap behavior in down and up years. They are illustrative summaries only and are not predictive of future crediting, carrier pricing, or market results.";

const ROTH_GRAPHICS_DISCLOSURE =
  "The Roth comparison graphics summarize modeled lifetime wealth, allocation among income you keep, legacy to heirs, and taxes plus IRMAA, plus a bracket-fill strategy view. Legacy to heirs equals ending balance; estate and gift taxes are not modeled.";

const ROTH_GRAPHICS_DISCLOSURE_2 =
  "Bracket zone and effective tax plus IRMAA rate visuals rely on simplifying assumptions. They are not tax, legal, investment, or Medicare advice and should be confirmed with qualified professionals before any transaction.";

const ROTH_REPORT_SCOPE_DISCLOSURE =
  "This report compares an illustrative current-allocation path with a modeled Roth conversion path. Assumptions, inputs, and limitations for that illustration are included in Disclosures below.";

const ROTH_LIMITATIONS_PARA =
  "Hypothetical illustration only: not tax, legal, investment, or Medicare advice. Actual outcomes depend on statutes, filings, withholding, Roth basis rules, beneficiary designations, enrollment timing for Medicare-related surcharges, and market results. Confirm all material facts with counsel and an independent CPA prior to recommending or executing transactions.";

export type ReportDisclosureChunk = { title: string; paragraphs: string[] };

export type PortfolioIllustrationLayout = {
  getPage: () => PDFPage;
  setPage: (p: PDFPage) => void;
  getY: () => number;
  setY: (v: number) => void;
  addContinuationPage: () => void;
  margin: number;
  contentW: number;
  footerSafeY: number;
  regular: PDFFont;
  bold: PDFFont;
  navyLight: ReturnType<typeof rgb>;
  stayBar: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
  rule: ReturnType<typeof rgb>;
  surface: ReturnType<typeof rgb>;
  ink: ReturnType<typeof rgb>;
  pageBg?: ReturnType<typeof rgb>;
  tableHeadText?: ReturnType<typeof rgb>;
  mono?: PDFFont;
  monoMedium?: PDFFont;
  serif?: PDFFont;
};

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function money(n: number) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })
  );
}

function wrapPlainText(lineMeasurer: (s: string) => number, text: string, size: number, maxW: number): string[] {
  const words = cleanText(text).split(" ");
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (lineMeasurer(trial) > maxW) {
      if (line) out.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) out.push(line);
  return out;
}

function asGraphicsLayout(L: PortfolioIllustrationLayout): ComparisonGraphicsLayout {
  return {
    ...L,
    pageBg: L.pageBg ?? rothTheme.pageBg,
    accent: L.stayBar,
    monoMedium: L.monoMedium,
  };
}

function drawRothTableInlay(
  L: PortfolioIllustrationLayout,
  title: string,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): void {
  drawTitledTableAtomic(asGraphicsLayout(L), title, rothTheme.navy, headers, rows, colWidths, { boldTotalRow: true });
}

/** Roth comparison figures + stay/roth tables only (no separate Roth disclosures page). */
export function appendRothIllustrationFiguresAndTables(
  L: PortfolioIllustrationLayout,
  model: RothConversionModelResult,
  clientName?: string,
  rothExhibitNumber?: number,
): void {
  L.setY(L.getY() - 8);

  const visualData = buildRothComparisonVisualData(model);
  appendRothComparisonGraphicsPdf(asGraphicsLayout(L), visualData, clientName, rothExhibitNumber);

  startDedicatedPage(asGraphicsLayout(L));

  const stayEndBal =
    model.stayTraditional.length > 0 ? model.stayTraditional[model.stayTraditional.length - 1]!.endBalance : 0;
  const stayIncomeColumnSum = model.stayTraditional.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);
  const rothIncomeColumnSum = model.rothConversion.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);

  const stayHeaders = ["Yr", "Age", "IRA balance", "Income", "Illust. tax", "End bal", "RMD", "IRMAA"];
  const stayW = [26, 30, 56, 52, 58, 58, 52, 50];
  const stayBody = model.stayTraditional.map((r) => [
    String(r.calendarYearOffset),
    String(r.age),
    money(r.yearStartBalance),
    money(r.reportIncomeAnnual),
    money(r.illustrativeFederalTax),
    money(r.endBalance),
    money(r.rmd),
    money(r.irmaaSurchargeAnnual),
  ]);
  const stayFooter: string[] = [
    "Total",
    "",
    "",
    money(stayIncomeColumnSum),
    money(model.stayTraditionalTotals.totalTaxAttributableToRmds),
    money(stayEndBal),
    money(model.stayTraditionalTotals.totalRmdWithdrawals),
    money(model.stayTraditionalTotals.totalIrmaaPaid),
  ];

  const rothHeaders = ["Yr", "Age", "Taxable IRA", "Income", "Gross conv", "Tax", "Net conv", "Total Roth", "RMD", "IRMAA"];
  const rothW = [20, 24, 48, 44, 44, 40, 44, 50, 40, 48];
  const rothBody = model.rothConversion.map((r) => [
    String(r.sequence),
    String(r.age),
    r.rothOnlyPhase ? money(0) : money(r.yearStartTraditional),
    money(r.reportIncomeAnnual),
    r.rothOnlyPhase ? money(0) : money(r.grossConversion),
    r.rothOnlyPhase ? money(0) : money(r.illustrativeTaxOnConversion),
    r.rothOnlyPhase ? money(0) : money(r.netConversionToRoth),
    money(r.totalRothBalance),
    r.rothOnlyPhase ? money(0) : money(r.rmdTraditional),
    r.rothOnlyPhase ? money(0) : money(r.irmaaSurchargeAnnual),
  ]);
  const rothFooter: string[] = [
    "Total",
    "",
    "",
    money(rothIncomeColumnSum),
    money(model.rothConversionTotals.totalGrossConversion),
    money(model.rothConversionTotals.totalConversionTaxPaid),
    money(model.rothConversionTotals.totalNetConversionToRoth),
    money(model.rothConversionTotals.endingTotalRothBalance),
    money(model.rothConversionTotals.totalRmdTraditional),
    money(model.rothConversionTotals.totalIrmaaPaid),
  ];

  drawRothTableInlay(
    L,
    "Current allocation path — 10% annual growth with RMDs from age 73",
    stayHeaders,
    [...stayBody, stayFooter],
    stayW,
  );

  drawRothTableInlay(L, "Roth conversion path", rothHeaders, [...rothBody, rothFooter], rothW);
}

export function getRothDisclosureChunksForPortfolio(model: RothConversionModelResult, need: number): ReportDisclosureChunk[] {
  const chunks: ReportDisclosureChunk[] = [
    {
      title: "Roth comparison graphics (illustrative)",
      paragraphs: [
        "Illustrative stay vs. conversion paths; assumptions, inputs, and limitations for that illustration are included in this Disclosures section.",
        "Illustrative comparison only — not tax, Medicare, or investment advice. Legacy to heirs uses ending balance; estate and gift taxes are not modeled.",
        "Lifetime wealth graphics compare ending after-tax wealth under the modeled stay-traditional path versus the Roth conversion path at the end of the illustrated horizon; whether the Roth path leaves more or less wealth depends on your inputs.",
        ROTH_GRAPHICS_DISCLOSURE,
        ROTH_GRAPHICS_DISCLOSURE_2,
      ],
    },
    {
      title: "Roth conversion illustration (scope)",
      paragraphs: [ROTH_REPORT_SCOPE_DISCLOSURE],
    },
    {
      title: "Roth path qualifiers (table assumptions)",
      paragraphs: [model.rothGrowthAssumptionLabel],
    },
    {
      title: "Roth modeling assumptions and inputs",
      paragraphs: [
        ...model.assumptions,
        `Assumption version: ${ROTH_ASSUMPTION_VERSION}. Federal marginal band used as conversion ceiling (illustration): ${model.federalBracketId}%  •  Ordinary tax modeled with progressive ${model.marriedFilingJointly ? "MFJ" : "single"} brackets and standard deduction ${money(model.standardDeductionAnnual)}.  Retirement cash need from intake (Q5): ${money(need)}/year.  Report table Income column: AGI-only before intake retirement age; retirement income goal only once retirement age begins.${
          model.annualAgiPreRetirementIllustration > 0
            ? ` Illustrated AGI from intake: ${money(model.annualAgiPreRetirementIllustration)}/year (also used in tax and conversion headroom before retirement, often stacked with spendable need for bracket math).`
            : ""
        }${model.annualSocialSecurityGross > 0 ? ` Gross Social Security (Q6): about ${money(model.annualSocialSecurityGross)}/year; remaining need illustrated from qualified IRA while converting.` : ""}`,
      ],
    },
    {
      title: "Roth illustration limitations",
      paragraphs: [ROTH_LIMITATIONS_PARA],
    },
  ];
  return chunks;
}

export function getFiaDisclosureChunksForPortfolio(opts?: { productLine?: string }): ReportDisclosureChunk[] {
  const comparisonParas = [
    "Advisor-entered terms; illustrative only, not a carrier illustration.",
    "Advisor-entered terms; index history matches firm S&P 500 calendar-year calibration. Down years credit 0%; up years credit the lesser of index return and cap. Illustrative only — not a carrier illustration.",
    "The comparison graphics use firm S&P 500 calendar-year calibration; the FIA path applies your entered cap, floor, bonus, and rider rules. The hypothetical S&P 500 path is fully exposed to each year's index return.",
    "The ending-value graphic uses the same calendar years, same starting premium, and the same illustrative RMD withdrawals for both paths.",
    FIA_GRAPHICS_DISCLOSURE,
    FIA_GRAPHICS_DISCLOSURE_2,
  ];
  if (opts?.productLine) {
    comparisonParas.splice(2, 0, `Product illustrated: ${opts.productLine}.`);
  }
  return [
    {
      title: "FIA comparison graphics (illustrative)",
      paragraphs: comparisonParas,
    },
    {
      title: "Hypothetical FIA calculator (illustrative)",
      paragraphs: [
        "The FIA exhibit uses advisor-entered contract terms and firm S&P 500 calendar-year calibration. Down years credit 0%; up years credit the lesser of index return and cap. It is not a carrier illustration and does not reflect all product charges, participation rates, spreads, or crediting methods.",
        "Hypothetical only. Confirm any recommendation with carrier materials, your firm, and a licensed professional.",
      ],
    },
  ];
}

function drawFiaTableInlay(
  L: PortfolioIllustrationLayout,
  title: string,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): void {
  drawTitledTableAtomic(asGraphicsLayout(L), title, L.navyLight, headers, rows, colWidths);
}

/** FIA comparison graphics (most recent window) + summary and year-by-year tables for all windows. */
export function appendFiaIllustrationFiguresAndTables(
  L: PortfolioIllustrationLayout,
  input: {
    fiaWorksheet: unknown;
    fiaPremiumDefault: number;
    fiaClientAgeForIllustration: number | null;
  }
): boolean {
  const ws = normalizeFiaWorksheet(input.fiaWorksheet);
  const premium = Math.max(0, Number(input.fiaPremiumDefault) || 0);
  const capRaw = fiaInputValue(ws.contractCapRatePct).trim();
  if (premium <= 0 || !capRaw) return false;

  const summaries = buildFiaScenarioSummaries(ws, premium, input.fiaClientAgeForIllustration);
  if (summaries.length === 0) return false;

  const scenario = pickMostRecentFiaScenario(summaries);
  if (!scenario) return false;

  const showRmd = summaries.some((s) => s.totalRmdDuringWindow > 0.5);
  const showRider = ws.hasIncomeRider === true;
  const capPct = parsePct(fiaInputValue(ws.contractCapRatePct)) ?? 0;
  const windowLabel = formatFiaYearWindowLabel(scenario.years[0], scenario.years[9]);
  const visualData = buildFiaScenarioVisualData(scenario.rows, {
    capPct,
    windowLabel,
    tabLabel: scenario.tabLabel,
    showRider,
  });
  if (!visualData) return false;

  appendFiaComparisonGraphicsPdf(asGraphicsLayout(L), visualData, showRider);

  startDedicatedPage(asGraphicsLayout(L));

  const sumHeaders = ["Window", "Hypo. annual credited", "Ending value"];
  const sumW = [200, 120, 120];
  if (showRmd) {
    sumHeaders.push("Total RMD (10 yr)");
    sumW.push(104);
  }
  if (showRider) {
    sumHeaders.push("Rider base (end)");
    sumW.push(104);
  }
  const sumRows = summaries.map((s) => {
    const row = [
      s.label,
      Number.isFinite(s.annualizedCreditedReturnPct) ? `${s.annualizedCreditedReturnPct.toFixed(2)}%` : "—",
      money(s.endingContractValue),
    ];
    if (showRmd) row.push(money(s.totalRmdDuringWindow));
    if (showRider) row.push(money(s.endingRiderBenefitBase));
    return row;
  });
  drawFiaTableInlay(L, "Hypothetical annualized credited return by window", sumHeaders, sumRows, sumW);

  for (const s of summaries) {
    const yHeaders = ["Year", "S&P %", "Credited %", "Start", "Interest", "End"];
    const yW = [44, 44, 52, 72, 72, 72];
    if (showRmd) {
      yHeaders.splice(1, 0, "Age");
      yW.splice(1, 0, 36);
    }
    if (showRider) {
      yHeaders.push("Rider base");
      yW.push(72);
    }
    const yRows = s.rows.map((r) => {
      const row: string[] = [
        String(r.year),
        `${r.sp500TotalReturnPct.toFixed(2)}%`,
        `${r.creditedRatePct.toFixed(2)}%`,
        money(r.startingContractValue),
        money(r.interestCredit),
        money(r.endingContractValue),
      ];
      if (showRmd) row.splice(1, 0, r.contractAge != null ? String(r.contractAge) : "—");
      if (showRider) row.push(money(r.riderBenefitBase));
      return row;
    });
    drawFiaTableInlay(
      L,
      `Year-by-year path — ${s.tabLabel} (${formatFiaYearWindowLabel(s.years[0], s.years[9])})`,
      yHeaders,
      yRows,
      yW,
    );
  }

  return true;
}
