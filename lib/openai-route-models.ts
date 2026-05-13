/**
 * Per-pass OpenAI model selection for Responses API routes.
 *
 * Capability notes (check OpenAI docs when upgrading SDK / models):
 * - JSON-only passes (`text.format: { type: "json_object" }`) are supported on `gpt-4o-mini`
 *   as well as `gpt-4o`; good candidate for cost savings after QA.
 * - Research passes here use `web_search_preview`; quality is sensitive—defaults stay on
 *   `gpt-4o`. OpenAI documents dedicated search-capable snapshots (e.g. *-search-preview)
 *   if you experiment with cheaper research tiers.
 */

const DEFAULT_MAIN = "gpt-4o";

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

/** Web-search macro notes before portfolio JSON synthesis (`/api/generate-analysis`). */
export function analysisResearchModel(): string {
  return trimEnv("OPENAI_ANALYSIS_RESEARCH_MODEL") ?? DEFAULT_MAIN;
}

/** Structured portfolio review JSON (`/api/generate-analysis`). */
export function analysisJsonModel(): string {
  return trimEnv("OPENAI_ANALYSIS_JSON_MODEL") ?? DEFAULT_MAIN;
}

/** Web-search bullets for one holding (`/api/enrich-holdings` → `lib/holding-enrichment`). */
export function enrichmentResearchModel(): string {
  return trimEnv("OPENAI_ENRICHMENT_RESEARCH_MODEL") ?? DEFAULT_MAIN;
}

/** Map research notes → enrichment JSON (`/api/enrich-holdings`). */
export function enrichmentJsonModel(): string {
  return trimEnv("OPENAI_ENRICHMENT_JSON_MODEL") ?? DEFAULT_MAIN;
}

/** Statement PDF/image extraction (`lib/extract-statement-holdings` → `/api/analyze-statement`). */
export function extractionModel(): string {
  return trimEnv("OPENAI_EXTRACTION_MODEL") ?? DEFAULT_MAIN;
}

/**
 * Upper bound for extraction JSON size (many holdings × options[] can exceed low defaults).
 * Override with `OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS` (positive integer).
 */
export function extractionMaxOutputTokens(): number {
  const raw = trimEnv("OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS");
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1024) return Math.min(Math.floor(n), 32768);
  }
  return 16384;
}

/**
 * When `ADVISORPILOT_OPENAI_LOG_MODEL_PASS=1`, logs `[openai:route:pass] model=…` per call.
 */
export function logOpenAiPass(routeTag: string, pass: string, model: string) {
  if (process.env.ADVISORPILOT_OPENAI_LOG_MODEL_PASS !== "1") return;
  console.info(`[openai:${routeTag}:${pass}] model=${model}`);
}
