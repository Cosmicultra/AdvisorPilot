/**
 * pdf-lib drawing for FIA comparison exhibit panels (mirrors components/fia/*).
 * All three panels render sequentially on one page — layout cursor advances after each block.
 */

import type { FiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import { FIA_VISUAL_COLORS, formatFiaDeltaCompact, formatFiaMoneyCompact, formatFiaPct } from "@/lib/fia-visual-theme";
import {
  type ComparisonGraphicsLayout,
  type StackSegment,
  drawCalloutBox,
  drawDualStackedBarRow,
  drawExplainerCardsRow,
  drawPanelEyebrow,
  drawPanelTitle,
  drawPillTimeline,
  drawThreeColumnCards,
  drawWrappedParagraph,
  hexToRgb,
  centerBlockOnPage,
  measureBlockHeight,
} from "@/lib/report-pdf/comparison-graphics-primitives";

const FIA_BRAND = hexToRgb(FIA_VISUAL_COLORS.fiaContract);
const FIA_BRAND_LIGHT = hexToRgb(FIA_VISUAL_COLORS.fiaContractLight);
const FIA_ON_BRAND_LIGHT = hexToRgb(FIA_VISUAL_COLORS.onBrandLight);
const FIA_RED = hexToRgb(FIA_VISUAL_COLORS.sp500);
const FIA_RED_LIGHT = hexToRgb(FIA_VISUAL_COLORS.sp500Light);
const FIA_CAP = hexToRgb(FIA_VISUAL_COLORS.cap);
const FIA_DOWN = hexToRgb(FIA_VISUAL_COLORS.downZone);
const FIA_UP_LIGHT = hexToRgb(FIA_VISUAL_COLORS.upZoneLight);
const FIA_RMD = hexToRgb(FIA_VISUAL_COLORS.rmd);

function buildSpSegments(data: FiaScenarioVisualData): StackSegment[] {
  const segs: StackSegment[] = [
    { key: "ending", label: "Ending balance", value: data.endingSp500, color: FIA_RED },
  ];
  if (data.totalRmd > 0) {
    segs.push({ key: "rmd", label: "Illustrative RMDs taken", value: data.totalRmd, color: FIA_RMD });
  }
  return segs;
}

function buildFiaSegments(data: FiaScenarioVisualData): StackSegment[] {
  const segs: StackSegment[] = [
    { key: "ending", label: "Ending balance", value: data.endingFia, color: FIA_BRAND },
  ];
  if (data.totalRmd > 0) {
    segs.push({ key: "rmd", label: "Illustrative RMDs taken", value: data.totalRmd, color: FIA_RMD });
  }
  return segs;
}

function drawFiaEndingValuePanel(L: ComparisonGraphicsLayout, data: FiaScenarioVisualData): void {
  drawThreeColumnCards(L, {
    label: "Hypothetical S&P 500",
    value: formatFiaMoneyCompact(data.endingSp500),
    sub: "Ending balance, fully exposed",
    fill: FIA_RED_LIGHT,
    border: FIA_RED,
    textColor: hexToRgb("#991b1b"),
  }, {
    label: "Difference",
    value: formatFiaDeltaCompact(data.wealthDelta),
    sub: `${formatFiaPct(data.wealthDeltaPct, true)} FIA minus S&P`,
  }, {
    label: "Your FIA contract",
    value: formatFiaMoneyCompact(data.endingFia),
    sub: "Ending contract value with cap/floor",
    fill: FIA_BRAND_LIGHT,
    border: FIA_BRAND,
    textColor: FIA_ON_BRAND_LIGHT,
  });
}

function drawFiaValueDeliveredPanel(L: ComparisonGraphicsLayout, data: FiaScenarioVisualData): void {
  L.setY(L.getY() - 8);
  drawPanelEyebrow(L, "Where the dollars went");
  drawPanelTitle(
    L,
    `How your premium became ${formatFiaMoneyCompact(data.endingFia + data.totalRmd)} vs ${formatFiaMoneyCompact(data.endingSp500 + data.totalRmd)}`,
  );
  drawWrappedParagraph(
    L,
    "Each bar combines what remains in the account plus illustrative RMDs already taken. The S&P bar also shows cumulative index losses in down years; the FIA path credited 0% in those years.",
    { size: 7, color: L.muted, lineH: 10 },
  );

  const spTotal = data.endingSp500 + data.totalRmd;
  const fiaTotal = data.endingFia + data.totalRmd;
  const lossSegment =
    data.spDownYearLossTotal > 0
      ? {
          key: "loss",
          label: "Index losses in down years",
          value: data.spDownYearLossTotal,
          color: FIA_RED,
        }
      : null;

  drawDualStackedBarRow(L, {
    chartH: 88,
    barW: 50,
    left: {
      segments: buildSpSegments(data),
      lossSegment,
      title: "Hypothetical S&P 500",
      totalLabel: formatFiaMoneyCompact(spTotal),
      titleColor: hexToRgb("#991b1b"),
    },
    right: {
      segments: buildFiaSegments(data),
      lossSegment: null,
      title: "Your FIA contract",
      totalLabel: formatFiaMoneyCompact(fiaTotal),
      titleColor: FIA_BRAND,
    },
    center: {
      delta: formatFiaDeltaCompact(data.wealthDelta),
      footnote: data.spDownYearLossTotal > 0 ? "Protected in down years" : undefined,
      deltaColor: FIA_BRAND,
    },
  });
}

function drawFiaProtectionCapPanel(L: ComparisonGraphicsLayout, data: FiaScenarioVisualData): void {
  L.setY(L.getY() - 8);
  drawPanelEyebrow(L, "How the FIA responded");
  drawPanelTitle(L, "Downside protection and upside cap");
  drawWrappedParagraph(
    L,
    `In this ${data.tabLabel.toLowerCase()} window (${data.windowLabel}), down S&P years credited 0% on the contract. Up years credited the lesser of the index return and your ${data.capPct}% cap.`,
    { size: 7, color: L.ink, lineH: 10 },
  );

  const totalYears = data.downYearCount + data.upYearCount;
  const downPct =
    totalYears > 0 ? Math.min(0.98, Math.max(0.02, data.downYearCount / totalYears)) : 0.5;
  const downLabel = `${data.downYearCount} down ${data.downYearCount === 1 ? "year" : "years"}`;
  const upLabel = `${data.upYearCount} up ${data.upYearCount === 1 ? "year" : "years"}`;

  drawPillTimeline(L, downPct, downLabel, upLabel, FIA_DOWN, FIA_UP_LIGHT, undefined, {
    upLabelColor: FIA_ON_BRAND_LIGHT,
  });

  if (data.cappedUpYearCount > 0) {
    drawCalloutBox(L, 36, (yTop, page) => {
      page.drawText("CAP APPLIED", {
        x: L.margin + 8,
        y: yTop - 12,
        size: 5.5,
        font: L.bold,
        color: L.muted,
      });
      const valFont = L.serif ?? L.bold;
      page.drawText(
        `${data.cappedUpYearCount} ${data.cappedUpYearCount === 1 ? "year" : "years"} hit the ${data.capPct}% cap`,
        { x: L.margin + 8, y: yTop - 26, size: 10, font: valFont, color: L.ink },
      );
    });
  }

  const worstLine = data.worstDownYear
    ? `${data.worstDownYear.year}: S&P ${formatFiaPct(data.worstDownYear.spReturnPct)} -> FIA credited 0%`
    : "No down years in this window.";

  const zeroFloorBody =
    data.spDownYearLossTotal > 0
      ? `In ${data.downYearCount} down ${data.downYearCount === 1 ? "year" : "years"} the contract credited 0%. A fully exposed S&P portfolio lost ${formatFiaMoneyCompact(data.spDownYearLossTotal)} cumulatively in those years (illustrative).`
      : "No down years in this window — both paths experienced positive or flat index returns.";

  const capBody = `Up years credit the lesser of the calendar-year S&P return and your ${data.capPct}% contract cap. ${data.cappedUpYearCount > 0 ? `${data.cappedUpYearCount} years were limited by the cap.` : "The cap did not bind in this window."}`;

  drawExplainerCardsRow(L, [
    { title: "Zero floor", body: zeroFloorBody, accent: FIA_DOWN },
    { title: "Your cap", body: capBody, accent: FIA_CAP },
    { title: "Worst down year", body: worstLine, accent: FIA_RED },
  ]);
}

/** Draw all three FIA comparison panels for one scenario (vertically centered on the page). */
export function appendFiaComparisonGraphicsPdf(
  L: ComparisonGraphicsLayout,
  data: FiaScenarioVisualData,
  showRider: boolean,
): void {
  const drawPanels = (layout: ComparisonGraphicsLayout) => {
    drawFiaEndingValuePanel(layout, data);
    drawFiaValueDeliveredPanel(layout, data);
    drawFiaProtectionCapPanel(layout, data);
    if (showRider && data.endingRiderBase != null && data.endingRiderBase > 0) {
      drawCalloutBox(layout, 22, (yTop, page) => {
        page.drawText(
          `Illustrative rider benefit base (end): ${formatFiaMoneyCompact(data.endingRiderBase)}`,
          { x: layout.margin + 8, y: yTop - 14, size: 7.5, font: layout.bold, color: layout.ink },
        );
      });
    }
  };

  centerBlockOnPage(L, measureBlockHeight(L, drawPanels));
  drawPanels(L);
}
