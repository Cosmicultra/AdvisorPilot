-- =============================================================================
-- AdvisorPilot — idempotent annuity reminder sends (per contract + event date)
--
-- Idempotent. Paste into Supabase SQL Editor or append to
-- supabase/_apply_all_new_migrations.sql.
-- =============================================================================

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
