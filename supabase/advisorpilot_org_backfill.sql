-- =============================================================================
-- AdvisorPilot — CRM Phase 0 backfill: personal-org-of-one per advisor
--
-- Runs ONCE (but is idempotent: ON CONFLICT DO NOTHING + WHERE … IS NULL
-- guards make re-runs no-ops).
--
-- For every existing advisor in the system:
--   1. Create a personal organization with a deterministic slug
--      ('personal-md5(email)') so re-runs collide harmlessly.
--   2. Make them the 'owner' member of that org.
--   3. Stamp every advisorpilot_clients row they own with org_id +
--      visibility='private'.
--
-- The advisor union (clients ∪ advisor_profiles) catches advisors with zero
-- saved clients — they still need a personal org so their first client
-- creation in Phase 1 has somewhere to live.
--
-- Tasks/notes/activity_log are empty at Phase 0 (no UI exists yet to create
-- them), so no backfill rows are needed for those tables. Phase 1 onward,
-- the API layer stamps org_id at INSERT time via lib/crm/ensure-personal-org.ts.
--
-- Apply order:
--   1. supabase/advisorpilot_rls_helpers.sql
--   2. supabase/advisorpilot_crm_schema.sql
--   3. THIS FILE
--
-- The combined runner supabase/_apply_crm_phase0_migrations.sql does all three.
-- =============================================================================


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
-- WHERE c.org_id is null guards re-runs — already-stamped rows are skipped.
update public.advisorpilot_clients c
   set org_id     = o.id,
       visibility = 'private'
  from public.advisorpilot_organizations o
 where lower(o.created_by_email) = lower(c.owner_email)
   and o.slug like 'personal-%'
   and c.org_id is null;


-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (run manually after the backfill to confirm; do NOT
-- include them in production migration runs):
--
--   select count(*) from public.advisorpilot_organizations
--    where slug like 'personal-%';                    -- = N advisors
--
--   select count(*) from public.advisorpilot_organization_members
--    where role = 'owner' and status = 'active';      -- = N advisors
--
--   select count(*) from public.advisorpilot_clients
--    where org_id is null;                            -- = 0
-- ─────────────────────────────────────────────────────────────────────────────
