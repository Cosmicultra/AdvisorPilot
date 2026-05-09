-- Requires public.set_advisorpilot_updated_at() from advisorpilot_full_schema_rls.sql (run main schema first if missing).
-- =============================================================================
-- Step 1 — Supabase Dashboard → SQL Editor → paste → Run.
-- Global cache for holding enrichment (shared across all advisors).
-- Only server code using SUPABASE_SERVICE_ROLE_KEY should touch this table.
-- RLS is enabled with no policies for authenticated users (deny); service role bypasses RLS.
-- =============================================================================

create table if not exists public.advisorpilot_security_enrichment_cache (
  lookup_key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_sec_enrich_cache_updated_at_idx
  on public.advisorpilot_security_enrichment_cache (updated_at desc);

drop trigger if exists set_advisorpilot_sec_enrich_cache_updated_at
  on public.advisorpilot_security_enrichment_cache;

create trigger set_advisorpilot_sec_enrich_cache_updated_at
before update on public.advisorpilot_security_enrichment_cache
for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_security_enrichment_cache enable row level security;

-- Step 2 — Optional env (defaults shown):
-- SECURITY_ENRICHMENT_CACHE_TTL_DAYS=90
