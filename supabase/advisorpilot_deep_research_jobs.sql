-- Async deep-research job queue. New table — does NOT modify any existing
-- table. Keyed by uuid; one row per "kick off a deep research synthesis"
-- request. The poller (POST /api/research/cron) picks up `status='running'`
-- rows and either polls the upstream provider (OpenAI background mode,
-- Gemini Interactions API) or marks complete when the underlying response
-- has arrived. Service role bypasses RLS.
--
-- Step 1 — Supabase Dashboard → SQL Editor → paste → Run.

create table if not exists public.advisorpilot_deep_research_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  provider text not null,          -- 'openai' | 'gemini' | 'grok'
  tier text not null,              -- 'deep-research' (kept open for future tiers)
  request jsonb not null,          -- ResearchRequest snapshot
  status text not null default 'queued',  -- queued | running | done | failed | canceled
  result jsonb,                    -- ResearchResult on success (citations + text + json)
  error text,
  external_handle text,            -- provider-side job id (OpenAI response.id, Gemini interaction id)
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
