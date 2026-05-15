-- Add provider/model preferences to the existing advisor profile table.
-- All three columns are NULLABLE with no DEFAULT — backward-compatible,
-- trivially reversible (drop column if exists).
--
-- NULL semantics in the resolver: "fall through to env / hardcoded default."
-- See docs/multi-provider-llm-plan.md §9.7.
--
-- Step 1 — Supabase Dashboard → SQL Editor → paste → Run.

alter table public.advisorpilot_advisor_profiles
  add column if not exists llm_provider text,                 -- 'openai' | 'gemini' | 'grok'
  add column if not exists llm_model_overrides jsonb,          -- { "extraction": "gpt-4o", ... }
  add column if not exists default_research_tier text;         -- 'fast-grounded' | 'agentic-research' | 'deep-research'

-- Optional check constraint (commented; uncomment if you want hard enforcement):
-- alter table public.advisorpilot_advisor_profiles
--   add constraint advisorpilot_advisor_profiles_llm_provider_check
--   check (llm_provider is null or llm_provider in ('openai', 'gemini', 'grok'));
