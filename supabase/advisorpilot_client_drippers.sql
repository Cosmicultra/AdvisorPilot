-- =============================================================================
-- AdvisorPilot — per-client dripper enrollments + run history
--
-- Idempotent. Paste into Supabase SQL Editor or append to
-- supabase/_apply_all_new_migrations.sql.
--
-- Requires: advisorpilot_clients, public.set_advisorpilot_updated_at()
-- =============================================================================

-- ── Enrollments ─────────────────────────────────────────────────────────────

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


-- ── Run history ─────────────────────────────────────────────────────────────

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
