-- Comparative fee analysis worksheet (per-account management assumptions).
-- Idempotent; safe on databases that already ran _apply_all_new_migrations.sql.

alter table public.advisorpilot_clients
  add column if not exists fee_analysis_worksheet jsonb;

-- Roster RPC: SELECT c.* + strip heavy JSONB (order-agnostic vs hand-listed columns).
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
    r.fee_analysis_worksheet := null;
    return next r;
  end loop;
  return;
end;
$$;

grant execute on function public.list_visible_clients_roster(text)
  to anon, authenticated, service_role;
