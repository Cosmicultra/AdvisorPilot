-- AdvisorPilot — Supabase schema reference (not auto-applied).
-- Update this file when you change production SQL so the repo stays the map for migrations and code.
--
-- App touchpoints:
--   advisorpilot_advisor_profiles → app/api/advisor-profile/route.ts
--   advisorpilot_clients          → app/api/client-database/route.ts
--
-- Base CREATE for public.advisorpilot_clients was not captured here; the API expects at least:
--   id, owner_email, client (jsonb), holdings (jsonb), meeting_notes, demo_mode, analysis,
--   total_value, created_at, updated_at, plus the columns below.

-- ---------------------------------------------------------------------------
-- advisorpilot_advisor_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.advisorpilot_advisor_profiles (
  owner_email text primary key,
  email_signature text not null default '',
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advisorpilot_clients
add column if not exists status text not null default 'Analyzed';

alter table public.advisorpilot_clients
add column if not exists last_contacted_at timestamptz;

alter table public.advisorpilot_clients
add column if not exists roth_worksheet jsonb;

create or replace function public.set_advisorpilot_advisor_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_advisorpilot_advisor_profiles_updated_at on public.advisorpilot_advisor_profiles;

create trigger set_advisorpilot_advisor_profiles_updated_at
before update on public.advisorpilot_advisor_profiles
for each row
execute function public.set_advisorpilot_advisor_profiles_updated_at();

alter table public.advisorpilot_advisor_profiles
add column if not exists advisor_name text;

alter table public.advisorpilot_advisor_profiles
add column if not exists advisor_title text;

alter table public.advisorpilot_advisor_profiles
add column if not exists advisor_license text;

alter table public.advisorpilot_advisor_profiles
add column if not exists calendar_link text;

alter table public.advisorpilot_advisor_profiles
add column if not exists office_address text;

alter table public.advisorpilot_advisor_profiles
add column if not exists office_phone text;

alter table public.advisorpilot_advisor_profiles
add column if not exists cell_phone text;

alter table public.advisorpilot_advisor_profiles
add column if not exists website text;

alter table public.advisorpilot_advisor_profiles
add column if not exists disclosures_text text;

alter table public.advisorpilot_advisor_profiles
add column if not exists disclosures_image_url text;

-- Public bucket for advisor logo / disclosure images (HTML email img src).
-- Required for POST /api/advisor-profile/upload. Create once using either:
--
-- A) Dashboard: Storage → New bucket → Name: advisorpilot-advisor-branding → enable "Public bucket" → Create.
--
-- B) SQL Editor (below). Service-role API uploads bypass RLS; recipients load images via public URL.

insert into storage.buckets (id, name, public)
values ('advisorpilot-advisor-branding', 'advisorpilot-advisor-branding', true)
on conflict (id) do update set public = excluded.public;

-- ---------------------------------------------------------------------------
-- advisorpilot_audit_events — action taxonomy (server-emitted)
-- ---------------------------------------------------------------------------
-- Core pipeline:
--   statement.extracted     POST /api/analyze-statement (success)
--   analysis.completed      POST /api/generate-analysis (success)
--   report.generated        POST /api/generate-report (success)
-- Other routes (existing): client.*, email.*, upload token / ingest, inbound_email.*
--
-- Placeholder owner_email "unauthenticated.demo" is used when demoMode is true and
-- no advisor session is present (anonymous demo extract/analysis/report).
