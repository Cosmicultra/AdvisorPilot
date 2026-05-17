-- =============================================================================
-- AdvisorPilot — apply all CRM Phase 0 migrations in one shot
--
-- Self-contained — no \i includes, no external files needed. Paste the whole
-- thing into Supabase Dashboard → SQL Editor → Run.
--
-- Idempotent: every CREATE / ALTER uses IF NOT EXISTS, every CREATE POLICY
-- uses DROP-then-CREATE, every backfill statement has a NULL guard.
--
-- DEPENDENCY ORDER (why the parts are sequenced this way):
--   The helper functions in PART 5 reference advisorpilot_clients.visibility
--   and advisorpilot_clients.org_id (and the same on tasks/notes). Postgres
--   parses LANGUAGE SQL function bodies at CREATE time, so those columns
--   must already exist when the functions are defined. The RLS policies in
--   PART 6 in turn reference the helpers, so they must come after PART 5.
--
--   Order:
--     1. Org/sharing tables                       (referenced as FKs by 2+3)
--     2. New CRM sidecar tables (tasks/notes/log) (have visibility/org_id from creation)
--     3. Additive columns on existing clients     (adds visibility/org_id)
--     4. Composite index on audit_events
--     5. Helper SQL functions                     (now every referenced column exists)
--     6. RLS policies                             (now every referenced function exists)
--     7. Grants
--     8. Backfill
--
-- ROLLBACK (if needed): the migration is purely additive — to roll back,
-- drop the new tables and the new columns. Existing rows are only modified
-- via the backfill, which writes to the new (org_id, visibility) columns
-- only. Set those back to NULL = full rollback.
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — Org & sharing tables (FK target for tasks/notes/clients)        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

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

drop trigger if exists set_advisorpilot_orgs_updated_at on public.advisorpilot_organizations;
create trigger set_advisorpilot_orgs_updated_at
  before update on public.advisorpilot_organizations
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_organizations enable row level security;


create table if not exists public.advisorpilot_organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.advisorpilot_organizations(id) on delete cascade,
  member_email text not null,
  member_user_id uuid,
  role text not null default 'member',
  status text not null default 'active',
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

drop trigger if exists set_advisorpilot_org_members_updated_at on public.advisorpilot_organization_members;
create trigger set_advisorpilot_org_members_updated_at
  before update on public.advisorpilot_organization_members
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_organization_members enable row level security;


create table if not exists public.advisorpilot_share_grants (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  grantee_email text not null,
  grantee_user_id uuid,
  granted_by_email text not null,
  granted_at timestamptz not null default now(),
  permission text not null default 'view',
  unique (entity_type, entity_id, grantee_email)
);

create index if not exists advisorpilot_share_grants_grantee_idx
  on public.advisorpilot_share_grants (grantee_email, entity_type);

create index if not exists advisorpilot_share_grants_entity_idx
  on public.advisorpilot_share_grants (entity_type, entity_id);

alter table public.advisorpilot_share_grants enable row level security;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — Three new CRM sidecar tables (tasks, notes, activity_log)       ║
-- ║  Each has visibility/org_id from creation, satisfying PART 5's helpers.   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.advisorpilot_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete cascade,
  org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  visibility text,
  title text not null,
  description text,
  due_date date,
  due_time time,
  priority text default 'Medium',
  status text default 'open',
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
  source text default 'manual',
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
  type text not null,
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


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 3 — Additive nullable columns on advisorpilot_clients               ║
-- ║  Adds visibility + org_id; the helpers in PART 5 reference these.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 4 — Composite index on advisorpilot_audit_events for activity query ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create index if not exists advisorpilot_audit_events_entity_idx
  on public.advisorpilot_audit_events (entity_type, entity_id, created_at desc)
  where entity_id is not null;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 5 — RLS visibility helper SQL functions                             ║
-- ║  Single source of truth for who-sees-what. References columns from        ║
-- ║  PARTS 1-3 — all of which exist by now.                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.clients_visible_to(viewer_email text, client_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_clients c
    where c.id = client_id
      and (
        c.owner_email = lower(viewer_email)
        or (
          c.visibility = 'organization'
          and c.org_id in (
            select om.org_id
            from public.advisorpilot_organization_members om
            where om.member_email = lower(viewer_email)
              and om.status = 'active'
          )
        )
        or (
          c.visibility = 'shared'
          and exists (
            select 1
            from public.advisorpilot_share_grants g
            where g.entity_type = 'client'
              and g.entity_id = c.id
              and g.grantee_email = lower(viewer_email)
          )
        )
      )
  );
$$;

create or replace function public.tasks_visible_to(viewer_email text, task_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_tasks t
    where t.id = task_id
      and (
        t.owner_email = lower(viewer_email)
        or (
          t.visibility = 'organization'
          and t.org_id in (
            select om.org_id
            from public.advisorpilot_organization_members om
            where om.member_email = lower(viewer_email)
              and om.status = 'active'
          )
        )
        or (
          t.visibility = 'shared'
          and exists (
            select 1
            from public.advisorpilot_share_grants g
            where g.entity_type = 'task'
              and g.entity_id = t.id
              and g.grantee_email = lower(viewer_email)
          )
        )
      )
  );
$$;

create or replace function public.notes_visible_to(viewer_email text, note_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_notes n
    where n.id = note_id
      and (
        n.owner_email = lower(viewer_email)
        or (
          n.visibility = 'organization'
          and n.org_id in (
            select om.org_id
            from public.advisorpilot_organization_members om
            where om.member_email = lower(viewer_email)
              and om.status = 'active'
          )
        )
        or (
          n.visibility = 'shared'
          and exists (
            select 1
            from public.advisorpilot_share_grants g
            where g.entity_type = 'note'
              and g.entity_id = n.id
              and g.grantee_email = lower(viewer_email)
          )
        )
      )
  );
$$;

create or replace function public.is_org_admin(viewer_email text, org_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_organization_members om
    where om.org_id = is_org_admin.org_id
      and om.member_email = lower(viewer_email)
      and om.role in ('owner', 'admin')
      and om.status = 'active'
  );
$$;

grant execute on function public.clients_visible_to(text, uuid) to anon, authenticated, service_role;
grant execute on function public.tasks_visible_to(text, uuid)   to anon, authenticated, service_role;
grant execute on function public.notes_visible_to(text, uuid)   to anon, authenticated, service_role;
grant execute on function public.is_org_admin(text, uuid)       to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 6 — RLS policies on the new tables (drop-then-create idempotency)   ║
-- ║  References the helpers from PART 5 — all functions exist by now.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ── advisorpilot_tasks ──
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


-- ── advisorpilot_notes ──
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


-- ── advisorpilot_activity_log (append-only; no UPDATE/DELETE policy) ──
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


-- ── advisorpilot_organizations ──
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


-- ── advisorpilot_organization_members ──
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


-- ── advisorpilot_share_grants ──
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


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 7 — Grants on new tables                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

grant all on table public.advisorpilot_tasks                to anon, authenticated, service_role;
grant all on table public.advisorpilot_notes                to anon, authenticated, service_role;
grant all on table public.advisorpilot_activity_log         to anon, authenticated, service_role;
grant all on table public.advisorpilot_organizations        to anon, authenticated, service_role;
grant all on table public.advisorpilot_organization_members to anon, authenticated, service_role;
grant all on table public.advisorpilot_share_grants         to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 8 — Backfill: personal-org-of-one per existing advisor              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Step 1: Create one personal org per advisor (union of advisor sources).
insert into public.advisorpilot_organizations (id, name, slug, created_by_email)
select
  gen_random_uuid(),
  concat(split_part(owner_email, '@', 1), '''s organization'),
  concat('personal-', md5(owner_email)),
  owner_email
from (
  select distinct lower(owner_email) as owner_email
    from public.advisorpilot_clients
   where owner_email is not null
  union
  select distinct lower(owner_email) as owner_email
    from public.advisorpilot_advisor_profiles
   where owner_email is not null
) advisors
on conflict (slug) do nothing;

-- Step 2: Make each advisor the 'owner' of their personal org.
insert into public.advisorpilot_organization_members
  (org_id, member_email, role, status, accepted_at)
select
  o.id,
  o.created_by_email,
  'owner',
  'active',
  now()
from public.advisorpilot_organizations o
where o.slug like 'personal-%'
on conflict (org_id, member_email) do nothing;

-- Step 3: Backfill advisorpilot_clients with org_id + visibility='private'.
update public.advisorpilot_clients c
   set org_id     = o.id,
       visibility = 'private'
  from public.advisorpilot_organizations o
 where lower(o.created_by_email) = lower(c.owner_email)
   and o.slug like 'personal-%'
   and c.org_id is null;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  VERIFICATION — run these as separate queries after the migration        ║
-- ║  to confirm the backfill worked. Expected results commented inline.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- select count(*) from public.advisorpilot_organizations
--  where slug like 'personal-%';
-- -- Expected: 1 row per advisor in (clients ∪ advisor_profiles).
--
-- select count(*) from public.advisorpilot_organization_members
--  where role = 'owner' and status = 'active';
-- -- Expected: same count as above.
--
-- select count(*) from public.advisorpilot_clients
--  where org_id is null;
-- -- Expected: 0.
--
-- select slug, name, created_by_email
--   from public.advisorpilot_organizations
--  where slug like 'personal-%'
--  order by created_by_email;
-- -- Expected: one row per advisor email, slug='personal-<md5>'.
