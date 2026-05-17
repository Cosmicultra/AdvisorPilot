# 50 · Organizations & Sharing

How multi-advisor organizations work and how shareable entities (clients, tasks, notes) get scoped to private / specific-grantees / whole-org.

This is **schema-first, UI-later.** The org-aware columns land alongside the CRM Phase 0–1 migrations so we never accumulate org-less rows. The full sharing UI (invite flow, share drawers, org admin page) ships in **Phase 6** after CRM v1 is in production. Until Phase 6, every advisor is a single-member org of one and everything is private — identical to today's behavior — but the database is org-shaped.

## 1. Why now

Retrofitting multi-tenancy onto a CRM with thousands of rows is painful: every existing query needs an `OR is-shared` clause, RLS policies need restating, and migration backfill is non-trivial when "who created this?" wasn't recorded. By landing the org schema in Phase 0–1:

- Every CRM record (clients, tasks, notes) gets `org_id` + `visibility` from day one (the existing `owner_email` column already records the creator — no separate `created_by_email` needed; see §3.4).
- Existing rows backfill to "personal-org-of-one" via a one-shot migration that auto-creates a default org per advisor.
- Phase 6's sharing UI is just turning on the dials; the data model already supports it.

## 2. The model in one paragraph

An **organization** is a tenant. Advisors belong to one or more organizations via **memberships** (with a `role`: `owner` / `admin` / `member`). Every shareable entity (`advisorpilot_clients`, `advisorpilot_tasks`, `advisorpilot_notes`) belongs to one org and has a `visibility` enum: `private` (creator-only), `shared` (granted to specific members via a separate join table), or `organization` (everyone in the org). The legacy "advisor-scoped" model is preserved: every existing advisor gets a default org with themselves as the only `owner` member, and every existing row is migrated to `org_id = their_default_org` + `visibility = 'private'` — visible only to the original advisor, exactly as today.

## 3. Tables

### 3.1 New: `advisorpilot_organizations`

```sql
create table if not exists public.advisorpilot_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,                          -- URL-safe ID, e.g. "assured-wealth"
  created_by_email text not null,
  -- Plan / quota hooks for later. Nullable.
  plan_tier text,                            -- 'solo' | 'team' | 'enterprise'
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
```

### 3.2 New: `advisorpilot_organization_members`

```sql
create table if not exists public.advisorpilot_organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.advisorpilot_organizations(id) on delete cascade,
  member_email text not null,
  member_user_id uuid,                       -- Supabase auth.users id when present
  role text not null default 'member',       -- 'owner' | 'admin' | 'member'
  status text not null default 'active',     -- 'invited' | 'active' | 'removed'
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
```

### 3.3 New: `advisorpilot_share_grants`

Per-entity, per-grantee. Populated only when `visibility = 'shared'`.

```sql
create table if not exists public.advisorpilot_share_grants (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,                 -- 'client' | 'task' | 'note'
  entity_id uuid not null,
  grantee_email text not null,
  grantee_user_id uuid,
  granted_by_email text not null,
  granted_at timestamptz not null default now(),
  -- Optional: scope what the grantee can do
  permission text not null default 'view',   -- 'view' | 'edit'
  unique (entity_type, entity_id, grantee_email)
);

create index if not exists advisorpilot_share_grants_grantee_idx
  on public.advisorpilot_share_grants (grantee_email, entity_type);

create index if not exists advisorpilot_share_grants_entity_idx
  on public.advisorpilot_share_grants (entity_type, entity_id);

alter table public.advisorpilot_share_grants enable row level security;
```

### 3.4 Additive columns on shareable existing tables

Each of `advisorpilot_clients`, `advisorpilot_tasks`, `advisorpilot_notes` gains the same **pair** — all NULLABLE with no DEFAULT, so existing rows are untouched until the backfill migration runs:

```sql
-- Clients
alter table public.advisorpilot_clients
  add column if not exists org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  add column if not exists visibility text;          -- 'private' | 'shared' | 'organization'

-- Tasks (new table from 20-technical-specs.md; columns included from creation)
alter table public.advisorpilot_tasks
  add column if not exists org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  add column if not exists visibility text;

-- Notes (new table; columns from creation)
alter table public.advisorpilot_notes
  add column if not exists org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  add column if not exists visibility text;

create index if not exists advisorpilot_clients_org_visibility_idx
  on public.advisorpilot_clients (org_id, visibility);
create index if not exists advisorpilot_tasks_org_visibility_idx
  on public.advisorpilot_tasks (org_id, visibility);
create index if not exists advisorpilot_notes_org_visibility_idx
  on public.advisorpilot_notes (org_id, visibility);
```

**Why no `created_by_email` column:** The existing `owner_email` column on these tables IS the creator's email (set once at INSERT, never updated). v1 has no ownership-transfer feature, and Phase 6 sharing achieves "new advisor sees this" via `share_grants` rather than changing ownership. So `owner_email` serves the resolver's "creator always sees own row" branch without a redundant column. If we add ownership transfer in a future phase, that's the time to introduce a separate `created_by_email` for immutable provenance.

### 3.5 Backfill migration (one-shot, idempotent)

A separate file, `supabase/advisorpilot_org_backfill.sql`, run **at the end of Phase 0** immediately after the schema migration (NOT Phase 1.5 — see §11). The backfill is purely additive (zero impact on legacy queries) so running it early is safe and means Phase 1 writes already have correct `org_id` from day one.

```sql
-- Step 1: create one personal org per advisor (unioned from clients + advisor_profiles
-- so we catch existing advisors with zero saved clients).
insert into public.advisorpilot_organizations (id, name, slug, created_by_email)
select
  gen_random_uuid(),
  concat(split_part(owner_email, '@', 1), '''s organization'),
  concat('personal-', md5(owner_email)),
  owner_email
from (
  select distinct owner_email from public.advisorpilot_clients where owner_email is not null
  union
  select distinct owner_email from public.advisorpilot_advisor_profiles where owner_email is not null
) advisors
on conflict (slug) do nothing;

-- Step 2: make each advisor the owner of their personal org
insert into public.advisorpilot_organization_members (org_id, member_email, role, status, accepted_at)
select o.id, o.created_by_email, 'owner', 'active', now()
from public.advisorpilot_organizations o
where o.slug like 'personal-%'
on conflict (org_id, member_email) do nothing;

-- Step 3: backfill clients to personal org + private visibility
update public.advisorpilot_clients c
set
  org_id = o.id,
  visibility = 'private'
from public.advisorpilot_organizations o
where o.created_by_email = c.owner_email
  and c.org_id is null;

-- Same backfill applied to advisorpilot_tasks and advisorpilot_notes when those tables exist + populated.
-- Each statement is idempotent: WHERE … is null guard means a re-run is a no-op.
```

### 3.6 Lazy org provisioning for future signups

The backfill catches every advisor that exists at the time of deploy. For advisors who sign up later, a small helper ensures their personal org exists on first request:

```ts
// lib/crm/ensure-personal-org.ts
export async function ensurePersonalOrg(email: string): Promise<string> {
  // Idempotent INSERT … ON CONFLICT DO NOTHING into both organizations
  // and organization_members. Returns the org_id either way.
  // Called from resolveAdvisorIdentity (one extra round-trip on first
  // request of a session; cache in the React context after that).
}
```

This is the "future signup" half of the lazy-creation strategy. Combined with the union-with-profiles in the backfill, the system covers all four cases: existing-with-clients, existing-without-clients, future-with-clients, future-without-clients.

## 4. Visibility resolver

**Single source of truth: Postgres function.** The visibility check lives in `LANGUAGE SQL STABLE` functions in Supabase. RLS policies use them directly. API routes (service-role) use them too — instead of constructing a SQL WHERE clause in TypeScript, every read calls the same function via a `WHERE clients_visible_to($email, c.id)` clause. The function's STABLE marker and pure-SQL body let the Postgres planner inline the call, so reads still use the underlying indexes.

```sql
-- supabase/advisorpilot_rls_helpers.sql
-- Pure SQL, STABLE — planner can inline. One function per entity type so
-- the function body can reference the entity table directly (cleanest plan).

create or replace function public.clients_visible_to(viewer_email text, client_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_clients c
    where c.id = client_id
      and (
        -- Creator always sees own row (or any row still using legacy owner_email
        -- semantics — `org_id IS NULL` rows pre-backfill resolve through the
        -- same branch).
        c.owner_email = lower(viewer_email)

        -- Org-wide: any active member of the same org sees it.
        OR (
          c.visibility = 'organization'
          AND c.org_id IN (
            select om.org_id from public.advisorpilot_organization_members om
            where om.member_email = lower(viewer_email) and om.status = 'active'
          )
        )

        -- Explicit grant: any row with a matching share_grants entry.
        OR (
          c.visibility = 'shared'
          AND exists (
            select 1 from public.advisorpilot_share_grants g
            where g.entity_type = 'client'
              and g.entity_id = c.id
              and g.grantee_email = lower(viewer_email)
          )
        )
      )
  );
$$;

-- Parallel `tasks_visible_to(viewer_email, task_id)` and
-- `notes_visible_to(viewer_email, note_id)` mirror the structure.

create or replace function public.is_org_admin(viewer_email text, org_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.advisorpilot_organization_members om
    where om.org_id = is_org_admin.org_id
      and om.member_email = lower(viewer_email)
      and om.role in ('owner', 'admin')
      and om.status = 'active'
  );
$$;
```

**TypeScript side** — `lib/crm/visibility.ts` exports a tiny helper that returns the SQL fragment for use in PostgREST-style query builders:

```ts
// Used by API routes: WHERE clients_visible_to($viewerEmail, c.id)
export function visibleClientsClause(): string {
  return "clients_visible_to($1, c.id)";   // $1 = advisor email
}
```

No SQL is constructed in TypeScript. The function call is the contract; the function body is the only place the rules live. If we want to add a new branch (e.g. "team leads see all team-tagged clients"), it's one Postgres function edit.

**Pre-org backward-compat (NULL `org_id` / NULL `visibility`):**

Rows whose new columns are NULL (a hypothetical row that slips through after backfill) still resolve through the **creator branch**: `c.owner_email = lower(viewer_email)`. That branch doesn't reference `org_id` or `visibility`, so NULL values aren't blockers — the creator always sees their own rows regardless of when they were inserted. **No separate legacy-fallback OR clause is needed** because `owner_email` is the right answer for both legacy and new rows.

After the Phase-0 backfill runs, every existing row has `org_id` populated. Phase 7 adds a CHECK constraint to enforce `org_id IS NOT NULL` going forward (after a monitoring window).

## 5. RLS policies

**Decision (schema audit, 2026-05-15): full RLS with policies on every new CRM table (Option A).** Defense-in-depth, single source of truth via the SQL functions, matches the existing `clients`/`documents` pattern. See `20-technical-specs.md §8` for the reasoning.

Same shape on all three shareable tables. Example for `advisorpilot_clients`:

```sql
-- Drop-then-create pattern for idempotency. Postgres CREATE POLICY doesn't
-- support IF NOT EXISTS, so we drop first; this lets the migration re-run
-- safely (per 20-technical-specs.md §1.3).

-- Read: viewer sees any row that passes the visibility resolver above.
DROP POLICY IF EXISTS "clients_select_visible" ON public.advisorpilot_clients;
CREATE POLICY "clients_select_visible" ON public.advisorpilot_clients
  FOR SELECT TO authenticated
  USING ( public.clients_visible_to(auth.jwt() ->> 'email', id) );

-- Write: only the creator (always), or an org admin on org/shared visibility.
-- Private rows are creator-only for BOTH read AND write — "private" means
-- private from everyone, including admins. Matches Notion/Linear convention
-- and matches risk O7's mitigation.
DROP POLICY IF EXISTS "clients_update_visible" ON public.advisorpilot_clients;
CREATE POLICY "clients_update_visible" ON public.advisorpilot_clients
  FOR UPDATE TO authenticated
  USING (
    owner_email = lower(auth.jwt() ->> 'email')
    OR (
      visibility in ('organization', 'shared')
      AND public.is_org_admin(auth.jwt() ->> 'email', org_id)
    )
  );

-- Same on INSERT — only the creator inserts; org admins can't fabricate rows for others.
DROP POLICY IF EXISTS "clients_insert_own" ON public.advisorpilot_clients;
CREATE POLICY "clients_insert_own" ON public.advisorpilot_clients
  FOR INSERT TO authenticated
  WITH CHECK ( owner_email = lower(auth.jwt() ->> 'email') );
```

The `clients_visible_to(email, client_id)` and `is_org_admin(email, org_id)` functions live in `supabase/advisorpilot_rls_helpers.sql` and are the **single source of truth** for visibility logic. Both RLS policies and API routes call them — there's no parallel TypeScript implementation to drift against (see §4).

Service-role bypasses RLS (existing pattern); all server routes use the service-role client and add `WHERE clients_visible_to(...)` to every read. The function does the visibility work; the API doesn't reconstruct it.

**Architectural rule:** All CRM reads MUST go through API routes using the service-role client + the visibility function. No direct client-side Supabase reads of `advisorpilot_clients`, `_tasks`, or `_notes`. This keeps RLS off the hot path and gives us one audit point for visibility behavior.

## 6. API surface additions

### 6.1 Organizations

```
GET  /api/orgs
  Response: { orgs: Organization[] }  // all orgs the viewer is a member of

POST /api/orgs
  Body: { name, slug? }
  Response: { org: Organization }  // creates org + auto-adds creator as owner

PATCH /api/orgs/[id]
  Body: { name?, slug?, planTier? }
  Response: { org: Organization }

GET  /api/orgs/[id]/members
  Response: { members: OrgMember[] }

POST /api/orgs/[id]/members
  Body: { email, role? }  // sends an invite
  Response: { member: OrgMember }

PATCH /api/orgs/[id]/members/[memberId]
  Body: { role?, status? }
  Response: { member: OrgMember }

DELETE /api/orgs/[id]/members/[memberId]
  Response: { id: string }
```

Invites are simple in v1: the invited email gets an email link (existing `/api/email-client-upload-link` pattern lightly generalized). On click, the recipient signs in and the membership flips to `status = 'active'`.

### 6.2 Sharing controls

Per-entity, three lightweight endpoints:

```
GET    /api/share/[entityType]/[entityId]
  Response: { visibility, grants: ShareGrant[], org: Organization | null }

PATCH  /api/share/[entityType]/[entityId]
  Body: { visibility: 'private' | 'shared' | 'organization' }
  Response: same as GET

POST   /api/share/[entityType]/[entityId]/grants
  Body: { granteeEmail, permission? }
  Response: { grant: ShareGrant }

DELETE /api/share/[entityType]/[entityId]/grants/[granteeEmail]
  Response: { id: string }
```

All routes check that the viewer is the creator OR an org admin before allowing changes.

### 6.3 Existing routes — minimal surface change

Existing endpoints (`/api/client-database`, `/api/clients`, `/api/tasks`, `/api/notes`, `/api/activity`) ALL gain the visibility resolver in their read path. They keep their request/response shapes unchanged — the shape of `ClientRosterItem`, `Task`, `Note` is unchanged. Only the row-filter expands.

New optional fields on response payloads (additive):

```ts
interface ClientRosterItem {
  // … existing fields …
  visibility?: "private" | "shared" | "organization";
  // ownerEmail is already present on ClientRosterItem today — it IS the
  // creator's email. The CRM UI uses it to display "Owned by D. Patel"
  // chips when ownerEmail !== viewer.email.
  sharedWith?: string[];     // email list (only populated for the entity owner / org admins)
}
```

Plain advisors see `visibility` to know whether the row is private / shared / org-wide. Org admins additionally see `sharedWith` to manage from the roster row. The owner display name comes from the existing `ownerEmail` field — no `createdByEmail` duplication.

## 7. TypeScript contracts

In `lib/crm/types.ts`. Note: there is no `CreatedByEmail` separate from the existing `ownerEmail` — `owner_email` IS the creator email.

```ts
export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  createdByEmail: string;
  planTier: "solo" | "team" | "enterprise" | null;
  maxSeats: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  memberEmail: string;
  memberUserId: string | null;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "removed";
  invitedByEmail: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
}

export type Visibility = "private" | "shared" | "organization";

export interface ShareGrant {
  id: string;
  entityType: "client" | "task" | "note";
  entityId: string;
  granteeEmail: string;
  granteeUserId: string | null;
  grantedByEmail: string;
  grantedAt: string;
  permission: "view" | "edit";
}
```

## 8. UI surface (Phase 6)

### 8.1 Roster row labeling

`ClientRow` shows a small **owner chip** in the meta strip when the row's `createdByEmail !== viewer.email`. Example: `D. Patel · Chen Family Trust · 4 accounts · Sarah's book`.

For org-shared rows: the chip says "Org" with the org slug as tooltip.

### 8.2 Share drawer

Reachable from the kebab on any client / task / note. Form:

- Radio: **Private** / **Shared with specific people** / **Whole organization**
- If "Shared": email picker (autocompletes org members), each grant gets a `permission` dropdown (view / edit).
- "Save" button.

Backend: `PATCH /api/share/<type>/<id>` for the visibility flip; `POST/DELETE /api/share/.../grants` for the picker changes.

### 8.3 Organization page

New `app/app/settings/organization/page.tsx`:

- Org name + slug editor (admins only).
- Member list with role badges (owner / admin / member) and last-active timestamp.
- "Invite member" button → drawer with email + role selector.
- Plan info + seat count (read-only in v1; ties to Stripe later).

### 8.4 Invitations

When invited, the new advisor:

1. Receives an email with a magic link via the existing email-sending plumbing.
2. Clicks → lands on `/app/orgs/[slug]/accept?token=…`.
3. Signs in (or signs up — same Google + email/password auth flow).
4. The route POST-flips `organization_members.status` to `active`.

## 9. Voice agent extensions

The voice agent gains organization awareness in Phase 6:

- `list_clients` / `search_clients` already returns the visibility-filtered set automatically (server-side filter applies). No tool signature changes — the agent just sees more rows when the advisor is in an org with shared/organization-wide records.
- **Persona prompt update (Phase 6):** when a `list_clients` / `search_clients` search returns zero matches for a name the advisor expects to find, the agent suggests checking with an org-mate ("I don't see Robert Garcia in your visible clients — he might be on a colleague's book. Ask them to share him with you, or want me to list who else is in your organization?").
- New tools:
  - `share_client({ name, with, permission? })` — share a client with another advisor. Requires explicit confirmation in the agent's persona ("I'm sharing Sarah Chen with Robert Patel (view-only) — saving now. Say cancel to undo.").
  - `list_org_members()` — list who else is in your org (for the agent to disambiguate "share with David" → which David?).

These are write tools, gated by `voice_can_write = true` (the same Phase 4.1 advisor pref). The persona update for shared-row hints ships in the same PR as `share_client` and `list_org_members`, not in Phase 4.

## 10. Backward compatibility — the matrix

| Existing concern | Pre-Phase-0 (today) | Phase 0-5 (schema landed, UI not) | Phase 6 (UI live) |
|---|---|---|---|
| Existing client rows | Belong to one advisor by `owner_email` | Phase-0 backfill populates `org_id` + `visibility = 'private'` on every existing row. Resolver's creator branch (`owner_email = viewer`) also catches any NULL-`org_id` row that somehow slipped through. | Same; advisor can now flip visibility to shared/organization if they want. |
| Existing `/api/client-database` query | Returns rows where `owner_email = viewer` | Same response shape. Internally, the query becomes `WHERE clients_visible_to($email, c.id)` — which the SQL function evaluates the same way (creator branch) for personal rows. | Same response shape. |
| Existing `writeAuditEvent` calls | Recorded per-advisor | Same — audit events are an immutable log, not a shareable entity | Org-scoped audit views are a Phase 7+ enhancement; v1 audit stays per-advisor. |
| `advisorpilot_documents` (statement uploads) | Per-advisor | Stays per-advisor by `owner_email`. Documents are NOT shareable in v1 (clients sometimes are; their statements aren't). | Reconsider in Phase 7. |
| `advisorpilot_advisor_profiles` | Per-advisor settings (signature, LLM prefs, voice prefs) | Unchanged. Profile is always personal — never shared. | Same. |
| Voice agent `getState()` | Reads single-advisor focus | Same — focus is always the current viewer. The roster the agent sees is org-aware via tool calls. | Same. |
| Demo mode | One demo advisor, one demo client | Demo client lives in a **synthetic (in-memory) demo org** with the demo advisor as the only member — never persisted to Supabase. `useAdvisorClient()` returns the synthetic org/membership/client without any DB query (matches `30-backward-compat.md §8`). | Same. |

## 11. Migration order

The cleanest sequence:

1. **Phase 0 (CRM Phase 0):** Apply BOTH the schema and the backfill in the same deploy window.
   1. Schema: create `advisorpilot_organizations`, `advisorpilot_organization_members`, `advisorpilot_share_grants` tables. Add the `org_id` + `visibility` pair to `advisorpilot_clients`. Install `clients_visible_to()` / `tasks_visible_to()` / `notes_visible_to()` / `is_org_admin()` SQL functions.
   2. Backfill: run `advisorpilot_org_backfill.sql`. Unions clients + advisor_profiles to catch zero-client advisors; idempotent.
   3. Result: every existing row has `org_id` populated and `visibility = 'private'` before any Phase-1 write runs.
2. **Phase 1 (CRM Phase 1):** When `advisorpilot_tasks` + `advisorpilot_notes` are created, they ship with the org-aware columns from the start and the backfill extends to populate them. `/api/clients` queries use `WHERE clients_visible_to(...)`. The resolver's creator branch (`owner_email = viewer`) covers any row that somehow slipped through with NULL `org_id`.
3. **Phase 6 (post-CRM-v1):** Ship the sharing UI, the organization page, the invite flow, the voice tools. Resolver works as designed — no resolver changes needed because the function already implements the full model.
4. **Phase 7 (cleanup):** Add a `CHECK (org_id IS NOT NULL)` constraint to `advisorpilot_clients` (and tasks, notes) once a monitoring window confirms zero NULL rows. Also drops the "future enhancement" notes for things now shipped.

**Why Phase 0 (not 1.5) for the backfill:** the backfill is purely additive — it only writes to new columns and creates rows in new tables. Zero risk to existing reads. Running it in Phase 0 means Phase 1 writes never accumulate NULL-org_id rows, which means the resolver's belt-and-suspenders creator-branch never has to do real work as a fallback.

## 12. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| O1 | Email change orphans the old personal org | Low | Low | v1 doesn't support email change. If we add it in Phase 7+, we tie membership lookups to `member_user_id` (already nullable on the table for this future use). Deferred. |
| O2 | An advisor in two orgs sees a confusing union of clients | Med | Med | Phase 6 roster has an org-filter chip ("My book · Assured Wealth · Other org"). |
| O3 | Sharing leaks PII to the wrong grantee (typo in email) | Med | High | Share drawer's email picker autocompletes from `organization_members` only — can't grant to a non-member. Adding a non-member requires an invite first. |
| O4 | Visibility resolver SQL is slow on large datasets | Low | High | `clients_visible_to()` is `LANGUAGE SQL STABLE` so the planner can inline it. Indexes on `(org_id, visibility)` + `(grantee_email, entity_type)` cover the share-grants lookup. EXPLAIN-ANALYZE'd against a synthetic dataset before Phase 6 ships. |
| O5 | RLS policy disagrees with API resolver | **Eliminated** | — | Single SQL function `clients_visible_to(email, id)` used by both RLS policies and API `WHERE` clauses. No parallel TypeScript implementation to drift against. |
| O6 | An admin removes a member while that member has open tasks | Low | Med | `on delete cascade` is set on `organization_members → organizations`; removing a member doesn't delete their entities (org_id stays). Phase 6's removal flow surfaces "this member has N tasks; choose: transfer to admin / delete / make private." |
| O7 | Org admin sees their own private notes when "show all org clients" is checked | Low | Med | Resolver's three branches don't include `private` for non-creators. Admin WRITE policy also tightened to `visibility IN ('organization', 'shared')` — admins can't blind-write private rows. Tested explicitly. |
| O8 | Future signup hits CRM before personal org exists | Low | Med | `ensurePersonalOrg(email)` helper called from `resolveAdvisorIdentity` creates the org + membership on first request via idempotent `INSERT ON CONFLICT DO NOTHING`. Cached in the React context for the session. |

## 13. What's NOT in this work

- **Billing.** `plan_tier` and `max_seats` columns are placeholders; Stripe integration is a separate plan.
- **Cross-org sharing.** An entity belongs to exactly one org. Sharing across orgs is not supported.
- **Granular permissions beyond view/edit.** No "comment only", no "redacted PII view" — Phase 7+.
- **Org-scoped audit logs.** Audit events stay per-advisor in v1. Org admins can't audit other members' actions until Phase 7.
- **Org-scoped voice settings.** Each advisor keeps personal voice settings; no "force org-wide voice agent off" toggle yet.

## 14. Concrete additions to `40-path-forward.md`

The phase table in `40-path-forward.md §1` already reflects this work. For reference:

```
Phase 0   Skeleton + flag + org schema + backfill         (2½d)
Phase 1   Read-only Roster + visibility resolver          (5d)
Phase 2   Tasks + Notes + Activity                        (5d)
Phase 3   Workflow extraction                             (8d)
Phase 4   Voice read tools                                (3d)
Phase 4.1 Voice write tools                               (2d)
Phase 5   Cutover                                         (2d)
─────────  v1 ships  ────────────────────────────────────────
Phase 6   Organizations & sharing UI                      (8d)
Phase 7   Resolver cleanup + audit-org scope              (3d)
```

The schema + backfill are merged into Phase 0 (not split as Phase 1.5) because the backfill is purely additive — running it during the same deploy as the schema means every Phase 1 write already has correct `org_id`. Total v1: ~28d. v1+Phase 6: ~36d.

## 15. The org-of-one assumption

For the entire v1 rollout (Phases 0–5), the org model is **invisible to advisors**. Every advisor has a personal org-of-one. The roster shows no org chips, no share controls, no member list. The only place the org model is observable is in the database. This means:

- Zero new advisor-facing UX from this work during v1.
- Zero training cost.
- Phase 6 introduces the controls when there's a real demand signal (e.g. firm onboards a 5-advisor team).
- If the demand signal never materializes, Phase 6 ships with smaller scope (just "invite a colleague" and "view their clients") — the schema doesn't force the full feature.

## 16. Decision summary

| Question | Decision |
|---|---|
| Do we need orgs in v1? | Schema-yes, UI-no. Land the columns in Phases 0–1; ship sharing UI in Phase 6. |
| Default org per advisor? | Yes — backfill creates one personal org per existing advisor, owner role, slug = `personal-md5(email)`. |
| Three visibility values or two? | Three: `private`, `shared`, `organization`. Two doesn't model "I want Robert and David to see this but not the whole firm." |
| Permission levels? | Two: `view`, `edit`. `view` = read-only; `edit` = full mutate. Granular permissions are Phase 7+. |
| Cross-org sharing? | Not supported. Entities belong to exactly one org. |
| Existing advisors auto-migrated? | Yes, by the one-shot backfill migration. Resolver tolerates NULL org_id rows until backfill completes. |
| Are documents shareable? | No in v1. Statement uploads stay personal. Phase 7 reconsiders. |
