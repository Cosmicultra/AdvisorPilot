/**
 * Slim client context for dripper LLM calls — no email, account numbers, or SSN.
 */

import { emptyFiaWorksheet, type FiaWorksheet } from "@/lib/fia-worksheet";
import type { IntakeClient } from "@/lib/intake-config";
import type { RothWorksheet } from "@/lib/roth-worksheet";
import type { ClientDetail } from "./types";

export const MEETING_NOTES_EXCERPT_MAX = 400;
export const NOTE_EXCERPT_MAX = 200;
export const DRIP_ANGLE_EXCERPT_MAX = 250;
export const ANALYSIS_THEME_ITEM_MAX = 80;
export const ANALYSIS_THEME_MAX_ITEMS = 3;

export type ToolsReviewed = {
  fia: boolean;
  roth: boolean;
  retirementIncome: boolean;
};

export type DripperEmailContext = {
  toolsReviewed: ToolsReviewed;
  riskAlignment: string | null;
  recentDripAngles: string[];
};

export type BuildDripperClientContextOptions = {
  recentNotesExcerpts?: string[];
  recentDripAngles?: string[];
};

function hasNonEmpty(...values: (string | null | undefined)[]): boolean {
  return values.some((v) => typeof v === "string" && v.trim() !== "");
}

export function excerptText(text: string, maxLen: number): string {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen - 1)}…`;
}

export function excerptDripRunOutput(text: string): string {
  return excerptText(text, DRIP_ANGLE_EXCERPT_MAX);
}

export function isFiaWorksheetPopulated(ws: FiaWorksheet | null | undefined): boolean {
  if (!ws) return false;
  if (hasNonEmpty(ws.carrierName, ws.productName, ws.premiumAmount, ws.registrationPremiumOverride)) {
    return true;
  }
  if (
    hasNonEmpty(
      ws.premiumBonusPct,
      ws.trailingBonusPct,
      ws.trailBonusYears,
      ws.contractCapRatePct,
      ws.penaltyFreeWithdrawalPct,
      ws.surrenderYears,
      ws.incomeRiderGuaranteePct,
      ws.incomeRiderFeePct
    )
  ) {
    return true;
  }
  if (ws.hasIncomeRider !== null || ws.contractEarningsAddToRiderBase !== null) {
    return true;
  }
  const empty = emptyFiaWorksheet();
  return ws.premiumSource !== empty.premiumSource;
}

export function isRothWorksheetPopulated(ws: RothWorksheet | null | undefined): boolean {
  if (!ws) return false;
  if (ws.useEntireQualifiedBalance !== null) return true;
  if (hasNonEmpty(ws.qualifiedAssetValue, ws.specificConversionAmount)) return true;
  if (ws.useFixedIndexContract !== null) return true;
  const fic = ws.fic;
  return hasNonEmpty(
    fic.carrierName,
    fic.productName,
    fic.premiumBonusPct,
    fic.contractEstimatedRateOfReturnPct,
    fic.maxTaxRatePct
  );
}

export function detectToolsReviewed(detail: ClientDetail): ToolsReviewed {
  return {
    fia: isFiaWorksheetPopulated(detail.client?.fiaWorksheet ?? null),
    roth: isRothWorksheetPopulated(detail.rothWorksheet),
    retirementIncome: hasNonEmpty(detail.client?.retirementSpendableIncomeAnnual),
  };
}

export function formatRiskAlignment(client: IntakeClient | undefined): string | null {
  if (!client) return null;
  const stated = client.riskProfile?.trim() ?? "";
  const suggested = client.riskProfileSuggested?.trim() ?? "";
  if (!stated && !suggested) return null;
  if (suggested && stated && suggested !== stated) {
    return `stated: ${stated}; suggested: ${suggested}`;
  }
  if (stated) return `stated: ${stated}`;
  return `suggested: ${suggested}`;
}

function truncateThemeItems(items: string[] | undefined): string[] {
  if (!items?.length) return [];
  return items
    .slice(0, ANALYSIS_THEME_MAX_ITEMS)
    .map((s) => excerptText(s, ANALYSIS_THEME_ITEM_MAX))
    .filter(Boolean);
}

export function buildAnalysisThemes(
  analysis: ClientDetail["analysis"]
): { strategies: string[]; redFlags: string[]; recommendations: string[] } | null {
  if (!analysis) return null;
  const strategies = truncateThemeItems(analysis.strategies);
  const redFlags = truncateThemeItems(analysis.redFlags);
  const recommendations = truncateThemeItems(analysis.recommendations);
  if (!strategies.length && !redFlags.length && !recommendations.length) {
    return null;
  }
  return { strategies, redFlags, recommendations };
}

export function toDripperEmailContext(
  full: ReturnType<typeof buildDripperClientContext>
): DripperEmailContext {
  const tools = full.toolsReviewed as ToolsReviewed | undefined;
  return {
    toolsReviewed: tools ?? { fia: false, roth: false, retirementIncome: false },
    riskAlignment: typeof full.riskAlignment === "string" ? full.riskAlignment : null,
    recentDripAngles: Array.isArray(full.recentDripAngles)
      ? (full.recentDripAngles as string[])
      : [],
  };
}

export function buildDripperClientContext(
  detail: ClientDetail,
  options: BuildDripperClientContextOptions = {}
): Record<string, unknown> {
  const aum = detail.aum ?? 0;
  const topHoldings = (detail.holdings ?? []).slice(0, 15).map((h) => ({
    name: h.suggested || h.rawName,
    ticker: h.enrichmentResolvedTicker ?? h.normalizedSymbol ?? null,
    assetClass: h.assetClass ?? null,
    value: h.value ?? null,
    weightPct: aum > 0 && h.value != null ? Math.round((h.value / aum) * 1000) / 10 : null,
  }));

  const recentNotesExcerpt = (options.recentNotesExcerpts ?? [])
    .map((n) => excerptText(n, NOTE_EXCERPT_MAX))
    .filter(Boolean);
  const recentDripAngles = (options.recentDripAngles ?? [])
    .map((o) => excerptDripRunOutput(o))
    .filter(Boolean);

  const meetingNotesExcerpt = detail.meetingNotes?.trim()
    ? excerptText(detail.meetingNotes, MEETING_NOTES_EXCERPT_MAX)
    : null;

  return {
    clientName: `${detail.firstName} ${detail.lastName}`.trim(),
    stage: detail.stage,
    status: detail.status,
    aum,
    ytdReturn: detail.ytdReturn,
    riskProfile: detail.client?.riskProfile ?? null,
    riskAlignment: formatRiskAlignment(detail.client),
    age: detail.client?.age ?? null,
    retirementTimeline: detail.client?.retirementAge ?? null,
    goal: detail.client?.goal ?? null,
    lastContactedAt: detail.lastContactedAt,
    nextMeetingAt: detail.nextMeetingAt,
    reviewDueAt: detail.reviewDueAt,
    location: detail.location,
    openTaskCount: detail.openTaskCount,
    recentNoteCount: detail.recentNoteCount,
    topHoldings,
    analysisSynopsis:
      typeof detail.analysis?.synopsis === "string"
        ? detail.analysis.synopsis.slice(0, 600)
        : null,
    analysisThemes: buildAnalysisThemes(detail.analysis),
    toolsReviewed: detectToolsReviewed(detail),
    meetingNotesExcerpt,
    recentNotesExcerpt,
    recentDripAngles,
  };
}
