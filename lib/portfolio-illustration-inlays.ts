/**
 * Embeds hypothetical FIA + Roth illustration pages into the portfolio Client Snapshot /
 * Advisor Deep Dive PDF (same document flow, before Disclosures). Disclosure text is returned
 * for merging into the report's Disclosures section.
 */

import type { PDFPage, PDFFont } from "pdf-lib";
import { rgb } from "pdf-lib";
import type { RothConversionModelResult } from "@/lib/roth-conversion-analysis";
import { ROTH_ASSUMPTION_VERSION } from "@/lib/roth-conversion-analysis";
import { buildFiaScenarioSummaries } from "@/lib/fia-illustration";
import { fiaInputValue, normalizeFiaWorksheet } from "@/lib/fia-worksheet";
const rothTheme = {
  navy: rgb(0.03, 0.12, 0.22),
  navyLight: rgb(0.07, 0.18, 0.32),
  ink: rgb(0.16, 0.18, 0.2),
  muted: rgb(0.38, 0.4, 0.44),
  rule: rgb(0.78, 0.8, 0.84),
  ruleStrong: rgb(0.55, 0.58, 0.62),
  surface: rgb(0.97, 0.98, 0.99),
  stayBar: rgb(0.12, 0.36, 0.55),
  stayBarSoft: rgb(0.75, 0.84, 0.92),
  rothBar: rgb(0.12, 0.52, 0.32),
  rothBarSoft: rgb(0.85, 0.95, 0.88),
};

const PAIRED_BAR_INTRO_TEXT =
  "Paired bars use a common scale within each metric (longer bar equals larger modeled value). This view relies on simplifying assumptions: it is not predictive of actual taxes, Medicare surcharges, or investment returns.";

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
  /** Report palette (navyLight, rule, etc.) */
  navyLight: ReturnType<typeof rgb>;
  stayBar: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
  rule: ReturnType<typeof rgb>;
  surface: ReturnType<typeof rgb>;
  ink: ReturnType<typeof rgb>;
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

/** Scale column widths so the table fits the portfolio content area (FIA summary can exceed page width otherwise). */
function scaleColWidthsToTarget(colWidths: number[], targetSum: number): number[] {
  const sum = colWidths.reduce((a, b) => a + b, 0);
  if (sum <= 0 || targetSum <= 0) return colWidths.slice();
  const factor = targetSum / sum;
  return colWidths.map((w) => w * factor);
}

function drawScenarioBarBlockInlay(
  L: PortfolioIllustrationLayout,
  metric: string,
  stayVal: number,
  rothVal: number
): void {
  let page = L.getPage();
  let y = L.getY();
  const regular = L.regular;
  const bold = L.bold;
  const leftPad = L.margin;
  const labelColW = 118;
  const barMaxW = Math.min(230, L.contentW - labelColW - 24);
  const barH = 12;
  const rowGap = 6;
  const blockGap = 22;
  const scaleMax = Math.max(stayVal, rothVal, 1);

  const ensureY = (minY: number) => {
    if (y < minY) {
      L.addContinuationPage();
      y = L.getY();
      page = L.getPage();
    }
  };

  ensureY(L.footerSafeY + 160);
  page.drawText(cleanText(metric), {
    x: leftPad,
    y,
    size: 8.5,
    font: bold,
    color: rothTheme.ink,
  });
  y -= 16;

  const drawPair = (subtitle: string, val: number, fill: ReturnType<typeof rgb>, track: ReturnType<typeof rgb>) => {
    ensureY(L.footerSafeY + 80);
    page = L.getPage();
    page.drawText(cleanText(subtitle), {
      x: leftPad + 4,
      y,
      size: 6.8,
      font: regular,
      color: rothTheme.muted,
    });
    y -= rowGap + 2;
    const trackX = leftPad + labelColW;
    const wBar = Math.max(2, (val / scaleMax) * barMaxW);
    const barBottomY = y - barH + 2;
    page.drawRectangle({
      x: trackX,
      y: barBottomY,
      width: barMaxW,
      height: barH,
      color: track,
    });
    page.drawRectangle({ x: trackX, y: barBottomY, width: wBar, height: barH, color: fill });
    const valTxt = cleanText(money(val));
    page.drawText(valTxt, {
      x: trackX + barMaxW + 10,
      y: barBottomY + 3,
      size: 8,
      font: bold,
      color: rothTheme.ink,
    });
    y -= barH + rowGap + 10;
  };

  drawPair("Current allocation path", stayVal, rothTheme.stayBar, rothTheme.stayBarSoft);
  drawPair("Roth conversion path", rothVal, rothTheme.rothBar, rothTheme.rothBarSoft);
  y -= blockGap - 8;
  L.setY(y);
}

function drawRothTableInlay(
  L: PortfolioIllustrationLayout,
  headers: string[],
  rows: string[][],
  colWidths: number[]
): void {
  const fs = 6.95;
  const rowHLocal = 10.5;
  const x0 = L.margin;
  /** Must use local y for breaks: L.getY() is not updated between rows during this loop. */
  const ensureRoom = (minY: number) => {
    if (y < minY) {
      L.addContinuationPage();
      page = L.getPage();
      y = L.getY();
    }
  };

  const targetInner = Math.max(200, L.contentW - 8);
  const scaledWidths = scaleColWidthsToTarget(colWidths, targetInner);
  const tableW = scaledWidths.reduce((a, b) => a + b, 0) + 8;

  let page = L.getPage();
  let y = L.getY();
  ensureRoom(L.footerSafeY + 110);

  const headerBandH = 20;
  const bandBottom = y - headerBandH;
  page.drawRectangle({ x: x0 - 4, y: bandBottom, width: tableW, height: headerBandH, color: rothTheme.surface });
  page.drawLine({
    start: { x: x0 - 4, y: bandBottom },
    end: { x: x0 - 4 + tableW, y: bandBottom },
    thickness: 0.9,
    color: rothTheme.navy,
  });
  let cx = x0;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(cleanText(headers[i]).slice(0, 40), {
      x: cx + 2,
      y: y - 3,
      size: fs,
      font: L.bold,
      color: rothTheme.navy,
    });
    cx += scaledWidths[i]!;
  }
  y -= headerBandH;

  let rIdx = 0;
  for (const row of rows) {
    ensureRoom(L.footerSafeY + 86);
    if (rIdx % 2 === 0 && !row.includes("Total")) {
      page.drawRectangle({ x: x0 - 4, y: y - rowHLocal + 9, width: tableW, height: rowHLocal + 1, color: rothTheme.surface });
    }
    cx = x0;
    const isTotal = row.includes("Total");
    for (let c = 0; c < row.length; c++) {
      const cell = cleanText(row[c]).slice(0, 48);
      page.drawText(cell, {
        x: cx + 2,
        y,
        size: fs,
        font: isTotal ? L.bold : L.regular,
        color: isTotal ? rothTheme.navy : rothTheme.ink,
      });
      cx += scaledWidths[c]!;
    }
    rIdx++;
    y -= rowHLocal;
  }
  y -= 14;
  page.drawLine({
    start: { x: x0, y: y + 6 },
    end: { x: x0 + tableW - 8, y: y + 6 },
    thickness: 0.6,
    color: rothTheme.ruleStrong,
  });
  y -= 8;
  L.setY(y);
}

/** Roth comparison figures + stay/roth tables only (no separate Roth disclosures page). */
export function appendRothIllustrationFiguresAndTables(
  L: PortfolioIllustrationLayout,
  model: RothConversionModelResult
): void {
  const regular = L.regular;
  const bold = L.bold;
  const lineH = 11;
  const widthOf = (s: string, size: number) => regular.widthOfTextAtSize(s, size);
  const left = L.margin;
  const wrapW = L.contentW;

  const drawPara = (text: string, size = 8, color = rothTheme.ink) => {
    const lines = wrapPlainText((t) => widthOf(t, size), text, size, wrapW);
    for (const line of lines) {
      if (L.getY() < L.footerSafeY + 40) L.addContinuationPage();
      L.getPage().drawText(line, { x: left, y: L.getY(), size, font: regular, color });
      L.setY(L.getY() - lineH);
    }
    L.setY(L.getY() - 4);
  };

  let y = L.getY() - 12;
  L.setY(y);
  if (L.getY() < L.footerSafeY + 160) L.addContinuationPage();

  L.getPage().drawText(cleanText("FIGURE  |  Scenario comparison"), {
    x: left,
    y: L.getY(),
    size: 7,
    font: regular,
    color: rothTheme.muted,
  });
  L.setY(L.getY() - 14);
  if (L.getY() < L.footerSafeY + 120) L.addContinuationPage();
  L.getPage().drawText(cleanText("Comparative differences between pathways"), {
    x: left,
    y: L.getY(),
    size: 16,
    font: bold,
    color: rothTheme.navy,
  });
  L.setY(L.getY() - 24);
  for (const ln of wrapPlainText((t) => regular.widthOfTextAtSize(t, 7.25), PAIRED_BAR_INTRO_TEXT, 7.25, wrapW)) {
    if (L.getY() < L.footerSafeY + 40) L.addContinuationPage();
    L.getPage().drawText(ln, { x: left, y: L.getY(), size: 7.25, font: regular, color: rothTheme.muted });
    L.setY(L.getY() - 10);
  }
  L.setY(L.getY() - 8);

  const stayFedTaxLifetime = model.stayTraditional.reduce((sum, row) => sum + row.illustrativeFederalTax, 0);
  const stayEndBal =
    model.stayTraditional.length > 0 ? model.stayTraditional[model.stayTraditional.length - 1]!.endBalance : 0;
  const stayIncomeColumnSum = model.stayTraditional.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);
  const rothIncomeColumnSum = model.rothConversion.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);

  drawScenarioBarBlockInlay(
    L,
    "Federal income tax modeled (lifetime sum of illustration estimates)",
    stayFedTaxLifetime,
    model.rothConversionTotals.totalConversionTaxPaid
  );
  drawScenarioBarBlockInlay(
    L,
    "Medicare IRMAA surcharges (illustrative, lifetime)",
    model.stayTraditionalTotals.totalIrmaaPaid,
    model.rothConversionTotals.totalIrmaaPaid
  );
  drawScenarioBarBlockInlay(
    L,
    "Required minimum distributions withdrawn (lifetime, illustration)",
    model.stayTraditionalTotals.totalRmdWithdrawals,
    model.rothConversionTotals.totalRmdTraditional
  );
  drawScenarioBarBlockInlay(
    L,
    "Ending illustrative balance / Roth bucket",
    stayEndBal,
    model.rothConversionTotals.endingTotalRothBalance
  );

  drawPara(
    "Ending balances are not interchangeable: traditional IRA balance differs from aggregated Roth IRA under the modeled paths.",
    6.75,
    rothTheme.muted
  );

  L.addContinuationPage();
  y = L.getY();
  L.getPage().drawRectangle({ x: L.margin, y: y - 2, width: 3, height: 14, color: rothTheme.stayBar });
  L.getPage().drawText(cleanText("Current allocation  |  10% annual growth with RMDs from age 73"), {
    x: L.margin + 10,
    y,
    size: 11,
    font: bold,
    color: rothTheme.navyLight,
  });
  L.setY(y - 22);
  L.getPage().drawLine({
    start: { x: L.margin, y: L.getY() + 8 },
    end: { x: L.margin + L.contentW, y: L.getY() + 8 },
    thickness: 0.5,
    color: rothTheme.rule,
  });
  L.setY(L.getY() - 14);

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
  drawRothTableInlay(L, stayHeaders, [...stayBody, stayFooter], stayW);

  L.addContinuationPage();
  y = L.getY();
  L.getPage().drawRectangle({ x: L.margin, y: y - 2, width: 3, height: 14, color: rothTheme.stayBar });
  L.getPage().drawText(cleanText("Roth conversion path"), {
    x: L.margin + 10,
    y,
    size: 11,
    font: bold,
    color: rothTheme.navyLight,
  });
  L.setY(y - 22);
  L.getPage().drawLine({
    start: { x: L.margin, y: L.getY() + 8 },
    end: { x: L.margin + L.contentW, y: L.getY() + 8 },
    thickness: 0.5,
    color: rothTheme.rule,
  });
  L.setY(L.getY() - 14);

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
  drawRothTableInlay(L, rothHeaders, [...rothBody, rothFooter], rothW);
}

export function getRothDisclosureChunksForPortfolio(model: RothConversionModelResult, need: number): ReportDisclosureChunk[] {
  const chunks: ReportDisclosureChunk[] = [
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

export function getFiaDisclosureChunksForPortfolio(): ReportDisclosureChunk[] {
  return [
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
  headers: string[],
  rows: string[][],
  colWidths: number[],
  fs = 6.6
): void {
  const x0 = L.margin;
  const rowHLocal = 10;
  const ensureRoom = (minY: number) => {
    if (y < minY) {
      L.addContinuationPage();
      page = L.getPage();
      y = L.getY();
    }
  };

  const targetInner = Math.max(200, L.contentW - 8);
  const scaledWidths = scaleColWidthsToTarget(colWidths, targetInner);
  const tableW = scaledWidths.reduce((a, b) => a + b, 0) + 8;

  let page = L.getPage();
  let y = L.getY();
  ensureRoom(L.footerSafeY + 110);
  const headerBandH = 18;
  const bandBottom = y - headerBandH;
  page.drawRectangle({ x: x0 - 4, y: bandBottom, width: tableW, height: headerBandH, color: L.surface });
  page.drawLine({
    start: { x: x0 - 4, y: bandBottom },
    end: { x: x0 - 4 + tableW, y: bandBottom },
    thickness: 0.9,
    color: L.stayBar,
  });
  let cx = x0;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(cleanText(headers[i]).slice(0, 36), {
      x: cx + 2,
      y: y - 2,
      size: fs,
      font: L.bold,
      color: L.navyLight,
    });
    cx += scaledWidths[i]!;
  }
  y -= headerBandH;

  let rIdx = 0;
  for (const row of rows) {
    ensureRoom(L.footerSafeY + 86);
    if (rIdx % 2 === 0) {
      page.drawRectangle({ x: x0 - 4, y: y - rowHLocal + 8, width: tableW, height: rowHLocal + 1, color: L.surface });
    }
    cx = x0;
    for (let c = 0; c < row.length; c++) {
      page.drawText(cleanText(row[c]).slice(0, 44), { x: cx + 2, y, size: fs, font: L.regular, color: L.ink });
      cx += scaledWidths[c]!;
    }
    rIdx++;
    y -= rowHLocal;
  }
  y -= 12;
  page.drawLine({
    start: { x: x0, y: y + 6 },
    end: { x: x0 + tableW - 8, y: y + 6 },
    thickness: 0.6,
    color: L.rule,
  });
  y -= 8;
  L.setY(y);
}

/** FIA summary + year-by-year tables (no separate FIA disclosures page). */
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

  const showRmd = summaries.some((s) => s.totalRmdDuringWindow > 0.5);
  const showRider = ws.hasIncomeRider === true;

  const regular = L.regular;
  const lineH = 11;
  const left = L.margin;
  const wrapW = L.contentW;
  const widthOf = (s: string, size: number) => regular.widthOfTextAtSize(s, size);

  const drawPara = (text: string, size = 8, color = L.ink) => {
    const lines = wrapPlainText((t) => widthOf(t, size), text, size, wrapW);
    for (const line of lines) {
      if (L.getY() < L.footerSafeY + 36) L.addContinuationPage();
      L.getPage().drawText(line, { x: left, y: L.getY(), size, font: regular, color });
      L.setY(L.getY() - lineH);
    }
    L.setY(L.getY() - 4);
  };

  drawPara(
    "Advisor-entered terms; index history matches firm S&P 500 calendar-year calibration. Down years credit 0%; up years credit the lesser of index return and cap. Illustrative only — not a carrier illustration.",
    7.5,
    L.muted
  );

  const carrier = fiaInputValue(ws.carrierName).trim();
  const product = fiaInputValue(ws.productName).trim();
  if (carrier || product) {
    drawPara(`Product: ${carrier}${carrier && product ? " — " : ""}${product}`, 8, L.ink);
  }

  const summaryHeadY = L.getY();
  L.getPage().drawRectangle({ x: L.margin, y: summaryHeadY - 2, width: 3, height: 14, color: L.stayBar });
  L.getPage().drawText(cleanText("Ten-year windows (summary)"), {
    x: L.margin + 10,
    y: summaryHeadY,
    size: 11,
    font: L.bold,
    color: L.navyLight,
  });
  L.setY(summaryHeadY - 22);
  L.getPage().drawLine({
    start: { x: L.margin, y: L.getY() + 8 },
    end: { x: L.margin + L.contentW, y: L.getY() + 8 },
    thickness: 0.5,
    color: L.rule,
  });
  L.setY(L.getY() - 14);

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
  drawFiaTableInlay(L, sumHeaders, sumRows, sumW);

  for (const s of summaries) {
    if (L.getY() < L.footerSafeY + 100) L.addContinuationPage();
    const pathHeadY = L.getY();
    L.getPage().drawRectangle({ x: L.margin, y: pathHeadY - 2, width: 3, height: 14, color: L.stayBar });
    L.getPage().drawText(cleanText(`Year-by-year path · ${s.tabLabel}`), {
      x: L.margin + 10,
      y: pathHeadY,
      size: 11,
      font: L.bold,
      color: L.navyLight,
    });
    L.setY(pathHeadY - 22);
    L.getPage().drawLine({
      start: { x: L.margin, y: L.getY() + 8 },
      end: { x: L.margin + L.contentW, y: L.getY() + 8 },
      thickness: 0.5,
      color: L.rule,
    });
    L.setY(L.getY() - 14);
    drawPara(`${s.label} (${s.years[0]}–${s.years[9]})`, 7.5, L.muted);

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
    drawFiaTableInlay(L, yHeaders, yRows, yW, 6.4);
  }

  return true;
}
