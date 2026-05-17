-- =============================================================================
-- AdvisorPilot — RLS visibility helper functions (CRM Phase 0)
--
-- Single source of truth for the visibility rules that decide who can see a
-- given client / task / note row. Both RLS policies AND API route WHERE
-- clauses call these functions, so the rules live in exactly one place
-- (eliminates risk O5 from docs/crm/50-organizations-and-sharing.md).
--
-- All functions are LANGUAGE SQL STABLE so the Postgres planner can inline
-- them; reads still use the underlying indexes on the entity tables.
--
-- Idempotent: every function uses CREATE OR REPLACE. Safe to re-run.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ DO NOT APPLY THIS FILE STANDALONE.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These functions reference advisorpilot_clients.visibility,
-- advisorpilot_clients.org_id, and the same columns on tasks/notes — Postgres
-- parses LANGUAGE SQL function bodies at CREATE time, so those columns must
-- already exist when the functions are defined. Applying this file before
-- advisorpilot_crm_schema.sql will fail with:
--   "ERROR: column c.visibility does not exist"
--
-- The canonical apply path is supabase/_apply_crm_phase0_migrations.sql,
-- which inlines this file in the correct order (after the schema's tables
-- and columns, before its RLS policies). Use that runner instead.
--
-- This file is kept around as a single-purpose reference — useful when
-- diff-reviewing the function bodies in isolation, or porting them to a
-- separate Postgres instance where the schema already exists.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- clients_visible_to(viewer_email, client_id)
-- Returns true when the viewer can see the given client row.
-- Three branches:
--   1. Creator branch — owner_email matches viewer (also covers any
--      pre-backfill rows with NULL org_id; owner_email is always set).
--   2. Org-wide — visibility='organization' and viewer is an active member of
--      the row's org.
--   3. Explicit grant — visibility='shared' with a matching share_grants row.
-- ─────────────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────────────
-- tasks_visible_to(viewer_email, task_id)
-- Same three branches as clients_visible_to but against advisorpilot_tasks.
-- A task with no client_id is treated as personal — only the creator sees it.
-- ─────────────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────────────
-- notes_visible_to(viewer_email, note_id)
-- Same three branches against advisorpilot_notes.
-- ─────────────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────────────
-- is_org_admin(viewer_email, org_id)
-- True when viewer is an active member of org_id with role 'owner' or 'admin'.
-- Used by the UPDATE policy on shareable tables: admins can edit organization-
-- visible or shared rows even if they didn't create them.
-- ─────────────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — match the existing function-grant pattern from
-- _apply_all_new_migrations.sql so authenticated users can call these via RLS
-- evaluation, and service-role can call them directly from API routes.
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.clients_visible_to(text, uuid) to anon, authenticated, service_role;
grant execute on function public.tasks_visible_to(text, uuid)   to anon, authenticated, service_role;
grant execute on function public.notes_visible_to(text, uuid)   to anon, authenticated, service_role;
grant execute on function public.is_org_admin(text, uuid)       to anon, authenticated, service_role;
