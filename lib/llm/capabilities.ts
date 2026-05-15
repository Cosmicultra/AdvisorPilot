/**
 * Capability matrix per provider × pass. Drives:
 *
 * 1. UI disabling of unsupported (provider, pass) combinations.
 * 2. Server-side fallback to OpenAI when the resolved provider can't serve a
 *    pass (TTS/STT in v1 always fall back; deep-research on Grok falls back
 *    to agentic-research with a logged warning).
 *
 * Sourced from §3 of docs/multi-provider-llm-plan.md.
 */

import type { LlmPass, LlmProvider } from "./types";

export type CapabilityLevel = "native" | "degraded" | "unsupported";

interface ProviderCapability {
  /** Native = full first-class support. Degraded = works with caveats noted below. Unsupported = use fallback. */
  level: CapabilityLevel;
  /** Human-readable note surfaced to the UI / logs. */
  note?: string;
}

type CapabilityMap = Record<LlmProvider, Record<LlmPass, ProviderCapability>>;

export const CAPABILITIES: CapabilityMap = {
  openai: {
    extraction: { level: "native" },
    "intake.turn": { level: "native" },
    "research.fast-grounded": { level: "native" },
    "research.agentic": { level: "native" },
    "research.deep": { level: "native", note: "o3-deep-research; async via background:true" },
    "synthesis.json": { level: "native" },
    tts: { level: "native" },
    stt: { level: "native" },
  },
  gemini: {
    extraction: { level: "native", note: "Native PDF; free text-layer tokens" },
    "intake.turn": { level: "native" },
    "research.fast-grounded": { level: "native", note: "google_search + url_context" },
    "research.agentic": { level: "native", note: "Single-call multi-query; bounded by thinkingLevel" },
    "research.deep": { level: "native", note: "Interactions API deep-research preview" },
    "synthesis.json": { level: "native", note: "JSON + tools combo is Gemini 3 only" },
    tts: { level: "degraded", note: "Preview-only; v1 falls back to OpenAI" },
    stt: { level: "degraded", note: "Audio understanding; no streaming; v1 falls back to OpenAI" },
  },
  grok: {
    extraction: { level: "degraded", note: "PDF rasterized to JPEG; no native PDF input" },
    "intake.turn": { level: "native" },
    "research.fast-grounded": { level: "native", note: "Agent Tools web_search (Responses API)" },
    "research.agentic": { level: "native", note: "Agent Tools loop; max_turns" },
    "research.deep": { level: "unsupported", note: "No async endpoint; falls back to extended agentic loop" },
    "synthesis.json": { level: "native" },
    tts: { level: "degraded", note: "xAI-specific REST shape; v1 falls back to OpenAI" },
    stt: { level: "degraded", note: "xAI-specific REST shape; v1 falls back to OpenAI" },
  },
};

/**
 * Returns the provider that should actually serve this pass. Falls back to
 * OpenAI when the resolved provider lists the pass as "unsupported" or as
 * "degraded" for passes we've decided to keep on OpenAI in v1 (TTS/STT).
 */
export function effectiveProviderForPass(
  resolved: LlmProvider,
  pass: LlmPass
): { provider: LlmProvider; fellBack: boolean; reason?: string } {
  const cap = CAPABILITIES[resolved][pass];

  if (cap.level === "unsupported") {
    return { provider: "openai", fellBack: true, reason: cap.note };
  }

  // v1 rule: TTS/STT always go to OpenAI regardless of selection.
  // See docs/multi-provider-llm-plan.md §16 decision.
  if (pass === "tts" || pass === "stt") {
    if (resolved === "openai") return { provider: "openai", fellBack: false };
    return {
      provider: "openai",
      fellBack: true,
      reason: "v1 keeps OpenAI for TTS/STT regardless of selected provider",
    };
  }

  return { provider: resolved, fellBack: false };
}
