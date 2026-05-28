-- ─────────────────────────────────────────────────────────────────────────────
-- advisorpilot_google_calendar_channels.sql
-- Section 13 in _apply_all_new_migrations.sql (section 14 adds provenance).
-- Google Calendar webhook channels (per advisor)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Stores the active Google Calendar watch channel for each advisor so
-- /api/calendar/google/webhook can validate notifications and trigger a sync.
--
-- Service-role only: RLS enabled with no policies (deny-by-default).
--
-- Idempotent: safe to run multiple times.

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

-- Ensure the CRM meeting/email columns exist (safe no-op if CRM Phase 0 already ran).
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

