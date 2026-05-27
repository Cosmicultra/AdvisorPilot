/**
 * Shared pdf-lib helpers for FIA / Roth comparison exhibit graphics.
 */

import type { PDFPage, PDFFont, RGB } from "pdf-lib";
import { rgb } from "pdf-lib";
import { layout as reportLayout, PAGE_H } from "@/lib/report-pdf/theme";

/** Y cursor immediately below the compact illustrative header on a fresh page. */
export const EXHIBIT_CONTENT_TOP_Y = PAGE_H - reportLayout.compactHeaderHeight - reportLayout.bodyPadTop;

/** Usable vertical space on a fresh illustrative exhibit page (below compact header). */
export const EXHIBIT_PAGE_CAPACITY = 792 - reportLayout.compactHeaderHeight - reportLayout.footerSafeY - 20;

export type ComparisonGraphicsLayout = {
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
  muted: RGB;
  ink: RGB;
  rule: RGB;
  surface: RGB;
  pageBg: RGB;
  navyLight: RGB;
  tableHeadText?: RGB;
  mono?: PDFFont;
  monoMedium?: PDFFont;
  serif?: PDFFont;
  /** Accent color for exhibit number label (matches report sectionTitle). */
  accent?: RGB;
};

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

export function cleanPdfText(value: unknown): string {
  return String(value || "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function wrapPlainText(
  lineMeasurer: (s: string) => number,
  text: string,
  _size: number,
  maxW: number,
): string[] {
  const words = cleanPdfText(text).split(" ");
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

export function availableHeight(L: ComparisonGraphicsLayout): number {
  return L.getY() - L.footerSafeY;
}

const NOOP_PDF_PAGE = {
  drawText: () => {},
  drawRectangle: () => {},
  drawLine: () => {},
} as unknown as PDFPage;

/** Layout proxy that advances Y without drawing (for block height measurement). */
export function createMeasuringLayout(L: ComparisonGraphicsLayout): ComparisonGraphicsLayout {
  let y = L.getY();
  return {
    ...L,
    getPage: () => NOOP_PDF_PAGE,
    getY: () => y,
    setY: (v: number) => {
      y = v;
    },
    addContinuationPage: () => {
      y = EXHIBIT_CONTENT_TOP_Y;
    },
  };
}

/** Run a draw routine on a measuring layout and return vertical space consumed (pt). */
export function measureBlockHeight(
  L: ComparisonGraphicsLayout,
  drawFn: (mL: ComparisonGraphicsLayout) => void,
): number {
  const mL = createMeasuringLayout(L);
  const startY = mL.getY();
  drawFn(mL);
  return Math.max(0, startY - mL.getY());
}

/** Exhibit section heading (matches `sectionTitle` in generate-report). Returns height consumed. */
export function drawExhibitSectionTitle(
  L: ComparisonGraphicsLayout,
  exhibitNumber: number,
  title: string,
): number {
  const y0 = L.getY();
  const numLabel = `Exhibit ${exhibitNumber}`;
  const numFont = L.monoMedium ?? L.mono ?? L.bold;
  const titleFont = L.serif ?? L.bold;
  const accent = L.accent ?? L.navyLight;
  const page = L.getPage();

  page.drawText(numLabel, {
    x: L.margin,
    y: y0,
    size: 7.5,
    font: numFont,
    color: accent,
  });
  const numW = numFont.widthOfTextAtSize(numLabel, 7.5);
  const titleText = cleanPdfText(title);
  page.drawText(titleText, {
    x: L.margin + numW + 10,
    y: y0,
    size: 11,
    font: titleFont,
    color: L.navyLight,
  });
  const titleW = titleFont.widthOfTextAtSize(titleText, 11);
  const ruleStart = L.margin + numW + 10 + titleW + 12;
  let y = y0 - 14;
  page.drawLine({
    start: { x: ruleStart, y: y + 4 },
    end: { x: L.margin + L.contentW, y: y + 4 },
    thickness: 0.4,
    color: L.rule,
  });
  y -= 2;
  L.setY(y);
  return y0 - y;
}

/** Shift the layout cursor down so a block of known height sits vertically centered on the page. */
export function centerBlockOnPage(
  L: ComparisonGraphicsLayout,
  blockHeight: number,
  opts?: { contentTopY?: number; contentBottomY?: number },
): void {
  const top = opts?.contentTopY ?? L.getY();
  const bottom = opts?.contentBottomY ?? L.footerSafeY;
  const available = top - bottom;
  if (blockHeight <= 0 || blockHeight >= available - 8) return;
  L.setY(top - (available - blockHeight) / 2);
}

/** Start a fresh page if the entire block cannot fit on the current page. */
export function ensureDedicatedPage(L: ComparisonGraphicsLayout, blockHeight: number): void {
  if (availableHeight(L) < blockHeight) {
    L.addContinuationPage();
  }
}

/** Force the next block onto its own page. */
export function startDedicatedPage(L: ComparisonGraphicsLayout): void {
  L.addContinuationPage();
}

export function estimateTableHeight(rowCount: number, opts?: { rowH?: number; headerH?: number }): number {
  const rowH = opts?.rowH ?? 20;
  const headerH = opts?.headerH ?? 22;
  return headerH + rowCount * rowH + 14;
}

export function pickTableSizing(rowCount: number): { fs: number; rowH: number; headerH: number } {
  const normal = { fs: 6.8, rowH: 20, headerH: 22 };
  const compact = { fs: 6, rowH: 14, headerH: 18 };
  if (estimateTableHeight(rowCount, normal) <= EXHIBIT_PAGE_CAPACITY) return normal;
  if (estimateTableHeight(rowCount, compact) <= EXHIBIT_PAGE_CAPACITY) return compact;
  return compact;
}

function scaleColWidthsToTarget(colWidths: number[], targetSum: number): number[] {
  const sum = colWidths.reduce((a, b) => a + b, 0);
  if (sum <= 0 || targetSum <= 0) return colWidths.slice();
  const factor = targetSum / sum;
  return colWidths.map((w) => w * factor);
}

function drawTableHeaderBand(
  L: ComparisonGraphicsLayout,
  page: PDFPage,
  yTop: number,
  headers: string[],
  scaledWidths: number[],
  tableW: number,
  headerH: number,
  fs: number,
) {
  const x0 = L.margin;
  const bandBottom = yTop - headerH;
  page.drawRectangle({ x: x0, y: bandBottom, width: tableW, height: headerH, color: L.navyLight });
  let cx = x0;
  const headerBaseline = yTop - headerH + 7;
  const headText = L.tableHeadText ?? rgb(1, 1, 1);
  for (let i = 0; i < headers.length; i++) {
    page.drawText(cleanPdfText(headers[i]).toUpperCase().slice(0, 40), {
      x: cx + 8,
      y: headerBaseline,
      size: fs - 0.5,
      font: L.bold,
      color: headText,
    });
    cx += scaledWidths[i]!;
  }
}

/** Draw a full table on one page — never splits rows across pages. Returns false if it cannot fit. */
export function drawPortfolioDataTableAtomic(
  L: ComparisonGraphicsLayout,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  opts?: {
    fs?: number;
    rowH?: number;
    headerH?: number;
    skipPageCheck?: boolean;
    /** Bold the last row when it appears to be a totals row. */
    boldTotalRow?: boolean;
  },
): boolean {
  const fs = opts?.fs ?? 6.8;
  const rowH = opts?.rowH ?? 20;
  const headerH = opts?.headerH ?? 22;
  const totalH = estimateTableHeight(rows.length, { rowH, headerH });

  if (!opts?.skipPageCheck) {
    ensureDedicatedPage(L, totalH);
  }
  if (availableHeight(L) < totalH) {
    L.getPage().drawText(
      "Table too large to display on a single page in this exhibit. See advisor worksheet for full detail.",
      { x: L.margin, y: L.getY(), size: 7.5, font: L.regular, color: L.muted },
    );
    L.setY(L.getY() - 20);
    return false;
  }

  const x0 = L.margin;
  const targetInner = Math.max(200, L.contentW);
  const scaledWidths = scaleColWidthsToTarget(colWidths, targetInner);
  const tableW = scaledWidths.reduce((a, b) => a + b, 0);

  let page = L.getPage();
  let y = L.getY();
  drawTableHeaderBand(L, page, y, headers, scaledWidths, tableW, headerH, fs);
  y -= headerH;

  let rIdx = 0;
  for (const row of rows) {
    const isTotalRow =
      Boolean(opts?.boldTotalRow) && (row[0] === "Total" || row.some((c) => String(c).trim() === "Total"));
    const rowFill = isTotalRow ? L.surface : rIdx % 2 === 0 ? L.surface : L.pageBg;
    const rowBottom = y - rowH;
    page.drawRectangle({ x: x0, y: rowBottom, width: tableW, height: rowH, color: rowFill });
    if (isTotalRow) {
      page.drawLine({
        start: { x: x0, y },
        end: { x: x0 + tableW, y },
        thickness: 0.8,
        color: L.rule,
      });
    }
    let cx = x0;
    const cellBaseline = rowBottom + rowH / 2 - 2;
    for (let c = 0; c < row.length; c++) {
      const cell = cleanPdfText(row[c]).slice(0, 48);
      const useMono = Boolean(L.mono && c > 0);
      page.drawText(cell, {
        x: cx + 8,
        y: cellBaseline,
        size: fs,
        font: isTotalRow ? L.bold : useMono ? L.mono! : L.regular,
        color: isTotalRow ? L.navyLight : L.ink,
      });
      cx += scaledWidths[c]!;
    }
    y = rowBottom;
    rIdx++;
  }

  L.setY(y - 14);
  return true;
}

/** Height reserved for a table section title line plus gap below it. */
export function estimateTableTitleHeight(): number {
  return 26;
}

/** Keep a table title and its table on the same page. */
export function drawTitledTableAtomic(
  L: ComparisonGraphicsLayout,
  title: string,
  titleColor: RGB,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  opts?: { boldTotalRow?: boolean },
): boolean {
  const sizing = pickTableSizing(rows.length);
  const tableH = estimateTableHeight(rows.length, sizing);
  const titleH = estimateTableTitleHeight();
  ensureDedicatedPage(L, titleH + tableH);

  L.getPage().drawText(cleanPdfText(title), {
    x: L.margin,
    y: L.getY(),
    size: 8,
    font: L.bold,
    color: titleColor,
  });
  L.setY(L.getY() - titleH);

  return drawPortfolioDataTableAtomic(L, headers, rows, colWidths, {
    ...sizing,
    skipPageCheck: true,
    boldTotalRow: opts?.boldTotalRow,
  });
}

export function drawWrappedParagraph(
  L: ComparisonGraphicsLayout,
  text: string,
  opts?: { size?: number; color?: RGB; lineH?: number; maxW?: number },
): number {
  const size = opts?.size ?? 8;
  const color = opts?.color ?? L.ink;
  const lineH = opts?.lineH ?? 11;
  const maxW = opts?.maxW ?? L.contentW;
  const widthOf = (s: string) => L.regular.widthOfTextAtSize(s, size);
  const lines = wrapPlainText(widthOf, text, size, maxW);
  for (const line of lines) {
    L.getPage().drawText(line, { x: L.margin, y: L.getY(), size, font: L.regular, color });
    L.setY(L.getY() - lineH);
  }
  L.setY(L.getY() - 4);
  return lines.length * lineH + 4;
}

export function drawPanelEyebrow(L: ComparisonGraphicsLayout, text: string, color?: RGB): void {
  L.getPage().drawText(cleanPdfText(text).toUpperCase(), {
    x: L.margin,
    y: L.getY(),
    size: 6.5,
    font: L.bold,
    color: color ?? L.muted,
  });
  L.setY(L.getY() - 12);
}

export function drawPanelTitle(L: ComparisonGraphicsLayout, text: string): void {
  const font = L.serif ?? L.bold;
  L.getPage().drawText(cleanPdfText(text), {
    x: L.margin,
    y: L.getY(),
    size: 13,
    font,
    color: L.ink,
  });
  L.setY(L.getY() - 18);
}

export function drawBorderedBox(
  L: ComparisonGraphicsLayout,
  x: number,
  yTop: number,
  w: number,
  h: number,
  fill: RGB,
  border: RGB,
): void {
  L.getPage().drawRectangle({ x, y: yTop - h, width: w, height: h, color: fill, borderColor: border, borderWidth: 0.5 });
}

export type StackSegment = { key: string; label: string; value: number; color: RGB };

export function stackedBarColumnHeight(
  chartH: number,
  lossVal: number,
  wealthTotal: number,
  legendCount: number,
): number {
  const lossH = lossVal > 0 && wealthTotal > 0 ? (lossVal / wealthTotal) * chartH * 0.45 : 0;
  return 12 + 18 + chartH + lossH + legendCount * 10 + 16;
}

/** Side-by-side stacked bars with optional center delta label; advances layout Y. */
export function drawDualStackedBarRow(
  L: ComparisonGraphicsLayout,
  opts: {
    chartH: number;
    barW: number;
    left: {
      segments: StackSegment[];
      lossSegment?: StackSegment | null;
      title: string;
      totalLabel: string;
      titleColor: RGB;
    };
    right: {
      segments: StackSegment[];
      lossSegment?: StackSegment | null;
      title: string;
      totalLabel: string;
      titleColor: RGB;
    };
    center?: { delta: string; footnote?: string; deltaColor?: RGB };
  },
): void {
  const yTop = L.getY();
  const colW = (L.contentW - 72) / 2;
  const leftX = L.margin + colW / 2 - opts.barW / 2;
  const rightX = L.margin + colW + 72 + colW / 2 - opts.barW / 2;

  const leftPos = opts.left.segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const leftLoss = opts.left.lossSegment?.value ?? 0;
  const leftTotal = leftPos + leftLoss;
  const leftLegends = opts.left.segments.length + (opts.left.lossSegment && opts.left.lossSegment.value > 0 ? 1 : 0);

  const rightPos = opts.right.segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const rightLoss = opts.right.lossSegment?.value ?? 0;
  const rightTotal = rightPos + rightLoss;
  const rightLegends = opts.right.segments.length + (opts.right.lossSegment && opts.right.lossSegment.value > 0 ? 1 : 0);

  drawStackedBarColumn(
    L,
    leftX,
    yTop,
    opts.barW,
    opts.chartH,
    opts.left.segments,
    opts.left.lossSegment,
    opts.left.title,
    opts.left.totalLabel,
    opts.left.titleColor,
  );
  drawStackedBarColumn(
    L,
    rightX,
    yTop,
    opts.barW,
    opts.chartH,
    opts.right.segments,
    opts.right.lossSegment,
    opts.right.title,
    opts.right.totalLabel,
    opts.right.titleColor,
  );

  if (opts.center) {
    const page = L.getPage();
    const midX = L.margin + colW + 16;
    const midY = yTop - opts.chartH * 0.45;
    page.drawText("->", { x: midX, y: midY, size: 11, font: L.regular, color: L.muted });
    page.drawText(cleanPdfText(opts.center.delta), {
      x: midX - 12,
      y: midY - 18,
      size: 11,
      font: L.serif ?? L.bold,
      color: opts.center.deltaColor ?? L.ink,
    });
    if (opts.center.footnote) {
      page.drawText(cleanPdfText(opts.center.footnote).toUpperCase(), {
        x: midX - 20,
        y: midY - 32,
        size: 5,
        font: L.bold,
        color: L.muted,
      });
    }
  }

  const rowH = Math.max(
    stackedBarColumnHeight(opts.chartH, leftLoss, leftTotal, leftLegends),
    stackedBarColumnHeight(opts.chartH, rightLoss, rightTotal, rightLegends),
  );
  L.setY(yTop - rowH - 10);
}

export function drawStackedBarColumn(
  L: ComparisonGraphicsLayout,
  x: number,
  yTop: number,
  barW: number,
  chartH: number,
  segments: StackSegment[],
  lossSegment?: StackSegment | null,
  title?: string,
  totalLabel?: string,
  titleColor?: RGB,
): void {
  const page = L.getPage();
  const positiveTotal = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const lossVal = lossSegment?.value ?? 0;
  const wealthTotal = positiveTotal + lossVal;
  const lossH = lossVal > 0 && wealthTotal > 0 ? (lossVal / wealthTotal) * chartH * 0.45 : 0;
  const stackH = chartH - lossH;

  let cursorY = yTop;
  if (title) {
    page.drawText(cleanPdfText(title).toUpperCase(), {
      x,
      y: cursorY,
      size: 6.5,
      font: L.bold,
      color: titleColor ?? L.ink,
    });
    cursorY -= 12;
  }
  if (totalLabel) {
    const font = L.serif ?? L.bold;
    page.drawText(cleanPdfText(totalLabel), {
      x,
      y: cursorY,
      size: 14,
      font,
      color: titleColor ?? L.ink,
    });
    cursorY -= 18;
  }

  const barBottom = cursorY - chartH - lossH;
  let yOffset = 0;
  const positiveSegs = [...segments].reverse();
  const posSum = positiveSegs.reduce((s, seg) => s + seg.value, 0);

  for (const seg of positiveSegs) {
    const h = posSum > 0 ? (seg.value / posSum) * stackH : 0;
    const segY = barBottom + stackH - yOffset - h;
    yOffset += h;
    if (h < 1) continue;
    page.drawRectangle({ x, y: segY, width: barW, height: h, color: seg.color });
  }

  if (lossH > 2 && lossSegment) {
    page.drawRectangle({
      x,
      y: barBottom + stackH + 4,
      width: barW,
      height: lossH,
      color: hexToRgb("#fecaca"),
    });
    page.drawRectangle({
      x,
      y: barBottom + stackH + 4,
      width: barW,
      height: Math.min(4, lossH),
      color: lossSegment.color,
    });
  }

  let legendY = barBottom - 8;
  for (const seg of segments) {
    page.drawRectangle({ x, y: legendY - 6, width: 6, height: 6, color: seg.color });
    page.drawText(cleanPdfText(seg.label).slice(0, 28), {
      x: x + 10,
      y: legendY - 5,
      size: 6,
      font: L.regular,
      color: L.muted,
    });
    legendY -= 10;
  }
  if (lossSegment && lossSegment.value > 0) {
    page.drawRectangle({ x, y: legendY - 6, width: 6, height: 6, color: lossSegment.color });
    page.drawText(cleanPdfText(lossSegment.label).slice(0, 28), {
      x: x + 10,
      y: legendY - 5,
      size: 6,
      font: L.regular,
      color: L.muted,
    });
    legendY -= 10;
  }
}

export function drawPillTimeline(
  L: ComparisonGraphicsLayout,
  downPct: number,
  downLabel: string,
  upLabel: string,
  downColor: RGB,
  upColor: RGB,
  stopLinePct?: number,
  labelColors?: { downLabelColor?: RGB; upLabelColor?: RGB },
): void {
  const yTop = L.getY();
  const page = L.getPage();
  const x = L.margin;
  const w = L.contentW;
  const h = 24;
  const downW = Math.max(8, w * downPct);
  const y = yTop - h;

  page.drawRectangle({ x, y, width: w, height: h, color: L.rule, borderWidth: 0.5, borderColor: L.rule });
  page.drawRectangle({ x, y, width: downW, height: h, color: downColor });
  page.drawRectangle({ x: x + downW, y, width: w - downW, height: h, color: upColor });

  const downLabelColor = labelColors?.downLabelColor ?? rgb(1, 1, 1);
  const upLabelColor = labelColors?.upLabelColor ?? hexToRgb("#0b1540");

  if (downPct >= 0.18) {
    page.drawText(cleanPdfText(downLabel).toUpperCase(), {
      x: x + 6,
      y: y + 8,
      size: 6,
      font: L.bold,
      color: downLabelColor,
    });
  }
  if (downPct <= 0.82) {
    page.drawText(cleanPdfText(upLabel).toUpperCase(), {
      x: x + downW + 6,
      y: y + 8,
      size: 6,
      font: L.bold,
      color: upLabelColor,
    });
  }

  if (stopLinePct != null && stopLinePct > 0 && stopLinePct < 1) {
    const lineX = x + w * stopLinePct;
    page.drawLine({
      start: { x: lineX, y: yTop },
      end: { x: lineX, y: y },
      thickness: 1.5,
      color: L.ink,
      dashArray: [3, 2],
    });
  }

  L.setY(yTop - h - 10);
}

export function drawThreeColumnCards(
  L: ComparisonGraphicsLayout,
  left: { label: string; value: string; sub: string; fill: RGB; border: RGB; textColor: RGB },
  center: { label: string; value: string; sub: string },
  right: { label: string; value: string; sub: string; fill: RGB; border: RGB; textColor: RGB },
): void {
  const yTop = L.getY();
  const page = L.getPage();
  const gap = 8;
  const centerW = 90;
  const cardW = (L.contentW - centerW - gap * 2) / 2;
  const cardH = 72;
  const y = yTop - cardH;
  const x0 = L.margin;

  const drawCard = (
    x: number,
    card: { label: string; value: string; sub: string; fill?: RGB; border?: RGB; textColor?: RGB },
  ) => {
    drawBorderedBox(L, x, yTop, cardW, cardH, card.fill ?? L.pageBg, card.border ?? L.rule);
    page.drawText(cleanPdfText(card.label).toUpperCase(), {
      x: x + 8,
      y: y + cardH - 14,
      size: 6,
      font: L.bold,
      color: card.textColor ?? L.muted,
    });
    const valFont = L.serif ?? L.bold;
    page.drawText(cleanPdfText(card.value), {
      x: x + 8,
      y: y + cardH - 36,
      size: 16,
      font: valFont,
      color: card.textColor ?? L.ink,
    });
    page.drawText(cleanPdfText(card.sub).slice(0, 42), {
      x: x + 8,
      y: y + 8,
      size: 6,
      font: L.regular,
      color: L.muted,
    });
  };

  drawCard(x0, left);
  drawCard(x0 + cardW + gap + centerW + gap, right);

  const cx = x0 + cardW + gap;
  page.drawText(cleanPdfText(center.label).toUpperCase(), {
    x: cx + 8,
    y: y + cardH - 16,
    size: 5.5,
    font: L.bold,
    color: L.muted,
  });
  const valFont = L.serif ?? L.bold;
  page.drawText(cleanPdfText(center.value), {
    x: cx + 4,
    y: y + cardH - 38,
    size: 13,
    font: valFont,
    color: L.ink,
  });
  page.drawText(cleanPdfText(center.sub).slice(0, 24), {
    x: cx + 4,
    y: y + 10,
    size: 5.5,
    font: L.regular,
    color: L.muted,
  });

  L.setY(yTop - cardH - 12);
}

export function drawExplainerCardsRow(
  L: ComparisonGraphicsLayout,
  cards: { title: string; body: string; accent: RGB }[],
): void {
  const yTop = L.getY();
  const page = L.getPage();
  const gap = 8;
  const cardW = (L.contentW - gap * (cards.length - 1)) / cards.length;
  const cardH = 58;
  const y = yTop - cardH;

  cards.forEach((card, i) => {
    const x = L.margin + i * (cardW + gap);
    drawBorderedBox(L, x, yTop, cardW, cardH, L.surface, L.rule);
    page.drawRectangle({ x: x + 8, y: y + cardH - 16, width: 6, height: 6, color: card.accent });
    page.drawText(cleanPdfText(card.title).toUpperCase(), {
      x: x + 18,
      y: y + cardH - 16,
      size: 5.5,
      font: L.bold,
      color: L.ink,
    });
    const bodyLines = wrapPlainText(
      (s) => L.regular.widthOfTextAtSize(s, 6),
      card.body,
      6,
      cardW - 16,
    ).slice(0, 4);
    let by = y + cardH - 28;
    for (const line of bodyLines) {
      page.drawText(line, { x: x + 8, y: by, size: 6, font: L.regular, color: L.muted });
      by -= 9;
    }
  });

  L.setY(yTop - cardH - 10);
}

export function drawInsightChipRow(
  L: ComparisonGraphicsLayout,
  chips: { label: string; value: string; helper: string }[],
): void {
  const yTop = L.getY();
  const page = L.getPage();
  const gap = 6;
  const cols = Math.min(chips.length, 4);
  const chipW = (L.contentW - gap * (cols - 1)) / cols;
  const chipH = 52;
  const y = yTop - chipH;

  chips.slice(0, cols).forEach((chip, i) => {
    const x = L.margin + i * (chipW + gap);
    drawBorderedBox(L, x, yTop, chipW, chipH, L.pageBg, L.rule);
    page.drawText(cleanPdfText(chip.label).toUpperCase(), {
      x: x + 6,
      y: y + chipH - 12,
      size: 5,
      font: L.bold,
      color: L.muted,
    });
    page.drawText(cleanPdfText(chip.value), {
      x: x + 6,
      y: y + chipH - 28,
      size: 9,
      font: L.bold,
      color: L.ink,
    });
    const helperLines = wrapPlainText(
      (s) => L.regular.widthOfTextAtSize(s, 5),
      chip.helper,
      5,
      chipW - 12,
    ).slice(0, 2);
    let hy = y + 8;
    for (const line of helperLines) {
      page.drawText(line, { x: x + 6, y: hy, size: 5, font: L.regular, color: L.muted });
      hy += 7;
    }
  });

  L.setY(yTop - chipH - 10);
}

/** Bordered callout box anchored at current Y; advances layout cursor. */
export function drawCalloutBox(
  L: ComparisonGraphicsLayout,
  height: number,
  drawInner: (yTop: number, page: PDFPage) => void,
): void {
  const yTop = L.getY();
  drawBorderedBox(L, L.margin, yTop, L.contentW, height, L.surface, L.rule);
  drawInner(yTop, L.getPage());
  L.setY(yTop - height - 10);
}
