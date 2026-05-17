-- =============================================================================
-- AdvisorPilot — CRM Phase 0 schema
--
-- Adds:
--   1. Three new sidecar tables: advisorpilot_tasks, advisorpilot_notes,
--      advisorpilot_activity_log.
--   2. Additive nullable columns on advisorpilot_clients (CRM-only fields).
--   3. Three org/sharing tables: advisorpilot_organizations,
--      advisorpilot_organization_members, advisorpilot_share_grants.
--   4. The org_id + visibility pair on advisorpilot_clients/_tasks/_notes.
--   5. A composite index on advisorpilot_audit_events (entity_type, entity_id,
--      created_at DESC) for the activity-log union query.
--   6. Full RLS policies on every new CRM table (drop-then-create for
--      idempotency). Visibility logic delegates to the SQL helper functions
--      in advisorpilot_rls_helpers.sql (SINGLE SOURCE OF TRUTH).
--
-- Backward-compat rules (docs/crm/30-backward-compat.md §2):
--   - No existing column dropped, renamed, or NOT-NULL-added.
--   - Every new column on existing tables is NULLABLE with no DEFAULT.
--   - All FKs go new → existing only.
--   - Every CREATE/ALTER uses IF NOT EXISTS. Re-runnable.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ DO NOT APPLY THIS FILE STANDALONE.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The RLS policies in PART 5 below reference the SQL helper functions in
-- advisorpilot_rls_helpers.sql. If you apply this file before the helpers
-- exist, the CREATE POLICY statements will fail. But applying the helpers
-- first ALSO fails, because they reference columns that THIS file adds.
-- (LANGUAGE SQL STABLE function bodies are parsed at CREATE time.)
--
-- The canonical apply path is supabase/_apply_crm_phase0_migrations.sql,
-- which sequences the parts correctly:
--
--   1. Tables (orgs, sidecar tables, additive columns)
--   2. Helper SQL functions (now every referenced column exists)
--   3. RLS policies (now every referenced function exists)
--   4. Backfill
--
-- This file is kept around as a logical-grouping reference for
-- diff-reviewing the schema in isolation. To actually deploy the migration,
-- use the runner.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Organizations & sharing tables (must come before _clients/_tasks/_notes
--    add their FK columns referencing advisorpilot_organizations).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.advisorpilot_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by_email text not null,
  plan_tier text,
  max_seats integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_orgs_created_by_idx
  on public.advisorpilot_organizations (created_by_email);

drop trigger if exists set_advisorpilot_orgs_updated_at
  on public.advisorpilot_organizations;
create trigger set_advisorpilot_orgs_updated_at
  before update on public.advisorpilot_organizations
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_organizations enable row level security;


create table if not exists public.advisorpilot_organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.advisorpilot_organizations(id) on delete cascade,
  member_email text not null,
  member_user_id uuid,
  role text not null default 'member',         -- 'owner' | 'admin' | 'member'
  status text not null default 'active',       -- 'invited' | 'active' | 'removed'
  invited_by_email text,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, member_email)
);

create index if not exists advisorpilot_org_members_email_idx
  on public.advisorpilot_organization_members (member_email, status);

create index if not exists advisorpilot_org_members_org_idx
  on public.advisorpilot_organization_members (org_id, status);

drop trigger if exists set_advisorpilot_org_members_updated_at
  on public.advisorpilot_organization_members;
create trigger set_advisorpilot_org_members_updated_at
  before update on public.advisorpilot_organization_members
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_organization_members enable row level security;


create table if not exists public.advisorpilot_share_grants (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,                   -- 'client' | 'task' | 'note'
  entity_id uuid not null,
  grantee_email text not null,
  grantee_user_id uuid,
  granted_by_email text not null,
  granted_at timestamptz not null default now(),
  permission text not null default 'view',     -- 'view' | 'edit'
  unique (entity_type, entity_id, grantee_email)
);

create index if not exists advisorpilot_share_grants_grantee_idx
  on public.advisorpilot_share_grants (grantee_email, entity_type);

create index if not exists advisorpilot_share_grants_entity_idx
  on public.advisorpilot_share_grants (entity_type, entity_id);

alter table public.advisorpilot_share_grants enable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Three new CRM sidecar tables.
--
-- FK delete semantics (docs/crm/20-technical-specs.md §1.1):
--   client_id → advisorpilot_clients uses ON DELETE CASCADE for tasks/notes/
--   activity_log. Deliberately different from advisorpilot_documents' SET
--   NULL: a task/note/activity entry without its client is meaningless,
--   whereas an orphaned document file is still a useful artifact.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.advisorpilot_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete cascade,
  org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  visibility text,                             -- 'private' | 'shared' | 'organization'
  title text not null,
  description text,
  due_date date,
  due_time time,
  priority text default 'Medium',              -- 'High' | 'Medium' | 'Low'
  status text default 'open',                  -- 'open' | 'in_progress' | 'done' | 'cancelled'
  completed_at timestamptz,
  reminder_at timestamptz,
  tags jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_tasks_owner_status_idx
  on public.advisorpilot_tasks (owner_email, status, due_date);

create index if not exists advisorpilot_tasks_client_idx
  on public.advisorpilot_tasks (client_id, status);

create index if not exists advisorpilot_tasks_org_visibility_idx
  on public.advisorpilot_tasks (org_id, visibility);

drop trigger if exists set_advisorpilot_tasks_updated_at on public.advisorpilot_tasks;
create trigger set_advisorpilot_tasks_updated_at
  before update on public.advisorpilot_tasks
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_tasks enable row level security;


create table if not exists public.advisorpilot_notes (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid not null references public.advisorpilot_clients(id) on delete cascade,
  org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  visibility text,
  author_email text not null,
  body text not null,
  tags jsonb default '[]'::jsonb,
  pinned boolean default false,
  source text default 'manual',                -- 'manual' | 'voice_agent' | 'meeting_recap'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_notes_client_pinned_created_idx
  on public.advisorpilot_notes (client_id, pinned desc, created_at desc);

create index if not exists advisorpilot_notes_org_visibility_idx
  on public.advisorpilot_notes (org_id, visibility);

drop trigger if exists set_advisorpilot_notes_updated_at on public.advisorpilot_notes;
create trigger set_advisorpilot_notes_updated_at
  before update on public.advisorpilot_notes
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_notes enable row level security;


create table if not exists public.advisorpilot_activity_log (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete cascade,
  type text not null,                          -- 'note' | 'meeting' | 'document' | 'email' | 'call' | 'task' | 'analysis' | 'system'
  title text not null,
  body text,
  actor_email text,
  metadata jsonb default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists advisorpilot_activity_client_occurred_idx
  on public.advisorpilot_activity_log (client_id, occurred_at desc);

create index if not exists advisorpilot_activity_owner_occurred_idx
  on public.advisorpilot_activity_log (owner_email, occurred_at desc);

create index if not exists advisorpilot_activity_type_idx
  on public.advisorpilot_activity_log (type, occurred_at desc);

alter table public.advisorpilot_activity_log enable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Additive nullable columns on advisorpilot_clients.
--
-- All NULLABLE with no DEFAULT so existing rows are untouched and the
-- migration is trivially reversible (drop these columns + drop the new
-- tables = zero footprint on existing data).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.advisorpilot_clients
  add column if not exists stage text,
  add column if not exists owner_initials text,
  add column if not exists household_label text,
  add column if not exists tags jsonb,
  add column if not exists location text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists inception_year integer,
  add column if not exists next_meeting_at timestamptz,
  add column if not exists review_due_at date,
  add column if not exists ytd_return numeric,
  add column if not exists org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  add column if not exists visibility text;

create index if not exists advisorpilot_clients_org_visibility_idx
  on public.advisorpilot_clients (org_id, visibility);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Composite index on advisorpilot_audit_events for the activity-log
--    union query (docs/crm/20-technical-specs.md §2.3).
--
-- The schema audit (2026-05-15) confirmed entity_type + entity_id are
-- top-level columns. The Timeline tab's union read filters by
-- WHERE entity_type = 'client' AND entity_id = $clientId. This index is
-- conditional (only rows with non-NULL entity_id) so it stays compact.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists advisorpilot_audit_events_entity_idx
  on public.advisorpilot_audit_events (entity_type, entity_id, created_at desc)
  where entity_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS policies on the three new CRM tables + the org/sharing tables.
--
-- Drop-then-create pattern for idempotency (docs/crm/20-technical-specs.md
-- §1.3): Postgres CREATE POLICY doesn't support IF NOT EXISTS, so we drop
-- first; this lets the migration re-run safely.
--
-- All visibility logic delegates to the SQL functions in
-- advisorpilot_rls_helpers.sql — the SINGLE SOURCE OF TRUTH for who can see
-- what (eliminates risk O5 from docs/crm/50-organizations-and-sharing.md §12).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── advisorpilot_tasks ──────────────────────────────────────────────────────

drop policy if exists "tasks_select_visible" on public.advisorpilot_tasks;
create policy "tasks_select_visible" on public.advisorpilot_tasks
  for select to authenticated
  using ( public.tasks_visible_to(auth.jwt() ->> 'email', id) );

drop policy if exists "tasks_insert_own" on public.advisorpilot_tasks;
create policy "tasks_insert_own" on public.advisorpilot_tasks
  for insert to authenticated
  with check ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "tasks_update_visible" on public.advisorpilot_tasks;
create policy "tasks_update_visible" on public.advisorpilot_tasks
  for update to authenticated
  using (
    owner_email = lower(auth.jwt() ->> 'email')
    or (
      visibility in ('organization', 'shared')
      and public.is_org_admin(auth.jwt() ->> 'email', org_id)
    )
  );

drop policy if exists "tasks_delete_own" on public.advisorpilot_tasks;
create policy "tasks_delete_own" on public.advisorpilot_tasks
  for delete to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );


-- ── advisorpilot_notes ──────────────────────────────────────────────────────

drop policy if exists "notes_select_visible" on public.advisorpilot_notes;
create policy "notes_select_visible" on public.advisorpilot_notes
  for select to authenticated
  using ( public.notes_visible_to(auth.jwt() ->> 'email', id) );

drop policy if exists "notes_insert_own" on public.advisorpilot_notes;
create policy "notes_insert_own" on public.advisorpilot_notes
  for insert to authenticated
  with check ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "notes_update_visible" on public.advisorpilot_notes;
create policy "notes_update_visible" on public.advisorpilot_notes
  for update to authenticated
  using (
    owner_email = lower(auth.jwt() ->> 'email')
    or (
      visibility in ('organization', 'shared')
      and public.is_org_admin(auth.jwt() ->> 'email', org_id)
    )
  );

drop policy if exists "notes_delete_own" on public.advisorpilot_notes;
create policy "notes_delete_own" on public.advisorpilot_notes
  for delete to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );


-- ── advisorpilot_activity_log ───────────────────────────────────────────────
-- Activity entries inherit visibility from the parent client when client_id
-- is set (otherwise creator-only). Append-only — no UPDATE policy.

drop policy if exists "activity_select_visible" on public.advisorpilot_activity_log;
create policy "activity_select_visible" on public.advisorpilot_activity_log
  for select to authenticated
  using (
    owner_email = lower(auth.jwt() ->> 'email')
    or (
      client_id is not null
      and public.clients_visible_to(auth.jwt() ->> 'email', client_id)
    )
  );

drop policy if exists "activity_insert_own" on public.advisorpilot_activity_log;
create policy "activity_insert_own" on public.advisorpilot_activity_log
  for insert to authenticated
  with check ( owner_email = lower(auth.jwt() ->> 'email') );


-- ── advisorpilot_organizations ──────────────────────────────────────────────
-- Members see their org. Only owners/admins update. Anyone can create (becomes
-- the owner of the new org via the API; the membership row makes them owner).

drop policy if exists "orgs_select_member" on public.advisorpilot_organizations;
create policy "orgs_select_member" on public.advisorpilot_organizations
  for select to authenticated
  using (
    id in (
      select om.org_id
      from public.advisorpilot_organization_members om
      where om.member_email = lower(auth.jwt() ->> 'email')
        and om.status = 'active'
    )
  );

drop policy if exists "orgs_insert_any" on public.advisorpilot_organizations;
create policy "orgs_insert_any" on public.advisorpilot_organizations
  for insert to authenticated
  with check ( created_by_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "orgs_update_admin" on public.advisorpilot_organizations;
create policy "orgs_update_admin" on public.advisorpilot_organizations
  for update to authenticated
  using ( public.is_org_admin(auth.jwt() ->> 'email', id) );


-- ── advisorpilot_organization_members ───────────────────────────────────────
-- Members see their own membership rows + all members of orgs they belong to.

drop policy if exists "org_members_select_visible" on public.advisorpilot_organization_members;
create policy "org_members_select_visible" on public.advisorpilot_organization_members
  for select to authenticated
  using (
    member_email = lower(auth.jwt() ->> 'email')
    or org_id in (
      select om.org_id
      from public.advisorpilot_organization_members om
      where om.member_email = lower(auth.jwt() ->> 'email')
        and om.status = 'active'
    )
  );

drop policy if exists "org_members_insert_admin" on public.advisorpilot_organization_members;
create policy "org_members_insert_admin" on public.advisorpilot_organization_members
  for insert to authenticated
  with check ( public.is_org_admin(auth.jwt() ->> 'email', org_id) );

drop policy if exists "org_members_update_admin" on public.advisorpilot_organization_members;
create policy "org_members_update_admin" on public.advisorpilot_organization_members
  for update to authenticated
  using ( public.is_org_admin(auth.jwt() ->> 'email', org_id) );

drop policy if exists "org_members_delete_admin" on public.advisorpilot_organization_members;
create policy "org_members_delete_admin" on public.advisorpilot_organization_members
  for delete to authenticated
  using ( public.is_org_admin(auth.jwt() ->> 'email', org_id) );


-- ── advisorpilot_share_grants ───────────────────────────────────────────────
-- Grantees see grants targeting them. Granters see grants they created.

drop policy if exists "share_grants_select_relevant" on public.advisorpilot_share_grants;
create policy "share_grants_select_relevant" on public.advisorpilot_share_grants
  for select to authenticated
  using (
    grantee_email = lower(auth.jwt() ->> 'email')
    or granted_by_email = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "share_grants_insert_grantor" on public.advisorpilot_share_grants;
create policy "share_grants_insert_grantor" on public.advisorpilot_share_grants
  for insert to authenticated
  with check ( granted_by_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "share_grants_delete_grantor" on public.advisorpilot_share_grants;
create policy "share_grants_delete_grantor" on public.advisorpilot_share_grants
  for delete to authenticated
  using ( granted_by_email = lower(auth.jwt() ->> 'email') );


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grants on the new tables — match the existing pattern from
--    _apply_all_new_migrations.sql (every role gets ALL; RLS does the
--    real gatekeeping for non-service-role).
-- ─────────────────────────────────────────────────────────────────────────────

grant all on table public.advisorpilot_tasks               to anon, authenticated, service_role;
grant all on table public.advisorpilot_notes               to anon, authenticated, service_role;
grant all on table public.advisorpilot_activity_log        to anon, authenticated, service_role;
grant all on table public.advisorpilot_organizations       to anon, authenticated, service_role;
grant all on table public.advisorpilot_organization_members to anon, authenticated, service_role;
grant all on table public.advisorpilot_share_grants        to anon, authenticated, service_role;
