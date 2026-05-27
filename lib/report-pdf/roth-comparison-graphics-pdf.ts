/**
 * pdf-lib drawing for Roth comparison exhibit panels (mirrors components/roth/*).
 * Lifetime wealth + wealth allocation on page one; bracket strategy on page two.
 */

import type { RothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import {
  formatEffectiveRate,
  formatRothDeltaCompact,
  formatRothMoneyCompact,
  formatRothMoneyFull,
  formatRothPct,
  ROTH_VISUAL_COLORS,
} from "@/lib/roth-visual-theme";
import {
  type ComparisonGraphicsLayout,
  type StackSegment,
  drawCalloutBox,
  drawDualStackedBarRow,
  drawExplainerCardsRow,
  drawInsightChipRow,
  drawPanelEyebrow,
  drawPanelTitle,
  drawPillTimeline,
  drawThreeColumnCards,
  drawWrappedParagraph,
  hexToRgb,
  centerBlockOnPage,
  drawExhibitSectionTitle,
  EXHIBIT_CONTENT_TOP_Y,
  measureBlockHeight,
  startDedicatedPage,
} from "@/lib/report-pdf/comparison-graphics-primitives";

const ROTH_STAY = hexToRgb(ROTH_VISUAL_COLORS.stay);
const ROTH_STAY_LIGHT = hexToRgb(ROTH_VISUAL_COLORS.stayLight);
const ROTH_BRAND = hexToRgb(ROTH_VISUAL_COLORS.roth);
const ROTH_BRAND_LIGHT = hexToRgb(ROTH_VISUAL_COLORS.rothLight);
const ROTH_ON_BRAND_LIGHT = hexToRgb(ROTH_VISUAL_COLORS.onBrandLight);
const ROTH_HEIRS = hexToRgb(ROTH_VISUAL_COLORS.heirs);
const ROTH_INCOME = hexToRgb(ROTH_VISUAL_COLORS.income);
const ROTH_TAXES = hexToRgb(ROTH_VISUAL_COLORS.taxes);
const ROTH_CONVERT = hexToRgb(ROTH_VISUAL_COLORS.convertZone);
const ROTH_AVOID_LIGHT = hexToRgb(ROTH_VISUAL_COLORS.avoidZoneLight);

function buildStackSegments(
  afterTaxIncome: number,
  heirsLegacy: number,
  taxesAndIrmaa: number,
): StackSegment[] {
  return [
    { key: "heirs", label: "Legacy to heirs", value: heirsLegacy, color: ROTH_HEIRS },
    { key: "income", label: "Income you keep", value: afterTaxIncome, color: ROTH_INCOME },
    { key: "taxes", label: "Taxes + IRMAA", value: taxesAndIrmaa, color: ROTH_TAXES },
  ];
}

function drawRothLifetimeWealthPanel(
  L: ComparisonGraphicsLayout,
  data: RothComparisonVisualData,
  clientName?: string,
): void {
  const headline = clientName
    ? `Lifetime wealth comparison for ${clientName}`
    : "Lifetime wealth comparison";

  drawPanelTitle(L, headline);

  drawThreeColumnCards(
    L,
    {
      label: "Current path",
      value: formatRothMoneyCompact(data.stayEndingWealth),
      sub: "After-tax wealth, no conversion",
      fill: ROTH_STAY_LIGHT,
      border: ROTH_STAY,
      textColor: L.ink,
    },
    {
      label: "Difference",
      value: formatRothDeltaCompact(data.wealthDelta),
      sub: formatRothPct(data.wealthDeltaPct, true),
    },
    {
      label: "Roth conversion path",
      value: formatRothMoneyCompact(data.rothEndingWealth),
      sub: "After-tax wealth, with conversion",
      fill: ROTH_BRAND_LIGHT,
      border: ROTH_BRAND,
      textColor: ROTH_ON_BRAND_LIGHT,
    },
  );

  drawInsightChipRow(L, [
    {
      label: "More total wealth",
      value: formatRothDeltaCompact(data.wealthDelta),
      helper: `${formatRothPct(data.wealthDeltaPct, true)} vs. current path`,
    },
    {
      label: "Tax savings",
      value: formatRothDeltaCompact(data.taxSavings),
      helper: "Federal illustrative tax avoided",
    },
    {
      label: "IRMAA difference",
      value: formatRothDeltaCompact(data.irmaaSavings),
      helper: "Medicare IRMAA surcharges avoided",
    },
    {
      label: "Income trade-off",
      value: formatRothDeltaCompact(data.afterTaxIncomeDelta),
      helper: "After-tax income kept during plan",
    },
  ]);
}

function drawRothWealthAllocationPanel(L: ComparisonGraphicsLayout, data: RothComparisonVisualData): void {
  L.setY(L.getY() - 8);
  const stayTotal = data.stayAfterTaxIncome + data.stayHeirsLegacy;
  const rothTotal = data.rothAfterTaxIncome + data.rothHeirsLegacy;
  const taxShift = data.stayTaxesAndIrmaa - data.rothTaxesAndIrmaa;

  drawPanelEyebrow(L, "Where the dollars go");
  drawPanelTitle(
    L,
    `How your ${formatRothMoneyCompact(stayTotal)} becomes ${formatRothMoneyCompact(rothTotal)}`,
  );
  drawWrappedParagraph(
    L,
    "Each bar splits lifetime value into income you keep, legacy to heirs (ending balance), and taxes plus IRMAA paid. Legacy is illustrative — estate taxes are not modeled.",
    { size: 7, color: L.muted, lineH: 10 },
  );

  const staySegs = buildStackSegments(data.stayAfterTaxIncome, data.stayHeirsLegacy, data.stayTaxesAndIrmaa);
  const rothSegs = buildStackSegments(data.rothAfterTaxIncome, data.rothHeirsLegacy, data.rothTaxesAndIrmaa);
  const stayTaxSeg = staySegs.find((s) => s.key === "taxes");
  const rothTaxSeg = rothSegs.find((s) => s.key === "taxes");

  drawDualStackedBarRow(L, {
    chartH: 88,
    barW: 50,
    left: {
      segments: staySegs.filter((s) => s.key !== "taxes"),
      lossSegment: stayTaxSeg && stayTaxSeg.value > 0 ? stayTaxSeg : null,
      title: "Current path",
      totalLabel: formatRothMoneyCompact(stayTotal),
      titleColor: L.ink,
    },
    right: {
      segments: rothSegs.filter((s) => s.key !== "taxes"),
      lossSegment: rothTaxSeg && rothTaxSeg.value > 0 ? rothTaxSeg : null,
      title: "Roth conversion path",
      totalLabel: formatRothMoneyCompact(rothTotal),
      titleColor: ROTH_BRAND,
    },
    center: {
      delta: formatRothDeltaCompact(data.wealthDelta),
      footnote: taxShift > 0 ? "Shifted from taxes & IRMAA" : undefined,
      deltaColor: ROTH_BRAND,
    },
  });
}

function nextBracketPct(current: number): number | null {
  const order = [10, 12, 22, 24, 32, 35, 37];
  const idx = order.indexOf(current);
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1]!;
}

function drawRothBracketStrategyPanel(L: ComparisonGraphicsLayout, data: RothComparisonVisualData): void {
  L.setY(L.getY() - 8);
  drawPanelEyebrow(L, "Your optimal income zone");
  drawPanelTitle(L, "Marginal tax bracket management");
  drawWrappedParagraph(L, data.filingLabel, { size: 7, color: L.muted, lineH: 10 });
  drawWrappedParagraph(
    L,
    `Each conversion year, we fill room up to your ${data.maxBracketPct}% bracket ceiling (${formatRothMoneyFull(data.grossIncomeCeiling)} illustrative gross income) — then stop before income would cross into a higher bracket.`,
    { size: 7, color: L.ink, lineH: 10 },
  );

  const stopPct = Math.min(0.98, Math.max(0.02, data.stopLinePosition));
  drawPillTimeline(L, stopPct, "Convert", "Avoid", ROTH_CONVERT, ROTH_AVOID_LIGHT, stopPct, {
    upLabelColor: hexToRgb(ROTH_VISUAL_COLORS.navy),
  });

  const nextBracket = nextBracketPct(data.maxBracketPct);
  drawCalloutBox(L, 36, (yTop, page) => {
    page.drawText("YOUR CONVERSION CEILING", {
      x: L.margin + 8,
      y: yTop - 12,
      size: 5.5,
      font: L.bold,
      color: L.muted,
    });
    const valFont = L.serif ?? L.bold;
    page.drawText(formatRothMoneyFull(data.grossIncomeCeiling), {
      x: L.margin + 8,
      y: yTop - 26,
      size: 10,
      font: valFont,
      color: L.ink,
    });
    page.drawText(
      `Top of your ${data.maxBracketPct}% marginal bracket${nextBracket ? ` (before ${nextBracket}%)` : ""}`,
      { x: L.margin + 8, y: yTop - 38, size: 6, font: L.regular, color: L.muted },
    );
  });

  drawExplainerCardsRow(L, [
    {
      title: "Convert zone",
      body: `Roth conversions are sized to keep illustrative gross income at or below ${formatRothMoneyFull(data.grossIncomeCeiling)} — the top of your ${data.maxBracketPct}% marginal bracket.`,
      accent: ROTH_CONVERT,
    },
    {
      title: "Your ceiling",
      body: `This is the stop line on the bar above. Conversions use available room each year without pushing ordinary income into the next bracket${nextBracket ? ` (${nextBracket}%)` : ""}.`,
      accent: ROTH_STAY,
    },
    {
      title: "Avoid zone",
      body: "Income above the ceiling would cross into a higher marginal rate. The plan avoids converting so much that you spill into this zone.",
      accent: hexToRgb(ROTH_VISUAL_COLORS.avoidZone),
    },
  ]);

  drawThreeColumnCards(
    L,
    {
      label: "Effective rate",
      value: formatEffectiveRate(data.stayEffectiveTaxIrmaaRate),
      sub: "Current path",
      fill: L.pageBg,
      border: L.rule,
      textColor: L.ink,
    },
    {
      label: "Change",
      value: formatEffectiveRate(Math.abs(data.effectiveRateDeltaPts)),
      sub: data.effectiveRateDeltaPts > 0 ? "Point decrease" : "Illustrative only",
    },
    {
      label: "Roth plan",
      value: formatEffectiveRate(data.rothEffectiveTaxIrmaaRate),
      sub: "Effective tax + IRMAA rate",
      fill: ROTH_BRAND_LIGHT,
      border: ROTH_BRAND,
      textColor: ROTH_ON_BRAND_LIGHT,
    },
  );

  if (data.conversionAmountTotal > 0) {
    drawWrappedParagraph(
      L,
      `Total gross conversions modeled: ${formatRothMoneyFull(data.conversionAmountTotal)}.`,
      { size: 6.5, color: L.muted, lineH: 9 },
    );
  }
}

/** Draw Roth comparison panels: first two centered on page one, bracket strategy centered on page two. */
export function appendRothComparisonGraphicsPdf(
  L: ComparisonGraphicsLayout,
  data: RothComparisonVisualData,
  clientName?: string,
  exhibitNumber?: number,
): void {
  const drawPageOne = (layout: ComparisonGraphicsLayout) => {
    drawRothLifetimeWealthPanel(layout, data, clientName);
    drawRothWealthAllocationPanel(layout, data);
  };
  centerBlockOnPage(L, measureBlockHeight(L, drawPageOne));
  drawPageOne(L);

  startDedicatedPage(L);
  L.setY(EXHIBIT_CONTENT_TOP_Y);
  let pageTwoContentTop = EXHIBIT_CONTENT_TOP_Y;
  if (exhibitNumber != null) {
    drawExhibitSectionTitle(L, exhibitNumber, "Roth conversion comparison cont.");
    L.setY(L.getY() - 4);
    pageTwoContentTop = L.getY();
  }

  const drawPageTwo = (layout: ComparisonGraphicsLayout) => {
    drawRothBracketStrategyPanel(layout, data);
  };
  centerBlockOnPage(L, measureBlockHeight(L, drawPageTwo), { contentTopY: pageTwoContentTop });
  drawPageTwo(L);
}
