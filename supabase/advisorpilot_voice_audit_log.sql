-- Voice agent tool-call audit trail. Shape-only — never stores transcripts
-- or PII; just (advisor, time, tool name, args hash, result hash).
-- Compliance hint per docs/voice-agent-plan.md §15 decision.
--
-- New table. Does NOT modify any existing table.
--
-- Step 1 — Supabase Dashboard → SQL Editor → paste → Run.

create table if not exists public.advisorpilot_voice_audit_log (
  id uuid primary key default gen_random_uuid(),
  advisor_email text not null,
  advisor_user_id uuid,
  tool text not null,
  args_hash text,                   -- SHA-256 hex of JSON.stringify(args), no PII
  result_hash text,                 -- SHA-256 hex of JSON.stringify(response)
  success boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists advisorpilot_voice_audit_advisor_idx
  on public.advisorpilot_voice_audit_log (advisor_email, created_at desc);

create index if not exists advisorpilot_voice_audit_tool_idx
  on public.advisorpilot_voice_audit_log (tool, created_at desc);

alter table public.advisorpilot_voice_audit_log enable row level security;
