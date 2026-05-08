-- Legacy compatibility wrapper.
-- Prefer running supabase/advisorpilot_full_schema_rls.sql, which creates this
-- table plus the client/profile/audit/document tables and RLS policies.
-- Tokens bind uploads to advisor_owner_email; never trust client-supplied email for ownership.

create table if not exists public.advisorpilot_upload_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  advisor_user_id uuid references auth.users(id) on delete set null,
  advisor_owner_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  upload_count int not null default 0,
  max_upload_count int not null default 25,
  last_used_at timestamptz,
  revoked_at timestamptz,
  intake_snapshot jsonb
);

create index if not exists advisorpilot_upload_tokens_advisor_idx
  on public.advisorpilot_upload_tokens (advisor_owner_email);

create index if not exists advisorpilot_upload_tokens_advisor_user_idx
  on public.advisorpilot_upload_tokens (advisor_user_id);

create index if not exists advisorpilot_upload_tokens_expires_idx
  on public.advisorpilot_upload_tokens (expires_at);
