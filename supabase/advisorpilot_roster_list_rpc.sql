-- Roster-optimized visibility list: omits heavy JSONB payloads (analysis,
-- roth_worksheet, meeting_notes) on the wire.
--
-- Uses SELECT c.* so column order always matches the live table (SET OF
-- advisorpilot_clients is position-sensitive). Do NOT hand-list columns here.
--
-- After advisorpilot_fee_analysis_worksheet.sql adds fee_analysis_worksheet,
-- re-run that file (or _apply_all_new_migrations.sql) to also strip that column.

create or replace function public.list_visible_clients_roster(viewer_email text)
returns setof public.advisorpilot_clients
language plpgsql
stable
as $$
declare
  r public.advisorpilot_clients;
begin
  for r in
    select c.*
    from public.advisorpilot_clients c
    where public.clients_visible_to(viewer_email, c.id)
  loop
    r.meeting_notes := null;
    r.analysis := null;
    r.roth_worksheet := null;
    return next r;
  end loop;
  return;
end;
$$;

grant execute on function public.list_visible_clients_roster(text)
  to anon, authenticated, service_role;
