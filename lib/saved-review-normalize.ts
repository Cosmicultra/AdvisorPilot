import { normalizeIntakeClient, type IntakeClient } from "@/lib/intake-config";
import { normalizeRothWorksheet, type RothWorksheet } from "@/lib/roth-worksheet";
import type { HoldingValidationMetadata, HoldingValidationStatus } from "@/lib/holding-validation";
import {
  normalizeRegistrationType,
  type RegistrationBucket,
} from "@/lib/holding-registration";

/** Mirrors `Holding` / persisted rows from Supabase JSON. */
export type UiHolding = {
  rawName: string;
  suggested: string;
  confidence: number;
  assetClass: string;
  value: number;
  status: string;
  options: string[];
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
};

/** Mirrors `AIAnalysis` used in reports. */
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
  /** Roth conversion worksheet saved with this profile */
  rothWorksheet?: RothWorksheet | null;
};

export function normalizeHoldingsForUi(raw: unknown): UiHolding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item): UiHolding => {
    const h = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const options = Array.isArray(h.options) ? h.options.map((o) => String(o)) : [];

    const base: UiHolding = {
      rawName: String(h.rawName ?? ""),
      suggested: String(h.suggested ?? ""),
      confidence: Number.isFinite(Number(h.confidence)) ? Number(h.confidence) : 0,
      assetClass: String(h.assetClass ?? "Unknown"),
      value: Number.isFinite(Number(h.value)) ? Number(h.value) : 0,
      status: String(h.status ?? "review"),
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
    if (acct) base.accountNumber = acct;
    base.registrationType = normalizeRegistrationType(
      (h.registrationType as RegistrationBucket | undefined) ?? "unknown"
    );
    const cb = Number(h.costBasis);
    if (Number.isFinite(cb) && cb > 0) base.costBasis = cb;

    return base;
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
