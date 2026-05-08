-- Run once in Supabase SQL editor if you already created advisorpilot_upload_tokens
-- without intake_snapshot (adds advisor-prefilled client profile JSON for magic links).

alter table public.advisorpilot_upload_tokens
  add column if not exists intake_snapshot jsonb;
