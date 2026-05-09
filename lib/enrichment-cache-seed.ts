import { canonicalizeAssetClass, isCashLikeHolding } from "./asset-classes";
import { extractLikelyCusip, extractLikelySymbol } from "./holding-validation";
import type { EnrichmentCachePayload } from "./security-enrichment-cache";
import type { UiHolding } from "./saved-review-normalize";

export type SeedCacheRow = { lookup_key: string; payload: EnrichmentCachePayload };

const NOTE_FROM_ENRICHED = "Seeded from saved AdvisorPilot holdings (prior enrichment).";
const NOTE_UNENRICHED = "Seeded from saved holdings without AI enrichment — lower confidence.";

export function seedPayloadQualityScore(p: EnrichmentCachePayload): number {
  let s = 0;
  if (p.enrichmentFigi) s += 4;
  if (p.enrichmentResolvedTicker) s += 2;
  if (Array.isArray(p.enrichmentSourceUrls) && p.enrichmentSourceUrls.length > 0) s += 1;
  if (!p.enrichmentNotes.includes("without AI")) s += 2;
  return s;
}

export function lookupKeyForUiHolding(h: UiHolding): string | null {
  const figi = String(h.enrichmentFigi || "").trim();
  if (figi) return `figi:${figi}`;

  const cusipRaw =
    String(h.normalizedCusip || "").trim().toUpperCase() ||
    extractLikelyCusip(h.suggested, h.rawName);
  const cusip = /^[0-9A-Z]{9}$/.test(cusipRaw) ? cusipRaw : "";
  if (cusip) return `cusip:${cusip}`;

  let sym =
    String(h.enrichmentResolvedTicker || "").trim().toUpperCase() ||
    String(h.normalizedSymbol || "").trim().toUpperCase() ||
    extractLikelySymbol(h.suggested, h.rawName);
  if (sym && /^(NEEDS|MANUAL|CASH)/i.test(sym)) sym = "";
  if (sym) return `sym:${sym}`;
  return null;
}

/** True when this holding row previously finished `/api/enrich-holdings` with persisted fields. */
export function holdingHasSavedAiEnrichment(h: UiHolding): boolean {
  return Boolean(
    typeof h.enrichmentCompletedAt === "string" &&
      h.enrichmentCompletedAt.trim() &&
      (h.enrichmentResolvedTicker?.trim() ||
        h.enrichmentFigi?.trim() ||
        h.enrichmentMappedAssetClass?.trim())
  );
}

export function uiHoldingToSeedCacheRow(
  h: UiHolding,
  opts: { includeUnenriched: boolean }
): SeedCacheRow | null {
  if (isCashLikeHolding(h.assetClass, h.suggested, h.rawName)) return null;
  if (h.enrichmentIsProprietaryOrThinData === true) return null;

  const enriched = holdingHasSavedAiEnrichment(h);
  if (!enriched && !opts.includeUnenriched) return null;

  const lookup_key = lookupKeyForUiHolding(h);
  if (!lookup_key) return null;

  if (enriched) {
    const mapped = canonicalizeAssetClass(
      String(h.enrichmentMappedAssetClass || h.assetClass || "Unknown")
    );
    const conf = Number.isFinite(Number(h.enrichmentConfidence))
      ? Number(h.enrichmentConfidence)
      : h.confidence;

    const payload: EnrichmentCachePayload = {
      enrichmentResolvedTicker: String(h.enrichmentResolvedTicker || "").trim().toUpperCase(),
      enrichmentResolvedName: String(h.enrichmentResolvedName || h.suggested || h.rawName).trim(),
      enrichmentShareClass: String(h.enrichmentShareClass || "").trim(),
      enrichmentMappedAssetClass: mapped,
      enrichmentSourceUrls: Array.isArray(h.enrichmentSourceUrls)
        ? h.enrichmentSourceUrls.map((u) => String(u).trim()).filter(Boolean).slice(0, 8)
        : [],
      enrichmentFigi: String(h.enrichmentFigi || "").trim(),
      enrichmentFigiSecurityType: String(h.enrichmentFigiSecurityType || "").trim(),
      enrichmentFigiSkippedReason: String(h.enrichmentFigiSkippedReason || "").trim(),
      enrichmentConfidence: Math.max(0, Math.min(100, conf)),
      enrichmentIsProprietaryOrThinData: Boolean(h.enrichmentIsProprietaryOrThinData),
      enrichmentNeedsReview: Boolean(h.enrichmentNeedsReview),
      enrichmentNotes: String(h.enrichmentNotes || "").trim() || NOTE_FROM_ENRICHED,
      suggested: h.suggested,
      assetClass: mapped,
      confidence: Math.max(0, Math.min(100, conf)),
      status: h.status,
    };
    return { lookup_key, payload };
  }

  const mapped = canonicalizeAssetClass(h.assetClass || "Unknown");
  const inferredSym =
    lookup_key.startsWith("sym:") ? lookup_key.slice(4) : extractLikelySymbol(h.suggested, h.rawName);

  const conf = h.confidence;
  const payload: EnrichmentCachePayload = {
    enrichmentResolvedTicker: inferredSym ? inferredSym.toUpperCase() : "",
    enrichmentResolvedName: h.suggested || h.rawName,
    enrichmentShareClass: "",
    enrichmentMappedAssetClass: mapped,
    enrichmentSourceUrls: [],
    enrichmentFigi: "",
    enrichmentFigiSecurityType: "",
    enrichmentFigiSkippedReason: "",
    enrichmentConfidence: Math.max(0, Math.min(100, conf)),
    enrichmentIsProprietaryOrThinData: false,
    enrichmentNeedsReview: conf < 75 || h.status === "review",
    enrichmentNotes: NOTE_UNENRICHED,
    suggested: h.suggested,
    assetClass: mapped,
    confidence: Math.max(0, Math.min(100, conf)),
    status: h.status,
  };

  return { lookup_key, payload };
}

/** Dedupe by lookup_key; keep higher-quality payload when both exist. */
export function mergeSeedRows(rows: SeedCacheRow[]): SeedCacheRow[] {
  const map = new Map<string, SeedCacheRow>();
  for (const row of rows) {
    const prev = map.get(row.lookup_key);
    if (!prev) {
      map.set(row.lookup_key, row);
      continue;
    }
    if (seedPayloadQualityScore(row.payload) > seedPayloadQualityScore(prev.payload)) {
      map.set(row.lookup_key, row);
    }
  }
  return [...map.values()];
}

export function collectSeedRowsFromHoldings(
  holdings: UiHolding[],
  opts: { includeUnenriched: boolean }
): SeedCacheRow[] {
  const raw: SeedCacheRow[] = [];
  for (const h of holdings) {
    const row = uiHoldingToSeedCacheRow(h, opts);
    if (row) raw.push(row);
  }
  return mergeSeedRows(raw);
}
