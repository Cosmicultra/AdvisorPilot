import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { clientDisplayName } from "@/lib/intake-config";
import { buildFiaScenarioSummaries } from "@/lib/fia-illustration";
import { fiaInputValue, normalizeFiaWorksheet } from "@/lib/fia-worksheet";

const navy = rgb(0.03, 0.12, 0.22);
const ink = rgb(0.16, 0.18, 0.2);
const muted = rgb(0.38, 0.4, 0.44);
const ruleStrong = rgb(0.55, 0.58, 0.62);
const surface = rgb(0.97, 0.98, 0.99);
const teal = rgb(0.05, 0.45, 0.42);

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

/**
 * Hypothetical FIA tables for appending to Client Snapshot / Advisor Deep Dive (not a carrier illustration).
 */
export async function buildFiaAppendixPdfBytes(input: {
  client: Record<string, unknown>;
  fiaWorksheet: unknown;
  fiaPremiumDefault: number;
  fiaClientAgeForIllustration: number | null;
}): Promise<Uint8Array> {
  const ws = normalizeFiaWorksheet(input.fiaWorksheet);
  const premium = Math.max(0, Number(input.fiaPremiumDefault) || 0);
  const capRaw = fiaInputValue(ws.contractCapRatePct).trim();
  if (premium <= 0) {
    throw new Error("FIA appendix needs a premium (pick qualified/non-qualified total or custom premium on the FIA calculator).");
  }
  if (!capRaw) {
    throw new Error("FIA appendix needs a contract cap rate % on the FIA calculator.");
  }

  const summaries = buildFiaScenarioSummaries(ws, premium, input.fiaClientAgeForIllustration);
  if (summaries.length === 0) {
    throw new Error("FIA appendix could not run scenarios.");
  }

  const showRmd = summaries.some((s) => s.totalRmdDuringWindow > 0.5);
  const showRider = ws.hasIncomeRider === true;

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]);
  let y = 744;
  const lineH = 11;
  const widthOf = (s: string, size: number) => regular.widthOfTextAtSize(s, size);

  function checkNewPage(minY = 72) {
    if (y < minY) {
      page = pdfDoc.addPage([612, 792]);
      y = 734;
      page.drawRectangle({ x: 0, y: 758, width: 612, height: 1, color: ruleStrong });
    }
  }

  function drawPara(text: string, size = 8, color = ink) {
    const lines = wrapPlainText((t) => widthOf(t, size), text, size, 520);
    for (const line of lines) {
      checkNewPage();
      page.drawText(line, { x: 40, y, size, font: regular, color });
      y -= lineH;
    }
    y -= 4;
  }

  function drawSectionHeading(label: string) {
    checkNewPage(96);
    page.drawRectangle({ x: 36, y: y - 2, width: 3, height: 14, color: teal });
    page.drawText(cleanText(label), { x: 46, y, size: 11, font: bold, color: navy });
    y -= 22;
    page.drawLine({
      start: { x: 36, y: y + 8 },
      end: { x: 576, y: y + 8 },
      thickness: 0.5,
      color: ruleStrong,
    });
    y -= 14;
  }

  function drawTable(headers: string[], rows: string[][], colWidths: number[], fs = 6.6) {
    const x0 = 36;
    const rowHLocal = 10;
    checkNewPage(110);
    const headerBandH = 18;
    const bandBottom = y - headerBandH;
    page.drawRectangle({ x: x0 - 4, y: bandBottom, width: 544, height: headerBandH, color: surface });
    page.drawLine({
      start: { x: x0 - 4, y: bandBottom },
      end: { x: x0 - 4 + 544, y: bandBottom },
      thickness: 0.9,
      color: navy,
    });
    let cx = x0;
    for (let i = 0; i < headers.length; i++) {
      page.drawText(cleanText(headers[i]).slice(0, 36), {
        x: cx + 2,
        y: y - 2,
        size: fs,
        font: bold,
        color: navy,
      });
      cx += colWidths[i]!;
    }
    y -= headerBandH;

    let rIdx = 0;
    for (const row of rows) {
      checkNewPage(86);
      if (rIdx % 2 === 0) {
        page.drawRectangle({ x: x0 - 4, y: y - rowHLocal + 8, width: 544, height: rowHLocal + 1, color: surface });
      }
      cx = x0;
      for (let c = 0; c < row.length; c++) {
        const cell = cleanText(row[c]).slice(0, 44);
        page.drawText(cell, { x: cx + 2, y, size: fs, font: regular, color: ink });
        cx += colWidths[c]!;
      }
      rIdx++;
      y -= rowHLocal;
    }
    y -= 12;
    page.drawLine({
      start: { x: x0, y: y + 6 },
      end: { x: 574, y: y + 6 },
      thickness: 0.6,
      color: ruleStrong,
    });
    y -= 8;
  }

  page.drawRectangle({ x: 0, y: 722, width: 612, height: 70, color: navy });
  page.drawText(cleanText("Appendix | Hypothetical FIA calculator"), {
    x: 40,
    y: 758,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });
  const sub = `${clientDisplayName(input.client as { firstName?: string; lastName?: string }) || "Client"}  |  Premium ${money(premium)}`;
  page.drawText(cleanText(sub), { x: 40, y: 736, size: 9, font: regular, color: rgb(0.82, 0.87, 0.93) });
  y = 698;

  drawPara(
    "Advisor-entered terms; index history matches firm S&P 500 calendar-year calibration. Down years credit 0%; up years credit the lesser of index return and cap. Illustrative only — not a carrier illustration.",
    7.5,
    muted
  );

  const carrier = fiaInputValue(ws.carrierName).trim();
  const product = fiaInputValue(ws.productName).trim();
  if (carrier || product) {
    drawPara(`Product: ${carrier}${carrier && product ? " — " : ""}${product}`, 8, ink);
  }

  drawSectionHeading("Ten-year windows (summary)");

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
  drawTable(sumHeaders, sumRows, sumW);

  for (const s of summaries) {
    drawSectionHeading(`Year-by-year path · ${s.tabLabel}`);
    drawPara(`${s.label} (${s.years[0]}–${s.years[9]})`, 7.5, muted);

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
      if (showRmd) {
        row.splice(1, 0, r.contractAge != null ? String(r.contractAge) : "—");
      }
      if (showRider) row.push(money(r.riderBenefitBase));
      return row;
    });
    drawTable(yHeaders, yRows, yW, 6.4);
  }

  drawSectionHeading("Limitations");
  drawPara(
    "Hypothetical only. Does not reflect carrier charges beyond fields you entered, partial-year resets, participation rates, spreads, or product-specific crediting methods. Confirm with carrier materials and a licensed professional.",
    7.5,
    muted
  );

  return pdfDoc.save();
}
