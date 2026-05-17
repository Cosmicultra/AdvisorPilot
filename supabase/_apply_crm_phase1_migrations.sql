-- =============================================================================
-- AdvisorPilot — apply CRM Phase 1 migrations
--
-- Self-contained — paste into Supabase Dashboard → SQL Editor → Run.
--
-- Phase 1 only adds two SQL helper functions on top of Phase 0. Both wrap
-- the visibility resolvers from advisorpilot_rls_helpers.sql so API routes
-- can query the visible set in a single PostgREST round-trip via
-- supabase.rpc(). Single source of truth for visibility logic — same as
-- the RLS policies, no parallel TypeScript implementation.
--
-- Idempotent: every function uses CREATE OR REPLACE. Safe to re-run.
--
-- DEPENDENCIES (must already exist from Phase 0):
--   - clients_visible_to(text, uuid)
--   - public.advisorpilot_clients (with org_id + visibility columns)
--   - public.advisorpilot_activity_log
--   - public.advisorpilot_audit_events
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  list_visible_clients(viewer_email)                                        ║
-- ║                                                                            ║
-- ║  Returns every advisorpilot_clients row the viewer can see, per the        ║
-- ║  three branches in clients_visible_to (creator / organization / shared).   ║
-- ║                                                                            ║
-- ║  Used by GET /api/clients. Filtering / sorting / pagination happen in TS   ║
-- ║  (acceptable for v1 cohorts of <100 clients per advisor; if N grows,       ║
-- ║  push these into the function signature later).                            ║
-- ║                                                                            ║
-- ║  STABLE so the planner can inline the visibility check; reads still use    ║
-- ║  advisorpilot_clients_owner_email_idx + the org_visibility composite idx.  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.list_visible_clients(viewer_email text)
returns setof public.advisorpilot_clients
language sql stable
as $$
  select c.*
    from public.advisorpilot_clients c
   where public.clients_visible_to(viewer_email, c.id);
$$;

grant execute on function public.list_visible_clients(text) to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  list_visible_activity(viewer_email, target_client_id, since_ts, limit_n)  ║
-- ║                                                                            ║
-- ║  Powers the Timeline tab + Overview's recent-activity rail. Unions:        ║
-- ║    1. advisorpilot_activity_log (CRM-native; manually-logged entries +     ║
-- ║       side-effects from Phase 2 task/note routes)                          ║
-- ║    2. advisorpilot_audit_events filtered to entity_type='client' (the      ║
-- ║       existing audit trail; statement.extracted, analysis.completed,       ║
-- ║       client.created, etc.)                                                ║
-- ║                                                                            ║
-- ║  Each entry carries a `source` column the adapter (lib/crm/                ║
-- ║  activity-adapter.ts) uses to map audit-event actions to ActivityType. New ║
-- ║  audit actions added by future PRs render as 'system' until the adapter    ║
-- ║  map names them.                                                           ║
-- ║                                                                            ║
-- ║  Both branches respect visibility via clients_visible_to(viewer, client).  ║
-- ║                                                                            ║
-- ║  Parameters:                                                               ║
-- ║    target_client_id  — when non-NULL, restricts to entries for that client ║
-- ║    since_ts          — when non-NULL, only entries occurred_at >= since    ║
-- ║    limit_n           — max rows to return; defaults to 50                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.list_visible_activity(
  viewer_email text,
  target_client_id uuid default null,
  since_ts timestamptz default null,
  limit_n integer default 50
)
returns table (
  id uuid,
  source text,             -- 'activity_log' | 'audit_event'
  client_id uuid,
  owner_email text,
  type text,               -- ActivityType for activity_log; raw audit action for audit_event
  title text,
  body text,
  actor_email text,
  metadata jsonb,
  occurred_at timestamptz
)
language sql stable
as $$
  with native as (
    select
      a.id,
      'activity_log'::text as source,
      a.client_id,
      a.owner_email,
      a.type,
      a.title,
      a.body,
      a.actor_email,
      a.metadata,
      a.occurred_at
    from public.advisorpilot_activity_log a
    where (target_client_id is null
           or a.client_id = target_client_id)
      and (since_ts is null or a.occurred_at >= since_ts)
      and (
        a.owner_email = lower(viewer_email)
        or (a.client_id is not null
            and public.clients_visible_to(viewer_email, a.client_id))
      )
  ),
  audit as (
    select
      e.id,
      'audit_event'::text as source,
      e.entity_id as client_id,
      e.owner_email,
      e.action as type,
      e.action as title,            -- adapter will humanize this
      null::text as body,
      e.actor_email,
      e.metadata,
      e.created_at as occurred_at
    from public.advisorpilot_audit_events e
    where e.entity_type = 'client'
      and e.entity_id is not null
      and (target_client_id is null or e.entity_id = target_client_id)
      and (since_ts is null or e.created_at >= since_ts)
      and public.clients_visible_to(viewer_email, e.entity_id)
  )
  select * from native
  union all
  select * from audit
  order by occurred_at desc
  limit greatest(coalesce(limit_n, 50), 1);
$$;

grant execute on function public.list_visible_activity(text, uuid, timestamptz, integer)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  VERIFICATION — run after applying to confirm the functions exist.        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- select proname, pronargs from pg_proc
--  where proname in ('list_visible_clients', 'list_visible_activity')
--  order by proname;
-- -- Expected: two rows.
--
-- select * from public.list_visible_clients('chris@assuredwealthadvisors.com');
-- -- Expected: every client row Chris owns.
--
-- select * from public.list_visible_activity(
--   'chris@assuredwealthadvisors.com',
--   null,
--   now() - interval '90 days',
--   10
-- );
-- -- Expected: up to 10 entries from the last 90 days.
