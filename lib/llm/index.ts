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
import { openaiAdapter } from "./providers/openai";
import { resolveLlmContext } from "./registry";
import type {
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
}

export async function complete<T = unknown>(
  req: CompletionRequest,
  options: LlmCallOptions = {}
): Promise<CompletionResponse<T>> {
  const ctxResolved = resolveLlmContext(req.pass, {
    request: options.request,
    providerOverride: options.providerOverride ?? req.providerOverride,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, req.pass);
  // Re-resolve model under the effective provider so TTS/STT fallbacks pick the
  // right OpenAI model regardless of what the advisor selected.
  const ctx = effective.fellBack
    ? resolveLlmContext(req.pass, { ...options, providerOverride: effective.provider })
    : ctxResolved;
  return getAdapter(ctx.provider).complete(req, ctx);
}

export async function research<T = unknown>(
  req: ResearchRequest,
  options: LlmCallOptions = {}
): Promise<ResearchResult<T>> {
  const pass = researchTierToPass(req.tier);
  const ctxResolved = resolveLlmContext(pass, {
    request: options.request,
    providerOverride: options.providerOverride ?? req.providerOverride,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, pass);
  const ctx = effective.fellBack
    ? resolveLlmContext(pass, { ...options, providerOverride: effective.provider })
    : ctxResolved;
  return getAdapter(ctx.provider).research<T>(req, ctx);
}

export async function tts(req: TtsRequest, options: LlmCallOptions = {}): Promise<Buffer> {
  // TTS always falls back to OpenAI in v1 — effectiveProviderForPass enforces this.
  const ctxResolved = resolveLlmContext("tts", {
    request: options.request,
    providerOverride: options.providerOverride,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, "tts");
  const ctx = effective.fellBack
    ? resolveLlmContext("tts", { ...options, providerOverride: effective.provider })
    : ctxResolved;
  return getAdapter(ctx.provider).tts(req, ctx);
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
  return getAdapter(ctx.provider).stt(req, ctx);
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
