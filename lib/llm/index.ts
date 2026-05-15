/**
 * Public LLM facade. Route handlers and library helpers should import only
 * `complete` / `research` / `tts` / `stt` from here — never the provider SDKs
 * directly.
 *
 * In Phase 0+1 only the OpenAI adapter is wired up. The dispatch shape below
 * is what additional providers will plug into in Phase 2 (Gemini) and Phase 3
 * (Grok).
 */

import type { Buffer } from "buffer";
import { effectiveProviderForPass } from "./capabilities";
import { advisorEmailHint, llmDebug, logLlmCall } from "./observability";
import { geminiAdapter } from "./providers/gemini";
import { grokAdapter } from "./providers/grok";
import { openaiAdapter } from "./providers/openai";
import { resolveLlmContext } from "./registry";
import type {
  AdvisorLlmSelection,
  CompletionRequest,
  CompletionResponse,
  LlmAdapter,
  LlmProvider,
  ResearchRequest,
  ResearchResult,
  ResearchTier,
  SttRequest,
  TtsRequest,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Adapter registry (only OpenAI today)
// ─────────────────────────────────────────────────────────────────────────────

const ADAPTERS: Partial<Record<LlmProvider, LlmAdapter>> = {
  openai: openaiAdapter,
  gemini: geminiAdapter,
  grok: grokAdapter,
};

function getAdapter(provider: LlmProvider): LlmAdapter {
  const a = ADAPTERS[provider];
  if (a) return a;
  // Future: gemini / grok land here. Until then, fall back transparently.
  console.warn(
    `[llm] provider "${provider}" not yet implemented; falling back to openai`
  );
  return openaiAdapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmCallOptions {
  /** Optional Request — used by `registry.ts` for header-based overrides. */
  request?: Request;
  /** Force a specific provider (testing / preview tooling). */
  providerOverride?: LlmProvider;
  /**
   * Per-advisor provider + model selection loaded from
   * `advisorpilot_advisor_profiles` via `resolveAdvisorLlmSelection()`.
   * When omitted, the resolver falls through to env / hardcoded defaults.
   */
  selection?: AdvisorLlmSelection;
}

export async function complete<T = unknown>(
  req: CompletionRequest,
  options: LlmCallOptions = {}
): Promise<CompletionResponse<T>> {
  const ctxResolved = resolveLlmContext(req.pass, {
    request: options.request,
    providerOverride: options.providerOverride ?? req.providerOverride,
    selection: options.selection,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, req.pass);
  const ctx = effective.fellBack
    ? resolveLlmContext(req.pass, { ...options, providerOverride: effective.provider })
    : ctxResolved;
  if (effective.fellBack) {
    llmDebug(`fallback ${ctxResolved.provider} → ${effective.provider} (${effective.reason ?? ""})`, {
      pass: req.pass,
    });
  }
  const advisor = advisorEmailHint(options.request, undefined);
  const start = performance.now();
  try {
    const result = await getAdapter(ctx.provider).complete<T>(req, ctx);
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      usage: result.usage,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      extra: { hasJson: result.json !== undefined ? 1 : 0, attachments: req.attachments?.length ?? 0 },
    });
    return result;
  } catch (err) {
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function research<T = unknown>(
  req: ResearchRequest,
  options: LlmCallOptions = {}
): Promise<ResearchResult<T>> {
  const pass = researchTierToPass(req.tier);
  const ctxResolved = resolveLlmContext(pass, {
    request: options.request,
    providerOverride: options.providerOverride ?? req.providerOverride,
    selection: options.selection,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, pass);
  const ctx = effective.fellBack
    ? resolveLlmContext(pass, { ...options, providerOverride: effective.provider })
    : ctxResolved;
  if (effective.fellBack) {
    llmDebug(`research fallback ${ctxResolved.provider} → ${effective.provider} (${effective.reason ?? ""})`, {
      tier: req.tier,
    });
  }
  const advisor = advisorEmailHint(options.request, undefined);
  const start = performance.now();
  try {
    const result = await getAdapter(ctx.provider).research<T>(req, ctx);
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      usage: result.usage,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      extra: {
        tier: req.tier,
        citations: result.citations.length,
        async: result.asyncHandle ? 1 : 0,
      },
    });
    return result;
  } catch (err) {
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      error: err instanceof Error ? err.message : String(err),
      extra: { tier: req.tier },
    });
    throw err;
  }
}

export async function tts(req: TtsRequest, options: LlmCallOptions = {}): Promise<Buffer> {
  const ctxResolved = resolveLlmContext("tts", {
    request: options.request,
    providerOverride: options.providerOverride,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, "tts");
  const ctx = effective.fellBack
    ? resolveLlmContext("tts", { ...options, providerOverride: effective.provider })
    : ctxResolved;
  const advisor = advisorEmailHint(options.request, undefined);
  const start = performance.now();
  try {
    const out = await getAdapter(ctx.provider).tts(req, ctx);
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      extra: { chars: req.text.length, bytes: out.length },
    });
    return out;
  } catch (err) {
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function stt(req: SttRequest, options: LlmCallOptions = {}): Promise<string> {
  const ctxResolved = resolveLlmContext("stt", {
    request: options.request,
    providerOverride: options.providerOverride,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, "stt");
  const ctx = effective.fellBack
    ? resolveLlmContext("stt", { ...options, providerOverride: effective.provider })
    : ctxResolved;
  const advisor = advisorEmailHint(options.request, undefined);
  const start = performance.now();
  try {
    const text = await getAdapter(ctx.provider).stt(req, ctx);
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      extra: { audioBytes: req.audio.length, chars: text.length },
    });
    return text;
  } catch (err) {
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      fallbackFrom: effective.fellBack ? ctxResolved.provider : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function researchTierToPass(tier: ResearchTier) {
  switch (tier) {
    case "fast-grounded":
      return "research.fast-grounded" as const;
    case "agentic-research":
      return "research.agentic" as const;
    case "deep-research":
      return "research.deep" as const;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports (so consumers only import from "@/lib/llm")
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AdvisorLlmSelection,
  Attachment,
  AttachmentKind,
  Citation,
  CompletionRequest,
  CompletionResponse,
  LlmContext,
  LlmPass,
  LlmProvider,
  ResearchRequest,
  ResearchResult,
  ResearchTier,
  SttRequest,
  TtsRequest,
  TokenUsage,
} from "./types";
export {
  LlmAttachmentError,
  LlmCapabilityError,
  LlmConfigError,
  LlmValidationError,
} from "./types";
export { resolveLlmContext, resolveProvider, resolveModel } from "./registry";
export { resolveAdvisorLlmSelection } from "./advisor-selection";
