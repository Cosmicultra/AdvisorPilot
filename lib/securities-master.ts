import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeAssetClass, type AssetClassId } from "./asset-classes";
import { SYNTHETIC_CASH_TICKER } from "./cash-holding-constants";

export const SECURITIES_MASTER_TABLE = "advisorpilot_securities_master";

export type SecuritiesMasterRow = {
  id?: string;
  primary_symbol: string;
  holding_name: string;
  investment_type: string;
  share_class: string;
  nasdaq_asset_class: string;
  region_scope: string;
  source?: string;
};

export function securitiesMasterFeatureEnabled(): boolean {
  return process.env.ADVISORPILOT_SECURITIES_MASTER === "1";
}

export function securitiesMasterConfidenceThreshold(): number {
  const n = Number(process.env.ADVISORPILOT_MASTER_NAME_SCORE_THRESHOLD);
  if (!Number.isFinite(n) || n < 0) return 35;
  if (n > 100) return 100;
  return Math.floor(n);
}

export function createSupabaseAdminForSecuritiesMaster(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Canonical exchange symbol formatting: trim, ASCII uppercase (locale-safe), preserves "$" suffix.
 */
export function normalizePrimarySymbol(raw: unknown): string {
  let s = String(raw ?? "").trim();
  const upperAscii = /[a-z]/;
  if (upperAscii.test(s)) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 97 && c <= 122) out += String.fromCharCode(c - 32);
      else out += s[i]!;
    }
    s = out;
  }
  return s.trim();
}

const NASDAQ_LABELS = new Map<string, AssetClassId>([
  ["stock / equity", "Individual Stock"],
  ["stock etf", "Equity ETF"],
  ["bond etf / fixed income etf", "Bond ETF"],
  ["international / global stock etf", "International Equity"],
  ["foreign equity", "International Equity"],
  ["preferred equity", "Individual Stock"],
  ["leveraged / inverse etf", "Equity ETF"],
  ["alternative / options strategy etf", "Equity ETF"],
  ["commodity / crypto etf or trust", "Alternative / Other"],
  ["real estate etf", "Equity ETF"],
  ["cash / cash-like etf", "Cash ETF"],
  ["listed fund / trust", "Mutual Fund"],
  ["closed-end fund", "Mutual Fund"],
  ["derivative / warrant", "Alternative / Other"],
  ["rights", "Alternative / Other"],
  ["unit", "Alternative / Other"],
  ["other", "Unknown"],
]);

/**
 * Maps raw Nasdaq-style `Asset Class` strings from CSV / master table onto AdvisorPilot ASSET_CLASSES.
 */
export function mapNasdaqAssetClassToAdvisorPilot(nasdaqRaw: unknown): AssetClassId {
  const trimmed = String(nasdaqRaw ?? "").trim();
  if (!trimmed) return canonicalizeAssetClass("");
  const key = trimmed.toLowerCase();
  const direct = NASDAQ_LABELS.get(key);
  return direct ?? canonicalizeAssetClass(trimmed);
}

const WORD_RE = /\b[a-zA-Z][a-zA-Z\-]{2,}\b/g;

/** Jaccard-style token overlap ratio 0..1 across meaningful words */
export function holdingNameConsistencyScore(statementBlob: string, masterName: string): number {
  const take = (s: string) => {
    const out = new Set<string>();
    const u = String(s || "").toLowerCase();
    let m: RegExpExecArray | null;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(u)) !== null) {
      const w = m[0];
      const skip = [
        "inc",
        "llc",
        "corp",
        "company",
        "co",
        "ltd",
        "plc",
        "the",
        "and",
        "for",
      ];
      if (skip.includes(w)) continue;
      out.add(w);
    }
    return out;
  };

  const a = take(statementBlob);
  const b = take(masterName);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) inter++;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export type ResolveSecuritiesMasterInput = {
  inferredSymbol: string;
  suggested: string;
  rawName: string;
};

export type ResolveSecuritiesMasterHit = {
  row: SecuritiesMasterRow;
  matchConfidencePercent: number;
  nameConsistencyPercent: number;
};

/**
 * Loads one row when `primary_symbol` matches (normalized). Validates name similarity when master has a holding_name.
 */
export async function resolveFromSecuritiesMaster(
  supabase: SupabaseClient,
  row: ResolveSecuritiesMasterInput
): Promise<ResolveSecuritiesMasterHit | null> {
  const sym = normalizePrimarySymbol(row.inferredSymbol);
  if (
    !sym ||
    sym === SYNTHETIC_CASH_TICKER ||
    /^NEEDS\s|^MANUAL\s|^NEEDSADVISOR$/i.test(sym) ||
    /NEEDS\s+ADVISOR|MANUAL\s+TICKER/i.test(`${sym} ${row.suggested}`)
  )
    return null;

  const { data, error } = await supabase
    .from(SECURITIES_MASTER_TABLE)
    .select(
      "id, primary_symbol, holding_name, investment_type, share_class, nasdaq_asset_class, region_scope, source"
    )
    .eq("primary_symbol", sym)
    .maybeSingle();

  if (error) {
    console.error("[securities-master] lookup failed:", error.message);
    return null;
  }
  if (!data?.primary_symbol) return null;

  const masterRow = data as SecuritiesMasterRow;
  const masterName = String(masterRow.holding_name || "").trim();
  const statementBlob = `${row.rawName}\n${row.suggested}`;
  let nameConsistency = holdingNameConsistencyScore(statementBlob, masterName);
  if (!masterName) nameConsistency = 1;

  const pct = Math.round(nameConsistency * 100);
  const threshold = securitiesMasterConfidenceThreshold();
  const matchConfidencePercent = pct;

  if (masterName && pct < threshold) {
    return null;
  }

  return { row: masterRow, matchConfidencePercent, nameConsistencyPercent: pct };
}

export function buildSuggestedDisplay(master: SecuritiesMasterRow): string {
  const sym = normalizePrimarySymbol(master.primary_symbol);
  const name = String(master.holding_name || "").trim();
  if (!name) return sym;
  return `${sym} - ${name}`;
}

export type HoldingLikeForMerge = Record<string, unknown>;

/**
 * Applies firm master match onto an extracted / normalized holding-shaped object for UI + enrichment fields.
 */
export function applyMasterResolutionToHolding(
  holding: HoldingLikeForMerge,
  hit: ResolveSecuritiesMasterHit
): HoldingLikeForMerge {
  const m = hit.row;
  const mappedAsset = mapNasdaqAssetClassToAdvisorPilot(m.nasdaq_asset_class);
  const display = buildSuggestedDisplay(m);
  const conf = Math.max(Number(holding.confidence) || 0, hit.matchConfidencePercent, 88);

  const nowIso = new Date().toISOString();

  return {
    ...holding,
    suggested: display,
    assetClass: mappedAsset,
    confidence: Math.min(98, Math.max(Number(holding.confidence) || 0, conf)),
    status: mappedAsset !== "Unknown" && hit.matchConfidencePercent >= 75 ? "matched" : "review",
    masterResolvedSymbol: normalizePrimarySymbol(m.primary_symbol),
    masterResolvedNote: `Matched firm securities catalog (${normalizePrimarySymbol(m.primary_symbol)})`,
    enrichmentCompletedAt: nowIso,
    enrichmentResolvedTicker: normalizePrimarySymbol(m.primary_symbol),
    enrichmentResolvedName: String(m.holding_name || ""),
    enrichmentShareClass: String(m.share_class || ""),
    enrichmentMappedAssetClass: mappedAsset,
    enrichmentSourceUrls: [],
    enrichmentFigi: "",
    enrichmentFigiSecurityType: "",
    enrichmentFigiSkippedReason: "securities_master_hit",
    enrichmentConfidence: Math.min(96, Math.max(conf, 88)),
    enrichmentIsProprietaryOrThinData: false,
    enrichmentNeedsReview:
      hit.matchConfidencePercent < 75 || mappedAsset === "Unknown",
    enrichmentNotes: `Verified from adviser securities master: ${normalizePrimarySymbol(m.primary_symbol)}. ${String(m.region_scope || "").trim() ? `Regional scope: ${m.region_scope.trim()}` : ""}`.trim(),
  };
}

/**
 * Builds the same enrichment patch shape as enriching after OpenAI (minus FIGI urls).
 */
export function masterHitToEnrichmentPatch(
  holding: { status: string; confidence: number; assetClass?: string },
  hit: ResolveSecuritiesMasterHit
): import("./enrichment-types").EnrichmentPatch {
  const merged = applyMasterResolutionToHolding(holding as HoldingLikeForMerge, hit);
  const mappedAsset = canonicalizeAssetClass(
    String(merged.enrichmentMappedAssetClass ?? hit.row.nasdaq_asset_class)
  );
  const nextStatus =
    merged.enrichmentNeedsReview === true || Number(merged.enrichmentConfidence) < 75
      ? "review"
      : holding.status === "confirmed"
        ? "confirmed"
        : "matched";

  return {
    enrichmentCompletedAt: String(merged.enrichmentCompletedAt),
    enrichmentResolvedTicker: String(merged.enrichmentResolvedTicker),
    enrichmentResolvedName: String(merged.enrichmentResolvedName),
    enrichmentShareClass: String(merged.enrichmentShareClass),
    enrichmentMappedAssetClass: mappedAsset,
    enrichmentSourceUrls: [],
    enrichmentFigi: "",
    enrichmentFigiSecurityType: "",
    enrichmentFigiSkippedReason: "securities_master_hit",
    enrichmentConfidence: Number(merged.enrichmentConfidence) || hit.matchConfidencePercent,
    enrichmentIsProprietaryOrThinData: false,
    enrichmentNeedsReview: merged.enrichmentNeedsReview === true,
    enrichmentNotes: String(merged.enrichmentNotes ?? ""),
    suggested: String(merged.suggested),
    assetClass: mappedAsset,
    confidence: Number(merged.confidence) || Number(holding.confidence),
    status: nextStatus,
  };
}

function reverseMapAdvisorPilotToRoughNasdaq(mappedLabel: AssetClassId): string {
  const mapRev: Partial<Record<AssetClassId, string>> = {
    "Individual Stock": "Stock / Equity",
    "Equity ETF": "Stock ETF",
    "Bond ETF": "Bond ETF / Fixed Income ETF",
    "International Equity": "International / Global Stock ETF",
    "Mutual Fund": "Listed Fund / Trust",
    "Cash ETF": "Cash / Cash-Like ETF",
    "Alternative / Other": "Other",
    Unknown: "Other",
    ETF: "Stock ETF",
  };
  return mapRev[mappedLabel] ?? "Other";
}

/**
 * INSERT new symbol from successful web enrichment; never overwrites Nasdaq seed rows (`source = nasdaq_csv`).
 */
export async function insertMasterFromWebEnrichment(
  supabase: SupabaseClient,
  patch: import("./enrichment-types").EnrichmentPatch
): Promise<void> {
  const sym = normalizePrimarySymbol(patch.enrichmentResolvedTicker);
  if (!sym || patch.enrichmentIsProprietaryOrThinData) return;
  const mapped = canonicalizeAssetClass(patch.enrichmentMappedAssetClass || patch.assetClass);

  const { data: existing, error: selErr } = await supabase
    .from(SECURITIES_MASTER_TABLE)
    .select("primary_symbol, source")
    .eq("primary_symbol", sym)
    .maybeSingle();

  if (selErr) {
    console.error("[securities-master] insert precheck failed:", selErr.message);
    return;
  }
  if (existing?.primary_symbol) return;

  const nasdaqRough = reverseMapAdvisorPilotToRoughNasdaq(mapped);

  const { error } = await supabase.from(SECURITIES_MASTER_TABLE).insert({
    primary_symbol: sym,
    holding_name: String(patch.enrichmentResolvedName || "").trim(),
    investment_type: "Enriched instrument",
    share_class: String(patch.enrichmentShareClass || "").trim(),
    nasdaq_asset_class: nasdaqRough,
    region_scope:
      /international|global|exo-us|developed ex|msci all country/i.test(
        `${patch.enrichmentResolvedName} ${patch.suggested}`
      )
        ? "Foreign / International"
        : /global/i.test(patch.suggested.toLowerCase())
          ? "Global"
          : "Domestic / U.S. Listed",
    source: "web_enrichment",
  });

  if (error && !`${error.message}`.includes("duplicate")) {
    console.error("[securities-master] insert enrichment row failed:", error.message);
  }
}
