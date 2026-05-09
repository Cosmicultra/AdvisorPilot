import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EnrichmentPatch } from "./enrichment-types";
import type { OpenFigiMappingResult } from "./openfigi";

export type EnrichmentCachePayload = Omit<EnrichmentPatch, "enrichmentCompletedAt">;

const TABLE = "advisorpilot_security_enrichment_cache";

export function enrichmentLookupKeys(params: {
  figi: OpenFigiMappingResult;
  cusip: string;
  inferredSymbol: string;
}): string[] {
  const keys: string[] = [];
  const liveFigi = params.figi.skipped ? "" : String(params.figi.figi || "").trim();
  if (liveFigi) keys.push(`figi:${liveFigi}`);

  const cusip = String(params.cusip || "").trim().toUpperCase();
  if (/^[0-9A-Z]{9}$/.test(cusip)) keys.push(`cusip:${cusip}`);

  const sym = String(params.inferredSymbol || "").trim().toUpperCase();
  if (sym && !/^(NEEDS|MANUAL|CASH)/i.test(sym)) keys.push(`sym:${sym}`);

  return keys;
}

export function cacheRowIsFresh(updatedAtIso: string, ttlDays: number): boolean {
  const updated = new Date(updatedAtIso).getTime();
  if (!Number.isFinite(updated)) return false;
  const ttlMs = Math.max(1, ttlDays) * 86_400_000;
  return Date.now() - updated <= ttlMs;
}

/** Treat as stale when OpenFIGI now resolves to a FIGI that disagrees with the cached row. */
export function cachedFigiConflictsLive(params: {
  cachedFigi: string;
  liveFigi: string;
  liveOpenFigiSkipped: boolean;
}): boolean {
  const live = params.liveOpenFigiSkipped ? "" : String(params.liveFigi || "").trim();
  const cached = String(params.cachedFigi || "").trim();
  if (!live) return false;
  if (!cached) return true;
  return cached !== live;
}

function payloadFromRow(raw: unknown): EnrichmentCachePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const required = [
    "enrichmentResolvedTicker",
    "enrichmentResolvedName",
    "enrichmentShareClass",
    "enrichmentMappedAssetClass",
    "enrichmentSourceUrls",
    "enrichmentFigi",
    "enrichmentFigiSecurityType",
    "enrichmentFigiSkippedReason",
    "enrichmentConfidence",
    "enrichmentIsProprietaryOrThinData",
    "enrichmentNeedsReview",
    "enrichmentNotes",
    "suggested",
    "assetClass",
    "confidence",
    "status",
  ] as const;
  for (const k of required) {
    if (!(k in p)) return null;
  }
  if (!Array.isArray(p.enrichmentSourceUrls)) return null;
  return p as unknown as EnrichmentCachePayload;
}

export function ttlDaysFromEnv(): number {
  const n = Number(process.env.SECURITY_ENRICHMENT_CACHE_TTL_DAYS);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 3650);
  return 90;
}

export async function tryGetCachedEnrichmentPatch(
  supabase: SupabaseClient,
  params: {
    figi: OpenFigiMappingResult;
    cusip: string;
    inferredSymbol: string;
  }
): Promise<EnrichmentCachePayload | null> {
  const ttlDays = ttlDaysFromEnv();
  const keys = enrichmentLookupKeys(params);
  const liveFigi = params.figi.skipped ? "" : String(params.figi.figi || "").trim();

  for (const lookupKey of keys) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("payload,updated_at")
      .eq("lookup_key", lookupKey)
      .maybeSingle();

    if (error) {
      console.error("[security-enrichment-cache] select failed:", error.message);
      continue;
    }
    if (!data?.payload || !data.updated_at) continue;

    if (!cacheRowIsFresh(String(data.updated_at), ttlDays)) continue;

    const payload = payloadFromRow(data.payload);
    if (!payload) continue;

    if (
      cachedFigiConflictsLive({
        cachedFigi: payload.enrichmentFigi,
        liveFigi,
        liveOpenFigiSkipped: Boolean(params.figi.skipped),
      })
    ) {
      continue;
    }

    return payload;
  }

  return null;
}

export async function upsertCachedEnrichmentPatch(
  supabase: SupabaseClient,
  patch: EnrichmentPatch,
  ctx: {
    figi: OpenFigiMappingResult;
    cusip: string;
    inferredSymbol: string;
  }
): Promise<void> {
  if (patch.enrichmentIsProprietaryOrThinData) return;

  const liveFigi = ctx.figi.skipped ? "" : String(ctx.figi.figi || "").trim();
  const cusip = String(ctx.cusip || "").trim().toUpperCase();
  const inferred = String(ctx.inferredSymbol || "").trim().toUpperCase();
  const resolved = String(patch.enrichmentResolvedTicker || "").trim().toUpperCase();

  let lookupKey: string | null = null;
  if (liveFigi) lookupKey = `figi:${liveFigi}`;
  else if (/^[0-9A-Z]{9}$/.test(cusip)) lookupKey = `cusip:${cusip}`;
  else if (resolved) lookupKey = `sym:${resolved}`;
  else if (inferred && !/^(NEEDS|MANUAL|CASH)/i.test(inferred)) lookupKey = `sym:${inferred}`;

  if (!lookupKey) return;

  const payload: EnrichmentCachePayload = {
    enrichmentResolvedTicker: patch.enrichmentResolvedTicker,
    enrichmentResolvedName: patch.enrichmentResolvedName,
    enrichmentShareClass: patch.enrichmentShareClass,
    enrichmentMappedAssetClass: patch.enrichmentMappedAssetClass,
    enrichmentSourceUrls: patch.enrichmentSourceUrls,
    enrichmentFigi: patch.enrichmentFigi,
    enrichmentFigiSecurityType: patch.enrichmentFigiSecurityType,
    enrichmentFigiSkippedReason: patch.enrichmentFigiSkippedReason,
    enrichmentConfidence: patch.enrichmentConfidence,
    enrichmentIsProprietaryOrThinData: patch.enrichmentIsProprietaryOrThinData,
    enrichmentNeedsReview: patch.enrichmentNeedsReview,
    enrichmentNotes: patch.enrichmentNotes,
    suggested: patch.suggested,
    assetClass: patch.assetClass,
    confidence: patch.confidence,
    status: patch.status,
  };

  const { error } = await supabase.from(TABLE).upsert(
    {
      lookup_key: lookupKey,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lookup_key" }
  );

  if (error) {
    console.error("[security-enrichment-cache] upsert failed:", error.message);
  }
}

export function createSupabaseAdminForEnrichmentCache(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}
