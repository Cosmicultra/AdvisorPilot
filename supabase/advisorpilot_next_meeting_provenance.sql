-- ─────────────────────────────────────────────────────────────────────────────
-- advisorpilot_next_meeting_provenance.sql
-- Section 14 in _apply_all_new_migrations.sql (run after section 13).
-- How/when the CRM next meeting was set (manual vs calendar).
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.advisorpilot_clients
  add column if not exists next_meeting_source text,
  add column if not exists next_meeting_initiator text,
  add column if not exists next_meeting_calendar_event_id text;
