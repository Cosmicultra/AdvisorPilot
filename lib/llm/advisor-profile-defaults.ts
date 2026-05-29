/**
 * Default LLM preferences seeded for new advisor profiles on first login.
 * Advisors who change these in Settings keep their saved values.
 */

import type { LlmProvider, ResearchTier } from "./types";

export const DEFAULT_ADVISOR_LLM_PROVIDER: LlmProvider = "gemini";
export const DEFAULT_ADVISOR_RESEARCH_TIER: ResearchTier = "agentic-research";
