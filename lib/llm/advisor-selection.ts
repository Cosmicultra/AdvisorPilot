/**
 * Load per-advisor LLM selection (provider + per-pass model overrides +
 * default research tier) from `advisorpilot_advisor_profiles`.
 *
 * Returns an empty `AdvisorLlmSelection` when no row exists, no preferences
 * are set, or Supabase isn't configured — every field is optional and the
 * resolver falls through to env / hardcoded defaults on NULL.
 *
 * Cheap and cached per-request via a lazy Supabase admin client; this is
 * called once at the top of an AI route, never inside loops.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdvisorLlmSelection, LlmPass, LlmProvider, ResearchTier } from "./types";

let _client: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return _client;
}

function isProvider(v: unknown): v is LlmProvider {
  return v === "openai" || v === "gemini" || v === "grok";
}
function isResearchTier(v: unknown): v is ResearchTier {
  return v === "fast-grounded" || v === "agentic-research" || v === "deep-research";
}

function normalizeOverrides(raw: unknown): Partial<Record<LlmPass, string>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const allowed: LlmPass[] = [
    "extraction",
    "intake.turn",
    "research.fast-grounded",
    "research.agentic",
    "research.deep",
    "synthesis.json",
    "fee-analysis",
    "tts",
    "stt",
  ];
  const out: Partial<Record<LlmPass, string>> = {};
  const rec = raw as Record<string, unknown>;
  for (const pass of allowed) {
    const v = rec[pass];
    if (typeof v === "string" && v.trim()) out[pass] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Fetch the advisor's persisted selection. Returns `{}` (no preferences) on
 * missing row, missing Supabase config, or query errors — those are fine
 * fallbacks; never block the AI call on a profile lookup.
 */
export async function resolveAdvisorLlmSelection(
  advisorEmail: string | null | undefined
): Promise<AdvisorLlmSelection> {
  if (!advisorEmail) return {};
  const admin = getAdmin();
  if (!admin) return {};
  try {
    const { data, error } = await admin
      .from("advisorpilot_advisor_profiles")
      .select("llm_provider, llm_model_overrides, default_research_tier")
      .eq("owner_email", advisorEmail.toLowerCase())
      .maybeSingle();
    if (error || !data) return {};
    const selection: AdvisorLlmSelection = {};
    if (isProvider(data.llm_provider)) selection.provider = data.llm_provider;
    const models = normalizeOverrides(data.llm_model_overrides);
    if (models) selection.models = models;
    if (isResearchTier(data.default_research_tier)) {
      selection.defaultResearchTier = data.default_research_tier;
    }
    return selection;
  } catch (err) {
    console.warn("[llm] advisor selection lookup failed:", err);
    return {};
  }
}
