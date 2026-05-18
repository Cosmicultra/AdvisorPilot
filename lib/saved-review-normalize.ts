import { normalizeIntakeClient, type IntakeClient } from "@/lib/intake-config";
import { normalizeRothWorksheet, type RothWorksheet } from "@/lib/roth-worksheet";
import type { HoldingValidationMetadata, HoldingValidationStatus } from "@/lib/holding-validation";
import {
  normalizeRegistrationType,
  type RegistrationBucket,
} from "@/lib/holding-registration";
import { canonicalizeAssetClass } from "@/lib/asset-classes";
import { deriveHoldingStatus } from "@/lib/holding-status";
import { applySyntheticCashTickerIfEligible } from "@/lib/holding-validation";
import { maskAccountNumberDisplay } from "@/lib/mask-account-number";

export type UiHolding = {
  rawName: string;
  suggested: string;
  confidence: number;
  assetClass: string;
  value: number;
  status: string;
  options: string[];
  masterResolvedSymbol?: string;
  masterResolvedNote?: string;
  normalizedSymbol?: string;
  normalizedCusip?: string;
  validationStatus?: HoldingValidationStatus;
  validationMetadata?: HoldingValidationMetadata;
  duplicateKey?: string;
  duplicateOfIndex?: number;
  sourceFileName?: string;
  sourceFileIndex?: number;
  accountNumber?: string;
  registrationType?: RegistrationBucket;
  costBasis?: number;
  enrichmentCompletedAt?: string;
  enrichmentResolvedTicker?: string;
  enrichmentResolvedName?: string;
  enrichmentShareClass?: string;
  enrichmentMappedAssetClass?: string;
  enrichmentSourceUrls?: string[];
  enrichmentFigi?: string;
  enrichmentFigiSecurityType?: string;
  enrichmentFigiSkippedReason?: string;
  enrichmentConfidence?: number;
  enrichmentIsProprietaryOrThinData?: boolean;
  enrichmentNeedsReview?: boolean;
  enrichmentNotes?: string;
  /** Advisor confirmed the proposed match on Confirm Holdings despite low AI confidence / review status. */
  confirmedMatchOverridesReview?: boolean;
};

export type NormalizedAiAnalysis = {
  synopsis: string;
  portfolioHighlights?: string[];
  strategies: string[];
  redFlags?: string[];
  overlapInsights?: string[];
  displayWhatThisMeans?: string[];
  recommendations: string[];
  talkingPoints?: string[];
  advisorOpeningScript?: string;
  objectionHandling?: string[];
};

export type SavedReviewNormalized = {
  id: string;
  savedAt: string;
  client: IntakeClient;
  holdings: UiHolding[];
  meetingNotes: string;
  demoMode: boolean;
  analysis: NormalizedAiAnalysis | null;
  status?: string;
  lastContactedAt?: string;
  totalValue?: number;
  rothWorksheet?: RothWorksheet | null;
};

export function normalizeHoldingsForUi(raw: unknown): UiHolding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item): UiHolding => {
    const h = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const options = Array.isArray(h.options) ? h.options.map((o) => String(o)) : [];
    const confRaw = Number.isFinite(Number(h.confidence)) ? Number(h.confidence) : 0;
    const acRaw = canonicalizeAssetClass(String(h.assetClass ?? "Unknown"));

    const base: UiHolding = {
      rawName: String(h.rawName ?? ""),
      suggested: String(h.suggested ?? ""),
      confidence: confRaw,
      assetClass: acRaw,
      value: Number.isFinite(Number(h.value)) ? Number(h.value) : 0,
      status: deriveHoldingStatus(h.status, confRaw),
      options,
    };

    if (typeof h.normalizedSymbol === "string" && h.normalizedSymbol.trim())
      base.normalizedSymbol = h.normalizedSymbol.trim();
    if (typeof h.normalizedCusip === "string" && h.normalizedCusip.trim())
      base.normalizedCusip = h.normalizedCusip.trim();
    if (
      h.validationStatus === "validated" ||
      h.validationStatus === "needs_review" ||
      h.validationStatus === "unverified"
    ) {
      base.validationStatus = h.validationStatus;
    }
    if (h.validationMetadata && typeof h.validationMetadata === "object") {
      base.validationMetadata = h.validationMetadata as HoldingValidationMetadata;
    }
    if (typeof h.duplicateKey === "string") base.duplicateKey = h.duplicateKey;
    if (typeof h.duplicateOfIndex === "number" && Number.isFinite(h.duplicateOfIndex)) {
      base.duplicateOfIndex = h.duplicateOfIndex;
    }
    if (typeof h.sourceFileName === "string") base.sourceFileName = h.sourceFileName;
    if (typeof h.sourceFileIndex === "number" && Number.isFinite(h.sourceFileIndex)) {
      base.sourceFileIndex = h.sourceFileIndex;
    }
    const acct = typeof h.accountNumber === "string" ? h.accountNumber.trim() : "";
    if (acct) base.accountNumber = maskAccountNumberDisplay(acct);
    base.registrationType = normalizeRegistrationType(
      (h.registrationType as RegistrationBucket | undefined) ?? "unknown"
    );
    const cb = Number(h.costBasis);
    if (Number.isFinite(cb) && cb > 0) base.costBasis = cb;

    if (typeof h.enrichmentCompletedAt === "string" && h.enrichmentCompletedAt.trim()) {
      base.enrichmentCompletedAt = h.enrichmentCompletedAt.trim();
    }
    if (typeof h.enrichmentResolvedTicker === "string" && h.enrichmentResolvedTicker.trim()) {
      base.enrichmentResolvedTicker = h.enrichmentResolvedTicker.trim();
    }
    if (typeof h.enrichmentResolvedName === "string" && h.enrichmentResolvedName.trim()) {
      base.enrichmentResolvedName = h.enrichmentResolvedName.trim();
    }
    if (typeof h.enrichmentShareClass === "string" && h.enrichmentShareClass.trim()) {
      base.enrichmentShareClass = h.enrichmentShareClass.trim();
    }
    if (typeof h.enrichmentMappedAssetClass === "string" && h.enrichmentMappedAssetClass.trim()) {
      base.enrichmentMappedAssetClass = h.enrichmentMappedAssetClass.trim();
    }
    if (Array.isArray(h.enrichmentSourceUrls)) {
      base.enrichmentSourceUrls = h.enrichmentSourceUrls.map((u) => String(u)).filter(Boolean);
    }
    if (typeof h.enrichmentFigi === "string" && h.enrichmentFigi.trim()) {
      base.enrichmentFigi = h.enrichmentFigi.trim();
    }
    if (typeof h.enrichmentFigiSecurityType === "string" && h.enrichmentFigiSecurityType.trim()) {
      base.enrichmentFigiSecurityType = h.enrichmentFigiSecurityType.trim();
    }
    if (typeof h.enrichmentFigiSkippedReason === "string" && h.enrichmentFigiSkippedReason.trim()) {
      base.enrichmentFigiSkippedReason = h.enrichmentFigiSkippedReason.trim();
    }
    if (Number.isFinite(Number(h.enrichmentConfidence))) {
      base.enrichmentConfidence = Number(h.enrichmentConfidence);
    }
    if (typeof h.enrichmentIsProprietaryOrThinData === "boolean") {
      base.enrichmentIsProprietaryOrThinData = h.enrichmentIsProprietaryOrThinData;
    }
    if (typeof h.enrichmentNeedsReview === "boolean") {
      base.enrichmentNeedsReview = h.enrichmentNeedsReview;
    }
    if (typeof h.enrichmentNotes === "string" && h.enrichmentNotes.trim()) {
      base.enrichmentNotes = h.enrichmentNotes.trim();
    }
    if (typeof h.confirmedMatchOverridesReview === "boolean") {
      base.confirmedMatchOverridesReview = h.confirmedMatchOverridesReview;
    }
    if (typeof (h as { masterResolvedSymbol?: unknown }).masterResolvedSymbol === "string") {
      const m = String((h as { masterResolvedSymbol?: string }).masterResolvedSymbol).trim();
      if (m) base.masterResolvedSymbol = m;
    }
    if (typeof (h as { masterResolvedNote?: unknown }).masterResolvedNote === "string") {
      const m = String((h as { masterResolvedNote?: string }).masterResolvedNote).trim();
      if (m) base.masterResolvedNote = m;
    }

    return applySyntheticCashTickerIfEligible(base);
  });
}

export function normalizeAiAnalysis(raw: unknown): NormalizedAiAnalysis | null {
  if (raw == null) return null;
  const a = typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const strArr = (key: string) =>
    Array.isArray(a[key]) ? (a[key] as unknown[]).map((x) => String(x)) : [];

  const strategies = strArr("strategies");
  const recommendations = strArr("recommendations");

  return {
    synopsis: String(a.synopsis ?? ""),
    portfolioHighlights: strArr("portfolioHighlights"),
    strategies: strategies.length ? strategies : [],
    redFlags: strArr("redFlags"),
    overlapInsights: strArr("overlapInsights"),
    displayWhatThisMeans: strArr("displayWhatThisMeans"),
    recommendations: recommendations.length ? recommendations : [],
    talkingPoints: strArr("talkingPoints"),
    advisorOpeningScript: String(a.advisorOpeningScript ?? ""),
    objectionHandling: strArr("objectionHandling"),
  };
}

export function normalizeSavedReviewRow(raw: unknown): SavedReviewNormalized {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lc =
    typeof r.lastContactedAt === "string" && r.lastContactedAt.trim()
      ? r.lastContactedAt
      : undefined;

  return {
    id: String(r.id ?? ""),
    savedAt: String(r.savedAt ?? ""),
    client: normalizeIntakeClient(r.client),
    holdings: normalizeHoldingsForUi(r.holdings),
    meetingNotes: String(r.meetingNotes ?? ""),
    demoMode: Boolean(r.demoMode),
    analysis: normalizeAiAnalysis(r.analysis),
    status: typeof r.status === "string" ? r.status : undefined,
    lastContactedAt: lc,
    totalValue: Number.isFinite(Number(r.totalValue)) ? Number(r.totalValue) : 0,
    rothWorksheet: (() => {
      if (r.rothWorksheet === undefined) return undefined;
      if (r.rothWorksheet === null) return null;
      return normalizeRothWorksheet(r.rothWorksheet);
    })(),
  };
}
