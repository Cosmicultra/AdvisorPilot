-- Per-advisor voice agent preferences. New dedicated table — does NOT
-- modify advisor_profile. Voice is its own concern per docs/voice-agent-plan.md §0.
--
-- All preference columns are nullable with NO DEFAULT. NULL means "use the
-- firm/env default for this preference." The (created_at, updated_at)
-- metadata columns are NOT NULL with DEFAULT now() since they're
-- bookkeeping, not preferences.
--
-- Tri-state semantics:
--   - voice_disclosed = NULL  → advisor hasn't been prompted yet
--   - voice_disclosed = false → advisor explicitly said no
--   - voice_disclosed = true  → advisor explicitly confirmed disclosure
--
-- Step 1 — Supabase Dashboard → SQL Editor → paste → Run.

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
