-- =============================================================================
-- Server-side Gmail refresh tokens (cron + drippers). Service-role only.
-- Idempotent. Requires public.set_advisorpilot_updated_at().
-- =============================================================================

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

-- No RLS: only server routes with service role access this table.

alter table public.advisorpilot_dripper_runs
  add column if not exists email_status text,
  add column if not exists email_error text,
  add column if not exists client_email_to text;
