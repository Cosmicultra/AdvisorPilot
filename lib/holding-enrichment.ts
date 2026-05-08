import OpenAI from "openai";
import { ASSET_CLASSES, canonicalizeAssetClass, isCashLikeHolding } from "./asset-classes";
import { extractLikelyCusip, extractLikelySymbol } from "./holding-validation";
import { mapHoldingToOpenFigi } from "./openfigi";

export type EnrichmentInputHolding = {
  rawName: string;
  suggested: string;
  assetClass: string;
  value: number;
  confidence: number;
  status: string;
  options: string[];
};

export type EnrichmentPatch = {
  enrichmentCompletedAt: string;
  enrichmentResolvedTicker: string;
  enrichmentResolvedName: string;
  enrichmentShareClass: string;
  enrichmentMappedAssetClass: string;
  enrichmentSourceUrls: string[];
  enrichmentFigi: string;
  enrichmentFigiSecurityType: string;
  enrichmentFigiSkippedReason: string;
  enrichmentConfidence: number;
  enrichmentIsProprietaryOrThinData: boolean;
  enrichmentNeedsReview: boolean;
  enrichmentNotes: string;
  suggested: string;
  assetClass: string;
  confidence: number;
  status: string;
};

function detectProprietaryHint(h: EnrichmentInputHolding): boolean {
  const b = `${h.rawName} ${h.suggested} ${h.assetClass}`.toLowerCase();
  return /annuity|fixed index|fia\b|non-?traded|private placement|limited partnership|interval fund|proprietary|buffer index|myga|spia|structured note|hedge fund|private equity/i.test(
    b
  );
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
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

export async function enrichOneHolding(
  openai: OpenAI,
  holding: EnrichmentInputHolding,
  opts: { openfigiApiKey?: string }
): Promise<EnrichmentPatch> {
  const now = new Date().toISOString();

  if (isCashLikeHolding(holding.assetClass, holding.suggested, holding.rawName)) {
    const mapped = canonicalizeAssetClass(holding.assetClass);
    const conf = Math.max(Number(holding.confidence) || 0, 91);
    return {
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
    };
  }

  const cusip = extractLikelyCusip(holding.suggested, holding.rawName);
  let sym = extractLikelySymbol(holding.suggested, holding.rawName);
  if (sym && /^(NEEDS|MANUAL|CASH)/i.test(sym)) sym = "";

  const figi = await mapHoldingToOpenFigi({
    cusip,
    ticker: sym,
    apiKey: opts.openfigiApiKey,
  });

  const proprietaryHint = detectProprietaryHint(holding);

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

Write concise research bullets (max 8). Cite no URLs in this step — facts only.
`;

  const researchResponse = await openai.responses.create({
    model: "gpt-4o",
    tools: [{ type: "web_search_preview" }],
    input: researchPrompt,
  });

  const researchNotes = researchResponse.output_text || "";

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
sourceUrls must include at least one https URL whenever you claim a ticker/CUSIP mapping for a public instrument. For proprietary-only, URLs may be carrier/product pages or empty with needsAdvisorReview=true.
`;

  const jsonResponse = await openai.responses.create({
    model: "gpt-4o",
    input: jsonPrompt,
    text: { format: { type: "json_object" } },
  });

  const parsed = parseJsonObject(jsonResponse.output_text || "{}");

  const mapped = canonicalizeAssetClass(str(parsed.mappedAssetClass) || holding.assetClass);
  const resolvedTicker = str(parsed.resolvedTicker).toUpperCase();
  const figiTicker = (figi.ticker || "").toUpperCase();
  let needsReview = Boolean(parsed.needsAdvisorReview);

  if (resolvedTicker && figiTicker && resolvedTicker !== figiTicker && !figiHasSkip(figi) && figi.figi) {
    needsReview = true;
  }

  const urls = strArr(parsed.sourceUrls);
  const thin = Boolean(parsed.isProprietaryOrThinData) || proprietaryHint;
  if (!thin && resolvedTicker && urls.length === 0) {
    needsReview = true;
  }

  const display = str(parsed.suggestedDisplay) || holding.suggested;
  const conf = Math.max(0, Math.min(100, num(parsed.confidence) || 72));

  const nextStatus =
    needsReview || conf < 75 ? "review" : holding.status === "confirmed" ? "confirmed" : "matched";

  return {
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
    enrichmentNotes: str(parsed.notes),
    suggested: display,
    assetClass: mapped,
    confidence: conf,
    status: nextStatus,
  };
}
