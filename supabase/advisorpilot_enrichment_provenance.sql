-- Requires public.advisorpilot_security_enrichment_cache (run
-- advisorpilot_security_enrichment_cache.sql first). Adds a new sidecar
-- table for per-provider citation provenance, additive to the existing
-- cache. The cache table itself is NOT modified.
--
-- =============================================================================
-- Step 1 — Supabase Dashboard → SQL Editor → paste → Run.
-- New table: advisorpilot_enrichment_provenance
--   - One row per (cache_key, provider) pair.
--   - Stores the normalized Citation[] (uri, title, snippet, indices, source)
--     produced by the LLM provider that wrote the cache row.
--   - When an advisor switches providers, lookups join on provider to avoid
--     mis-attributing citations from a different model's research.
-- Only server code using SUPABASE_SERVICE_ROLE_KEY should touch this table.
-- RLS is enabled with no policies for authenticated users (deny); service
-- role bypasses RLS.
-- =============================================================================

create table if not exists public.advisorpilot_enrichment_provenance (
  cache_key text not null
    references public.advisorpilot_security_enrichment_cache(lookup_key)
    on delete cascade,
  provider text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cache_key, provider)
);

create index if not exists advisorpilot_enrich_provenance_provider_idx
  on public.advisorpilot_enrichment_provenance (provider);

create index if not exists advisorpilot_enrich_provenance_updated_at_idx
  on public.advisorpilot_enrichment_provenance (updated_at desc);

drop trigger if exists set_advisorpilot_enrich_provenance_updated_at
  on public.advisorpilot_enrichment_provenance;

create trigger set_advisorpilot_enrich_provenance_updated_at
before update on public.advisorpilot_enrichment_provenance
for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_enrichment_provenance enable row level security;
