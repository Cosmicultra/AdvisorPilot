import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSET_CLASSES, canonicalizeAssetClass, isCashLikeHolding } from "./asset-classes";
import type { EnrichmentInputHolding, EnrichmentPatch } from "./enrichment-types";
import { extractLikelyCusip, extractLikelySymbol } from "./holding-validation";
import { SYNTHETIC_CASH_TICKER } from "./cash-holding-constants";
import { complete, research } from "./llm";
import { filterUrlsToCitations } from "./llm/citation-filter";
import { mapHoldingToOpenFigi } from "./openfigi";
import {
  insertMasterFromWebEnrichment,
  masterHitToEnrichmentPatch,
  resolveFromSecuritiesMaster,
  securitiesMasterFeatureEnabled,
} from "./securities-master";
import {
  tryGetCachedEnrichmentPatch,
  upsertCachedEnrichmentPatch,
} from "./security-enrichment-cache";

export type { EnrichmentInputHolding, EnrichmentPatch } from "./enrichment-types";

export type EnrichOneHoldingResult = {
  patch: EnrichmentPatch;
  cacheHit: boolean;
};

function detectProprietaryHint(h: EnrichmentInputHolding): boolean {
  const b = `${h.rawName} ${h.suggested} ${h.assetClass}`.toLowerCase();
  return /annuity|fixed index|fia\b|non-?traded|private placement|limited partnership|interval fund|proprietary|buffer index|myga|spia|structured note|hedge fund|private equity/i.test(
    b
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
}

function figiHasSkip(figi: { skipped?: boolean }): boolean {
  return figi.skipped === true;
}

function figiSkipReason(figi: { skipped?: boolean; reason?: string }): string {
  return figi.skipped ? String(figi.reason || "") : "";
}

function patchFromCachedPayload(
  holding: EnrichmentInputHolding,
  cached: Omit<EnrichmentPatch, "enrichmentCompletedAt">
): EnrichmentPatch {
  const now = new Date().toISOString();
  const needsReview = cached.enrichmentNeedsReview;
  const conf = cached.enrichmentConfidence;
  const nextStatus =
    needsReview || conf < 75 ? "review" : holding.status === "confirmed" ? "confirmed" : "matched";

  return {
    enrichmentCompletedAt: now,
    enrichmentResolvedTicker: cached.enrichmentResolvedTicker,
    enrichmentResolvedName: cached.enrichmentResolvedName,
    enrichmentShareClass: cached.enrichmentShareClass,
    enrichmentMappedAssetClass: cached.enrichmentMappedAssetClass,
    enrichmentSourceUrls: cached.enrichmentSourceUrls,
    enrichmentFigi: cached.enrichmentFigi,
    enrichmentFigiSecurityType: cached.enrichmentFigiSecurityType,
    enrichmentFigiSkippedReason: cached.enrichmentFigiSkippedReason,
    enrichmentConfidence: cached.enrichmentConfidence,
    enrichmentIsProprietaryOrThinData: cached.enrichmentIsProprietaryOrThinData,
    enrichmentNeedsReview: cached.enrichmentNeedsReview,
    enrichmentNotes: cached.enrichmentNotes,
    suggested: cached.suggested,
    assetClass: cached.assetClass,
    confidence: cached.confidence,
    status: nextStatus,
  };
}

/**
 * Run the per-holding enrichment passes (web research + JSON synthesis)
 * through the multi-provider LLM abstraction. The OpenAI client parameter
 * from the legacy signature has been removed; provider + model selection now
 * lives in `lib/llm/registry.ts`.
 */
export async function enrichOneHolding(
  holding: EnrichmentInputHolding,
  opts: {
    openfigiApiKey?: string;
    /** When set, cached rows skip OpenAI web search + JSON passes for eligible holdings. */
    supabaseCache?: SupabaseClient | null;
    /** When `ADVISORPILOT_SECURITIES_MASTER=1`, Nasdaq seed / firm catalog lookups skip OpenFIGI + OpenAI hits. */
    supabaseMaster?: SupabaseClient | null;
  }
): Promise<EnrichOneHoldingResult> {
  const now = new Date().toISOString();

  if (isCashLikeHolding(holding.assetClass, holding.suggested, holding.rawName)) {
    const mapped = canonicalizeAssetClass(holding.assetClass);
    const conf = Math.max(Number(holding.confidence) || 0, 91);
    return {
      cacheHit: false,
      patch: {
        enrichmentCompletedAt: now,
        enrichmentResolvedTicker: "",
        enrichmentResolvedName: holding.suggested || holding.rawName,
        enrichmentShareClass: "",
        enrichmentMappedAssetClass: mapped,
        enrichmentSourceUrls: [],
        enrichmentFigi: "",
        enrichmentFigiSecurityType: "",
        enrichmentFigiSkippedReason: "cash_like_skip",
        enrichmentConfidence: conf,
        enrichmentIsProprietaryOrThinData: false,
        enrichmentNeedsReview: false,
        enrichmentNotes: "Cash or money market — skipped web and OpenFIGI.",
        suggested: holding.suggested || mapped,
        assetClass: mapped,
        confidence: conf,
        status: conf >= 75 ? "matched" : "review",
      },
    };
  }

  const cusip = extractLikelyCusip(holding.suggested, holding.rawName);
  let sym = extractLikelySymbol(holding.suggested, holding.rawName);
  if (sym && /^(NEEDS|MANUAL|CASH)/i.test(sym)) sym = "";

  if (
    securitiesMasterFeatureEnabled() &&
    opts.supabaseMaster &&
    sym &&
    sym !== SYNTHETIC_CASH_TICKER
  ) {
    const masterHit = await resolveFromSecuritiesMaster(opts.supabaseMaster, {
      inferredSymbol: sym,
      suggested: holding.suggested,
      rawName: holding.rawName,
    });
    if (masterHit) {
      const patchEarly = masterHitToEnrichmentPatch(holding, masterHit);
      return { patch: patchEarly, cacheHit: false };
    }
  }

  const figi = await mapHoldingToOpenFigi({
    cusip,
    ticker: sym,
    apiKey: opts.openfigiApiKey,
  });

  const proprietaryHint = detectProprietaryHint(holding);

  if (opts.supabaseCache) {
    const cached = await tryGetCachedEnrichmentPatch(opts.supabaseCache, {
      figi,
      cusip,
      inferredSymbol: sym,
    });
    if (cached) {
      return { patch: patchFromCachedPayload(holding, cached), cacheHit: true };
    }
  }

  const figiSummary = figiHasSkip(figi)
    ? `OpenFIGI: skipped (${figi.reason || "unknown"})`
    : `OpenFIGI: figi=${figi.figi} name=${figi.name || "?"} ticker=${figi.ticker || "?"} type=${figi.securityType || "?"}`;

  const assetClassEnum = ASSET_CLASSES.join(", ");

  const researchPrompt = `
You are verifying a single client portfolio holding for a licensed advisor using web search.

Statement line: ${JSON.stringify(holding.rawName)}
Current match label: ${JSON.stringify(holding.suggested)}
Current asset class (AdvisorPilot enum hint): ${JSON.stringify(holding.assetClass)}
Known identifiers: CUSIP=${cusip || "none"} ticker=${sym || "none"}
Proprietary / illiquid heuristic: ${proprietaryHint ? "YES — be careful not to invent tickers" : "no"}
${figiSummary}

Rules:
- Use web search to corroborate public funds, ETFs, stocks, bonds, UITs with tickers/CUSIPs.
- If proprietary (FIA, MYGA, SPIA, non-traded/private/annuity-heavy), do NOT invent tickers/CUSIPs. Summarize only what reputable sources state (carrier/product/form if found).
- Never provide buy/sell advice.
- For thin documentation, say so honestly.

- For ETFs and mutual funds, confirm the underlying sleeve (equity vs bond vs cash / money-market) from prospectus summaries or fund profiles — this drives accurate allocation math.

Write concise research bullets (max 8). Cite the public sources you used; the system will capture them automatically from your web search.
`;

  const researchResult = await research({
    tier: "fast-grounded",
    user: researchPrompt,
  });

  const researchNotes = researchResult.text;
  const researchCitations = researchResult.citations;

  const allowedSourcesBlock = researchCitations.length
    ? `\nAllowed source URLs (only these may appear in "sourceUrls"; the system will silently drop anything else):
${researchCitations.map((c, i) => `[${i + 1}] ${c.uri}`).join("\n")}
`
    : `\nNo public source URLs were captured by web search. "sourceUrls" must therefore be empty (the system will drop anything else).
`;

  const jsonPrompt = `
Map the holding to AdvisorPilot fields using the research notes. Return ONLY JSON.

AdvisorPilot asset classes — pick exactly one string from this comma-separated list (verbatim):
${assetClassEnum}

Allocation-critical rule for wrappers:
- If the security is an ETF, choose Equity ETF, Bond ETF, or Cash ETF when the underlying sleeve is clear from research (equity/stock index vs bond/fixed vs money-market / ultra-short cash / T-bill type). Use plain ETF only if the sleeve cannot be determined.
- If the security is an open-end mutual fund, choose Equity Mutual Fund, Bond Mutual Fund, or Cash Mutual Fund the same way. Use Mutual Fund only if the sleeve cannot be determined.

Statement line: ${JSON.stringify(holding.rawName)}
Prior label: ${JSON.stringify(holding.suggested)}
${figiSummary}

Research notes:
${researchNotes}
${allowedSourcesBlock}
JSON shape:
{
  "resolvedTicker": "uppercase symbol or empty if none / proprietary",
  "resolvedName": "official or best-match name",
  "shareClass": "share class text or empty",
  "mappedAssetClass": "one exact string from the AdvisorPilot list above",
  "sourceUrls": ["https://..."],
  "confidence": 0-100,
  "isProprietaryOrThinData": true/false,
  "needsAdvisorReview": true/false,
  "notes": "short advisor-facing note",
  "suggestedDisplay": "TICKER - Name - ShareClass" or a descriptive label without fake tickers
}

needsAdvisorReview=true if: sources weak, ticker conflicts OpenFIGI (${figi.ticker || ""}), multiple share classes plausible, proprietary with sparse data, or ETF/mutual-fund sleeve (equity vs bond vs cash) is still ambiguous after research.
resolvedTicker must be empty if proprietary/no public symbol.
sourceUrls: include ONLY URLs from the "Allowed source URLs" list above. Do not invent URLs from memory; the system will drop any URL that is not in the allowed list.
`;

  const jsonResult = await complete<Record<string, unknown>>({
    pass: "synthesis.json",
    user: jsonPrompt,
    jsonSchema: { type: "object" },
  });

  const parsed = (jsonResult.json ?? {}) as Record<string, unknown>;

  const mapped = canonicalizeAssetClass(str(parsed.mappedAssetClass) || holding.assetClass);
  const resolvedTicker = str(parsed.resolvedTicker).toUpperCase();
  const figiTicker = (figi.ticker || "").toUpperCase();
  let needsReview = Boolean(parsed.needsAdvisorReview);

  if (resolvedTicker && figiTicker && resolvedTicker !== figiTicker && !figiHasSkip(figi) && figi.figi) {
    needsReview = true;
  }

  // Bug fix: the JSON pass historically returned `sourceUrls` from model
  // memory. Pin them to the actual research citations.
  const proposedUrls = strArr(parsed.sourceUrls);
  const { kept: urls, dropped } = filterUrlsToCitations(proposedUrls, researchCitations);
  if (dropped.length > 0) {
    console.warn(
      `[enrich-holdings] dropped ${dropped.length} hallucinated URL(s) not in research citations:`,
      dropped
    );
  }

  const thin = Boolean(parsed.isProprietaryOrThinData) || proprietaryHint;
  if (!thin && resolvedTicker && urls.length === 0) {
    needsReview = true;
  }

  const display = str(parsed.suggestedDisplay) || holding.suggested;
  const conf = Math.max(0, Math.min(100, num(parsed.confidence) || 72));

  let enrichmentNotes = str(parsed.notes);
  if (!enrichmentNotes.trim() && thin) {
    enrichmentNotes =
      "Could not verify this holding against the firm securities master catalog or widely available public sources. It may be proprietary, institutional-only, or not publicly listed.";
  }

  const nextStatus =
    needsReview || conf < 75 ? "review" : holding.status === "confirmed" ? "confirmed" : "matched";

  const patch: EnrichmentPatch = {
    enrichmentCompletedAt: now,
    enrichmentResolvedTicker: resolvedTicker,
    enrichmentResolvedName: str(parsed.resolvedName),
    enrichmentShareClass: str(parsed.shareClass),
    enrichmentMappedAssetClass: mapped,
    enrichmentSourceUrls: urls,
    enrichmentFigi: figi.figi || "",
    enrichmentFigiSecurityType: figi.securityType || "",
    enrichmentFigiSkippedReason: figiSkipReason(figi),
    enrichmentConfidence: conf,
    enrichmentIsProprietaryOrThinData: thin,
    enrichmentNeedsReview: needsReview,
    enrichmentNotes,
    suggested: display,
    assetClass: mapped,
    confidence: conf,
    status: nextStatus,
  };

  if (opts.supabaseCache) {
    await upsertCachedEnrichmentPatch(opts.supabaseCache, patch, {
      figi,
      cusip,
      inferredSymbol: sym,
    });
  }

  if (securitiesMasterFeatureEnabled() && opts.supabaseMaster) {
    await insertMasterFromWebEnrichment(opts.supabaseMaster, patch);
  }

  return { patch, cacheHit: false };
}
