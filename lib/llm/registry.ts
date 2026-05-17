/**
 * Per-request provider + model resolution.
 *
 * Resolution order (highest priority first):
 *   1. Request header (`x-llm-provider`, `x-llm-model-<pass>`)            — for the UI selector / preview tools
 *   2. Persisted advisor preference (advisor_profile.llm_provider, llm_model_overrides) — *future, hooked when Settings ships*
 *   3. Env var (`LLM_<PROVIDER>_<PASS>_MODEL`, `ADVISORPILOT_DEFAULT_LLM_PROVIDER`)
 *   4. Legacy alias env vars (`OPENAI_EXTRACTION_MODEL`, etc.) — backward-compatible with today's deployments
 *   5. Hardcoded default
 *
 * In Phase 0+1 (this PR) only OpenAI is wired up; the registry already
 * understands provider resolution so future PRs only need to add adapters.
 *
 * A `NULL` profile value (or missing column) means "fall through to env" —
 * see §9.7 of docs/multi-provider-llm-plan.md.
 */

import type { AdvisorLlmSelection, LlmContext, LlmPass, LlmProvider } from "./types";
import { LlmConfigError } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded defaults (last-resort fallbacks)
// ─────────────────────────────────────────────────────────────────────────────

const HARDCODED_DEFAULT_PROVIDER: LlmProvider = "openai";

const HARDCODED_MODEL_DEFAULTS: Record<LlmProvider, Record<LlmPass, string>> = {
  openai: {
    extraction: "gpt-4o",
    "intake.turn": "gpt-4o-mini",
    "research.fast-grounded": "gpt-4o",
    "research.agentic": "gpt-4o",
    "research.deep": "gpt-4o",
    "synthesis.json": "gpt-4o",
    "fee-analysis": "gpt-4o-mini",
    chat: "gpt-4o",
    tts: "gpt-4o-mini-tts",
    stt: "whisper-1",
  },
  gemini: {
    extraction: "gemini-3-flash-preview",
    "intake.turn": "gemini-3.1-flash-lite",
    "research.fast-grounded": "gemini-3-flash-preview",
    "research.agentic": "gemini-3.1-pro-preview",
    "research.deep": "deep-research-preview-04-2026",
    "synthesis.json": "gemini-3.1-flash-lite",
    "fee-analysis": "gemini-3.1-flash-lite",
    chat: "gemini-2.5-flash",
    tts: "gemini-3.1-flash-tts-preview",
    stt: "gemini-3-flash-preview",
  },
  grok: {
    extraction: "grok-4.3",
    "intake.turn": "grok-4.3",
    "research.fast-grounded": "grok-4.3",
    "research.agentic": "grok-4.3",
    "research.deep": "grok-4.3",
    "synthesis.json": "grok-4.3",
    "fee-analysis": "grok-4.3",
    chat: "grok-4.3",
    tts: "grok-4.3",
    stt: "grok-4.3",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Env var name builders
// ─────────────────────────────────────────────────────────────────────────────

/** Pass → env-var-friendly snake (e.g. "research.fast-grounded" → "RESEARCH_FAST"). */
const PASS_TO_ENV: Record<LlmPass, string> = {
  extraction: "EXTRACTION",
  "intake.turn": "INTAKE",
  "research.fast-grounded": "RESEARCH_FAST",
  "research.agentic": "RESEARCH_AGENTIC",
  "research.deep": "RESEARCH_DEEP",
  "synthesis.json": "SYNTHESIS",
  "fee-analysis": "FEE_ANALYSIS",
  chat: "CHAT",
  tts: "TTS",
  stt: "STT",
};

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

/**
 * Backward-compatibility aliases honored only for the OpenAI provider so
 * existing `.env.local` files keep working through the rollout.
 */
function legacyOpenAiAlias(pass: LlmPass): string | undefined {
  switch (pass) {
    case "extraction":
      return trimEnv("OPENAI_EXTRACTION_MODEL");
    case "intake.turn":
      return trimEnv("OPENAI_INTAKE_MODEL");
    case "research.fast-grounded":
      // Today's enrichment research pass — fallthrough to analysis-research as the closest match.
      return trimEnv("OPENAI_ENRICHMENT_RESEARCH_MODEL") ?? trimEnv("OPENAI_ANALYSIS_RESEARCH_MODEL");
    case "research.agentic":
      return trimEnv("OPENAI_ANALYSIS_RESEARCH_MODEL");
    case "synthesis.json":
      return trimEnv("OPENAI_ANALYSIS_JSON_MODEL") ?? trimEnv("OPENAI_ENRICHMENT_JSON_MODEL");
    case "fee-analysis":
      // Existing route used OPENAI_FEE_ANALYSIS_JSON_MODEL with a
      // fallback to OPENAI_ANALYSIS_JSON_MODEL — preserve both.
      return trimEnv("OPENAI_FEE_ANALYSIS_JSON_MODEL") ?? trimEnv("OPENAI_ANALYSIS_JSON_MODEL");
    case "tts":
      return trimEnv("OPENAI_TTS_MODEL");
    case "stt":
      return trimEnv("OPENAI_STT_MODEL");
    case "research.deep":
      return undefined;
    default:
      return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve provider for the current request.
 *
 * Precedence: header → advisor profile selection → env → hardcoded.
 */
export function resolveProvider(
  request?: Request,
  selection?: AdvisorLlmSelection
): LlmProvider {
  const headerOverride = request?.headers.get("x-llm-provider")?.trim().toLowerCase();
  if (headerOverride && isProvider(headerOverride)) return headerOverride;

  if (selection?.provider) return selection.provider;

  const envDefault = trimEnv("ADVISORPILOT_DEFAULT_LLM_PROVIDER")?.toLowerCase();
  if (envDefault && isProvider(envDefault)) return envDefault;

  return HARDCODED_DEFAULT_PROVIDER;
}

/** Resolve model for a (provider, pass) combo.
 *
 * Precedence: header → advisor profile model override → env → legacy alias →
 * hardcoded default.
 */
export function resolveModel(
  provider: LlmProvider,
  pass: LlmPass,
  request?: Request,
  selection?: AdvisorLlmSelection
): string {
  // 1. Per-pass header override (used by preview tools / power users)
  const headerName = `x-llm-model-${pass}`;
  const headerOverride = request?.headers.get(headerName)?.trim();
  if (headerOverride) return headerOverride;

  // 2. Advisor profile override
  const profileOverride = selection?.models?.[pass];
  if (profileOverride) return profileOverride;

  // 3. New-style env var
  const envVar = `LLM_${provider.toUpperCase()}_${PASS_TO_ENV[pass]}_MODEL`;
  const envValue = trimEnv(envVar);
  if (envValue) return envValue;

  // 4. Legacy alias (OpenAI only)
  if (provider === "openai") {
    const legacy = legacyOpenAiAlias(pass);
    if (legacy) return legacy;
  }

  // 5. Hardcoded default
  return HARDCODED_MODEL_DEFAULTS[provider][pass];
}

/**
 * Build a complete LlmContext for the current request. Adapters expect this.
 *
 * `passOverride` lets internal call sites (eg. fallback to OpenAI for TTS)
 * change pass on the fly without re-resolving provider.
 */
export function resolveLlmContext(
  pass: LlmPass,
  options: {
    request?: Request;
    providerOverride?: LlmProvider;
    selection?: AdvisorLlmSelection;
  } = {}
): LlmContext {
  const provider =
    options.providerOverride ?? resolveProvider(options.request, options.selection);
  const model = resolveModel(provider, pass, options.request, options.selection);
  return { provider, pass, model };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal guards
// ─────────────────────────────────────────────────────────────────────────────

function isProvider(value: string): value is LlmProvider {
  return value === "openai" || value === "gemini" || value === "grok";
}

/** Throw a stable error when a provider's API key is missing. */
export function assertProviderConfigured(provider: LlmProvider): void {
  switch (provider) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) {
        throw new LlmConfigError("Missing OPENAI_API_KEY in environment.");
      }
      return;
    case "gemini":
      if (!process.env.GEMINI_API_KEY) {
        throw new LlmConfigError("Missing GEMINI_API_KEY in environment.");
      }
      return;
    case "grok":
      if (!process.env.XAI_API_KEY) {
        throw new LlmConfigError("Missing XAI_API_KEY in environment.");
      }
      return;
  }
}
