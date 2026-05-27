import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { clientDisplayName } from "@/lib/intake-config";
import { buildRothConversionModel, ROTH_ASSUMPTION_VERSION, type RothConversionModelResult } from "@/lib/roth-conversion-analysis";
import { annualSocialSecurityGrossForIllustration, parseClientAgeForIllustration, parseSpouseAgeForIllustration } from "@/lib/roth-inputs";
import { federalBracketIdFromWorksheetPct, normalizeRothWorksheet } from "@/lib/roth-worksheet";

/** McKinsey-inspired palette: deep navy, cool neutrals, disciplined accent pair. */
const theme = {
  navy: rgb(0.03, 0.12, 0.22),
  navyLight: rgb(0.07, 0.18, 0.32),
  ink: rgb(0.16, 0.18, 0.2),
  muted: rgb(0.38, 0.4, 0.44),
  rule: rgb(0.78, 0.8, 0.84),
  ruleStrong: rgb(0.55, 0.58, 0.62),
  surface: rgb(0.97, 0.98, 0.99),
  white: rgb(1, 1, 1),
  gold: rgb(0.78, 0.62, 0.28),
  stayBar: rgb(0.12, 0.36, 0.55),
  stayBarSoft: rgb(0.75, 0.84, 0.92),
  /** Roth conversion pathway bars: distinct green vs. blue “stay” bars. */
  rothBar: rgb(0.12, 0.52, 0.32),
  rothBarSoft: rgb(0.85, 0.95, 0.88),
};

const PAIRED_BAR_INTRO_TEXT =
  "Paired bars use a common scale within each metric (longer bar equals larger modeled value). This view relies on simplifying assumptions: it is not predictive of actual taxes, Medicare surcharges, or investment returns.";

const ROTH_REPORT_SCOPE_DISCLOSURE =
  "This report compares an illustrative current-allocation path with a modeled Roth conversion path. Assumptions, inputs, limitations, and other disclosures follow below.";

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

function drawTopAccentLine(pg: PDFPage, y: number, w = 612) {
  pg.drawRectangle({ x: 0, y: y - 3, width: w, height: 3, color: theme.gold });
}

function drawFigureCaption(
  pg: PDFPage,
  x: number,
  y: number,
  caption: string,
  font: PDFFont,
  size = 7
) {
  pg.drawText(cleanText(caption), { x, y, size, font, color: theme.muted });
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

/** Horizontal paired bars per metric: stay vs Roth (values share row scale). */
function drawScenarioBarBlock(
  pg: PDFPage,
  topY: number,
  regular: PDFFont,
  bold: PDFFont,
  metric: string,
  stayVal: number,
  rothVal: number
): number {
  const leftPad = 40;
  const labelColW = 118;
  const barMaxW = 230;
  const barH = 12;
  const rowGap = 6;
  const blockGap = 22;
  const scaleMax = Math.max(stayVal, rothVal, 1);

  let y = topY;

    pg.drawText(cleanText(metric), {
      x: leftPad,
      y,
      size: 8.5,
      font: bold,
      color: theme.ink,
    });
    y -= 16;

  const drawPair = (
    subtitle: string,
    val: number,
    fill: ReturnType<typeof rgb>,
    track: ReturnType<typeof rgb>
  ) => {
    pg.drawText(cleanText(subtitle), {
      x: leftPad + 4,
      y,
      size: 6.8,
      font: regular,
      color: theme.muted,
    });
    y -= rowGap + 2;
    const trackX = leftPad + labelColW;
    const w = Math.max(2, (val / scaleMax) * barMaxW);
    const barBottomY = y - barH + 2;
    pg.drawRectangle({
      x: trackX,
      y: barBottomY,
      width: barMaxW,
      height: barH,
      color: track,
    });
    pg.drawRectangle({ x: trackX, y: barBottomY, width: w, height: barH, color: fill });
    const valTxt = cleanText(money(val));
    pg.drawText(valTxt, {
      x: trackX + barMaxW + 10,
      y: barBottomY + 3,
      size: 8,
      font: bold,
      color: theme.ink,
    });
    y -= barH + rowGap + 10;
  };

  drawPair("Current allocation path", stayVal, theme.stayBar, theme.stayBarSoft);
  drawPair("Roth conversion path", rothVal, theme.rothBar, theme.rothBarSoft);

  y -= blockGap - 8;
  return y;
}

export type RothReportModelBundle = {
  client: Record<string, unknown>;
  model: RothConversionModelResult;
  need: number;
  age: number;
  totalValue: number;
};

/**
 * Validates intake + worksheet and builds the Roth conversion model (shared by standalone Roth PDF
 * and portfolio report inlays).
 * @throws Error with advisor-facing message when inputs are invalid (same rules as /api/generate-roth-report).
 */
export function buildRothReportModelBundle(body: unknown): RothReportModelBundle {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const client = (payload.client && typeof payload.client === "object" ? payload.client : {}) as Record<string, unknown>;
  const rothWorksheet =
    payload.rothWorksheet != null && typeof payload.rothWorksheet === "object"
      ? normalizeRothWorksheet(payload.rothWorksheet)
      : null;

  const totalValue = Number(payload.totalValue);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    throw new Error("totalValue must be a positive number.");
  }

  const age = parseClientAgeForIllustration(client);
  if (age < 60) {
    throw new Error("Roth Option report is only generated for clients age 60 and older.");
  }

  const bracketRaw = String(client.federalTaxBracket || "22").replace(/%/g, "").trim();
  const intakeFederal = ["10", "12", "22", "24", "32", "35", "37"].includes(bracketRaw) ? bracketRaw : "22";
  const worksheetBracketId = rothWorksheet?.fic?.maxTaxRatePct
    ? federalBracketIdFromWorksheetPct(rothWorksheet.fic.maxTaxRatePct)
    : null;
  const federal = worksheetBracketId ?? intakeFederal;

  const retireAge = Math.max(50, Math.floor(Number(client.retirementAge) || 67));
  const incomeRaw = String(client.retirementSpendableIncomeAnnual || "").replace(/[$,]/g, "");
  const need = Math.max(0, Number(incomeRaw) || 0);
  if (need <= 0) {
    throw new Error("Enter annual retirement spendable income on intake to run this Roth illustration.");
  }

  const marriedFilingJointly = Boolean(client.married === true || String(client.married).toLowerCase() === "true");
  const annualSocialSecurityGross = annualSocialSecurityGrossForIllustration(client);

  const agiRaw = String(client.adjustedGrossIncomeAnnual || "").replace(/[$,]/g, "");
  const annualAgi = Math.max(0, Number(agiRaw) || 0);

  const useFixedIndexContract = rothWorksheet?.useFixedIndexContract === true;
  const protectInitialInvestment = Boolean(rothWorksheet?.fic?.protectInitialInvestment);

  if (rothWorksheet === null || rothWorksheet.retirementIncomeFromConversionAccount === null) {
    throw new Error(
      'Answer "Income received from conversion account?" (Yes or No) on the Roth worksheet before generating this report.'
    );
  }

  const model = buildRothConversionModel({
    totalAccountValue: totalValue,
    currentAge: age,
    retirementAge: retireAge,
    retirementSpendableIncomeAnnual: need,
    annualSocialSecurityGross,
    federalTaxBracketId: federal,
    marriedFilingJointly,
    annualAdjustedGrossIncomePreRetirement: annualAgi,
    protectInitialInvestment,
    useFixedIndexContract,
    contractEstimatedRateOfReturnPct: rothWorksheet?.fic?.contractEstimatedRateOfReturnPct || "",
    ficPremiumBonusPct: rothWorksheet?.fic?.premiumBonusPct,
    ficTrailingBonusPct: rothWorksheet?.fic?.trailingBonusPct,
    ficTrailBonusYears: rothWorksheet?.fic?.trailBonusYears,
    ficSurrenderYears: rothWorksheet?.fic?.surrenderYears,
    spouseStartAge: parseSpouseAgeForIllustration(client),
    stateTaxRatePct: rothWorksheet?.fic?.stateTaxPct,
    retirementIncomeFromConversionAccount: rothWorksheet.retirementIncomeFromConversionAccount,
  });

  return { client, model, need, age, totalValue };
}

/**
 * Builds the same Roth Option PDF bytes as the standalone download (graphs, tables, disclosures).
 * @throws Error with advisor-facing message when inputs are invalid (same rules as /api/generate-roth-report).
 */
export async function buildRothReportPdfBytes(body: unknown): Promise<Uint8Array> {
  const { client, model, need, age, totalValue } = buildRothReportModelBundle(body);

    const pdfDoc = await PDFDocument.create();
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    /** Tight typography: Helvetica Neue alternatives need embedded files; Helvetica reads crisp in PDF. */

    let logoImage: PDFImage | null = null;
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png");
      const logoBytes = await fs.readFile(logoPath);
      logoImage = await pdfDoc.embedPng(logoBytes);
    } catch {
      logoImage = null;
    }

    let page = pdfDoc.addPage([612, 792]);
    const lineH = 11;
    let y = 744;

    const widthOf = (s: string, size: number) => regular.widthOfTextAtSize(s, size);

    function checkNewPage(minY = 72) {
      if (y < minY) {
        page = pdfDoc.addPage([612, 792]);
        y = 734;
        drawTopAccentLine(page, 792);
        page.drawRectangle({ x: 0, y: 758, width: 612, height: 1, color: theme.ruleStrong });
      }
    }

    function drawHeader(title: string) {
      page.drawRectangle({ x: 0, y: 722, width: 612, height: 72, color: theme.navy });
      drawTopAccentLine(page, 794);
      page.drawText(cleanText(title), { x: 40, y: 760, size: 20, font: bold, color: theme.white });
      const subName = `${clientDisplayName(client as { firstName?: string; lastName?: string; name?: string }) || "Client"}  |  Age ${age}`;
      page.drawText(cleanText(subName), {
        x: 40,
        y: 740,
        size: 9,
        font: regular,
        color: rgb(0.82, 0.87, 0.93),
      });
      page.drawText(cleanText(`IRA / qualified balance (illustrative): ${money(totalValue)}`), {
        x: 40,
        y: 726,
        size: 8.5,
        font: regular,
        color: rgb(0.7, 0.78, 0.88),
      });
      if (logoImage) {
        page.drawRectangle({
          x: 526,
          y: 735,
          width: 48,
          height: 36,
          color: theme.white,
          opacity: 0.94,
          borderColor: rgb(0.18, 0.36, 0.54),
          borderWidth: 0.6,
        });
        page.drawImage(logoImage, { x: 533, y: 739, width: 34, height: 28 });
      } else {
        page.drawText("AdvisorPilot", { x: 498, y: 742, size: 10, font: bold, color: theme.white });
      }
      y = 698;
    }

    function drawSectionHeading(label: string) {
      checkNewPage(96);
      page.drawRectangle({ x: 36, y: y - 2, width: 3, height: 14, color: theme.stayBar });
      page.drawText(cleanText(label), { x: 46, y, size: 11, font: bold, color: theme.navyLight });
      y -= 22;
      page.drawLine({
        start: { x: 36, y: y + 8 },
        end: { x: 576, y: y + 8 },
        thickness: 0.5,
        color: theme.rule,
      });
      y -= 14;
    }

    function drawPara(text: string, size = 8, color = theme.ink) {
      const maxW = 520;
      const lines = wrapPlainText((t) => widthOf(t, size), text, size, maxW);
      for (const line of lines) {
        checkNewPage();
        page.drawText(line, { x: 40, y, size, font: regular, color });
        y -= lineH;
      }
      y -= 4;
    }

    function drawTable(headers: string[], rows: string[][], colWidths: number[]) {
      const x0 = 36;
      const fs = 6.95;
      const rowHLocal = 10.5;
      checkNewPage(110);
      const headerBandH = 20;
      const bandBottom = y - headerBandH;
      page.drawRectangle({ x: x0 - 4, y: bandBottom, width: 544, height: headerBandH, color: theme.surface });
      page.drawLine({
        start: { x: x0 - 4, y: bandBottom },
        end: { x: x0 - 4 + 544, y: bandBottom },
        thickness: 0.9,
        color: theme.navy,
      });
      let cx = x0;
      for (let i = 0; i < headers.length; i++) {
        page.drawText(cleanText(headers[i]).slice(0, 40), {
          x: cx + 2,
          y: y - 3,
          size: fs,
          font: bold,
          color: theme.navy,
        });
        cx += colWidths[i]!;
      }
      y -= headerBandH;

      let rIdx = 0;
      for (const row of rows) {
        checkNewPage(86);
        if (rIdx % 2 === 0 && !row.includes("Total")) {
          page.drawRectangle({ x: x0 - 4, y: y - rowHLocal + 9, width: 544, height: rowHLocal + 1, color: theme.surface });
        }
        cx = x0;
        const isTotal = row.includes("Total");
        for (let c = 0; c < row.length; c++) {
          const cell = cleanText(row[c]).slice(0, 48);
          const font = isTotal ? bold : regular;
          const colColor = isTotal ? theme.navy : theme.ink;
          page.drawText(cell, { x: cx + 2, y, size: fs, font, color: colColor });
          cx += colWidths[c]!;
        }
        rIdx++;
        y -= rowHLocal;
      }
      y -= 14;
      page.drawLine({
        start: { x: x0, y: y + 6 },
        end: { x: 574, y: y + 6 },
        thickness: 0.6,
        color: theme.ruleStrong,
      });
      y -= 8;
    }

    drawHeader("Roth option  |  Comparative Analysis");

    const stayFedTaxLifetime = model.stayTraditional.reduce((sum, row) => sum + row.illustrativeFederalTax, 0);
    const stayEndBal =
      model.stayTraditional.length > 0
        ? model.stayTraditional[model.stayTraditional.length - 1]!.endBalance
        : 0;
    const stayIncomeColumnSum = model.stayTraditional.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);
    const rothIncomeColumnSum = model.rothConversion.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);

    /** Page 1 (after header): comparison bars. */
    y -= 12;
    checkNewPage(160);
    drawFigureCaption(page, 40, y, "FIGURE  |  Scenario comparison", regular);
    y -= 14;
    page.drawText(cleanText("Comparative differences between pathways"), {
      x: 40,
      y,
      size: 16,
      font: bold,
      color: theme.navy,
    });
    y -= 24;
    for (const ln of wrapPlainText((t) => regular.widthOfTextAtSize(t, 7.25), PAIRED_BAR_INTRO_TEXT, 7.25, 530)) {
      checkNewPage(120);
      page.drawText(ln, { x: 40, y, size: 7.25, font: regular, color: theme.muted });
      y -= 10;
    }
    y -= 8;

    checkNewPage(160);
    y = drawScenarioBarBlock(
      page,
      y,
      regular,
      bold,
      "Federal income tax modeled (lifetime sum of illustration estimates)",
      stayFedTaxLifetime,
      model.rothConversionTotals.totalConversionTaxPaid
    );

    checkNewPage(160);
    y = drawScenarioBarBlock(
      page,
      y,
      regular,
      bold,
      "Medicare IRMAA surcharges (illustrative, lifetime)",
      model.stayTraditionalTotals.totalIrmaaPaid,
      model.rothConversionTotals.totalIrmaaPaid
    );

    checkNewPage(160);
    y = drawScenarioBarBlock(
      page,
      y,
      regular,
      bold,
      "Required minimum distributions withdrawn (lifetime, illustration)",
      model.stayTraditionalTotals.totalRmdWithdrawals,
      model.rothConversionTotals.totalRmdTraditional
    );

    checkNewPage(160);
    y = drawScenarioBarBlock(page, y, regular, bold, "Ending illustrative balance / Roth bucket", stayEndBal, model.rothConversionTotals.endingTotalRothBalance);

    drawPara(
      "Ending balances are not interchangeable: traditional IRA balance differs from aggregated Roth IRA under the modeled paths.",
      6.75,
      theme.muted
    );

    page = pdfDoc.addPage([612, 792]);
    y = 734;
    drawTopAccentLine(page, 792);
    page.drawRectangle({ x: 0, y: 758, width: 612, height: 1, color: theme.ruleStrong });

    drawSectionHeading("Current allocation  |  10% annual growth with RMDs from age 73");

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
    drawTable(stayHeaders, [...stayBody, stayFooter], stayW);

    page = pdfDoc.addPage([612, 792]);
    y = 734;
    drawTopAccentLine(page, 792);
    page.drawRectangle({ x: 0, y: 758, width: 612, height: 1, color: theme.ruleStrong });

    drawSectionHeading("Roth Conversion Path");

    const rothHeaders = [
      "Yr",
      "Age",
      "Taxable IRA",
      "Income",
      "Gross conv",
      "Tax",
      "Net conv",
      "Total Roth",
      "RMD",
      "IRMAA",
    ];
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
    drawTable(rothHeaders, [...rothBody, rothFooter], rothW);

    const disclaimerText =
      "Hypothetical illustration only: not tax, legal, investment, or Medicare advice. Actual outcomes depend on statutes, filings, withholding, Roth basis rules, beneficiary designations, enrollment timing for Medicare-related surcharges, and market results. Confirm all material facts with counsel and an independent CPA prior to recommending or executing transactions.";
    const discSize = 6.85;
    const discLineH = 9;
    const discLines = wrapPlainText((t) => widthOf(t, discSize), disclaimerText, discSize, 534);

    page = pdfDoc.addPage([612, 792]);
    y = 734;
    drawTopAccentLine(page, 792);
    page.drawRectangle({ x: 0, y: 758, width: 612, height: 1, color: theme.ruleStrong });

    page.drawText(cleanText("Disclosures"), { x: 40, y, size: 22, font: bold, color: theme.navy });
    y -= 30;
    page.drawLine({
      start: { x: 36, y: y + 10 },
      end: { x: 576, y: y + 10 },
      thickness: 0.6,
      color: theme.rule,
    });
    y -= 14;

    drawPara(ROTH_REPORT_SCOPE_DISCLOSURE, 8, theme.muted);

    drawSectionHeading("Roth path qualifiers (tables)");
    drawPara(model.rothGrowthAssumptionLabel, 8, theme.muted);

    drawSectionHeading("Assumptions and inputs");
    for (const a of model.assumptions) {
      drawPara(a, 8);
    }
    drawPara(
      `Assumption version: ${ROTH_ASSUMPTION_VERSION}. Federal marginal band used as conversion ceiling (illustration): ${model.federalBracketId}%  •  Ordinary tax modeled with progressive ${model.marriedFilingJointly ? "MFJ" : "single"} brackets and standard deduction ${money(model.standardDeductionAnnual)}.  Retirement cash need from intake (Q5): ${money(need)}/year.  Report table Income column: AGI-only before intake retirement age; retirement income goal only once retirement age begins.${
        model.annualAgiPreRetirementIllustration > 0
          ? ` Illustrated AGI from intake: ${money(model.annualAgiPreRetirementIllustration)}/year (also used in tax and conversion headroom before retirement, often stacked with spendable need for bracket math).`
          : ""
      }${model.annualSocialSecurityGross > 0 ? ` Gross Social Security (Q6): about ${money(model.annualSocialSecurityGross)}/year; remaining need illustrated from qualified IRA while converting.` : ""}`,
      8,
      theme.muted
    );

    drawSectionHeading("Important limitations");
    for (let i = 0; i < discLines.length; i++) {
      checkNewPage(72);
      page.drawText(discLines[i]!, {
        x: 40,
        y,
        size: discSize,
        font: regular,
        color: theme.muted,
      });
      y -= discLineH;
    }

    return pdfDoc.save();
}
