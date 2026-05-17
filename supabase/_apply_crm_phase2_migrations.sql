-- =============================================================================
-- AdvisorPilot — apply CRM Phase 2 migrations
--
-- Self-contained — paste into Supabase Dashboard → SQL Editor → Run.
--
-- Phase 2 adds two more SQL helper functions on top of Phase 0/1, mirroring
-- list_visible_clients but for the tasks and notes tables. Same single-
-- source-of-truth pattern: API routes call them via supabase.rpc() so
-- visibility logic lives in ONE place (the SQL functions; same predicate
-- the RLS policies use).
--
-- Idempotent: every function uses CREATE OR REPLACE. Safe to re-run.
--
-- DEPENDENCIES (must already exist from Phase 0):
--   - tasks_visible_to(text, uuid)
--   - notes_visible_to(text, uuid)
--   - public.advisorpilot_tasks
--   - public.advisorpilot_notes
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  list_visible_tasks(viewer_email)                                          ║
-- ║                                                                            ║
-- ║  Returns every advisorpilot_tasks row the viewer can see (creator branch   ║
-- ║  + organization-wide + explicitly-shared). API route filters/sorts/paginates║
-- ║  on the returned set in TS — same approach as list_visible_clients.        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.list_visible_tasks(viewer_email text)
returns setof public.advisorpilot_tasks
language sql stable
as $$
  select t.*
    from public.advisorpilot_tasks t
   where public.tasks_visible_to(viewer_email, t.id);
$$;

grant execute on function public.list_visible_tasks(text) to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  list_visible_notes(viewer_email)                                          ║
-- ║                                                                            ║
-- ║  Returns every advisorpilot_notes row the viewer can see. Same shape +     ║
-- ║  predicate as list_visible_tasks but against the notes table.              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.list_visible_notes(viewer_email text)
returns setof public.advisorpilot_notes
language sql stable
as $$
  select n.*
    from public.advisorpilot_notes n
   where public.notes_visible_to(viewer_email, n.id);
$$;

grant execute on function public.list_visible_notes(text) to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  VERIFICATION                                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- select proname, pronargs from pg_proc
--  where proname in ('list_visible_tasks', 'list_visible_notes')
--  order by proname;
-- -- Expected: two rows.
