# 20 · Technical Specs

Database schemas, API surface, TypeScript contracts, component interfaces, and voice-agent tool extensions. Implementation in `10-implementation.md` references everything in this document by anchor.

## 1. Database changes

### 1.1 New tables (all additive, none touching existing rows)

#### `advisorpilot_tasks`

One row per task. Scoped per advisor, optionally linked to a client.

**FK delete semantics:** `client_id` uses `ON DELETE CASCADE` — a task without its client is meaningless, so we drop it when the client is deleted. This is deliberately different from `advisorpilot_documents.client_id` (which is `ON DELETE SET NULL`); documents are standalone artifacts worth preserving as orphans, tasks aren't. Same `CASCADE` semantics for `advisorpilot_notes.client_id` and `advisorpilot_activity_log.client_id`.

```sql
create table if not exists public.advisorpilot_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  due_time time,
  priority text default 'Medium',           -- 'High' | 'Medium' | 'Low'
  status text default 'open',               -- 'open' | 'in_progress' | 'done' | 'cancelled'
  completed_at timestamptz,
  reminder_at timestamptz,
  tags jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_tasks_owner_status_idx
  on public.advisorpilot_tasks (owner_email, status, due_date);

create index if not exists advisorpilot_tasks_client_idx
  on public.advisorpilot_tasks (client_id, status);

drop trigger if exists set_advisorpilot_tasks_updated_at on public.advisorpilot_tasks;
create trigger set_advisorpilot_tasks_updated_at
  before update on public.advisorpilot_tasks
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_tasks enable row level security;
-- Policies: same pattern as advisorpilot_clients — service-role bypass; user RLS by email + user_id.
```

#### `advisorpilot_notes`

Free-form text notes attached to a client. Optionally pinned.

```sql
create table if not exists public.advisorpilot_notes (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid not null references public.advisorpilot_clients(id) on delete cascade,
  author_email text not null,
  body text not null,
  tags jsonb default '[]'::jsonb,
  pinned boolean default false,
  source text default 'manual',             -- 'manual' | 'voice_agent' | 'meeting_recap'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_notes_client_pinned_created_idx
  on public.advisorpilot_notes (client_id, pinned desc, created_at desc);

drop trigger if exists set_advisorpilot_notes_updated_at on public.advisorpilot_notes;
create trigger set_advisorpilot_notes_updated_at
  before update on public.advisorpilot_notes
  for each row execute function public.set_advisorpilot_updated_at();

alter table public.advisorpilot_notes enable row level security;
```

#### `advisorpilot_activity_log`

Append-only audit-trail of every client-touching event. Powers the Timeline tab.

```sql
create table if not exists public.advisorpilot_activity_log (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete cascade,
  type text not null,                        -- 'note' | 'meeting' | 'document' | 'email' | 'call' | 'task' | 'analysis' | 'system'
  title text not null,                       -- one-line summary
  body text,                                 -- optional longer description
  actor_email text,                          -- who performed the action (advisor or 'system')
  metadata jsonb default '{}'::jsonb,        -- type-specific payload (e.g. task_id, note_id, analysis snapshot)
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists advisorpilot_activity_client_occurred_idx
  on public.advisorpilot_activity_log (client_id, occurred_at desc);

create index if not exists advisorpilot_activity_owner_occurred_idx
  on public.advisorpilot_activity_log (owner_email, occurred_at desc);

create index if not exists advisorpilot_activity_type_idx
  on public.advisorpilot_activity_log (type, occurred_at desc);

alter table public.advisorpilot_activity_log enable row level security;
```

### 1.2 Additive columns on existing tables

The existing `advisorpilot_clients` already has `status` and `last_contacted_at` (verified in the schema audit). We add a small set of nullable CRM fields. **Every column is NULLABLE with no DEFAULT** so existing rows are untouched and the migration is trivially reversible.

```sql
alter table public.advisorpilot_clients
  add column if not exists stage text,                -- 'Review due' | 'Upcoming' | 'Stable' | 'At risk' | 'Onboarding' | 'Prospect'
  add column if not exists owner_initials text,       -- e.g. 'D. Patel' for display
  add column if not exists household_label text,      -- e.g. 'Chen Family Trust'
  add column if not exists tags jsonb,                -- string[]
  add column if not exists location text,             -- CRM-managed; not collected at intake
  add column if not exists email text,                -- CLIENT's email (the existing client.advisorEmail is the advisor's email)
  add column if not exists phone text,                -- CRM-managed; not collected at intake
  add column if not exists inception_year integer,    -- CRM-managed
  add column if not exists next_meeting_at timestamptz,
  add column if not exists review_due_at date,
  add column if not exists ytd_return numeric;        -- decimal, e.g. 0.062

-- Intentionally NOT added (anti-drift):
--   `relationship_summary` — derivable from client JSONB (client.married, spouseFirstName, etc.). Compute on read.
--   `is_prospect`           — redundant with `status='Prospect'`; index on status already covers the filter.
```

**Backward compat notes:**
- All NULL on existing rows ⇒ no UI regression: the legacy app reads `client` JSONB which still has every legacy field.
- Top-level columns are the source of truth for CRM-only data (`stage`, `owner_initials`, `household_label`, `tags`, `location`, `email`, `phone`, `inception_year`, `next_meeting_at`, `review_due_at`, `ytd_return`). These fields are NOT in today's `IntakeClient`, so there's no drift surface — write to top-level only.
- Anything inside the `client` JSONB blob (intake fields: `firstName`, `lastName`, `dob`, `age`, `riskProfile`, `goal`, etc.) stays JSONB-only. The CRM UI reads JSONB via `/api/clients/[id]` and never writes top-level mirrors.
- **Read fallback for fields that may exist in both places (legacy clients).** Some advisors may have entered `email` / `phone` / `location` into intake before these top-level columns existed — those values sit inside the `client` JSONB. The Roster + Profile header must therefore read **top-level first, fall back to `client.<field>` JSONB** for these specific fields:
  - `email`: `clients.email ?? client.email` (where `client` here is the intake JSONB blob)
  - `phone`: `clients.phone ?? client.phone`
  - `location`: `clients.location ?? client.location`
  - Top-level columns are write-only going forward; the JSONB values are read-only and left in place (don't migrate to top-level — drift surface).
- Existing queries that `SELECT *` get extra NULL fields; existing UPSERT statements that don't mention these columns are unaffected.

### 1.3 Combined migration file

We ship one file per the existing project convention: `supabase/advisorpilot_crm_schema.sql`. It includes:

- The three new CRM sidecar tables (tasks, notes, activity_log) + their indexes + RLS.
- The additive CRM columns on `advisorpilot_clients` (§1.2).
- The two new org tables + sharing join table (`advisorpilot_organizations`, `advisorpilot_organization_members`, `advisorpilot_share_grants`) — see `50-organizations-and-sharing.md §3`.
- The `org_id` + `visibility` pair on `advisorpilot_clients` (and on the new `tasks` / `notes` tables from creation). NB: `created_by_email` was anticipated but dropped — `owner_email` is the creator email; see `50-organizations-and-sharing.md §3.4`.
- The SQL helper functions (`clients_visible_to`, `tasks_visible_to`, `notes_visible_to`, `is_org_admin`) shipped as `supabase/advisorpilot_rls_helpers.sql`. They're `LANGUAGE SQL STABLE` so the Postgres planner can inline them — used by RLS policies AND by API route WHERE clauses, single source of truth (eliminates risk O5).
- The `(entity_type, entity_id, created_at DESC) WHERE entity_id IS NOT NULL` index on `advisorpilot_audit_events` per §2.3.

Idempotent (every statement uses `IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`). A separate one-shot backfill (`supabase/advisorpilot_org_backfill.sql`) runs **in the same Phase 0 deploy window, immediately after the schema migration** and creates a personal "org of one" per existing advisor (unioning `advisorpilot_clients.owner_email` with `advisorpilot_advisor_profiles.owner_email` so zero-client advisors aren't missed), then assigns existing rows to it. The backfill is also idempotent — re-runnable safely. For future signups (post-deploy), `lib/crm/ensure-personal-org.ts` provisions on-demand via `resolveAdvisorIdentity` on first request.

**Policy idempotency pattern.** Postgres `CREATE POLICY` doesn't support `IF NOT EXISTS`, so re-running the migration would error on the second run. Every policy in our migration uses the drop-then-create pattern:

```sql
DROP POLICY IF EXISTS "tasks_select_visible" ON public.advisorpilot_tasks;
CREATE POLICY "tasks_select_visible" ON public.advisorpilot_tasks
  FOR SELECT TO authenticated
  USING ( public.tasks_visible_to(auth.jwt() ->> 'email', id) );
```

Same shape for every `CREATE POLICY` statement. Cheap, idempotent, mirrors what the existing `set_advisorpilot_*_updated_at` triggers do with `DROP TRIGGER IF EXISTS`.

### 1.4 What we DO NOT change

Nothing in: `advisorpilot_clients` rows, `advisorpilot_advisor_profiles`, `advisorpilot_documents`, `advisorpilot_audit_events`, `advisorpilot_security_enrichment_cache`, `advisorpilot_enrichment_provenance`, `advisorpilot_upload_tokens`, `advisorpilot_voice_settings`, `advisorpilot_voice_audit_log`, `advisorpilot_deep_research_jobs`. Zero risk to existing reads/writes.

## 2. API surface

All new routes follow the existing conventions: Node runtime, advisor-auth gated via `resolveAdvisorIdentity(req)`, JSON request/response, audit events written via `writeAuditEvent`.

### 2.1 Tasks

```
GET    /api/tasks?clientId=&status=&due=&priority=&limit=&offset=
  Response: { tasks: Task[], total: number, hasMore: boolean }

POST   /api/tasks
  Body: { clientId?, title, description?, dueDate?, dueTime?, priority?, tags? }
  Response: { task: Task }

PATCH  /api/tasks/[id]
  Body: { title?, description?, dueDate?, dueTime?, priority?, status?, tags?, completedAt? }
  Response: { task: Task }

DELETE /api/tasks/[id]
  Response: { id: string }
```

**Side effects:** Every POST + non-trivial PATCH writes a row to `advisorpilot_activity_log` (`type: "task"`).

### 2.2 Notes

```
GET    /api/notes?clientId=&pinned=&limit=&offset=
  Response: { notes: Note[], total: number }

POST   /api/notes
  Body: { clientId, body, tags?, pinned?, source? }
  Response: { note: Note }

PATCH  /api/notes/[id]
  Body: { body?, tags?, pinned? }
  Response: { note: Note }

DELETE /api/notes/[id]
  Response: { id: string }
```

**Side effects:**
- POST → activity log (`type: "note"`).
- POST → updates `advisorpilot_clients.last_contacted_at = now()` for the parent client (treated as a "touchpoint").

### 2.3 Activity timeline

```
GET    /api/activity?clientId=&type=&since=&limit=
  Response: { entries: ActivityEntry[], hasMore: boolean }

POST   /api/activity
  Body: { clientId?, type, title, body?, metadata? }
  Response: { entry: ActivityEntry }
```

The POST surface lets the agent + integrations write explicit entries (e.g. "Email sent to client@example.com"). Auto-entries fire from task/note/analysis routes.

**Storage model — union on read:**

`/api/activity` GET reads from BOTH `advisorpilot_activity_log` (CRM-native) AND `advisorpilot_audit_events` (existing audit trail), maps each to the `ActivityEntry` shape via a small adapter in `lib/crm/activity-adapter.ts`, sorts by timestamp, and returns. This means:

- Legacy `writeAuditEvent()` calls continue unchanged. Every existing route's audit-event write becomes a Timeline entry retroactively for all clients.
- Manual notes / drawer-driven entries hit `advisorpilot_activity_log` only.
- No double-writes, no backfill migration.

**Mapping strategy: lazy with fallback.** The adapter at `lib/crm/activity-adapter.ts:AUDIT_ACTION_TO_ACTIVITY_TYPE` is a partial map:

```ts
const AUDIT_ACTION_TO_ACTIVITY_TYPE: Record<string, ActivityType> = {
  "statement.extracted": "document",
  "analysis.completed": "analysis",
  "client.created": "system",
  // … add as we go; not exhaustive.
};

function mapAuditAction(action: string): { type: ActivityType; title: string } {
  const known = AUDIT_ACTION_TO_ACTIVITY_TYPE[action];
  if (known) return { type: known, title: humanizeAction(action) };
  // Fallback: unknown action renders as system entry with the raw action as title.
  return { type: "system", title: humanizeAction(action) };
}
```

This way, new `writeAuditEvent()` actions (added by future PRs in unrelated routes) render in the timeline immediately under `type: "system"` without requiring the adapter map to be updated in lockstep. When we want them categorized properly, we add them to the map.

**Resolved (schema audit, 2026-05-15):** `advisorpilot_audit_events` has both `entity_type text` and `entity_id uuid` as top-level columns (per `schema.sql:122-127`). The union query is the simple form:

```sql
WHERE entity_type = 'client' AND entity_id = $clientId
```

No expression index on `metadata->>'clientId'` is needed. However, the table's existing indexes are only `(created_at)`, `(lower(owner_email))`, and `(owner_user_id)` — there's NO `(entity_type, entity_id, created_at)` index. Per-client timeline reads would table-scan without one. The Phase-1 migration adds:

```sql
CREATE INDEX IF NOT EXISTS advisorpilot_audit_events_entity_idx
  ON public.advisorpilot_audit_events (entity_type, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;
```

This index is conditional (only rows with non-NULL `entity_id`) so it stays compact even if non-entity-scoped audit events become common.

### 2.4 Client roster + detail

The existing `GET /api/client-database` continues to return the legacy `SavedReview[]` shape. We add a new route shaped for the Roster UI:

```
GET    /api/clients?search=&stage=&tag=&staleDays=&sort=&limit=&offset=
  Response: { clients: ClientRosterItem[], total: number, hasMore: boolean }
  // Includes all the CRM-shape fields (stage, household_label, next_meeting_at, ytd_return, etc.)

GET    /api/clients/[id]
  Response: { client: ClientDetail }
  // Detail includes: client JSONB + holdings + analysis + computed KPI block + counts (open tasks, recent notes)

PATCH  /api/clients/[id]
  Body: { stage?, tags?, location?, email?, phone?, nextMeetingAt?, reviewDueAt?, ownerInitials? }
  Response: { client: ClientDetail }
  // Only touches the new top-level columns; client JSONB is updated via the existing /api/client-database endpoint for intake-shape changes.
```

The legacy `/api/client-database` stays mounted forever (or until v3) — the Roster route is in addition, not a replacement.

### 2.5 Reports archive

```
GET    /api/reports?clientId=&type=&limit=
  Response: { reports: ReportRecord[] }
```

Reports today are generated on-demand and downloaded; we don't persist the PDF. v1 of the archive lists rows from `advisorpilot_documents` filtered to `type = 'report'`. Phase-2 enhancement: optionally store the generated PDF in the existing `advisorpilot-statements` bucket under a `reports/` prefix.

## 3. TypeScript contracts

All shared types in `lib/crm/types.ts`. Imported by both server routes and client components.

```ts
export interface Task {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;      // ISO date
  dueTime: string | null;       // HH:MM
  priority: "High" | "Medium" | "Low";
  status: "open" | "in_progress" | "done" | "cancelled";
  completedAt: string | null;
  reminderAt: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  ownerEmail: string;
  clientId: string;
  authorEmail: string;
  body: string;
  tags: string[];
  pinned: boolean;
  source: "manual" | "voice_agent" | "meeting_recap";
  createdAt: string;
  updatedAt: string;
}

export type ActivityType =
  | "note" | "meeting" | "document" | "email"
  | "call" | "task" | "analysis" | "system";

export interface ActivityEntry {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  type: ActivityType;
  title: string;
  body: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface ClientRosterItem {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  householdLabel: string | null;
  stage: ClientStage | null;
  status: string | null;                          // "Prospect" replaces the dropped `isProspect` boolean
  aum: number | null;                             // computed: sum of holdings.value
  ytdReturn: number | null;
  accountsCount: number | null;
  custodians: string[];
  ownerEmail: string;                             // Creator email — drives the "Owned by D. Patel" chip in the row
  ownerInitials: string | null;
  lastContactedAt: string | null;
  nextMeetingAt: string | null;
  reviewDueAt: string | null;
  isOverdue: boolean;
  tags: string[];
  // Org-aware fields (Phase 0+) — populated from advisorpilot_clients.{org_id,visibility}
  visibility?: "private" | "shared" | "organization";
  // Phase 6 only — populated when viewer is the entity owner or an org admin.
  // Empty when the viewer doesn't have permission to see who else has access.
  sharedWith?: string[];
}

export interface ClientDetail extends ClientRosterItem {
  client: IntakeClient;            // existing type from lib/intake-config.ts
  holdings: UiHolding[];           // existing type
  analysis: AIAnalysis | null;     // existing type
  rothWorksheet: RothWorksheet | null;
  meetingNotes: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  relationshipSummary: string | null;
  inceptionYear: number | null;
  // Aggregates computed server-side for the profile header KPI strip
  openTaskCount: number;
  recentNoteCount: number;
}

export type ClientStage =
  | "Review due" | "Upcoming" | "Stable"
  | "At risk" | "Onboarding" | "Prospect";
```

## 4. Stage computation rules

`stage` can be persisted (advisor sets it manually) or computed. When NULL, the API computes per these rules and returns the value but does not persist (a Phase-2 cron writes it back):

```
if status === 'Prospect'                          → 'Prospect'
else if review_due_at < today                     → 'Review due'   (and isOverdue=true)
else if review_due_at within 14d                  → 'Upcoming'
else if last_contacted_at older than 90d          → 'At risk'
else if next_meeting_at within 14d                → 'Upcoming'
else if account opened <90d ago (inception_year)  → 'Onboarding'
else                                              → 'Stable'
```

Encapsulated in `lib/crm/stage.ts` so the rules are unit-testable.

## 5. Component contracts

Every CRM component is ≤500 lines per the existing CLAUDE.md guidance. Cross-component data flow runs through `lib/crm/use-client.ts` (a React context that resolves the active clientId from URL params and caches the response from `/api/clients/[id]`).

### 5.1 Shell

```
components/crm/app-rail.tsx               // 60px vertical nav. Props: { activeModule: "intake" | "crm" | "tasks" | "reports" | "settings"; openTaskCount: number }
components/crm/top-header.tsx             // Title bar. Props: { title: string; subtitle?: string; rightActions?: ReactNode }
components/crm/crm-shell.tsx              // Layout wrapper. Renders <AppRail/> + <TopHeader/> + {children}.
```

### 5.2 Roster

```
components/crm/roster-list.tsx            // Left pane. Props: { items: ClientRosterItem[]; selectedId: string | null; onSelect(id): void; filters; setFilters }
components/crm/client-row.tsx             // Single 60px row. Props: { item: ClientRosterItem; selected: boolean; onClick(): void }
components/crm/roster-filter-bar.tsx      // Search + chips + sort. Props: { filters; setFilters; resultCount: number }
```

### 5.3 Client detail

```
components/crm/profile-header.tsx         // Hero card. Props: { client: ClientDetail; onLogNote(): void; onPrepMeeting(): void }
components/crm/client-tabs.tsx            // Sticky tab bar. Props: { clientId: string; activeTab: string; tabBadges: { tasks: number; notes: number } }
components/crm/overview/                  // Overview tab grid
  current-allocation-card.tsx
  accounts-card.tsx
  timeline-card.tsx
  profile-facts-card.tsx
  tasks-card.tsx
  pinned-note-card.tsx
  contacts-card.tsx
components/crm/tabs/
  notes-tab.tsx                           // Full notes list + drawer to add/edit
  timeline-tab.tsx                        // Full activity log + filters
  tasks-tab.tsx                           // Client-scoped task list + drawer
  workflow-tab.tsx                        // PHASE 3 v1: single tab that hosts the legacy step machine (intake/upload/confirm/analysis/meeting/fia/roth/ret-income/fee-analysis/report). Mounted as URL `/app/crm/[id]/workflow?step=<name>`. v2 splits this into:
                                          //    portfolio-tab.tsx  (holdings + confirm + analysis as sub-tabs)
                                          //    planning-tab.tsx   (meeting + FIA + Roth + RetIncome + FeeAnalysis as sub-tabs)
                                          //    reports-tab.tsx    (report + archived PDFs)
  documents-tab.tsx                       // List of advisorpilot_documents for this client
  contacts-tab.tsx                        // Phase 2 placeholder; computed from client.married + spouse* JSONB fields
```

### 5.4 Drawers / dialogs

```
components/crm/drawers/
  log-note-drawer.tsx                     // Right-side drawer. Form: body + tags + pin checkbox
  add-task-drawer.tsx                     // Form: title + description + due + priority
  edit-client-drawer.tsx                  // Form for the CRM-specific fields (location, email, phone, stage, tags, etc.)
```

### 5.5 Reuse from existing app

Components extracted from `app/app/page.tsx` (each ≤500 lines):

```
components/workflow/intake-wizard.tsx     // The 10-step intake (currently lines ~4213-4468 in app/app/page.tsx)
components/workflow/upload-section.tsx    // Statement upload (~4470-4616)
components/workflow/confirm-holdings.tsx  // Holdings table (~4618-4994)
components/workflow/analysis-view.tsx     // AI analysis (~4995-5012)
components/workflow/meeting-guide.tsx     // Talking points (~5013-5103)
components/workflow/fia-calculator.tsx    // FIA tool (~5104-5864)
components/workflow/roth-worksheet.tsx    // Roth conversion (~5865-6792)
components/workflow/retirement-income.tsx // Retirement income (~6820-7582)
components/workflow/fee-analysis.tsx      // Fee analysis (~7583-7820)
components/workflow/report-snapshot.tsx   // Client Snapshot report (~7820-8121)
```

Each accepts the same props it consumes today (client, holdings, analysis, setters) — extraction is structural only, no behavior change. They mount inside CRM tabs.

## 6. Voice-agent tool extensions

The voice agent adds these tools in v2 of the CRM rollout (after the read-only Roster is live). v1 keeps the existing 17 read-only tools and adds only the navigation aliases below.

### 6.1 New navigation aliases (v1)

The existing `navigate(step)` continues to accept all 11 step values. New aliases route to the new URLs:

| Agent says... | Routes to |
|---|---|
| `navigate({ step: "intake" })` with no active client | `/app/intake` (new-client wizard — the landing surface) |
| `navigate({ step: "intake" })` with active client | `/app/crm/[activeClientId]/intake` (edit-existing intake) |
| `navigate({ step: "saved" })` | `/app/crm` (the Roster — synonymous with the old "saved clients" view) |
| `navigate({ step: "tasks" })` *(new)* | `/app/tasks` |
| `navigate({ step: "reports" })` *(new)* | `/app/reports` |
| `navigate({ step: "settings" })` *(new)* | `/app/settings` |
| All other step names with active client | `/app/crm/[activeClientId]/[stepName]` |
| All other step names without active client | Voice agent prompts the advisor to pick a client first |

The persona prompt (`lib/voice/prompts/advisor.txt`) is updated with these route mappings.

### 6.2 New read tools (v1)

```
list_tasks({ clientId?, status?, due? })          → Task[]
get_recent_activity({ clientId?, type?, limit? }) → ActivityEntry[]
get_notes({ clientId?, pinned? })                 → Note[]
```

### 6.3 New write tools (v2 — feature-flagged)

These mutate data, so they're gated by `voice_audit_tool_calls = true` AND a new advisor pref `voice_can_write` (default false in v2; flipped to true after eval).

```
create_task({ clientId?, title, dueDate?, priority? })  → Task
complete_task({ id })                                    → Task
log_note({ clientId, body, tags? })                      → Note
log_call({ clientId, summary })                          → ActivityEntry (type=call)
update_client_stage({ id, stage })                       → ClientRosterItem
```

Persona prompt adds confirmation rules: agent always speaks the action before performing it ("Logging a note that you called Sarah and discussed the RMD strategy — saving now.") and rolls back if the user objects within a short window (rolled back via a `cancel` IPC the UI exposes).

### 6.4 Tool token-config wiring

Schema entries follow the established Athena-style upper-case parameter types pattern used in `lib/voice/token-config.ts`. Each new tool gets a trigger-phrase-led description ("CREATE A TASK. Use this when the advisor says 'remind me to…', 'I need to do…', 'add a follow-up'…").

## 7. URL conventions

### 7.1 Routes

| URL | Renders |
|---|---|
| `/` | Marketing site (unchanged) |
| `/login` | Login (unchanged) |
| `/demo` | Tour page (unchanged) |
| `/app` | **Redirects to `/app/intake`** when CRM flag is on (Intake remains the landing surface — only the surrounding chrome changes from top-nav to side-nav); renders legacy single-page workflow when off. |
| `/app/intake` | **New-client intake (default landing).** Advisor starts from blank. Reached on login, via the **Intake** rail item, or via "New client" in the top header. |
| `/app/crm` | Roster (reached via the **CRM** rail item, not as default). Selected client auto-loads from `?id=` or most-recently-viewed; empty state when no prior selection. |
| `/app/crm/[clientId]` | Roster with that client open on the right (Overview tab). |
| `/app/crm/[clientId]/[tab]` | Roster with that client and that tab. **Phase 3 v1 tab set (7 visible tabs):** `overview`, `workflow`, `notes`, `timeline`, `tasks`, `documents`, `contacts`. The `workflow` tab accepts a `?step=` query (`intake`/`upload`/`confirm`/`analysis`/`meeting`/`fia`/`roth`/`ret-income`/`fee-analysis`/`report`) — these are bookmarkable URLs but render INSIDE the Workflow tab, not as separate top-level tabs. **v2 split:** `workflow` becomes `portfolio` + `planning` + `reports`. |
| `/app/tasks` | Global task list. |
| `/app/reports` | Reports archive. |
| `/app/settings` | Settings page (tabbed). |
| `/app/settings/[section]` | Settings tab (`profile`, `ai-models`, `voice-agent`, `disclosures`). |
| `/client-upload/[token]` | Public magic-link upload (unchanged). |

### 7.2 Search params

| Param | Routes that honor it | Purpose |
|---|---|---|
| `search` | `/app/crm`, `/app/tasks` | Client/task list filter |
| `stage` | `/app/crm` | Filter by stage |
| `tag` | `/app/crm`, `/app/tasks` | Filter by tag (multi: comma-separated) |
| `staleDays` | `/app/crm` | "Show me clients I haven't touched in 90d" |
| `sort` | `/app/crm`, `/app/tasks` | `review-due-asc`, `aum-desc`, `name-asc`, etc. |
| `due` | `/app/tasks` | `today`, `week`, `overdue` |
| `view` | `/app/reports` | `recent`, `by-client` |

### 7.3 Voice agent → URL

The agent's `navigate()` constructs URLs using the current active client (from focus state) when relevant. Example: with Sarah open and agent says "go to her analysis" → router push to `/app/crm/c01/analysis`. Without a client open, "go to analysis" → "Pick a client first?" prompt.

## 8. Auth + RLS

**Decision (schema audit, 2026-05-15): Option A — full RLS policies on every new CRM table.** Mirrors the `advisorpilot_clients` / `advisorpilot_documents` pattern in the existing schema, not the RLS-enabled-no-policies pattern on `advisorpilot_voice_settings` / `_voice_audit_log` / `_deep_research_jobs`. Three reasons:

1. **Phase 6 needs it anyway.** Shared-row visibility ("Robert can see Sarah's notes because Maria shared the client with him") is expressible as a single RLS predicate. Doing it the no-policies way and "upgrading" to RLS later means rewriting the policies and re-validating every API route.
2. **Risk O5 is already eliminated.** Per `50-organizations-and-sharing.md §4`, both the RLS policy AND the API WHERE clause call the same SQL function (`clients_visible_to`, `tasks_visible_to`, `notes_visible_to`). One source of truth, no drift surface.
3. **Defense-in-depth is free here.** If the service-role key ever leaks (committed to a repo, exposed in a log), full RLS is the difference between "advisor data exposed" and "all advisors' data, all clients, all notes, exposed."

**RLS policies for the three new tables** are defined in `50-organizations-and-sharing.md §5` — see there for the canonical shape. Each policy uses the drop-then-create idempotency pattern from §1.3.

**Existing voice/research tables (`voice_settings`, `voice_audit_log`, `deep_research_jobs`) have RLS-no-policies** today (deny-all for non-service-role). This is inconsistent with the rest of the schema and worth addressing in a separate small cleanup PR — not blocking the CRM work but tracked as follow-up cleanup (see `40-path-forward.md §6`).

Service-role bypasses RLS (existing pattern). CRM API routes use the service-role client and add `WHERE <table>_visible_to($email, c.id)` to every read — the visibility function does the filter; the API doesn't reconstruct it.

## 9. Performance

| Concern | Strategy |
|---|---|
| Roster list with 100+ clients | Virtualize via `react-window` (per the AP2 handoff line 826). Initial fetch is `limit=50`, infinite-scroll loads next 50. |
| Tab data fetch on URL change | React Server Component for the data-fetch + Client Component for interactivity. RSC fetches `/api/clients/[id]` server-side; tab swaps don't refetch. |
| Activity log on a long-lived client | Server-side `limit=50` newest-first; lazy-load older on scroll. Filter by type client-side. |
| Voice agent latency | The CRM doesn't change the Gemini Live path; the agent's `getState()` still resolves quickly because the host page's voiceActions adapter reads from React context. |
| Initial load | The Roster's RSC fetches client list + auto-loaded client detail in one trip. Subsequent tab/client switches are client-side router pushes with cached data. |

## 10. Feature flag

`CRM_SHELL` (server-only) — one of `on` | `off`. Default `off` until v1 rollout.

**Why no `NEXT_PUBLIC_` prefix:** the flag is only read in server-side `redirect()` calls (`app/app/page.tsx` legacy redirect, `app/app/(crm)/layout.tsx` shell-gate redirect). The client never reads it — the voice provider's action adapter inspects `window.location.pathname` to choose state-setter mode vs `router.push()` mode. Server-only env vars are runtime in Next.js (re-read per request); flipping the var in Vercel takes effect without a redeploy.

```ts
// lib/crm/feature-flag.ts
export function crmShellEnabled(): boolean {
  return process.env.CRM_SHELL === "on";
}
```

When off:
- `/app` renders the legacy `app/app/page.tsx` (top nav, single-page workflow).
- `/app/crm/*` redirects to `/app` (so links shared during rollout don't 404).

When on (production rollout state — Phase 5+):
- `/app` redirects to `/app/intake` (Intake remains the landing surface).
- All new routes are live; CRM is reachable via the rail's **CRM** item.
- Legacy page still mounted at `/app/legacy` for emergency rollback (deprecated; remove after Phase 5).

**Pre-Phase-3 internal-testing redirect target:** Before Phase 3 step 1 extracts the intake wizard, `/app/intake` is a placeholder. To keep internal testers (flag-on) on the most-developed surface during Phases 0-2, the `/app` redirect points at `/app/crm` (the Roster) instead. Phase 3 step 1 (intake extraction) flips the redirect target to `/app/intake`. Production stays flag-off through Phase 4, so no real advisor sees the pre-Phase-3 target.

**Future enhancement (v1.5):** Add `crm_shell_enabled boolean` column to `advisorpilot_advisor_profiles` for per-advisor opt-in. Resolver order becomes: profile column → env var → default off. Lets us cohort-roll rather than all-or-nothing-flip. Not in v1.

## 11. Telemetry / observability

Three new things get logged using the existing `[llm]` line format (`lib/llm/observability.ts`):

- **Page navigations** — `[crm:nav] route=/app/crm/c01/analysis duration=42ms advisor=…`
- **CRM API timing** — every new `/api/tasks|notes|activity|clients` route logs `[crm:api] route=… method=… status=200 duration=…ms`
- **Voice tool calls** — already emitted as `[voice:tool]`; new tools (`create_task`, etc.) flow through the same channel.

Visible in dev console + Vercel logs without setup.
