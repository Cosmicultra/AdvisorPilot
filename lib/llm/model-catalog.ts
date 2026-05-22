/**
 * Selectable model IDs per provider per pass — drives the Settings drawer
 * "AI Models" tab dropdowns.
 *
 * Add a new model: append to the relevant array. The UI re-renders without
 * other code changes; a "Custom…" option in the dropdown also accepts any
 * free-text ID so power users aren't blocked when a new model snapshot lands
 * before we ship a release.
 *
 * Default model per (provider, pass) lives in `registry.ts` — same source of
 * truth as the env-var resolver.
 */

import type { LlmPass, LlmProvider } from "./types";

export const MODEL_CATALOG: Record<LlmProvider, Partial<Record<LlmPass, string[]>>> = {
  openai: {
    extraction: ["gpt-4o", "gpt-4o-mini"],
    "extraction.classify": ["gpt-4o-mini", "gpt-4o"],
    "extraction.annuity": ["gpt-4o", "gpt-4o-mini"],
    "intake.turn": ["gpt-4o-mini", "gpt-4o"],
    "research.fast-grounded": ["gpt-4o", "gpt-4o-mini"],
    "research.agentic": ["gpt-4o", "gpt-4o-mini"],
    "research.deep": ["gpt-4o"],
    "synthesis.json": ["gpt-4o", "gpt-4o-mini"],
    "fee-analysis": ["gpt-4o-mini", "gpt-4o"],
    chat: ["gpt-4o", "gpt-4o-mini"],
    dripper: ["gpt-4o-mini", "gpt-4o"],
    "dripper.client-email": ["gpt-4o-mini", "gpt-4o"],
    tts: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    stt: ["whisper-1"],
  },
  gemini: {
    extraction: ["gemini-2.5-flash", "gemini-2.5-pro"],
    "extraction.classify": ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "extraction.annuity": ["gemini-2.5-flash", "gemini-2.5-pro"],
    "intake.turn": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "research.fast-grounded": ["gemini-2.5-flash", "gemini-2.5-pro"],
    "research.agentic": ["gemini-2.5-pro", "gemini-2.5-flash"],
    "research.deep": ["gemini-2.5-pro"],
    "synthesis.json": ["gemini-2.5-flash", "gemini-2.5-pro"],
    "fee-analysis": ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    chat: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    dripper: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "dripper.client-email": ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    // TTS/STT fall back to OpenAI in v1 — not user-selectable here.
  },
  grok: {
    extraction: ["grok-4.3", "grok-4.3-latest"],
    "extraction.classify": ["grok-4.3"],
    "extraction.annuity": ["grok-4.3", "grok-4.3-latest"],
    "intake.turn": ["grok-4.3"],
    "research.fast-grounded": ["grok-4.3"],
    "research.agentic": ["grok-4.3"],
    "research.deep": ["grok-4.3"],
    "synthesis.json": ["grok-4.3"],
    "fee-analysis": ["grok-4.3"],
    chat: ["grok-4.3", "grok-4.3-latest"],
    dripper: ["grok-4.3"],
    "dripper.client-email": ["grok-4.3"],
  },
};

export interface ProviderPassEntry {
  pass: LlmPass;
  /** Human-readable label for the UI dropdown row. */
  label: string;
  /** Models the user can pick (in addition to "Custom…"). */
  options: string[];
}

const PASS_LABELS: Record<LlmPass, string> = {
  extraction: "Statement extraction (vision → JSON)",
  "extraction.classify": "Statement type routing (brokerage vs annuity)",
  "extraction.annuity": "Annuity contract extraction (vision → JSON)",
  "intake.turn": "Intake conversation turn",
  "research.fast-grounded": "Per-holding research (fast, grounded)",
  "research.agentic": "Macro market research (agentic)",
  "research.deep": "Deep research (background, multi-step)",
  "synthesis.json": "Portfolio synthesis JSON",
  "fee-analysis": "Fee analysis (fund expense ratio lookup)",
  chat: "Chat assistant (in-app orchestrator)",
  dripper: "CRM dripper (scheduled client briefs)",
  "dripper.client-email": "CRM dripper client email rewrite",
  tts: "Voice intake — text-to-speech",
  stt: "Voice intake — speech-to-text",
};

/** Builds the dropdown rows the Settings UI renders for a given provider. */
export function modelOptionsForProvider(provider: LlmProvider): ProviderPassEntry[] {
  const catalog = MODEL_CATALOG[provider];
  const passes: LlmPass[] = [
    "extraction",
    "intake.turn",
    "research.fast-grounded",
    "research.agentic",
    "research.deep",
    "synthesis.json",
    "fee-analysis",
    "chat",
    "tts",
    "stt",
  ];
  return passes
    .filter((p) => Array.isArray(catalog[p]) && (catalog[p] as string[]).length > 0)
    .map((p) => ({
      pass: p,
      label: PASS_LABELS[p],
      options: catalog[p] as string[],
    }));
}
