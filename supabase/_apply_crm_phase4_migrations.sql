-- =============================================================================
-- AdvisorPilot — apply CRM Phase 4 migrations
--
-- Self-contained — paste into Supabase Dashboard → SQL Editor → Run.
--
-- Phase 4 adds the `advisorpilot_reports` table — the markdown-report archive
-- that Nova creates via `manage_report` and the advisor reads/edits in
-- /app/reports. Mirrors `advisorpilot_notes` exactly for visibility +
-- RLS + helpers so the chat orchestrator can wire it through the same
-- patterns (`list_visible_reports(viewer_email)` RPC,
-- `reports_visible_to(viewer_email, report_id)` predicate, shareable via
-- the existing `advisorpilot_share_grants` table by convention).
--
-- DEFERRED to a later migration (scoped out of this slice so the foundation
-- ships clean):
--   - `advisorpilot_report_versions` sidecar (version history table)
--     → enables manage_report.list_versions / restore_version
--   - `embed_image` storage path conventions
--
-- Idempotent: every object uses CREATE OR REPLACE / IF NOT EXISTS / DROP-THEN-
-- CREATE for policies. Safe to re-run.
--
-- DEPENDENCIES (must already exist from Phase 0):
--   - public.advisorpilot_organizations + advisorpilot_organization_members
--   - public.advisorpilot_share_grants (entity_type is `text not null` — we use
--     the value 'report' by convention; no schema change needed)
--   - public.is_org_admin(text, uuid)
--
-- Spec: docs/crm/70-orchestrator-tools.md §10.1 + §7.
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — Table                                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.advisorpilot_reports (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete set null,
  org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  visibility text default 'private',

  title text not null,
  content text not null,                                -- markdown body
  embedded_media jsonb default '[]'::jsonb,             -- [{ type:'image', storagePath, caption, atLine }, ...]
  icon text default '📄',
  color text,
  status text default 'draft',                          -- 'draft' | 'published' | 'archived'

  tags jsonb default '[]'::jsonb,
  source text default 'ai_generated',                   -- 'ai_generated' | 'advisor_authored' | 'imported'
  generated_by_model text,
  generated_by_provider text,
  generated_in_conversation_id text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trigger to bump updated_at on UPDATE (uses the existing shared trigger
-- function from Phase 0).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_advisorpilot_reports_updated_at'
  ) then
    create trigger set_advisorpilot_reports_updated_at
      before update on public.advisorpilot_reports
      for each row execute function public.set_advisorpilot_updated_at();
  end if;
end$$;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — Indexes                                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create index if not exists advisorpilot_reports_owner_created_idx
  on public.advisorpilot_reports (lower(owner_email), created_at desc);

create index if not exists advisorpilot_reports_client_created_idx
  on public.advisorpilot_reports (client_id, created_at desc)
  where archived_at is null;

create index if not exists advisorpilot_reports_org_visibility_idx
  on public.advisorpilot_reports (org_id, visibility);

create index if not exists advisorpilot_reports_status_idx
  on public.advisorpilot_reports (lower(owner_email), status);


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 3 — Visibility helper                                                ║
-- ║                                                                            ║
-- ║  reports_visible_to(viewer, report_id) returns TRUE when the viewer is:    ║
-- ║    - The owner (lower(owner_email) match), OR                              ║
-- ║    - An active member of the report's org AND visibility='organization', OR║
-- ║    - A grantee in share_grants for entity_type='report' AND visibility='shared'║
-- ║                                                                            ║
-- ║  Same predicate the RLS policies use → ONE source of truth for who-sees-what.║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.reports_visible_to(viewer_email text, report_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_reports r
    where r.id = report_id
      and (
        r.owner_email = lower(viewer_email)
        or (
          r.visibility = 'organization'
          and r.org_id in (
            select om.org_id
            from public.advisorpilot_organization_members om
            where om.member_email = lower(viewer_email)
              and om.status = 'active'
          )
        )
        or (
          r.visibility = 'shared'
          and exists (
            select 1
            from public.advisorpilot_share_grants g
            where g.entity_type = 'report'
              and g.entity_id = r.id
              and g.grantee_email = lower(viewer_email)
          )
        )
      )
  );
$$;

grant execute on function public.reports_visible_to(text, uuid)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 4 — list_visible_reports(viewer_email) — returns the visible cohort  ║
-- ║                                                                            ║
-- ║  Mirrors list_visible_notes — chat-tool helpers + API routes iterate over  ║
-- ║  this result + filter/sort/paginate in TypeScript. Same single-source-of-  ║
-- ║  truth pattern.                                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.list_visible_reports(viewer_email text)
returns setof public.advisorpilot_reports
language sql stable
as $$
  select r.*
  from public.advisorpilot_reports r
  where
    r.owner_email = lower(viewer_email)
    or (
      r.visibility = 'organization'
      and r.org_id in (
        select om.org_id
        from public.advisorpilot_organization_members om
        where om.member_email = lower(viewer_email)
          and om.status = 'active'
      )
    )
    or (
      r.visibility = 'shared'
      and exists (
        select 1
        from public.advisorpilot_share_grants g
        where g.entity_type = 'report'
          and g.entity_id = r.id
          and g.grantee_email = lower(viewer_email)
      )
    )
  order by r.created_at desc;
$$;

grant execute on function public.list_visible_reports(text)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 5 — RLS policies (drop-then-create idempotency)                      ║
-- ║                                                                            ║
-- ║  Pattern matches advisorpilot_notes:                                       ║
-- ║    - SELECT: visible-to                                                    ║
-- ║    - INSERT: own only                                                      ║
-- ║    - UPDATE: own OR org-admin on shared/org rows                           ║
-- ║    - DELETE: own only                                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

alter table public.advisorpilot_reports enable row level security;

drop policy if exists "reports_select_visible" on public.advisorpilot_reports;
create policy "reports_select_visible" on public.advisorpilot_reports
  for select to authenticated
  using ( public.reports_visible_to(auth.jwt() ->> 'email', id) );

drop policy if exists "reports_insert_own" on public.advisorpilot_reports;
create policy "reports_insert_own" on public.advisorpilot_reports
  for insert to authenticated
  with check ( owner_email = lower(auth.jwt() ->> 'email') );

drop policy if exists "reports_update_visible" on public.advisorpilot_reports;
create policy "reports_update_visible" on public.advisorpilot_reports
  for update to authenticated
  using (
    owner_email = lower(auth.jwt() ->> 'email')
    or (
      visibility in ('organization', 'shared')
      and public.is_org_admin(auth.jwt() ->> 'email', org_id)
    )
  );

drop policy if exists "reports_delete_own" on public.advisorpilot_reports;
create policy "reports_delete_own" on public.advisorpilot_reports
  for delete to authenticated
  using ( owner_email = lower(auth.jwt() ->> 'email') );


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 6 — Table grants                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

grant all on table public.advisorpilot_reports to anon, authenticated, service_role;


-- =============================================================================
-- DONE. Verify with these smoke queries in the Supabase SQL Editor:
--
--   -- 1. Table exists with the expected columns
--   select column_name, data_type
--     from information_schema.columns
--     where table_schema = 'public'
--       and table_name = 'advisorpilot_reports'
--     order by ordinal_position;
--
--   -- 2. Helpers + RPC + RLS policies in place
--   select proname from pg_proc
--     where proname in ('reports_visible_to', 'list_visible_reports');
--   select policyname from pg_policies
--     where tablename = 'advisorpilot_reports';
--
--   -- 3. Round-trip test — insert a sample row, list, delete:
--   insert into public.advisorpilot_reports (owner_email, title, content)
--     values ('you@firm.com', 'Smoke test report',
--             '# Smoke test\n\nIf you see this in list_visible_reports, RLS is wired.')
--     returning id;
--   select id, title, status, created_at
--     from public.list_visible_reports('you@firm.com');
--   delete from public.advisorpilot_reports where title = 'Smoke test report';
-- =============================================================================
