-- =============================================================================
-- AdvisorPilot — apply all incremental migrations (bundle)
--
-- Idempotent: every CREATE / ALTER uses IF NOT EXISTS / IF NOT EXISTS.
--
-- Prerequisites: run advisorpilot_full_schema_rls.sql first on a fresh DB.
-- Run order matters inside this file (e.g. enrichment provenance needs the
-- security-enrichment-cache table).
--
-- Paste this entire file into Supabase Dashboard → SQL Editor → Run.
--
-- Sections:
--   1  LLM columns on advisor_profiles
--   2  Enrichment provenance sidecar
--   3  Deep research jobs
--   4  Voice settings
--   5  Voice audit log
--   6  Client drippers + dripper runs
--   7  Gmail tokens + dripper email columns
--   8  Annuity reminder sends
--   9  Outlook tokens
--  10  Fee analysis worksheet column
--  10  Fee analysis worksheet column
--  11  Roster list RPC
--  13  Google Calendar webhook channels + CRM email / next_meeting_at
--  14  Next meeting provenance (source / initiator / event id)
--      (13–14 grouped at the bottom under one part header)
-- =============================================================================


-- ═════════════════════════════════════════════════════════════════════════════
-- LLM, enrichment, research, voice
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. advisorpilot_advisor_profiles_llm_columns.sql
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.advisorpilot_advisor_profiles
  add column if not exists llm_provider text,
  add column if not exists llm_model_overrides jsonb,
  add column if not exists default_research_tier text;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. advisorpilot_enrichment_provenance.sql
-- (Requires public.set_advisorpilot_updated_at() + enrichment cache table.)
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


-- ═════════════════════════════════════════════════════════════════════════════
-- Drippers, email tokens, worksheets, roster RPC
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. advisorpilot_client_drippers.sql (+ dripper run history)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_client_drippers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.advisorpilot_clients(id) on delete cascade,
  template_id text not null,
  owner_email text not null,
  owner_user_id uuid,
  enabled boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz,
  frequency_days integer not null,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, template_id)
);

create index if not exists advisorpilot_client_drippers_client_idx
  on public.advisorpilot_client_drippers (client_id);

create index if not exists advisorpilot_client_drippers_due_idx
  on public.advisorpilot_client_drippers (next_run_at)
  where enabled = true;

drop trigger if exists set_advisorpilot_client_drippers_updated_at
  on public.advisorpilot_client_drippers;

create trigger set_advisorpilot_client_drippers_updated_at
  before update on public.advisorpilot_client_drippers
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_client_drippers enable row level security;

drop policy if exists "client_drippers_select_own" on public.advisorpilot_client_drippers;
create policy "client_drippers_select_own" on public.advisorpilot_client_drippers
  for select to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "client_drippers_insert_own" on public.advisorpilot_client_drippers;
create policy "client_drippers_insert_own" on public.advisorpilot_client_drippers
  for insert to authenticated
  with check ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "client_drippers_update_own" on public.advisorpilot_client_drippers;
create policy "client_drippers_update_own" on public.advisorpilot_client_drippers
  for update to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "client_drippers_delete_own" on public.advisorpilot_client_drippers;
create policy "client_drippers_delete_own" on public.advisorpilot_client_drippers
  for delete to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );

create table if not exists public.advisorpilot_dripper_runs (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.advisorpilot_client_drippers(id) on delete cascade,
  client_id uuid not null references public.advisorpilot_clients(id) on delete cascade,
  template_id text not null,
  owner_email text not null,
  owner_user_id uuid,
  status text not null,
  output_text text,
  error_message text,
  provider text,
  model text,
  ran_at timestamptz not null default now()
);

create index if not exists advisorpilot_dripper_runs_client_ran_idx
  on public.advisorpilot_dripper_runs (client_id, ran_at desc);

create index if not exists advisorpilot_dripper_runs_enrollment_idx
  on public.advisorpilot_dripper_runs (enrollment_id, ran_at desc);

alter table public.advisorpilot_dripper_runs enable row level security;

drop policy if exists "dripper_runs_select_own" on public.advisorpilot_dripper_runs;
create policy "dripper_runs_select_own" on public.advisorpilot_dripper_runs
  for select to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "dripper_runs_insert_own" on public.advisorpilot_dripper_runs;
create policy "dripper_runs_insert_own" on public.advisorpilot_dripper_runs
  for insert to authenticated
  with check ( owner_email = lower(auth.jwt() ->> 'email') );


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. advisorpilot_advisor_gmail_tokens.sql (+ dripper run email columns)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_advisor_gmail_tokens (
  advisor_email text primary key,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_advisorpilot_advisor_gmail_tokens_updated_at
  on public.advisorpilot_advisor_gmail_tokens;

create trigger set_advisorpilot_advisor_gmail_tokens_updated_at
  before update on public.advisorpilot_advisor_gmail_tokens
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_dripper_runs
  add column if not exists email_status text,
  add column if not exists email_error text,
  add column if not exists client_email_to text;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. advisorpilot_annuity_reminder_sends.sql
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_annuity_reminder_sends (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.advisorpilot_clients(id) on delete cascade,
  template_id text not null,
  contract_key text not null,
  reminder_kind text not null,
  event_date date not null,
  sent_at timestamptz not null default now(),
  run_id uuid references public.advisorpilot_dripper_runs(id) on delete set null,
  unique (client_id, template_id, contract_key, reminder_kind, event_date)
);

create index if not exists advisorpilot_annuity_reminder_sends_client_idx
  on public.advisorpilot_annuity_reminder_sends (client_id, template_id);

alter table public.advisorpilot_annuity_reminder_sends enable row level security;

drop policy if exists "annuity_reminder_sends_select_own" on public.advisorpilot_annuity_reminder_sends;
create policy "annuity_reminder_sends_select_own" on public.advisorpilot_annuity_reminder_sends
  for select to authenticated
  using (
    exists (
      select 1 from public.advisorpilot_clients c
      where c.id = client_id
        and c.owner_email = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "annuity_reminder_sends_insert_own" on public.advisorpilot_annuity_reminder_sends;
create policy "annuity_reminder_sends_insert_own" on public.advisorpilot_annuity_reminder_sends
  for insert to authenticated
  with check (
    exists (
      select 1 from public.advisorpilot_clients c
      where c.id = client_id
        and c.owner_email = lower(auth.jwt() ->> 'email')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. advisorpilot_advisor_outlook_tokens.sql
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_advisor_outlook_tokens (
  advisor_email text primary key,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_advisorpilot_advisor_outlook_tokens_updated_at
  on public.advisorpilot_advisor_outlook_tokens;

create trigger set_advisorpilot_advisor_outlook_tokens_updated_at
  before update on public.advisorpilot_advisor_outlook_tokens
  for each row execute function public.set_advisorpilot_updated_at();

-- No RLS: only server routes with service role access this table.


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. advisorpilot_fee_analysis_worksheet.sql
-- (Column must exist before roster RPC in section 11.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.advisorpilot_clients
  add column if not exists fee_analysis_worksheet jsonb;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. advisorpilot_roster_list_rpc.sql
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.list_visible_clients_roster(viewer_email text)
returns setof public.advisorpilot_clients
language plpgsql
stable
as $$
declare
  r public.advisorpilot_clients;
begin
  for r in
    select c.*
    from public.advisorpilot_clients c
    where public.clients_visible_to(viewer_email, c.id)
  loop
    r.meeting_notes := null;
    r.analysis := null;
    r.roth_worksheet := null;
    r.fee_analysis_worksheet := null;
    return next r;
  end loop;
  return;
end;
$$;

grant execute on function public.list_visible_clients_roster(text)
  to anon, authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- CRM: Google Calendar sync + next meeting provenance (sections 13–14)
-- Requires advisorpilot_clients (full schema or CRM Phase 0).
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. advisorpilot_google_calendar_channels.sql
--     Webhook channel registry + base CRM meeting columns on clients.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.advisorpilot_google_calendar_channels (
  advisor_email text primary key,
  calendar_id text not null default 'primary',
  channel_id text not null,
  resource_id text not null,
  channel_token text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advisorpilot_clients
  add column if not exists email text,
  add column if not exists next_meeting_at timestamptz;

create index if not exists advisorpilot_google_calendar_channels_channel_idx
  on public.advisorpilot_google_calendar_channels (channel_id);

drop trigger if exists set_advisorpilot_google_calendar_channels_updated_at
  on public.advisorpilot_google_calendar_channels;

create trigger set_advisorpilot_google_calendar_channels_updated_at
  before update on public.advisorpilot_google_calendar_channels
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_google_calendar_channels enable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- 14. advisorpilot_next_meeting_provenance.sql
--     How the next meeting was set (manual vs calendar, who initiated).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.advisorpilot_clients
  add column if not exists next_meeting_source text,
  add column if not exists next_meeting_initiator text,
  add column if not exists next_meeting_calendar_event_id text;
