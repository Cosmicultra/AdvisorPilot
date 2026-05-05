-- Run in Supabase SQL editor (once) for magic-link client uploads.
-- Tokens bind uploads to advisor_owner_email; never trust client-supplied email for ownership.

create table if not exists public.advisorpilot_upload_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  advisor_owner_email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  upload_count int not null default 0
);

create index if not exists advisorpilot_upload_tokens_advisor_idx
  on public.advisorpilot_upload_tokens (advisor_owner_email);

create index if not exists advisorpilot_upload_tokens_expires_idx
  on public.advisorpilot_upload_tokens (expires_at);
