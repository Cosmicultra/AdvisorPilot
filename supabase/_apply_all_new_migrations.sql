-- =============================================================================
-- AdvisorPilot — apply all 5 new migrations for the multi-provider LLM + voice
-- agent work. Idempotent: every CREATE / ALTER uses IF NOT EXISTS.
--
-- Run order matters (the provenance sidecar references the existing
-- security-enrichment-cache table). Just paste the whole file into the
-- Supabase Dashboard → SQL Editor → Run.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. advisorpilot_advisor_profiles_llm_columns.sql
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.advisorpilot_advisor_profiles
  add column if not exists llm_provider text,
  add column if not exists llm_model_overrides jsonb,
  add column if not exists default_research_tier text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. advisorpilot_enrichment_provenance.sql
-- (Requires public.set_advisorpilot_updated_at() + the enrichment cache table.)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. advisorpilot_deep_research_jobs.sql
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_deep_research_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  provider text not null,
  tier text not null,
  request jsonb not null,
  status text not null default 'queued',
  result jsonb,
  error text,
  external_handle text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_deep_research_owner_idx
  on public.advisorpilot_deep_research_jobs (owner_email, created_at desc);

create index if not exists advisorpilot_deep_research_status_idx
  on public.advisorpilot_deep_research_jobs (status, updated_at desc);

drop trigger if exists set_advisorpilot_deep_research_updated_at
  on public.advisorpilot_deep_research_jobs;

create trigger set_advisorpilot_deep_research_updated_at
before update on public.advisorpilot_deep_research_jobs
for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_deep_research_jobs enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. advisorpilot_voice_settings.sql
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_voice_settings (
  advisor_email text primary key,
  advisor_user_id uuid,
  voice_enabled boolean,
  voice_model text,
  voice_name text,
  voice_hotkey text,
  voice_show_captions boolean,
  voice_pause_on_blur boolean,
  voice_disclosed boolean,
  voice_audit_tool_calls boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_voice_settings_user_id_idx
  on public.advisorpilot_voice_settings (advisor_user_id);

drop trigger if exists set_advisorpilot_voice_settings_updated_at
  on public.advisorpilot_voice_settings;

create trigger set_advisorpilot_voice_settings_updated_at
before update on public.advisorpilot_voice_settings
for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_voice_settings enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. advisorpilot_voice_audit_log.sql
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_voice_audit_log (
  id uuid primary key default gen_random_uuid(),
  advisor_email text not null,
  advisor_user_id uuid,
  tool text not null,
  args_hash text,
  result_hash text,
  success boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists advisorpilot_voice_audit_advisor_idx
  on public.advisorpilot_voice_audit_log (advisor_email, created_at desc);

create index if not exists advisorpilot_voice_audit_tool_idx
  on public.advisorpilot_voice_audit_log (tool, created_at desc);

alter table public.advisorpilot_voice_audit_log enable row level security;
