import { ASSET_CLASSES } from "./asset-classes";
import type { EnrichmentInputHolding } from "./enrichment-types";

/** Offline regression checklist — run holdings extraction manually on anonymized PDFs/images. */
export const STATEMENT_EXTRACTION_EVAL_CHECKLIST = [
  "multi-account-Roth-vs-qualified-headings",
  "non-qualified-with-cost-basis-columns",
  "stable-value-vs-money-market-rows",
  "annuity-or-proprietary-name-without-ticker",
  "sweep-and-cash-awaiting-investment-lines",
  "brokerage-consolidated-multipage",
  "messy-scan-low-contrast-statement-image",
  "fund-share-class-ticker-at-end-of-long-name",
] as const;

export type EnrichmentJsonEvalFixture = {
  /** Stable slug for dashboards / spreadsheets */
  id: string;
  /** What this case is probing */
  scenario: string;
  holding: EnrichmentInputHolding;
  figiSummary: string;
  /** Deterministic fake output as if web-search pass succeeded */
  researchNotes: string;
};

const baseFields = {
  value: 100_000,
  confidence: 80,
  status: "review" as const,
  options: ["Option A", "Option B", "Manual ticker / CUSIP entry"],
};

/** Grounded inputs for JSON-only enrichment passes — pair with `buildEnrichmentJsonEvalPrompt`. */
export const ENRICHMENT_JSON_EVAL_FIXTURES: EnrichmentJsonEvalFixture[] = [
  {
    id: "ambiguous-bond-etf-name",
    scenario: "Bond sleeve vs generic ETF label",
    holding: {
      rawName: "ISHARES CORE US AGGREGATE BD ETF",
      suggested: "AGG - Aggregate Bond ETF",
      assetClass: "ETF",
      ...baseFields,
    },
    figiSummary:
      'OpenFIGI: figi=BBG004SCSYG7 name="iShares Core US Aggregate Bond ETF" ticker=AGG type=ETF',
    researchNotes:
      "- Broad US investment-grade aggregate bond ETF; tracks Barclays US Aggregate Bond Index.\n- Underlying sleeve: investment-grade taxable bonds.\n- Ticker AGG widely used for aggregate bond beta.",
  },
  {
    id: "ultra-short-treasury-cash-sleeve",
    scenario: "Cash vs bond sleeve for treasury money-market ETF",
    holding: {
      rawName: "SPDR Bloomberg 1-3 Mo Tbill ETF",
      suggested: "BIL",
      assetClass: "ETF",
      ...baseFields,
    },
    figiSummary:
      'OpenFIGI: figi=placeholder name="SPD Bloomberg Barclays 1-3 Month T-Bill ETF" ticker=BIL type=ETF',
    researchNotes:
      "- Tracks very short-duration US Treasury obligations (1–3 months).\n- Often used as low-volatility cash / liquidity sleeve rather than intermediate bonds.\n- Prospectus cites US T-bills and equivalents.",
  },
  {
    id: "proprietary-ish-no-ticker",
    scenario: "Flags review when public mapping is fragile",
    holding: {
      rawName: "NON-TRADED RE INV TR II",
      suggested: "Needs advisor confirmation",
      assetClass: "Alternative / Other",
      ...baseFields,
    },
    figiSummary: "OpenFIGI: skipped (insufficient identifiers)",
    researchNotes:
      "- Thin public references; characteristic of semi-liquid/non-traded RE programs.\n- No reliable exchange ticker.",
  },
];

function assetClassEnumBlock(): string {
  return ASSET_CLASSES.join(", ");
}

/** Mirrors `holding-enrichment` JSON pass inputs for offline / paired model tests. */
export function buildEnrichmentJsonEvalPrompt(f: EnrichmentJsonEvalFixture): string {
  return `
Map the holding to AdvisorPilot fields using the research notes. Return ONLY JSON.

AdvisorPilot asset classes — pick exactly one string from this comma-separated list (verbatim):
${assetClassEnumBlock()}

Allocation-critical rule for wrappers:
- If the security is an ETF, choose Equity ETF, Bond ETF, or Cash ETF when the underlying sleeve is clear from research (equity/stock index vs bond/fixed vs money-market / ultra-short cash / T-bill type). Use plain ETF only if the sleeve cannot be determined.

Statement line: ${JSON.stringify(f.holding.rawName)}
Prior label: ${JSON.stringify(f.holding.suggested)}
${f.figiSummary}

Research notes:
${f.researchNotes}

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

resolvedTicker must be empty if proprietary/no public symbol.
sourceUrls must include at least one https URL whenever you claim a ticker mapping for a public instrument.
`;
}

export type AnalysisJsonEvalFixture = {
  analysisDate: string;
  client: Record<string, unknown>;
  holdings: Record<string, unknown>[];
  allocation: Record<string, unknown>;
  totalValue: number;
  researchNotes: string;
};

/** Tiny portfolio context for paired JSON-pass smoke runs (same prompt → two models). */
export const ANALYSIS_JSON_EVAL_FIXTURE: AnalysisJsonEvalFixture = {
  analysisDate: "May 9, 2026",
  client: {
    firstName: "Jamie",
    riskProfile: "Moderate Growth",
    retirementAge: 66,
    riskIntakeKnown: "yes",
  },
  holdings: [
    {
      rawName: "VOO Vanguard S&P 500 ETF",
      suggested: "VOO",
      assetClass: "Equity ETF",
      value: 220_000,
      confidence: 92,
      status: "matched",
      registrationType: "qualified",
    },
    {
      rawName: "AGG",
      suggested: "AGG",
      assetClass: "Bond ETF",
      value: 80_000,
      confidence: 90,
      status: "matched",
      registrationType: "qualified",
    },
  ],
  allocation: {
    current: { equity: 73, fixedIncome: 22, cash: 5 },
    target: { equity: 60, fixedIncome: 35, cash: 5 },
  },
  totalValue: 300_000,
  researchNotes:
    "- Equities moderately extended vs long-run valuations; dispersion elevated.\n" +
    "- Policy rates stabilized; yields off peak; volatility in rates still matters for sleeve duration.",
};

export function buildAnalysisJsonEvalPrompt(f: AnalysisJsonEvalFixture): string {
  return `
You are AdvisorPilot. Return ONLY valid JSON. No markdown. No commentary.

Today's analysis date: ${f.analysisDate}

Return a JSON object with these keys exactly:
- synopsis: single string beginning with "As of ${f.analysisDate}," then 5–6 sentences; cite at least one ticker from Holdings; weave current vs target allocation briefly; mention risk posture.
- portfolioHighlights: array of exactly 3 one-sentence strings (no overlap with synopsis wording).
- strategies: exactly 3 strings.
- redFlags, overlapInsights, displayWhatThisMeans, recommendations, talkingPoints: each an array with exactly 2 strings.
- advisorOpeningScript: one string.
- objectionHandling: array of exactly 2 strings.

Client:
${JSON.stringify(f.client, null, 2)}
Holdings:
${JSON.stringify(f.holdings, null, 2)}
Allocation:
${JSON.stringify(f.allocation, null, 2)}
Total Value:
${f.totalValue}

Market Research Notes:
${f.researchNotes}

NON-NEGOTIABLE: synopsis must NOT repeat verbatim strings from portfolioHighlights. Sections must stay distinct roles. No buy/sell orders. No guarantees.
`;
}
