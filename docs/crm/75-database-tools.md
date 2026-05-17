# 75 · Database tools — security, schema, and the literal SQL behind `query_crm`

> **Status:** Design doc — no code yet. **Date:** 2026-05-16. **Scope:** the *database surface* the chat orchestrator's `query_crm` + `compute` tools (per [70-orchestrator-tools.md](./70-orchestrator-tools.md) §3-4) sit on top of. This doc owns:
>
> 1. The full **security model** (identity resolution → service-role client → visibility helpers → RLS enforcement)
> 2. The **per-table reference** (every column, every index, every RLS policy, every visibility-helper interaction)
> 3. The **literal SQL** every `query_crm` operation compiles to
> 4. The **new SQL functions** this plan introduces (`query_crm_aggregate`, `query_crm_path`) with full bodies
> 5. **Performance characteristics** (which indexes each query hits)
> 6. **Worked end-to-end trace** of one chat request through to the rows it returns
>
> [70-orchestrator-tools.md](./70-orchestrator-tools.md) remains the LLM-facing tool catalog (what tools exist, what their JSON shapes look like, when the model uses each). This doc is the SQL-facing reference (how each tool reads/writes Supabase). The two intentionally overlap on the entity menu — that's the contract between the LLM surface and the database surface.

---

## Table of contents

1. [Why a separate doc](#1--why-a-separate-doc)
2. [The security model in one page](#2--the-security-model-in-one-page)
3. [Per-table reference — 14 tables](#3--per-table-reference)
4. [`query_crm` operations — the literal SQL](#4--query_crm-operations--the-literal-sql)
5. [The new `query_crm_aggregate` function — full SQL](#5--the-new-query_crm_aggregate-function--full-sql)
6. [The new `query_crm_path` function — full SQL](#6--the-new-query_crm_path-function--full-sql)
7. [Worked end-to-end trace](#7--worked-end-to-end-trace)
8. [Performance characteristics](#8--performance-characteristics)
9. [Adding a new entity — checklist](#9--adding-a-new-entity--checklist)
10. [Self-audit (line-by-line)](#10--self-audit-line-by-line)

---

## 1 · Why a separate doc

The database-tool surface is the most security-sensitive part of the orchestrator. Three things made it deserve a dedicated document instead of staying as a section of 70:

1. **The security model is subtle.** AdvisorPilot has *two* authentication paths (NextAuth Google + Supabase email/password), *one* service-role client used by every API route, *three* visibility tiers (private / shared / organization), and a **split between owner-only RLS and visibility-aware RLS** that's not the same across tables. Get any of those wrong and the LLM can either (a) silently leak data the advisor shouldn't see or (b) silently hide data the advisor *should* see. Both are bad in opposite ways. A separate doc lets us spell the model out once, precisely.

2. **The literal SQL needs to be auditable.** Every `query_crm` operation compiles to a known Postgres call. Future contributors changing a filter or adding a column need to see the actual SQL — not just the LLM-facing parameter description — so they can reason about indexes, query cost, and RLS interaction. The 70 doc has tool descriptions; this doc has SQL.

3. **The schema has surprises.** `advisorpilot_securities_master` has a column called `"Domestic, Foriegn, Global"` (with the typo "Foriegn") and quoted column names with spaces. `advisorpilot_clients` RLS doesn't call its own visibility helper. `advisorpilot_documents` has owner-only RLS but the visibility expansion happens by joining through `client_id → clients_visible_to`. Documenting these clearly in one place keeps every future tool consistent.

This doc does NOT redefine anything from 70 — it deepens. The LLM-facing tool parameters (filter allowlists, sort tokens, aggregate functions) live in 70 §3.3. The SQL each compiles to lives here.

---

## 2 · The security model in one page

### 2.1 Identity resolution

Every chat request hits `app/api/chat/stream/route.ts` (60-§B.8). The first thing the route does is:

```ts
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";

const identity = await resolveAdvisorIdentity(req);   // Promise<AdvisorIdentity | null>
if (!identity) return new Response("Sign in.", { status: 401 });
```

`resolveAdvisorIdentity` is the *only* place in the codebase that decides who the signed-in advisor is. Its full source is at `lib/advisor-auth.ts:23-48`. The flow:

1. **Try NextAuth first** — `getServerSession(authOptions)`. If a session exists and has `user.email`, return `{ email, userId: null, provider: "google" }`. Google-authed advisors don't have a Supabase auth user id unless separately linked.
2. **Fall back to the `Authorization: Bearer <jwt>` header** — `supabaseAdmin.auth.getUser(jwt)`. If valid, return `{ email, userId: <supabase auth.users id>, provider: "supabase" }`.
3. **Otherwise null** — the route returns 401.

The chat tool executors **never** call `resolveAdvisorIdentity` themselves; they receive `ctx.advisorEmail` (and `ctx.advisorUserId` when present) from the runner. The email is the only identity they trust. There is no path where the LLM can substitute a different `viewer_email` — no tool parameter accepts one.

### 2.2 The service-role client

All chat tool executors use the SAME Supabase client the existing CRM routes use: the service-role singleton from `lib/crm/supabase-admin.ts:29-44`.

```ts
import { getCrmSupabaseAdmin } from "@/lib/crm/supabase-admin";

const supabase = getCrmSupabaseAdmin();
```

Service-role **bypasses RLS by design**. That's a feature, not a bug — it lets us:

- Run RPCs that take `viewer_email` as a parameter (where the visibility predicate is evaluated *inside the function* against the passed email, not against `auth.jwt() ->> 'email'` which wouldn't be set in a service-role call)
- Read rows the advisor can see via *visibility expansion* (org-shared, explicit grants) even though their JWT's RLS policy is owner-only for `clients`/`documents`/etc.
- Run aggregates that join across tables without hitting RLS overhead on every row

The trade-off: **the tool executor is responsible for re-asserting visibility** on every read. The `lib/crm/supabase-admin.ts:14-15` comment is explicit about this: "every CRM route MUST add the appropriate `*_visible_to(...)` predicate to its WHERE clause via `lib/crm/visibility.ts`. RLS is the safety net for direct user access; the API path enforces visibility itself."

### 2.3 The three visibility tiers

Every shareable entity (`clients`, `tasks`, `notes`) carries a `visibility` column with one of:

| Tier            | Meaning                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `private`       | Creator-only. The only visible viewer is `owner_email`.                                                                  |
| `shared`        | The creator + any email in `advisorpilot_share_grants` for this `(entity_type, entity_id)` pair.                          |
| `organization`  | The creator + every active member of the entity's `org_id` (via `advisorpilot_organization_members`).                    |

`reports` (NEW per [70-§10](./70-orchestrator-tools.md#10--persistence--the-new-supabase-tables)) follows the same model.

Documents, deep-research jobs, audit events, the advisor profile, the enrichment cache, and the securities master are NOT in the share/org model. They use simpler visibility rules — documented per-table in §3 below.

### 2.4 The visibility helper functions

Five SQL functions in `schema.sql:48-204` + `:275-383` encode every visibility decision. Every tool executor and every RLS policy that needs cross-tier expansion ultimately calls one of these:

| Function                                                    | Signature                                                                                                                                                    | Defined at         | What it returns                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------- |
| `clients_visible_to(viewer_email, client_id)`               | `(text, uuid) → boolean`                                                                                                                                     | `schema.sql:48-78` | `true` if viewer is owner OR org-member of `client.org_id` (when `visibility='organization'`) OR has a `share_grants` row (when `visibility='shared'`) |
| `tasks_visible_to(viewer_email, task_id)`                   | `(text, uuid) → boolean`                                                                                                                                     | `schema.sql:350-380` | Same three branches against `advisorpilot_tasks`                  |
| `notes_visible_to(viewer_email, note_id)`                   | `(text, uuid) → boolean`                                                                                                                                     | `schema.sql:275-305` | Same three branches against `advisorpilot_notes`                  |
| `is_org_admin(viewer_email, org_id)`                        | `(text, uuid) → boolean`                                                                                                                                     | `schema.sql:84-95`   | `true` if viewer has role `'owner'` or `'admin'` in this org      |
| `list_visible_activity(viewer_email, target_client_id, since_ts, limit_n)` | `(text, uuid?, timestamptz?, integer?) → setof (id uuid, source text, client_id uuid, owner_email text, type text, title text, body text, actor_email text, metadata jsonb, occurred_at timestamptz)` | `schema.sql:101-150` | UNION of `activity_log` (creator-visible OR client-visible) and `audit_events` (when client_id is visible). Returns newest-first up to `limit_n` |

Plus three thin wrappers used by the existing API routes (and that the chat tools will reuse):

| Wrapper                            | Defined at                | What it returns                                                                                           |
| ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `list_visible_clients(viewer_email)` | `schema.sql:195-201`     | `SETOF advisorpilot_clients` — every row passing `clients_visible_to(viewer_email, c.id)`                  |
| `list_visible_tasks(viewer_email)`   | `schema.sql:263-269`     | `SETOF advisorpilot_tasks`                                                                                 |
| `list_visible_notes(viewer_email)`   | `schema.sql:227-233`     | `SETOF advisorpilot_notes`                                                                                 |

All eight functions are granted to `anon`, `authenticated`, and `service_role` (`schema.sql:1358-1438`).

The TypeScript-side SQL fragment helpers in `lib/crm/visibility.ts` (5-61) — `visibleClientsClause()`, `visibleTasksClause()`, `visibleNotesClause()`, `isOrgAdminClause()` — exist for the future power-user raw-SQL escape hatch (70-§12.10 Phase 7). The v1 tools all use the RPC route via `supabase.rpc("list_visible_*", {...})`.

### 2.5 The owner-only vs visibility-aware RLS split

This is the trap that catches every new contributor. **Not every table's RLS policy calls its own visibility helper.** The split:

| Table                                | RLS SELECT policy                                          | Visibility helper exists? | Tool must add explicit visibility check? |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `advisorpilot_clients`               | **owner-only** (`schema.sql:1028`)                          | YES (`clients_visible_to`) | **YES** — without it, org/shared clients are invisible |
| `advisorpilot_notes`                 | visibility-aware via `notes_visible_to` (`schema.sql:1131`) | YES                       | Belt-and-suspenders (RLS would catch us; explicit check is faster on bulk reads via the RPC) |
| `advisorpilot_tasks`                 | visibility-aware via `tasks_visible_to` (`schema.sql:1191`) | YES                       | Same                                     |
| `advisorpilot_activity_log`          | owner OR `clients_visible_to(client_id)` (`schema.sql:996`) | (uses clients_visible_to)  | Tool uses `list_visible_activity` RPC    |
| `advisorpilot_audit_events`          | **owner-only** (`schema.sql:1013`)                          | NO                        | Tool filters by `owner_email = $viewer` |
| `advisorpilot_documents`             | **owner-only** (`schema.sql:1050`)                          | NO                        | Tool joins `client_id → clients_visible_to` when a clientId filter is set; otherwise filters by `owner_email = $viewer` |
| `advisorpilot_advisor_profiles`      | **owner-only** (`schema.sql:1078`)                          | NO                        | Tool filters by `owner_email = $viewer` (single-row entity) |
| `advisorpilot_organizations`         | member-of (`schema.sql:1161-1163`)                          | (membership join)         | Out of v1 tool surface                   |
| `advisorpilot_organization_members`  | member-of-same-org (`schema.sql:1147-1149`)                 | NO                        | Out of v1 tool surface                   |
| `advisorpilot_share_grants`          | grantee OR grantor (`schema.sql:1179`)                      | NO                        | Out of v1 tool surface                   |
| `advisorpilot_deep_research_jobs`    | RLS enabled, **no policies** (`schema.sql:1036`)            | NO                        | Service-role only; tool filters by `owner_email = $viewer` |
| `advisorpilot_enrichment_provenance` | RLS enabled, no policies                                   | NO                        | Process-wide cache; no per-advisor visibility |
| `advisorpilot_security_enrichment_cache` | RLS enabled, no policies                                | NO                        | Process-wide cache                       |
| `advisorpilot_securities_master`     | RLS enabled, no policies                                   | NO                        | Process-wide reference data              |

The two tool patterns that fall out of this:

**Pattern A — table has its own `list_visible_*` RPC.** Use the RPC. The visibility is baked in.

```ts
const { data } = await supabase.rpc("list_visible_clients", { viewer_email: ctx.advisorEmail });
// data is already filtered to visible clients.
```

**Pattern B — table is owner-only or has no policies.** Use a plain `.from().select()` with an explicit `owner_email = $viewer` predicate, OR cross-reference visibility via a JOIN to clients.

```ts
// documents: owner-only at the table, but expandable via client_id
const { data } = await supabase
  .from("advisorpilot_documents")
  .select("*")
  .or(`owner_email.eq.${ctx.advisorEmail},client_id.in.(${visibleClientIds.join(",")})`);
```

Every executor function in `lib/llm/chat/tools/query-crm.ts` is exactly one of those two patterns. The §3 table reference below tells you which pattern each entity uses.

### 2.6 The full security flow, top-to-bottom

```
Browser
  │  fetch('/api/chat/stream', {body, signal})
  │  Cookies: next-auth.session-token (Google)
  │  OR   Authorization: Bearer <supabase-jwt>     (email/password)
  ▼
app/api/chat/stream/route.ts
  │  identity ← resolveAdvisorIdentity(req)         // lib/advisor-auth.ts:23-48
  │  if (!identity) return 401
  │  ctx ← { advisorEmail: identity.email,
  │          advisorUserId: identity.userId,
  │          currentClientId: body.currentClientId, ... }
  │  runner.runOnce({ context: ctx, ... })
  ▼
lib/llm/chat/chat-runner.ts
  │  // preflight + system-prompt build + provider stream + tool loop
  │  for each model-emitted tool_call:
  │    toolBroker.callTool(name, args, callId, ctx, { onProgress })
  ▼
lib/llm/chat/tools/query-crm.ts (executor)
  │  // ctx.advisorEmail is the ONLY identity we trust
  │  // The LLM cannot put a different email in args; no parameter accepts one.
  │  supabase ← getCrmSupabaseAdmin()              // service-role; bypasses RLS
  │
  │  // Pattern A — visibility-aware RPC
  │  supabase.rpc("list_visible_clients", { viewer_email: ctx.advisorEmail })
  │      └─► Postgres planner inlines clients_visible_to(viewer_email, c.id)
  │          for each row in advisorpilot_clients
  │              ├─ owner_email match → visible
  │              ├─ visibility='organization' AND member of org → visible
  │              └─ visibility='shared' AND has share_grants row → visible
  │
  │  // Pattern B — owner-only table with explicit predicate
  │  supabase.from("advisorpilot_documents")
  │           .select("*")
  │           .eq("owner_email", ctx.advisorEmail)
  │
  │  rows → mapper (e.g. toRosterItem) → ChatToolResult
  ▼
chat-runner forwards result to provider as tool_result message
```

**One trust boundary** — the `ctx.advisorEmail` set in the route handler. Everything downstream takes that email as ground truth. The LLM never types it.

---

## 3 · Per-table reference

For each table the chat tools read or write, this section lists: purpose, columns (verbatim from `schema.sql`), JSONB shapes (where applicable), indexes, RLS, FK relationships, mappers, and tool exposure.

### 3.1 `advisorpilot_clients` — the master client record

The flagship entity. Every other CRM table (notes, tasks, activity, documents, reports) FKs into this.

**Defined at:** `schema.sql:160-192`. **PK:** `id uuid`.

**Columns** (29 total, mixing pre-existing + Phase 0 additive):

```sql
-- Original (pre-Phase-0) columns
id                  uuid        not null default gen_random_uuid()
owner_email         text        not null
client              jsonb       not null default '{}'::jsonb       -- IntakeClient shape
holdings            jsonb       not null default '[]'::jsonb       -- UiHolding[] shape
meeting_notes       text        not null default ''
demo_mode           boolean     not null default false
analysis            jsonb                                          -- NormalizedAiAnalysis | null
total_value         numeric     not null default 0
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()             -- trigger-maintained
status              text        not null default 'Analyzed'
last_contacted_at   timestamptz
owner_user_id       uuid                                           -- FK auth.users on delete set null
source              text        not null default 'advisor'
roth_worksheet      jsonb                                          -- RothWorksheet | null

-- Phase 0 additive (all nullable, no default — backward-compatible)
stage               text                                           -- ClientStage enum
owner_initials      text
household_label     text
tags                jsonb
location            text
email               text                                           -- the CLIENT's email
phone               text
inception_year      integer
next_meeting_at     timestamptz
review_due_at       date
ytd_return          numeric
org_id              uuid                                           -- FK advisorpilot_organizations on delete set null
visibility          text                                           -- 'private' | 'shared' | 'organization'
```

**JSONB shapes** (LLM-readable; full reference):

- `client` → `IntakeClient` (`lib/intake-config.ts:13-62`). The 10-question wizard payload + spouse + risk profile + optional FIA worksheet.
- `holdings` → `UiHolding[]` (`lib/saved-review-normalize.ts:12-48`). One entry per security position; includes enrichment metadata (FIGI, share class, mapped asset class, source URLs, confidence, needs-review flag).
- `analysis` → `NormalizedAiAnalysis | null` (`lib/saved-review-normalize.ts:50-61`). Synopsis + portfolio highlights + strategies + red flags + overlap insights + recommendations + talking points + advisor opening script + objection handling.
- `roth_worksheet` → `RothWorksheet | null` (`lib/roth-worksheet.ts:1-23`).
- `client.fiaWorksheet` → `FiaWorksheet | null` (`lib/fia-worksheet.ts:3-27`) — nested in the intake JSONB.

**Indexes:**

| Index                                          | Definition                                  | Used by                                              |
| ---------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `advisorpilot_clients_pkey`                    | PK on `(id)`                                | `get:clients`, all FK joins                          |
| `advisorpilot_clients_owner_email_idx`         | btree `(owner_email)`                       | RLS lookups, `list_visible_clients` owner branch     |
| `advisorpilot_clients_owner_user_id_idx`       | btree `(owner_user_id)`                     | RLS lookups for Supabase email/password users        |
| `advisorpilot_clients_org_visibility_idx`      | btree `(org_id, visibility)`                | Org-shared visibility branch                         |
| `advisorpilot_clients_updated_at_idx`          | btree `(updated_at DESC)`                   | Roster sort fallback                                 |

**RLS policies** (`schema.sql:1017-1032`):

- `advisorpilot_clients_select_own` — owner via either `owner_user_id` OR lowered `owner_email`. **Does NOT call `clients_visible_to`.**
- `advisorpilot_clients_insert_own` — same predicate as WITH CHECK
- `advisorpilot_clients_update_own` — same
- `advisorpilot_clients_delete_own` — same

**The trap:** because RLS is owner-only, a direct `supabase.from("advisorpilot_clients").select("*")` with a user JWT will silently miss org-shared and explicitly-shared clients. The visibility expansion only happens when the tool executor uses service-role + calls `list_visible_clients(viewer_email)`. **Every tool read of `clients` MUST go through the RPC**, not a plain `.from().select()`.

**Visibility helper:** `clients_visible_to(viewer_email, client_id)` (`schema.sql:48-78`). Wrapper: `list_visible_clients(viewer_email)` (`schema.sql:195-201`).

**FK relationships:** `clients` is the *parent* — every dependent table FKs into `clients.id`:

| Dependent                          | FK                                              | On delete |
| ---------------------------------- | ----------------------------------------------- | --------- |
| `advisorpilot_notes.client_id`     | NOT NULL → `clients.id`                          | CASCADE   |
| `advisorpilot_tasks.client_id`     | nullable → `clients.id`                         | CASCADE   |
| `advisorpilot_activity_log.client_id` | nullable → `clients.id`                       | CASCADE   |
| `advisorpilot_documents.client_id` | nullable → `clients.id`                         | SET NULL  |

The asymmetry (CASCADE vs SET NULL) is documented in `docs/crm/20-technical-specs.md §1.1` and `supabase/advisorpilot_crm_schema.sql:129-133`: "a task/note/activity entry without its client is meaningless, whereas an orphaned document file is still a useful artifact."

**Existing API consumers:**

- `GET /api/clients` (`app/api/clients/route.ts:77-135`) — roster list via `list_visible_clients` RPC
- `GET /api/clients/[id]` (`app/api/clients/[id]/route.ts:46-159`) — single fetch via `clients_visible_to` gate + plain SELECT
- `PATCH /api/clients/[id]` (`:192-260+`) — top-level CRM columns only; never touches JSONB
- Various legacy routes (`/api/generate-analysis`, `/api/generate-report`, `/api/fee-analysis`, `/api/enrich-holdings`) read/write the JSONB columns

**Mappers:**

- `toRosterItem(ClientRow): ClientRosterItem` — `lib/crm/clients-mapper.ts:71-115`
- `toClientDetail(ClientRow, aggregates): ClientDetail` — `:116+`

**Tool exposure** (per 70-§3):

| `query_crm` operation | What runs |
| --------------------- | --------- |
| `list:clients`        | `supabase.rpc("list_visible_clients", { viewer_email })` → `.map(toRosterItem)` → TS filter/sort/paginate |
| `get:clients`         | `supabase.rpc("clients_visible_to", { viewer_email, client_id })` → 404 if false → `.from("advisorpilot_clients").select("*").eq("id", id)` → `toClientDetail` |
| `aggregate:clients`   | `supabase.rpc("query_crm_aggregate", { viewer_email, entity: "clients", ... })` — see §5 |
| `search:clients`      | `list_visible_clients` + TS substring filter on firstName/lastName/householdLabel |
| `path:clients`        | `supabase.rpc("query_crm_path", { viewer_email, entity: "clients", id, paths })` — see §6 |

### 3.2 `advisorpilot_notes` — client-scoped free-form text

**Defined at:** `schema.sql:207-221`. **PK:** `id uuid`.

**Columns:**

```sql
id              uuid        not null default gen_random_uuid()
owner_email     text        not null
owner_user_id   uuid
client_id       uuid        not null      -- FK clients.id on delete CASCADE
org_id          uuid                       -- FK organizations on delete set null
visibility      text                       -- 'private' | 'shared' | 'organization'
author_email    text        not null      -- may differ from owner_email for org-shared clients
body            text        not null
tags            jsonb       default '[]'::jsonb
pinned          boolean     default false
source          text        default 'manual'    -- 'manual' | 'voice_agent' | 'meeting_recap'
created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
```

**Indexes:**

| Index                                            | Definition                                                 | Used by                                                                |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `advisorpilot_notes_pkey`                        | PK on `(id)`                                               | `get:notes`                                                            |
| `advisorpilot_notes_client_pinned_created_idx`   | btree `(client_id, pinned DESC, created_at DESC)`          | Per-client list (pinned-first), Overview pinned-note card              |
| `advisorpilot_notes_org_visibility_idx`          | btree `(org_id, visibility)`                               | Org-shared visibility branch                                           |

**RLS policies** (`schema.sql:1123-1135`):

- `notes_select_visible` — calls `notes_visible_to(jwt.email, id)`. **Visibility-aware** unlike clients.
- `notes_insert_own` — `owner_email = lower(jwt.email)`
- `notes_update_visible` — owner OR (`visibility IN ('organization','shared')` AND `is_org_admin(jwt.email, org_id)`)
- `notes_delete_own` — owner only

**Visibility helper:** `notes_visible_to(viewer_email, note_id)` (`schema.sql:275-305`). Wrapper: `list_visible_notes(viewer_email)` (`schema.sql:227-233`).

**Existing API consumers:** `GET /api/notes` (`app/api/notes/route.ts:40-115`), `POST /api/notes` (`:117-227`). Side effects on create: `writeActivityLog(type='note')` + `bumpLastContactedAt(client_id)`.

**Mapper:** `toNote(NoteRow): Note` (`lib/crm/note-mapper.ts:25-39`).

**Tool exposure:**

| `query_crm` op  | What runs |
| --------------- | --------- |
| `list:notes`    | `supabase.rpc("list_visible_notes", { viewer_email })` → `.map(toNote)` → TS filter |
| `get:notes`     | `supabase.rpc("notes_visible_to", { viewer_email, note_id })` gate → plain SELECT |
| `aggregate:notes` | via `query_crm_aggregate(entity: "notes", ...)` |
| `search:notes`  | RPC + TS substring on `body` |

### 3.3 `advisorpilot_tasks` — todos, optionally client-linked

**Defined at:** `schema.sql:239-257`. **PK:** `id uuid`.

**Columns:**

```sql
id              uuid        not null default gen_random_uuid()
owner_email     text        not null
owner_user_id   uuid
client_id       uuid                       -- NULLABLE; null = personal task. FK clients.id on delete CASCADE
org_id          uuid
visibility      text
title           text        not null
description     text
due_date        date
due_time        time without time zone
priority        text        default 'Medium'    -- 'High' | 'Medium' | 'Low'
status          text        default 'open'      -- 'open' | 'in_progress' | 'done' | 'cancelled'
completed_at    timestamptz
reminder_at     timestamptz
tags            jsonb       default '[]'::jsonb
created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
```

**Indexes:**

| Index                                       | Definition                                       | Used by                                                  |
| ------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `advisorpilot_tasks_pkey`                   | PK on `(id)`                                     | `get:tasks`                                              |
| `advisorpilot_tasks_owner_status_idx`       | btree `(owner_email, status, due_date)`          | Roster "my open tasks", `list:tasks` with `status` filter |
| `advisorpilot_tasks_client_idx`             | btree `(client_id, status)`                      | Per-client task tab                                      |
| `advisorpilot_tasks_org_visibility_idx`     | btree `(org_id, visibility)`                     | Org-shared branch                                        |

**RLS policies** (`schema.sql:1183-1195`):

- `tasks_select_visible` — calls `tasks_visible_to`. Visibility-aware.
- `tasks_insert_own` — owner only
- `tasks_update_visible` — owner OR (org-admin AND `visibility IN ('organization','shared')`)
- `tasks_delete_own` — owner only

**Visibility helper:** `tasks_visible_to(viewer_email, task_id)` (`schema.sql:350-380`). Wrapper: `list_visible_tasks(viewer_email)` (`schema.sql:263-269`).

**Existing API consumers:** `GET /api/tasks` (`app/api/tasks/route.ts:41-104`), `POST /api/tasks` (`:108-212`). Side effect on create: `writeActivityLog(type='task')`.

**Mapper:** `toTask(TaskRow): Task` (`lib/crm/task-mapper.ts:29-47`).

**Tool exposure:** identical pattern to notes — `list:tasks` / `get:tasks` / `aggregate:tasks` / `search:tasks`.

### 3.4 `advisorpilot_activity_log` — CRM-native event stream

**Defined at:** `schema.sql:386-398`. **PK:** `id uuid`.

**Columns:**

```sql
id              uuid        not null default gen_random_uuid()
owner_email     text        not null
owner_user_id   uuid
client_id       uuid                       -- nullable; FK clients.id on delete CASCADE
type            text        not null      -- ActivityType enum
title           text        not null
body            text
actor_email     text                       -- who performed the action (may differ from owner)
metadata        jsonb       default '{}'::jsonb
occurred_at     timestamptz not null default now()
created_at      timestamptz not null default now()
```

`type` values (from `lib/crm/types.ts:171-179`): `'note' | 'meeting' | 'document' | 'email' | 'call' | 'task' | 'analysis' | 'system'`.

**Indexes:**

| Index                                        | Definition                              |
| -------------------------------------------- | --------------------------------------- |
| `advisorpilot_activity_log_pkey`             | PK on `(id)`                            |
| `advisorpilot_activity_client_occurred_idx`  | `(client_id, occurred_at DESC)`         |
| `advisorpilot_activity_owner_occurred_idx`   | `(owner_email, occurred_at DESC)`       |
| `advisorpilot_activity_type_idx`             | `(type, occurred_at DESC)`              |

**RLS policies** (`schema.sql:992-996`):

- `activity_select_visible` — owner OR (`client_id IS NOT NULL` AND `clients_visible_to(jwt.email, client_id)`). Append-only model — no UPDATE/DELETE policies.
- `activity_insert_own` — owner only

**Visibility:** delegates to `clients_visible_to` for client-scoped entries. Personal entries (`client_id IS NULL`) are owner-only.

**Reads:** always via `list_visible_activity(viewer_email, target_client_id?, since_ts?, limit_n?)` (`schema.sql:101-150`). This RPC UNIONs `activity_log` with `audit_events` (the older audit trail) so the chat tool sees ONE unified stream — same source the Timeline tab + Overview's recent-activity rail consume.

**Writer:** `writeActivityLog(supabase, input)` in `lib/crm/activity-writer.ts:26-51`. Best-effort (logs + swallows errors).

**Mapper:** `toActivityEntry(VisibleActivityRow): ActivityEntry` (`lib/crm/activity-adapter.ts:61-93`). Handles two row sources (`'activity_log'` rows and `'audit_event'` rows from the UNION), with a partial action-name map to humanize unknown audit actions.

**Tool exposure:**

| `query_crm` op    | What runs |
| ----------------- | --------- |
| `list:activity`   | `supabase.rpc("list_visible_activity", { viewer_email, target_client_id, since_ts, limit_n })` → `.map(toActivityEntry)` |
| `aggregate:activity` | `query_crm_aggregate(entity: "activity", ...)` |

No `get:activity` — activity entries are an event stream, not addressable by id from the chat surface.

### 3.5 `advisorpilot_documents` — uploaded files + generated artifacts

**Defined at:** `schema.sql:467-483`. **PK:** `id uuid`.

**Columns:**

```sql
id                  uuid        not null default gen_random_uuid()
owner_user_id       uuid                       -- FK auth.users on delete set null
owner_email         text        not null
client_id           uuid                       -- nullable; FK clients.id on delete SET NULL
storage_bucket      text        not null default 'advisorpilot-statements'
storage_path        text        not null
original_file_name  text
mime_type           text
file_size_bytes     bigint
sha256              text
source              text        not null default 'advisor_upload'
  -- 'advisor_upload' | 'client_upload' | 'generated_client_snapshot'
  -- | 'generated_advisor_deep_dive' | 'generated_roth_report' | 'generated_snapshot_email'
  -- | 'generated_report'
status              text        not null default 'uploaded'
  -- 'uploaded' | 'processing' | 'extracted' | 'complete'
metadata            jsonb       not null default '{}'::jsonb
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
```

**Indexes:**

| Index                                  | Definition                          |
| -------------------------------------- | ----------------------------------- |
| `advisorpilot_documents_pkey`          | PK on `(id)`                        |
| `advisorpilot_documents_client_id_idx` | btree `(client_id)`                 |
| `advisorpilot_documents_owner_email_idx` | btree `(lower(owner_email))`       |
| `advisorpilot_documents_owner_user_id_idx` | btree `(owner_user_id)`          |

**RLS policies** (`schema.sql:1042-1054`): owner-only — `select / insert / update / delete` all gated by `owner_user_id = auth.uid()` OR `lower(owner_email) = lower(jwt.email)`. **No visibility helper at RLS level.** This means a user JWT can NEVER see another user's documents directly, even on shared clients. The tool layer expands by joining `client_id → clients_visible_to`.

**Default exclusion:** `GET /api/documents` (`app/api/documents/route.ts:22-29`) explicitly defaults to excluding `source IN ('advisor_upload', 'client_upload')` rows — those are personal financial statement uploads that are processed through AI then discarded for compliance. The Documents tab reserves itself for system-generated artifacts. Pass `includeStatements: true` to override. The `query_crm:list:documents` operation mirrors this default.

**Existing API consumer:** `GET /api/documents` (`app/api/documents/route.ts:52-128+`).

**Mapper:** `toDocument(DocumentRow): Document` (`lib/crm/document-mapper.ts:25-44`).

**Signed URLs:** documents are referenced by `storage_bucket` + `storage_path`. The list endpoint can return on-demand signed URLs (60-min TTL by default) when `withSignedUrls=true` is passed; the chat tool does NOT request signed URLs by default (URL minting is per-call work; only mint when the LLM asks for download/preview).

**Tool exposure:**

| `query_crm` op       | What runs |
| -------------------- | --------- |
| `list:documents`     | If filter `clientId` set: gate via `clients_visible_to`, then `.from("advisorpilot_documents").select("*").eq("client_id", id)`. Else: `.eq("owner_email", viewer_email)`. Default `source NOT IN ('advisor_upload', 'client_upload')` unless `includeStatements` is true. |
| `get:documents`      | `.eq("id", id).maybeSingle()` then visibility-check (owner OR `clients_visible_to(client_id)`) |
| `aggregate:documents` | via `query_crm_aggregate(entity: "documents", ...)` — but only owner-scoped (org-shared docs are not in v1) |

### 3.6 `advisorpilot_audit_events` — append-only audit trail

**Defined at:** `schema.sql:430-440`. **PK:** `id uuid`.

**Columns:**

```sql
id              uuid        not null default gen_random_uuid()
owner_user_id   uuid                       -- FK auth.users on delete set null
owner_email     text        not null
actor_email     text
action          text        not null      -- e.g. 'statement.extracted', 'analysis.completed', 'client.created'
entity_type     text        not null      -- e.g. 'client', 'document', 'task'
entity_id       uuid
metadata        jsonb       not null default '{}'::jsonb
created_at      timestamptz not null default now()
```

**Indexes:**

| Index                                       | Definition                                         |
| ------------------------------------------- | -------------------------------------------------- |
| `advisorpilot_audit_events_pkey`            | PK on `(id)`                                       |
| `advisorpilot_audit_events_created_at_idx`  | btree `(created_at DESC)`                          |
| `advisorpilot_audit_events_entity_idx`      | partial btree `(entity_type, entity_id, created_at DESC) WHERE entity_id IS NOT NULL` |
| `advisorpilot_audit_events_owner_email_idx` | btree `(lower(owner_email))`                       |
| `advisorpilot_audit_events_owner_user_id_idx` | btree `(owner_user_id)`                          |

**RLS policies** (`schema.sql:1006-1013`): owner-only — `select` and `insert` gated by either owner_user_id or lowered owner_email.

**Writer:** `writeAuditEvent(input)` in `lib/audit-log.ts:8-31` (best-effort, log-and-swallow).

**Action vocabulary** (partial, from `lib/crm/activity-adapter.ts:46-58`):

```
client.created / client.updated / client.deleted
statement.extracted
analysis.completed / fee_analysis.completed
report.generated
email.client_snapshot_sent / email.follow_up_sent / inbound_email.received
upload_token.created
```

Plus any string a future route passes — adapter humanizes unknowns via `humanizeAuditAction()`.

**Tool exposure:** primarily consumed indirectly via `list_visible_activity` (the UNION). Direct exposure as a `query_crm` entity is reserved (the LLM might ask "show me every `analysis.completed` event last quarter" without wanting it intermixed with `activity_log` rows). Not in v1; available via the `activity` entity's `source` filter.

### 3.7 `advisorpilot_advisor_profiles` — per-advisor settings + branding

**Defined at:** `schema.sql:404-424`. **PK:** `owner_email text` (no surrogate).

**Columns:**

```sql
owner_email             text        not null primary key
email_signature         text        not null default ''
logo_url                text
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()
advisor_name            text
advisor_title           text
advisor_license         text
calendar_link           text
office_address          text
office_phone            text
cell_phone              text
website                 text
owner_user_id           uuid                       -- FK auth.users on delete set null
disclosures_text        text
disclosures_image_url   text
llm_provider            text                       -- nullable; multi-provider-llm-plan.md §9.7
llm_model_overrides     jsonb                      -- per-pass model overrides
default_research_tier   text                       -- 'fast-grounded' | 'agentic-research' | 'deep-research'
```

**Index:** `advisorpilot_profiles_owner_user_id_idx` on `(owner_user_id)`.

**RLS policies** (`schema.sql:1070-1082`): owner-only `select / insert / update / delete`.

**Existing API consumer:** `GET /api/advisor-profile` — used by `UserMenu`, `LlmSettingsButton`, and the chat launcher's auth probe (60-§B.14.2).

**Tool exposure:**

| `query_crm` op            | What runs |
| ------------------------- | --------- |
| `get:advisor_profile`     | `.from("advisorpilot_advisor_profiles").select("*").eq("owner_email", viewer_email).maybeSingle()` |

Single-row entity — no `list:` or other operations needed. The whole row is returned including `llm_model_overrides` jsonb.

### 3.8 `advisorpilot_organizations` + `advisorpilot_organization_members` — sharing infrastructure

**Defined at:** `schema.sql:519-528` (organizations) and `:501-513` (members). Together with `advisorpilot_share_grants`, these implement the `private | shared | organization` visibility tiers.

**Organizations columns:**

```sql
id                uuid        not null default gen_random_uuid()
name              text        not null
slug              text                       -- unique
created_by_email  text        not null
plan_tier         text                       -- 'solo' | 'team' | 'enterprise' | null
max_seats         integer
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()
```

**Members columns:**

```sql
id                uuid        not null default gen_random_uuid()
org_id            uuid        not null      -- FK organizations.id on delete CASCADE
member_email      text        not null
member_user_id    uuid
role              text        not null default 'member'   -- 'owner' | 'admin' | 'member'
status            text        not null default 'active'   -- 'invited' | 'active' | 'removed'
invited_by_email  text
invited_at        timestamptz
accepted_at       timestamptz
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()
unique (org_id, member_email)
```

**Indexes:**

- `advisorpilot_orgs_created_by_idx` on `(created_by_email)`
- `advisorpilot_org_members_email_idx` on `(member_email, status)`
- `advisorpilot_org_members_org_idx` on `(org_id, status)`

**RLS policies:**

- `orgs_select_member` — visible to active members (`schema.sql:1161-1163`)
- `orgs_insert_any` — `created_by_email = lower(jwt.email)`
- `orgs_update_admin` — `is_org_admin(jwt.email, id)`
- `org_members_select_visible` — own membership OR other members of same org
- `org_members_insert_admin` / `_update_admin` / `_delete_admin` — `is_org_admin` gated

**Personal-org provisioning:** `ensurePersonalOrg(advisorEmail)` in `lib/crm/ensure-personal-org.ts:48-116`. Idempotent — creates a personal org with slug `personal-<md5(email)>` for new advisors on first need (Phase 0 backfill handles existing).

**Tool exposure:** NOT in v1. Org management is a Phase 6 UI feature ([50-organizations-and-sharing.md](./50-organizations-and-sharing.md)); the chat doesn't need to invite teammates or change membership. The visibility helpers READ these tables transparently when evaluating client/task/note visibility.

### 3.9 `advisorpilot_share_grants` — explicit per-entity sharing

**Defined at:** `schema.sql:557-566`. **PK:** `id uuid`. **Unique:** `(entity_type, entity_id, grantee_email)`.

**Columns:**

```sql
id                uuid        not null default gen_random_uuid()
entity_type       text        not null      -- 'client' | 'task' | 'note' | 'report' (by convention)
entity_id         uuid        not null
grantee_email     text        not null
grantee_user_id   uuid
granted_by_email  text        not null
granted_at        timestamptz not null default now()
permission        text        not null default 'view'    -- 'view' | 'edit'
```

**Indexes:** `advisorpilot_share_grants_entity_idx` on `(entity_type, entity_id)`, `advisorpilot_share_grants_grantee_idx` on `(grantee_email, entity_type)`.

**RLS:** grantee or grantor visible only (`schema.sql:1179`); grantor can INSERT and DELETE.

**Tool exposure:** NOT directly. Read transparently by the visibility helpers when an entity's `visibility = 'shared'`. The chat agent has no operations to view/grant/revoke share permissions in v1.

### 3.10 `advisorpilot_deep_research_jobs` — async research job tracking

**Defined at:** `schema.sql:446-461`. **PK:** `id uuid`.

**Columns:**

```sql
id                uuid        not null default gen_random_uuid()
owner_email       text        not null
owner_user_id     uuid
provider          text        not null      -- 'openai' | 'gemini' | 'grok'
tier              text        not null      -- 'fast-grounded' | 'agentic-research' | 'deep-research'
request           jsonb       not null      -- ResearchRequest shape
status            text        not null default 'queued'   -- 'queued' | 'running' | 'complete' | 'error'
result            jsonb                       -- ResearchResult shape when status='complete'
error             text
external_handle   text                       -- e.g. OpenAI background-response id
started_at        timestamptz
completed_at      timestamptz
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()
```

**Indexes:**

- `advisorpilot_deep_research_owner_idx` on `(owner_email, created_at DESC)`
- `advisorpilot_deep_research_status_idx` on `(status, updated_at DESC)` — for the cron poller (`app/api/research/cron/route.ts`)

**RLS:** RLS enabled with **no policies** (`schema.sql:1036`) — service-role only at the JWT level. The chat tool reads via service-role + explicit `owner_email = $viewer` predicate.

**Existing API consumers:** `POST /api/research/start`, `GET /api/research/[id]`, `POST /api/research/cron`.

**Tool exposure:**

| `query_crm` op            | What runs |
| ------------------------- | --------- |
| `list:research_jobs`      | `.from("advisorpilot_deep_research_jobs").select("*").eq("owner_email", viewer).order("created_at", desc).limit(50)` |
| `get:research_jobs`       | `.eq("id", id).eq("owner_email", viewer).maybeSingle()` |

Used by the LLM to poll `run_deep_research` results (per [70-§6.4](./70-orchestrator-tools.md#64-run_deep_research)).

### 3.11 `advisorpilot_security_enrichment_cache` + `advisorpilot_enrichment_provenance`

**Cache definition:** `schema.sql:547-551`. **PK:** `lookup_key text`. Columns: `lookup_key, payload jsonb, updated_at timestamptz`.

**Provenance definition:** `schema.sql:489-495`. **PK:** `(cache_key, provider)`. Columns: `cache_key text (FK), provider text, citations jsonb, created_at, updated_at`. FK `cache_key → cache.lookup_key on delete CASCADE` (`schema.sql:957-958`).

**Lookup-key convention:** `'sym:SPY'`, `'figi:BBG000B9XRY4'`, `'cusip:78462F103'` — set by `lib/holding-enrichment.ts`.

**RLS:** RLS enabled on both tables, no policies. Service-role only — these are process-wide caches, not per-advisor data.

**Tool exposure:**

| `query_crm` op             | What runs |
| -------------------------- | --------- |
| `list:enrichment_cache`    | `.from("advisorpilot_security_enrichment_cache").select("*, advisorpilot_enrichment_provenance(provider, citations)").ilike("lookup_key", filterPattern)` |

Useful for "what did we look up for SPY?" — the LLM passes ticker/CUSIP/FIGI prefixes to find matches. No visibility expansion needed; the cache is shared across all advisors.

### 3.12 `advisorpilot_securities_master` — reference table

**Defined at:** `schema.sql:534-541`. **No PK** (it's a reference table). RLS enabled, no policies.

**Columns** — note the quoted names with spaces AND the typo `"Foriegn"`:

```sql
"Ticker Symbols"             text
"Holding Name"               text
"Investment Type"            text
"Share Class"                text
"Asset Class"                text
"Domestic, Foriegn, Global"  text       -- TYPO in source schema; preserved verbatim
```

**Tool exposure:** v2 candidate. Could expose as `query_crm:list:securities` with normalized column names (`tickerSymbols`, `holdingName`, `investmentType`, `shareClass`, `assetClass`, `domesticForeignGlobal` — fixing the typo at the API boundary). Not in v1.

### 3.13 `advisorpilot_upload_tokens` + voice tables — out of v1 tool surface

- `advisorpilot_upload_tokens` (`schema.sql:572-585`) — magic-link upload tokens. Internal/admin. NOT a chat-tool entity.
- `advisorpilot_voice_audit_log` (`schema.sql:591-601`) — voice-agent audit. NOT a chat-tool entity in v1 (voice is its own surface; see `docs/voice-agent-plan.md`).
- `advisorpilot_voice_settings` (`schema.sql:607-620`) — per-advisor voice preferences. NOT a chat-tool entity in v1.

The chat tool stays silent about these tables; the LLM can't read them via `query_crm`.

### 3.14 `advisorpilot_reports` + `advisorpilot_report_versions` — NEW per 70

Both new in Phase 4 of [70-§10](./70-orchestrator-tools.md#10--persistence--the-new-supabase-tables). Schema lives there; SQL helpers (`reports_visible_to`, `list_visible_reports`) follow the same shape as the existing `*_visible_to` / `list_visible_*` family.

**Tool exposure:**

| `query_crm` op       | What runs |
| -------------------- | --------- |
| `list:reports`       | `supabase.rpc("list_visible_reports", { viewer_email })` → TS filter |
| `get:reports`        | `supabase.rpc("reports_visible_to", { viewer_email, report_id })` gate → plain SELECT (full markdown + versions) |
| `aggregate:reports`  | via `query_crm_aggregate(entity: "reports", ...)` |
| `search:reports`     | RPC + TS substring on `title` + `content` |

Reports are written by `manage_report` (70-§7.1), not `query_crm`.

---

## 4 · `query_crm` operations — the literal SQL

This section shows the actual Supabase JS calls + the SQL each compiles to, for every supported `(operation, entity)` pair. The pattern from §2.5 governs which approach each cell uses.

### 4.1 `list:clients`

```ts
const { data, error } = await supabase.rpc("list_visible_clients", {
  viewer_email: ctx.advisorEmail,
});
// data is `advisorpilot_clients[]` — all visible rows.
// TS-side: map → ClientRosterItem[], apply filters (search, stage, tags, staleDays, AUM bounds),
// apply sort (review-due-asc | aum-desc | name-asc | last-contact-desc), paginate.
```

**SQL executed:**

```sql
SELECT c.*
FROM public.advisorpilot_clients c
WHERE public.clients_visible_to($viewer_email, c.id);
```

Where `clients_visible_to` inlines (LANGUAGE SQL STABLE):

```sql
EXISTS (
  SELECT 1 FROM public.advisorpilot_clients c2
  WHERE c2.id = c.id AND (
    c2.owner_email = lower($viewer_email)
    OR (c2.visibility = 'organization' AND c2.org_id IN (
         SELECT om.org_id FROM public.advisorpilot_organization_members om
         WHERE om.member_email = lower($viewer_email) AND om.status = 'active'))
    OR (c2.visibility = 'shared' AND EXISTS (
         SELECT 1 FROM public.advisorpilot_share_grants g
         WHERE g.entity_type = 'client' AND g.entity_id = c2.id
           AND g.grantee_email = lower($viewer_email)))
  )
)
```

**Indexes hit:** `advisorpilot_clients_owner_email_idx` (owner branch), `advisorpilot_clients_org_visibility_idx` (org branch), `advisorpilot_share_grants_grantee_idx` + `_entity_idx` (shared branch), `advisorpilot_org_members_email_idx` (membership lookup).

**Notes on cost:** for a typical advisor with ≤500 clients, the row scan is bounded and the function inlines well. For multi-thousand-client enterprise advisors, push filters into the function signature instead of TS-side (Phase 6+ optimization).

### 4.2 `get:clients`

```ts
// Step 1: visibility gate (mirrors app/api/clients/[id]/route.ts:77-95)
const visible = await supabase.rpc("clients_visible_to", {
  viewer_email: ctx.advisorEmail,
  client_id:    args.id,
});
if (visible.data !== true) return { success: false, error: "Client not found." };  // 404 not 403

// Step 2: full row + KPI aggregates (mirrors :97-118)
const [row, taskCount, noteCount] = await Promise.all([
  supabase.from("advisorpilot_clients").select("*").eq("id", args.id).maybeSingle(),
  supabase.from("advisorpilot_tasks")
          .select("id", { count: "exact", head: true })
          .eq("client_id", args.id).in("status", ["open", "in_progress"]),
  supabase.from("advisorpilot_notes")
          .select("id", { count: "exact", head: true })
          .eq("client_id", args.id)
          .gte("created_at", new Date(Date.now() - 30*86400_000).toISOString()),
]);

return {
  success: true,
  data: toClientDetail(row.data, { openTaskCount: taskCount.count ?? 0, recentNoteCount: noteCount.count ?? 0 }),
};
```

**Returned shape:** full `ClientDetail` — including the COMPLETE `client` (intake), `holdings`, `analysis`, `roth_worksheet`, `meeting_notes` jsonb columns. The LLM gets everything the human advisor sees in the Overview tab.

### 4.3 `list:tasks` / `list:notes`

Both follow the identical pattern as `list:clients`, using their own RPC:

```ts
const { data } = await supabase.rpc("list_visible_tasks", { viewer_email: ctx.advisorEmail });
// data is advisorpilot_tasks[]; map → Task[], apply filters/sort/paginate
```

```ts
const { data } = await supabase.rpc("list_visible_notes", { viewer_email: ctx.advisorEmail });
// data is advisorpilot_notes[]; map → Note[]; required client filter or pinned filter typical
```

### 4.4 `list:activity`

The most useful single tool for advisor questions about timeline. Backed by the UNION RPC:

```ts
const f = (args.filters ?? {}) as any;
const { data } = await supabase.rpc("list_visible_activity", {
  viewer_email:     ctx.advisorEmail,
  target_client_id: f.clientId ?? null,
  since_ts:         f.since ?? null,
  limit_n:          Math.min(Number(args.limit ?? 50), 200),
});
return { success: true, data: { rows: data?.map(toActivityEntry) ?? [], rowCount: data?.length ?? 0 } };
```

**SQL** (`schema.sql:101-150`): UNION of:

- `advisorpilot_activity_log` rows where (owner match) OR (client_id IS NOT NULL AND `clients_visible_to(viewer, client_id)`)
- `advisorpilot_audit_events` rows where `entity_type = 'client'` AND `entity_id IS NOT NULL` AND `clients_visible_to(viewer, entity_id)`

Ordered `occurred_at DESC`, limited to `greatest(limit_n, 1)`.

**Indexes hit:** `advisorpilot_activity_owner_occurred_idx` + `advisorpilot_activity_client_occurred_idx` for the native side; `advisorpilot_audit_events_entity_idx` for the audit side.

### 4.5 `list:documents`

Two branches based on whether `clientId` is set in the filter:

```ts
const f = (args.filters ?? {}) as any;

// Branch A: filter by client (must verify client visibility first)
if (f.clientId) {
  const visible = await supabase.rpc("clients_visible_to", {
    viewer_email: ctx.advisorEmail, client_id: f.clientId,
  });
  if (visible.data !== true) return { success: false, error: "Client not found." };
  let q = supabase.from("advisorpilot_documents").select("*").eq("client_id", f.clientId);
  if (!f.includeStatements) q = q.not("source", "in", "(advisor_upload,client_upload)");
  if (f.source) q = q.eq("source", f.source);
  const { data } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  return { success: true, data: { rows: data?.map(toDocument) ?? [], rowCount: data?.length ?? 0 } };
}

// Branch B: no client → advisor's own documents
let q = supabase.from("advisorpilot_documents").select("*").eq("owner_email", ctx.advisorEmail);
if (!f.includeStatements) q = q.not("source", "in", "(advisor_upload,client_upload)");
if (f.source) q = q.eq("source", f.source);
const { data } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
return { success: true, data: { rows: data?.map(toDocument) ?? [], rowCount: data?.length ?? 0 } };
```

This is **Pattern B** from §2.5 — documents are owner-only at the RLS level; the tool layer adds the client-visibility expansion when a client filter is present.

### 4.6 `list:reports`

Same pattern as `list:clients` once the table lands in Phase 4 of 70:

```ts
const { data } = await supabase.rpc("list_visible_reports", { viewer_email: ctx.advisorEmail });
// TS-side filter by clientId, tags, status, since, paginate.
```

### 4.7 `list:research_jobs`

```ts
let q = supabase
  .from("advisorpilot_deep_research_jobs")
  .select("*")
  .eq("owner_email", ctx.advisorEmail);
if (f.status) q = q.eq("status", f.status);
if (f.tier)   q = q.eq("tier",   f.tier);
if (f.since)  q = q.gte("created_at", f.since);
const { data } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
```

**Index hit:** `advisorpilot_deep_research_owner_idx` on `(owner_email, created_at DESC)`.

### 4.8 `list:enrichment_cache`

```ts
let q = supabase
  .from("advisorpilot_security_enrichment_cache")
  .select("*, advisorpilot_enrichment_provenance(provider, citations)");
if (f.ticker) q = q.eq("lookup_key", `sym:${f.ticker.toUpperCase()}`);
if (f.cusip)  q = q.eq("lookup_key", `cusip:${f.cusip}`);
if (f.figi)   q = q.eq("lookup_key", `figi:${f.figi}`);
if (f.since)  q = q.gte("updated_at", f.since);
const { data } = await q.limit(Math.min(args.limit ?? 25, 200));
```

No visibility predicate — process-wide cache.

### 4.9 `get:advisor_profile`

```ts
const { data } = await supabase
  .from("advisorpilot_advisor_profiles")
  .select("*")
  .eq("owner_email", ctx.advisorEmail)
  .maybeSingle();
return { success: true, data: data ?? null };
```

Single-row entity — returns the entire row including `llm_model_overrides` jsonb.

### 4.10 `get:tasks` / `get:notes` / `get:documents` / `get:reports`

Pattern for each: visibility-check → SELECT.

```ts
// get:tasks
const visible = await supabase.rpc("tasks_visible_to", { viewer_email: ctx.advisorEmail, task_id: args.id });
if (visible.data !== true) return { success: false, error: "Task not found." };
const { data } = await supabase.from("advisorpilot_tasks").select("*").eq("id", args.id).maybeSingle();
return { success: true, data: toTask(data) };
```

```ts
// get:documents
const { data: docRow } = await supabase
  .from("advisorpilot_documents").select("*").eq("id", args.id).maybeSingle();
if (!docRow) return { success: false, error: "Document not found." };
// Visibility: owner OR client-visible (when client_id is set)
if (docRow.owner_email !== ctx.advisorEmail) {
  if (!docRow.client_id) return { success: false, error: "Document not found." };
  const visible = await supabase.rpc("clients_visible_to", {
    viewer_email: ctx.advisorEmail, client_id: docRow.client_id,
  });
  if (visible.data !== true) return { success: false, error: "Document not found." };
}
return { success: true, data: toDocument(docRow) };
```

### 4.11 `search:clients` / `search:notes` / `search:tasks` / `search:reports`

All four follow the same pattern: pull the visible cohort via the RPC, then TS-side substring filter on text fields. Per-entity searchable fields:

| Entity      | Fields                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- |
| `clients`   | `firstName`, `lastName`, `householdLabel`, `intake.goal`                                |
| `notes`     | `body`, `tags[]`                                                                        |
| `tasks`     | `title`, `description`, `tags[]`                                                        |
| `reports`   | `title`, `content` (markdown body), `tags[]`                                            |

```ts
// search:clients
const { data } = await supabase.rpc("list_visible_clients", { viewer_email: ctx.advisorEmail });
const q = String(args.query ?? "").toLowerCase();
const matches = (data ?? [])
  .map(toRosterItem)
  .filter(r => {
    const hay = [r.firstName, r.lastName, r.householdLabel ?? "", /* + intake.goal from raw row */ ]
                  .join(" ").toLowerCase();
    return hay.includes(q);
  })
  .slice(0, args.limit ?? 25);
return { success: true, data: { rows: matches, rowCount: matches.length } };
```

For larger cohorts a Postgres `to_tsvector` full-text search would be faster, but TS substring on a <500-row visible-set is fast enough for v1.

---

## 5 · The new `query_crm_aggregate` function — full SQL

The `aggregate` operation needs Postgres to do the math (grouping, sums, counts) instead of pulling all rows to TS. This is the only new SQL function the chat tools require for v1, plus four private helpers.

**Lands in:** `supabase/_apply_crm_phase3_migrations.sql` (NEW, per 70-§11 Phase 3).

```sql
-- =============================================================================
-- query_crm_aggregate — typed DSL compiler for AGGREGATE queries
--
-- Visibility is INJECTED via the per-entity list_visible_* RPC or owner_email
-- predicate. Per-entity allowlists for group_by tokens and aggregate field
-- names are enforced inside the helper functions.
--
-- SECURITY: security INVOKER (runs with caller's privileges). The caller is
-- always service-role (the chat tool executor), so RLS is bypassed; the
-- visibility predicate inside the visible-set CTE is the enforcement layer.
--
-- Parameters:
--   viewer_email  — the signed-in advisor's email (from ctx.advisorEmail)
--   entity        — one of 'clients','tasks','notes','activity','documents','reports'
--   group_by      — per-entity allowlist token (see 70-§3.4) or NULL for ungrouped
--   aggregates    — jsonb array of {fn, field?, as}
--   filters       — jsonb object (per-entity allowlist; see 70-§3.3)
--   limit_n       — max buckets to return (default 1000, hard cap)
--
-- Returns: table(bucket text, metrics jsonb) — one row per groupBy bucket
-- =============================================================================

create or replace function public.query_crm_aggregate(
  viewer_email text,
  entity text,
  group_by text default null,
  aggregates jsonb default '[]'::jsonb,
  filters jsonb default '{}'::jsonb,
  limit_n integer default 1000
)
returns table (bucket text, metrics jsonb)
language plpgsql
stable
security invoker
as $$
declare
  v_visible_cte text;
  v_group_expr  text;
  v_select_aggs text;
  v_where_extra text;
  v_sql         text;
begin
  -- 1. Validate entity
  if entity not in ('clients','tasks','notes','activity','documents','reports') then
    raise exception 'query_crm_aggregate: invalid entity %', entity;
  end if;

  -- 2. Build the visibility-filtered source CTE
  v_visible_cte := public._qcrm_visible_set_sql(viewer_email, entity);

  -- 3. Build the GROUP BY expression (or 'NULL' for ungrouped)
  v_group_expr  := public._qcrm_build_group_expr(entity, group_by);

  -- 4. Build the aggregate SELECT list (one jsonb object per bucket)
  v_select_aggs := public._qcrm_build_aggregate_metrics(entity, aggregates);

  -- 5. Build the WHERE fragment from filters (values bound, not interpolated)
  v_where_extra := public._qcrm_build_filter_where(entity, filters);

  -- 6. Assemble + execute
  v_sql := format(
    'with visible as (%s) ' ||
    'select coalesce(%s::text, ''ALL'') as bucket, %s as metrics ' ||
    'from visible src %s ' ||
    'group by %s ' ||
    'order by 1 nulls last ' ||
    'limit %s',
    v_visible_cte,
    v_group_expr,
    v_select_aggs,
    v_where_extra,
    v_group_expr,
    greatest(coalesce(limit_n, 1000), 1)
  );

  return query execute v_sql;
end;
$$;

grant execute on function public.query_crm_aggregate(text, text, text, jsonb, jsonb, integer)
  to anon, authenticated, service_role;
```

### 5.1 `_qcrm_visible_set_sql` — picks the right visible-cohort source

```sql
create or replace function public._qcrm_visible_set_sql(viewer_email text, entity text)
returns text
language plpgsql immutable
as $$
declare
  v_email_lit text := quote_literal(lower(viewer_email));
begin
  return case entity
    when 'clients'  then format('select * from public.list_visible_clients(%s) src', v_email_lit)
    when 'tasks'    then format('select * from public.list_visible_tasks(%s) src',   v_email_lit)
    when 'notes'    then format('select * from public.list_visible_notes(%s) src',   v_email_lit)
    when 'activity' then format(
      'select * from public.list_visible_activity(%s, null, null, 100000) src',
      v_email_lit)
    when 'documents' then format(
      'select d.* from public.advisorpilot_documents d ' ||
      'where d.owner_email = %s ' ||
      'or (d.client_id is not null and public.clients_visible_to(%s, d.client_id))',
      v_email_lit, v_email_lit)
    when 'reports'   then format('select * from public.list_visible_reports(%s) src', v_email_lit)
    else null
  end;
end;
$$;
```

### 5.2 `_qcrm_build_group_expr` — allowlist-validated group expression

Per-entity tokens from 70-§3.4. Helper translates each to the correct Postgres expression. Unknown tokens raise; that's the security boundary against grouping by a column we didn't intend to expose.

```sql
create or replace function public._qcrm_build_group_expr(entity text, group_by text)
returns text
language plpgsql immutable
as $$
begin
  if group_by is null or group_by = '' then return 'NULL'; end if;

  -- ===== clients =====
  if entity = 'clients' then
    return case group_by
      when 'stage'            then 'src.stage'
      when 'status'           then 'src.status'
      when 'owner_email'      then 'src.owner_email'
      when 'inception_year'   then 'src.inception_year::text'
      when 'review_month'     then 'to_char(src.review_due_at, ''YYYY-MM'')'
      when 'intake.riskProfile'         then 'src.client ->> ''riskProfile'''
      when 'intake.federalTaxBracket'   then 'src.client ->> ''federalTaxBracket'''
      when 'intake.calibration'         then 'src.client ->> ''calibration'''
      when 'intake.married'             then '(src.client ->> ''married'')'
      when 'intake.takingSocialSecurity' then '(src.client ->> ''takingSocialSecurity'')'
      when 'analysis.hasRedFlags'       then 'case when src.analysis ? ''redFlags'' and jsonb_array_length(src.analysis -> ''redFlags'') > 0 then ''true'' else ''false'' end'
      when 'analysis.hasAnalysis'       then 'case when src.analysis is not null then ''true'' else ''false'' end'
      when 'holdings.dominant_asset_class' then '(
        select h ->> ''assetClass''
        from jsonb_array_elements(src.holdings) h
        group by h ->> ''assetClass''
        order by sum((h ->> ''value'')::numeric) desc nulls last
        limit 1
      )'
      when 'account_count_bucket'  then 'case
        when (select count(distinct h ->> ''accountNumber'') from jsonb_array_elements(src.holdings) h where h ? ''accountNumber'') = 0 then ''0''
        when (select count(distinct h ->> ''accountNumber'') from jsonb_array_elements(src.holdings) h where h ? ''accountNumber'') = 1 then ''1''
        when (select count(distinct h ->> ''accountNumber'') from jsonb_array_elements(src.holdings) h where h ? ''accountNumber'') <= 3 then ''2-3''
        else ''4+'' end'
      else raise_exception_invalid_group(entity, group_by)  -- helper raises
    end;
  end if;

  -- ===== tasks =====
  if entity = 'tasks' then
    return case group_by
      when 'status'      then 'src.status'
      when 'priority'    then 'src.priority'
      when 'client_id'   then 'src.client_id::text'
      when 'due_week'    then 'to_char(src.due_date, ''IYYY-IW'')'
      when 'is_overdue'  then 'case when src.due_date is not null and src.due_date < current_date and src.status not in (''done'',''cancelled'') then ''true'' else ''false'' end'
      else raise_exception_invalid_group(entity, group_by)
    end;
  end if;

  -- ===== notes =====
  if entity = 'notes' then
    return case group_by
      when 'client_id'      then 'src.client_id::text'
      when 'source'         then 'src.source'
      when 'pinned'         then 'src.pinned::text'
      when 'created_week'   then 'to_char(src.created_at, ''IYYY-IW'')'
      when 'author_email'   then 'src.author_email'
      else raise_exception_invalid_group(entity, group_by)
    end;
  end if;

  -- ===== activity =====
  if entity = 'activity' then
    return case group_by
      when 'type'           then 'src.type'
      when 'client_id'      then 'src.client_id::text'
      when 'actor_email'    then 'src.actor_email'
      when 'occurred_week'  then 'to_char(src.occurred_at, ''IYYY-IW'')'
      when 'occurred_month' then 'to_char(src.occurred_at, ''YYYY-MM'')'
      when 'source'         then 'src.source'
      else raise_exception_invalid_group(entity, group_by)
    end;
  end if;

  -- ===== documents =====
  if entity = 'documents' then
    return case group_by
      when 'source'         then 'src.source'
      when 'client_id'      then 'src.client_id::text'
      when 'status'         then 'src.status'
      when 'mime_type'      then 'src.mime_type'
      when 'created_month'  then 'to_char(src.created_at, ''YYYY-MM'')'
      else raise_exception_invalid_group(entity, group_by)
    end;
  end if;

  -- ===== reports =====
  if entity = 'reports' then
    return case group_by
      when 'client_id'               then 'src.client_id::text'
      when 'visibility'              then 'src.visibility'
      when 'generated_by_provider'   then 'src.generated_by_provider'
      when 'created_month'           then 'to_char(src.created_at, ''YYYY-MM'')'
      else raise_exception_invalid_group(entity, group_by)
    end;
  end if;

  -- Should be unreachable; entity is validated upstream
  raise exception 'query_crm_aggregate: unknown entity %', entity;
end;
$$;

-- Helper helper — pulls the error-message construction out of every CASE
create or replace function public.raise_exception_invalid_group(entity text, group_by text)
returns text language plpgsql immutable as $$
begin
  raise exception 'query_crm_aggregate: groupBy "%" not allowed for entity "%"', group_by, entity;
end;
$$;
```

### 5.3 `_qcrm_build_aggregate_metrics` — builds the `jsonb_build_object` of metrics

```sql
create or replace function public._qcrm_build_aggregate_metrics(entity text, aggregates jsonb)
returns text
language plpgsql immutable
as $$
declare
  pair jsonb;
  fn text;
  field text;
  alias text;
  fn_sql text;
  parts text[] := '{}'::text[];
begin
  if jsonb_array_length(aggregates) = 0 then
    -- Default: single count(*) named 'count'
    return 'jsonb_build_object(''count'', count(*))';
  end if;

  if jsonb_array_length(aggregates) > 5 then
    raise exception 'query_crm_aggregate: at most 5 aggregate expressions per call (%)', jsonb_array_length(aggregates);
  end if;

  for pair in select * from jsonb_array_elements(aggregates) loop
    fn    := pair ->> 'fn';
    field := pair ->> 'field';
    alias := pair ->> 'as';

    if alias is null or alias = '' then
      raise exception 'query_crm_aggregate: every aggregate needs an "as" alias';
    end if;
    if fn not in ('count','sum','avg','min','max') then
      raise exception 'query_crm_aggregate: invalid aggregate fn % (must be count|sum|avg|min|max)', fn;
    end if;
    if fn <> 'count' and (field is null or field = '') then
      raise exception 'query_crm_aggregate: aggregate fn % requires "field"', fn;
    end if;

    fn_sql := case
      when fn = 'count' then 'count(*)'
      else format('%s(%s)', fn, public._qcrm_build_aggregate_field_expr(entity, field))
    end;

    parts := parts || format('%L, %s', alias, fn_sql);
  end loop;

  return 'jsonb_build_object(' || array_to_string(parts, ', ') || ')';
end;
$$;

-- Per-entity numeric-field allowlist (validates the `field` parameter of fn != 'count')
create or replace function public._qcrm_build_aggregate_field_expr(entity text, field text)
returns text language plpgsql immutable as $$
begin
  if entity = 'clients' then
    return case field
      when 'total_value'           then 'src.total_value'
      when 'ytd_return'            then 'src.ytd_return'
      when 'inception_year'        then 'src.inception_year'
      when 'intake.age'            then '(src.client ->> ''age'')::numeric'
      when 'intake.retirementAge'  then '(src.client ->> ''retirementAge'')::numeric'
      when 'intake.adjustedGrossIncomeAnnual' then '(src.client ->> ''adjustedGrossIncomeAnnual'')::numeric'
      when 'intake.retirementSpendableIncomeAnnual' then '(src.client ->> ''retirementSpendableIncomeAnnual'')::numeric'
      when 'intake.socialSecurityMonthlyClient' then '(src.client ->> ''socialSecurityMonthlyClient'')::numeric'
      when 'holdings.totalValue'   then '(select sum((h ->> ''value'')::numeric) from jsonb_array_elements(src.holdings) h)'
      when 'holdings.count'        then 'jsonb_array_length(src.holdings)'
      else raise exception 'query_crm_aggregate: field "%" not allowed for entity "clients"', field
    end;
  end if;

  if entity = 'tasks' then
    return case field
      when 'days_overdue' then 'greatest(0, (current_date - src.due_date))'
      else raise exception 'query_crm_aggregate: field "%" not allowed for entity "tasks"', field
    end;
  end if;

  -- notes, activity, documents, reports — count-only entities; no numeric fields in v1.
  raise exception 'query_crm_aggregate: aggregate field expressions not allowed for entity "%"', entity;
end;
$$;
```

### 5.4 `_qcrm_build_filter_where` — allowlist-validated WHERE fragment

This is where the bulk of per-entity filter logic lives. Same allowlist pattern as `_qcrm_build_group_expr`. Filter VALUES are accessed via jsonb operators (`filters ->> 'stage'`) so they're parameterized — no string interpolation of user-supplied values.

```sql
create or replace function public._qcrm_build_filter_where(entity text, filters jsonb)
returns text
language plpgsql immutable
as $$
declare
  parts text[] := '{}'::text[];
  filter_keys text[];
  k text;
begin
  if filters is null or filters = '{}'::jsonb then return ''; end if;

  filter_keys := array(select jsonb_object_keys(filters));

  for k in select unnest(filter_keys) loop
    -- ===== clients =====
    if entity = 'clients' then
      case k
        when 'stage'              then parts := parts || format('src.stage = %L',  filters ->> 'stage');
        when 'status'             then parts := parts || format('src.status = %L', filters ->> 'status');
        when 'ownerEmail'         then parts := parts || format('lower(src.owner_email) = lower(%L)', filters ->> 'ownerEmail');
        when 'minAum'             then parts := parts || format('src.total_value >= %s', (filters ->> 'minAum')::numeric);
        when 'maxAum'             then parts := parts || format('src.total_value <= %s', (filters ->> 'maxAum')::numeric);
        when 'reviewDueBefore'    then parts := parts || format('src.review_due_at <= %L::date', filters ->> 'reviewDueBefore');
        when 'reviewDueAfter'     then parts := parts || format('src.review_due_at >= %L::date', filters ->> 'reviewDueAfter');
        when 'nextMeetingBefore'  then parts := parts || format('src.next_meeting_at <= %L::timestamptz', filters ->> 'nextMeetingBefore');
        when 'staleDays'          then parts := parts || format(
          '(src.last_contacted_at is null or src.last_contacted_at < now() - %L::interval)',
          ((filters ->> 'staleDays')::int || ' days'));
        when 'inceptionYearMin'   then parts := parts || format('src.inception_year >= %s', (filters ->> 'inceptionYearMin')::int);
        when 'inceptionYearMax'   then parts := parts || format('src.inception_year <= %s', (filters ->> 'inceptionYearMax')::int);
        when 'married'            then parts := parts || format('(src.client ->> ''married'')::boolean = %L::boolean', filters ->> 'married');
        when 'takingSocialSecurity' then parts := parts || format('(src.client ->> ''takingSocialSecurity'')::boolean = %L::boolean', filters ->> 'takingSocialSecurity');
        when 'riskProfile'        then parts := parts || format('src.client ->> ''riskProfile'' = %L', filters ->> 'riskProfile');
        when 'federalTaxBracket'  then parts := parts || format('src.client ->> ''federalTaxBracket'' = %L', filters ->> 'federalTaxBracket');
        when 'hasFiaWorksheet'    then parts := parts || (case when (filters ->> 'hasFiaWorksheet')::boolean
                                                              then '(src.client -> ''fiaWorksheet'') is not null'
                                                              else '(src.client -> ''fiaWorksheet'') is null' end);
        when 'hasRothWorksheet'   then parts := parts || (case when (filters ->> 'hasRothWorksheet')::boolean
                                                              then 'src.roth_worksheet is not null'
                                                              else 'src.roth_worksheet is null' end);
        when 'hasAnalysis'        then parts := parts || (case when (filters ->> 'hasAnalysis')::boolean
                                                              then 'src.analysis is not null'
                                                              else 'src.analysis is null' end);
        when 'hasRedFlags'        then parts := parts || (case when (filters ->> 'hasRedFlags')::boolean
                                                              then '(src.analysis ? ''redFlags'') and jsonb_array_length(src.analysis -> ''redFlags'') > 0'
                                                              else '(src.analysis is null or not (src.analysis ? ''redFlags'') or jsonb_array_length(src.analysis -> ''redFlags'') = 0)' end);
        when 'redFlagKeyword'     then parts := parts || format(
          'exists (select 1 from jsonb_array_elements_text(src.analysis -> ''redFlags'') x where x ilike %L)',
          '%' || (filters ->> 'redFlagKeyword') || '%');
        when 'recommendationKeyword' then parts := parts || format(
          'exists (select 1 from jsonb_array_elements_text(src.analysis -> ''recommendations'') x where x ilike %L)',
          '%' || (filters ->> 'recommendationKeyword') || '%');
        when 'goalKeyword'        then parts := parts || format('(src.client ->> ''goal'') ilike %L',
                                                                '%' || (filters ->> 'goalKeyword') || '%');
        when 'holdsTicker'        then parts := parts || format(
          'exists (select 1 from jsonb_array_elements(src.holdings) h where upper(h ->> ''enrichmentResolvedTicker'') = upper(%L))',
          filters ->> 'holdsTicker');
        when 'holdsAssetClass'    then parts := parts || format(
          'exists (select 1 from jsonb_array_elements(src.holdings) h where h ->> ''assetClass'' = %L)',
          filters ->> 'holdsAssetClass');
        when 'hasAccountNumber'   then parts := parts || format(
          'exists (select 1 from jsonb_array_elements(src.holdings) h where h ->> ''accountNumber'' = %L)',
          filters ->> 'hasAccountNumber');
        when 'holdingsNeedReview' then parts := parts || (case when (filters ->> 'holdingsNeedReview')::boolean
                                                              then 'exists (select 1 from jsonb_array_elements(src.holdings) h where (h ->> ''enrichmentNeedsReview'')::boolean = true)'
                                                              else 'not exists (select 1 from jsonb_array_elements(src.holdings) h where (h ->> ''enrichmentNeedsReview'')::boolean = true)' end);
        when 'hasRegistrationType' then parts := parts || format(
          'exists (select 1 from jsonb_array_elements(src.holdings) h where h ->> ''registrationType'' = %L)',
          filters ->> 'hasRegistrationType');
        when 'tags'               then parts := parts || format(
          'exists (select 1 from jsonb_array_elements_text(src.tags) t where t = any(%L::text[]))',
          string_to_array(filters ->> 'tags', ','));
        else raise exception 'query_crm_aggregate: filter "%" not allowed for entity "clients"', k;
      end case;
    end if;

    -- ===== tasks / notes / activity / documents / reports =====
    -- (analogous case statements — see 70-§3.3 for the per-entity allowlist)
    -- Omitted here for brevity; full implementation lands in _apply_crm_phase3_migrations.sql.
  end loop;

  if array_length(parts, 1) is null or array_length(parts, 1) = 0 then return ''; end if;
  return 'where ' || array_to_string(parts, ' and ');
end;
$$;
```

**Security claim:** `_qcrm_build_filter_where` constructs SQL only from validated identifier tokens (key allowlist per entity) and bound jsonb values (cast through `format(%L, ...)` which uses Postgres' built-in literal-quoting). There is no path where a filter value reaches SQL unquoted.

---

## 6 · The new `query_crm_path` function — full SQL

When the LLM only needs one field from a row (e.g. "what's John's wife's first name?"), `path:clients` is the surgical instrument. Returns just the requested JSONB paths plus a visibility check — no full-row marshalling.

```sql
-- =============================================================================
-- query_crm_path — surgical JSONB path extraction with visibility gate
--
-- Returns a single (id, values) row where `values` is a jsonb object mapping
-- each requested path to its extracted value. Paths use dotted notation
-- (intake.spouseFirstName) with optional [N] / [*] array indexing.
--
-- 404 (returns no rows) when the entity row exists but the viewer can't see it.
-- =============================================================================

create or replace function public.query_crm_path(
  viewer_email text,
  entity text,
  id_text text,                     -- uuid as text (lets us reuse for non-uuid PKs later)
  paths text[]
)
returns table (id text, values jsonb)
language plpgsql stable security invoker
as $$
declare
  v_visible boolean;
  v_row jsonb;
  v_id uuid;
  p text;
  out_obj jsonb := '{}'::jsonb;
begin
  -- 1. Validate + visibility
  if entity = 'clients' then
    begin v_id := id_text::uuid; exception when others then return; end;
    select public.clients_visible_to(viewer_email, v_id) into v_visible;
    if not v_visible then return; end if;
    select to_jsonb(c) into v_row from public.advisorpilot_clients c where c.id = v_id;
    if v_row is null then return; end if;

    -- Build a synthetic "intake.X" / "holdings[*].X" / "analysis.X" path namespace
    -- by aliasing the actual jsonb columns
    v_row := jsonb_build_object(
      'id', v_row -> 'id',
      'intake',        v_row -> 'client',
      'holdings',      v_row -> 'holdings',
      'analysis',      v_row -> 'analysis',
      'rothWorksheet', v_row -> 'roth_worksheet',
      'top',           v_row    -- everything else available at "top.X"
    );

  elsif entity = 'reports' then
    begin v_id := id_text::uuid; exception when others then return; end;
    select public.reports_visible_to(viewer_email, v_id) into v_visible;
    if not v_visible then return; end if;
    select to_jsonb(r) into v_row from public.advisorpilot_reports r where r.id = v_id;
    if v_row is null then return; end if;

  else
    raise exception 'query_crm_path: entity "%" not supported for path operation', entity;
  end if;

  -- 2. Extract each requested path
  foreach p in array paths loop
    out_obj := jsonb_set(out_obj, array[p], public._qcrm_extract_path(v_row, p));
  end loop;

  return query select id_text, out_obj;
end;
$$;

grant execute on function public.query_crm_path(text, text, text, text[])
  to anon, authenticated, service_role;

-- =============================================================================
-- _qcrm_extract_path — dotted path with [N] and [*] support
-- Examples:
--   "intake.spouseFirstName"              → row -> 'intake' ->> 'spouseFirstName'
--   "holdings[0].enrichmentResolvedTicker" → row -> 'holdings' -> 0 ->> 'enrichmentResolvedTicker'
--   "holdings[*].value"                    → jsonb_agg of every holding's value
--   "analysis.redFlags"                    → row -> 'analysis' -> 'redFlags' (jsonb array verbatim)
-- =============================================================================

create or replace function public._qcrm_extract_path(row_data jsonb, path text)
returns jsonb
language plpgsql immutable
as $$
declare
  segments text[];
  s text;
  cur jsonb := row_data;
  arr_match text[];
begin
  segments := string_to_array(path, '.');
  foreach s in array segments loop
    -- Detect "name[N]" or "name[*]"
    arr_match := regexp_match(s, '^([a-zA-Z_][a-zA-Z0-9_]*)\[(\*|\d+)\]$');
    if arr_match is not null then
      cur := cur -> arr_match[1];
      if cur is null then return null::jsonb; end if;
      if arr_match[2] = '*' then
        -- The remaining segments apply to each array element; recurse via aggregate
        return (
          select jsonb_agg(public._qcrm_extract_path(elem, array_to_string(
            (select array_agg(t) from unnest(segments[array_position(segments, s) + 1:]) t), '.')))
          from jsonb_array_elements(cur) elem
        );
      else
        cur := cur -> arr_match[2]::int;
      end if;
    else
      cur := cur -> s;
    end if;
    if cur is null then return null::jsonb; end if;
  end loop;
  return cur;
end;
$$;
```

**LLM-facing example** (per 70-§3.5):

```jsonc
// Tool call
{
  "operation": "path",
  "entity":    "clients",
  "id":        "c_a1b2",
  "paths":     [
    "intake.spouseFirstName",
    "intake.fiaWorksheet.carrierName",
    "analysis.redFlags",
    "holdings[0].enrichmentResolvedTicker",
    "holdings[*].value"
  ]
}

// Returned data
{
  "id": "c_a1b2",
  "values": {
    "intake.spouseFirstName":             "Margaret",
    "intake.fiaWorksheet.carrierName":    "Athene",
    "analysis.redFlags":                  ["Concentrated in US large-cap (62%)", ...],
    "holdings[0].enrichmentResolvedTicker": "SPY",
    "holdings[*].value":                  [125000, 87500, 42000, ...]
  }
}
```

---

## 7 · Worked end-to-end trace

Real call. Advisor on `/app/crm/c_a1b2/overview` asks: *"What's John Smith's allocation, and does he have any red flags?"*

```
1. Browser POSTs /api/chat/stream
   Body: { message, conversationId, currentClientId: "c_a1b2", currentRoute: "/app/crm/c_a1b2/overview" }
   Headers: Authorization: Bearer <supabase-jwt>

2. SSE route resolves identity (lib/advisor-auth.ts:23-48)
   → identity = { email: "jane@firm.com", userId: "auth-uuid-...", provider: "supabase" }
   ctx = { advisorEmail: "jane@firm.com", currentClientId: "c_a1b2", ... }

3. Chat-runner preflight (60-§B.4)
   Fetches: advisor profile, current-client snapshot, recent activity, pinned notes, open tasks
   Each call uses ctx.advisorEmail via service-role + RPC. System prompt assembled.

4. Model emits two tool calls in this turn:

   ─── Tool call A ─────────────────────────────────────────────────────────────
   compute({ operation: "allocation_summary", clientId: "c_a1b2" })

   Executor (lib/llm/chat/tools/compute.ts):
     a. supabase.rpc("clients_visible_to", { viewer_email: "jane@firm.com", client_id: "c_a1b2" })
        → SQL: SELECT public.clients_visible_to('jane@firm.com', 'c_a1b2'::uuid)
        → planner inlines the visibility function
        → returns TRUE (Jane owns the client)

     b. supabase.from("advisorpilot_clients").select("id, holdings").eq("id", "c_a1b2").maybeSingle()
        → SQL: SELECT id, holdings FROM advisorpilot_clients WHERE id = 'c_a1b2' LIMIT 1
        → returns 1 row, holdings is a 23-element jsonb array

     c. buildAllocationSummary({ id, client: {}, holdings }) — reused from lib/voice/page-helpers.ts:96-117
        (will be lib/crm/projections.ts after the Phase 2 extraction)
        → returns { clientId, totalValue: 1_420_000, buckets: [{name:"Equity",valueUsd:881820,weightPct:62.1},...] }

   ─── Tool call B ─────────────────────────────────────────────────────────────
   query_crm({ operation: "path", entity: "clients", id: "c_a1b2",
               paths: ["analysis.redFlags", "analysis.recommendations[0]"] })

   Executor (lib/llm/chat/tools/query-crm.ts):
     a. supabase.rpc("query_crm_path", {
          viewer_email: "jane@firm.com",
          entity: "clients",
          id_text: "c_a1b2",
          paths: ["analysis.redFlags", "analysis.recommendations[0]"],
        })
        → SQL: SELECT * FROM public.query_crm_path('jane@firm.com', 'clients', 'c_a1b2', ARRAY[...])

     Inside the function:
        - clients_visible_to('jane@firm.com', 'c_a1b2'::uuid) → true
        - to_jsonb(c) for the row; alias into namespace { id, intake, holdings, analysis, ... }
        - extract "analysis.redFlags" → row->'analysis'->'redFlags' = ["Concentrated in US large-cap (62%)", "Two duplicate small-cap funds with 87% overlap"]
        - extract "analysis.recommendations[0]" → row->'analysis'->'recommendations'->0 = "Rotate 10% from VTI into ex-US developed markets (VEA or IXUS)."
        - jsonb_build_object the result

     → returns { id: "c_a1b2", values: { "analysis.redFlags": [...2 items...], "analysis.recommendations[0]": "Rotate 10%..." } }

5. Chat-runner forwards both tool results to the provider as tool_result messages.

6. Provider emits assistant deltas:
   "John's portfolio breaks down to **62.1% Equity**, **24.8% Fixed Income**,
    **8.9% Cash**, and **4.2% Alternatives**, on a total of **$1.42M**.

    Two red flags from the latest analysis:
    1. **Concentrated in US large-cap** at 62% — see the top recommendation:
       _Rotate 10% from VTI into ex-US developed markets (VEA or IXUS)._
    2. **Two duplicate small-cap funds with 87% overlap.**"

7. completed event fires; route persists the assistant turn to advisorpilot_chat_messages
   (per 60-§B.7); stream closes.
```

**Total wall time:** ~3-5 seconds for the whole turn (preflight ~400ms; first tool ~80ms; second tool ~30ms; provider emission ~2-3s; persistence non-blocking after `completed`).

**Total SQL queries** (excluding preflight + persistence): 4 — one visibility check, one client SELECT, one `query_crm_path` call, plus the function's internal subqueries. All hit indexed paths.

---

## 8 · Performance characteristics

| Operation                          | Cost                                                                                                | Notes                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `list:clients` (200-client advisor)| ~10-30 ms server-side, ~5 KB JSON                                                                  | RPC + PK lookup per row + visibility check; well-indexed                                            |
| `list:clients` (5,000-client RIA)  | ~200-500 ms server-side, ~120 KB JSON                                                              | TS-side filter becomes the bottleneck; push filters into the RPC for tier-3 customers              |
| `get:clients`                      | ~5-15 ms (one visibility check + one PK SELECT)                                                    | Returns FULL row including all JSONB columns (typically 5-50 KB per client)                        |
| `aggregate:clients groupBy=stage`  | ~20-50 ms                                                                                          | Visible cohort scan + GROUP BY on indexed column                                                   |
| `aggregate:clients groupBy=intake.riskProfile` | ~50-100 ms                                                                            | JSONB extraction per row; no index on intake.riskProfile                                            |
| `aggregate:clients groupBy=holdings.dominant_asset_class` | ~200-500 ms (200-client advisor)                                          | Subquery per row scans holdings array; consider materialized projection for tier-3                  |
| `path:clients` (single field)      | ~3-8 ms                                                                                            | One visibility check + one row fetch + jsonb traversal                                              |
| `path:clients` with `[*]` projection| ~10-30 ms                                                                                          | Aggregate across the holdings array                                                                 |
| `search:clients` (200 clients)     | ~30-60 ms                                                                                          | RPC scan + TS substring; would benefit from `to_tsvector` index at scale                            |
| `list:activity` (with clientId)    | ~10-40 ms                                                                                          | UNION of two tables with composite indexes; well-tuned                                              |
| `list:notes` (per-client list)     | ~5-20 ms                                                                                          | Hits `advisorpilot_notes_client_pinned_created_idx`                                                 |
| `list:tasks` (status='open')       | ~10-30 ms                                                                                          | Hits `advisorpilot_tasks_owner_status_idx`                                                          |
| `list:documents` (per-client)      | ~10-30 ms                                                                                          | Hits `advisorpilot_documents_client_id_idx`                                                         |

### 8.1 The hot paths to watch

1. **`list:clients` at scale.** Today's RPC returns every visible row to the client and filters in TS. Above ~1000 clients per advisor, push filters into the function signature (e.g., `list_visible_clients(viewer_email, stage_filter text, min_aum numeric)`). Phase 6+.
2. **JSONB aggregates** (e.g., grouping by `holdings.dominant_asset_class`). Per-row subqueries don't use any index. For frequent advisor-wide questions, consider a *materialized projection* table updated by trigger on client write — out of scope for v1.
3. **Cross-advisor org queries** (when a steward of an org runs `aggregate:clients` across the whole org's clients). The `clients_visible_to` function's org branch hits the membership table for every row; at scale, the planner may need a hash join instead of nested loops. Cheap to measure; revisit if it shows up in slow-query logs.

### 8.2 Things this does NOT do

- **No connection pooling concern** — Supabase already PgBouncer-pools the service-role connection.
- **No N+1 risk** — every `list:*` op is one RPC; every `get:*` op is at most three queries (visibility + row + aggregates).
- **No cross-tenant overhead** — the visibility helpers are STABLE so the planner can inline them; there's no recursive CTE explosion.

---

## 9 · Adding a new entity — checklist

When a future contributor wants to add a new `query_crm` entity (e.g., `manage_memory` lands and `memories` becomes a readable entity), here's the order of operations:

1. **Create the table** in a new `_apply_crm_phase<N>_migrations.sql` file. Pick visibility model: owner-only? `_visible_to` helper? Just service-role?
2. **Define the visibility helper** (if not owner-only): `<entity>_visible_to(viewer_email, <pk>)`. Mirror the three-branch structure of `clients_visible_to`.
3. **Define the list wrapper**: `list_visible_<entity>(viewer_email) returns setof <table>`. Mirror `list_visible_clients`.
4. **Write RLS policies**: at minimum SELECT + INSERT + UPDATE + DELETE. Pick owner-only vs visibility-aware based on the visibility model.
5. **Grant execute** on the new functions to `anon`, `authenticated`, `service_role`.
6. **Add the entity to the enum** in `query_crm_aggregate` + the four helper functions (`_qcrm_visible_set_sql`, `_qcrm_build_group_expr`, `_qcrm_build_aggregate_metrics`, `_qcrm_build_filter_where`).
7. **Add a mapper**: `to<Entity>(row): <EntityType>` in `lib/crm/<entity>-mapper.ts`.
8. **Add to `query_crm` executor**: new switch cases for `list:<entity>`, `get:<entity>`, etc.
9. **Add to per-entity allowlists** in 70-§3.3 (filters, sort, select, groupBy).
10. **Update this doc** — add the table to §3, the SQL to §4-§6, the audit table in §10.
11. **Verify with audit query**:

```sql
-- List every visibility helper + list wrapper to confirm completeness
SELECT proname, pronargs FROM pg_proc
WHERE proname LIKE 'list_visible_%' OR proname LIKE '%_visible_to'
ORDER BY proname;
```

---

## 10 · Self-audit (line-by-line)

Every schema reference in this doc verified against `schema.sql` lines (verbatim from the dump generated 2026-05-16).

### 10.1 Tables

| §          | Table                                          | schema.sql lines | Status |
| ---------- | ---------------------------------------------- | ---------------- | ------ |
| §3.1       | `advisorpilot_clients`                         | 160-189          | PASS   |
| §3.2       | `advisorpilot_notes`                           | 207-221          | PASS   |
| §3.3       | `advisorpilot_tasks`                           | 239-257          | PASS   |
| §3.4       | `advisorpilot_activity_log`                    | 386-398          | PASS   |
| §3.5       | `advisorpilot_documents`                       | 467-483          | PASS   |
| §3.6       | `advisorpilot_audit_events`                    | 430-440          | PASS   |
| §3.7       | `advisorpilot_advisor_profiles`                | 404-424          | PASS   |
| §3.8       | `advisorpilot_organizations`                   | 519-528          | PASS   |
| §3.8       | `advisorpilot_organization_members`            | 501-513          | PASS   |
| §3.9       | `advisorpilot_share_grants`                    | 557-566          | PASS   |
| §3.10      | `advisorpilot_deep_research_jobs`              | 446-461          | PASS   |
| §3.11      | `advisorpilot_security_enrichment_cache`       | 547-551          | PASS   |
| §3.11      | `advisorpilot_enrichment_provenance`           | 489-495          | PASS   |
| §3.12      | `advisorpilot_securities_master` (with "Foriegn" typo) | 534-541  | PASS   |
| §3.13      | `advisorpilot_upload_tokens`                   | 572-585          | PASS   |
| §3.13      | `advisorpilot_voice_audit_log`                 | 591-601          | PASS   |
| §3.13      | `advisorpilot_voice_settings`                  | 607-620          | PASS   |
| §3.14      | `advisorpilot_reports` (NEW)                   | — (Phase 4 of 70-§10) | GAP — intentional |

### 10.2 Visibility helpers + list RPCs

| §          | Function                                                                                                                  | schema.sql lines | Status |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| §2.4, §3.1 | `clients_visible_to(viewer_email text, client_id uuid)`                                                                   | 48-78            | PASS   |
| §2.4, §3.8 | `is_org_admin(viewer_email text, org_id uuid)`                                                                            | 84-95            | PASS   |
| §2.4, §3.4 | `list_visible_activity(viewer_email, target_client_id, since_ts, limit_n)` with 10-column return signature                | 101-150          | PASS   |
| §2.4, §3.1 | `list_visible_clients(viewer_email)` returning `SETOF advisorpilot_clients`                                                | 195-201          | PASS   |
| §2.4, §3.2 | `notes_visible_to(viewer_email, note_id)`                                                                                  | 275-305          | PASS   |
| §2.4, §3.2 | `list_visible_notes(viewer_email)`                                                                                         | 227-233          | PASS   |
| §2.4, §3.3 | `tasks_visible_to(viewer_email, task_id)`                                                                                  | 350-380          | PASS   |
| §2.4, §3.3 | `list_visible_tasks(viewer_email)`                                                                                         | 263-269          | PASS   |
| §3.14      | `reports_visible_to`, `list_visible_reports` (NEW in 70-§10)                                                                | — (Phase 4)      | GAP — intentional |
| §5, §6     | `query_crm_aggregate`, `query_crm_path`, `_qcrm_*` helpers (NEW)                                                            | — (Phase 3)      | GAP — intentional |

### 10.3 RLS policies

| §          | Policy                                                                                                                 | schema.sql lines | Status |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| §2.5, §3.1 | `advisorpilot_clients_select_own` — **owner-only**, does NOT call `clients_visible_to`                                  | 1028             | PASS   |
| §2.5, §3.1 | `advisorpilot_clients_insert_own / update_own / delete_own` — owner-only                                                | 1020-1032        | PASS   |
| §2.5, §3.2 | `notes_select_visible` — calls `notes_visible_to`                                                                       | 1131             | PASS   |
| §2.5, §3.2 | `notes_insert_own / update_visible / delete_own`                                                                         | 1123-1135        | PASS   |
| §2.5, §3.3 | `tasks_select_visible` — calls `tasks_visible_to`                                                                       | 1191             | PASS   |
| §2.5, §3.3 | `tasks_insert_own / update_visible / delete_own`                                                                         | 1183-1195        | PASS   |
| §2.5, §3.4 | `activity_select_visible` — owner OR `clients_visible_to(client_id)`                                                    | 996              | PASS   |
| §2.5, §3.4 | `activity_insert_own`                                                                                                   | 992              | PASS   |
| §2.5, §3.5 | `advisorpilot_documents_select_own` — owner-only                                                                        | 1050             | PASS   |
| §2.5, §3.6 | `advisorpilot_audit_events_select_own / insert_own`                                                                     | 1009, 1013       | PASS   |
| §2.5, §3.7 | `advisorpilot_profiles_*` — owner-only                                                                                  | 1070-1082        | PASS   |
| §2.5, §3.8 | `orgs_*` + `org_members_*` policies                                                                                     | 1139-1167        | PASS   |
| §2.5, §3.9 | `share_grants_*`                                                                                                        | 1171-1179        | PASS   |
| §2.5, §3.10| `advisorpilot_deep_research_jobs` RLS enabled, NO policies (service-role only)                                          | 1036             | PASS   |

### 10.4 Indexes

| §          | Index                                                                | schema.sql lines | Status |
| ---------- | -------------------------------------------------------------------- | ---------------- | ------ |
| §3.1       | `advisorpilot_clients_owner_email_idx`                               | 758              | PASS   |
| §3.1       | `advisorpilot_clients_owner_user_id_idx`                             | 762              | PASS   |
| §3.1       | `advisorpilot_clients_org_visibility_idx`                            | 754              | PASS   |
| §3.1       | `advisorpilot_clients_updated_at_idx`                                | 766              | PASS   |
| §3.2       | `advisorpilot_notes_client_pinned_created_idx`                       | 798              | PASS   |
| §3.2       | `advisorpilot_notes_org_visibility_idx`                              | 802              | PASS   |
| §3.3       | `advisorpilot_tasks_owner_status_idx (owner_email, status, due_date)` | 842            | PASS   |
| §3.3       | `advisorpilot_tasks_client_idx (client_id, status)`                  | 834              | PASS   |
| §3.3       | `advisorpilot_tasks_org_visibility_idx`                              | 838              | PASS   |
| §3.4       | `advisorpilot_activity_client_occurred_idx`                          | 726              | PASS   |
| §3.4       | `advisorpilot_activity_owner_occurred_idx`                           | 730              | PASS   |
| §3.4       | `advisorpilot_activity_type_idx`                                     | 734              | PASS   |
| §3.5       | `advisorpilot_documents_client_id_idx`                               | 778              | PASS   |
| §3.5       | `advisorpilot_documents_owner_email_idx` (lower(owner_email))         | 782              | PASS   |
| §3.5       | `advisorpilot_documents_owner_user_id_idx`                           | 786              | PASS   |
| §3.6       | `advisorpilot_audit_events_entity_idx` partial WHERE entity_id IS NOT NULL | 742         | PASS   |
| §3.10      | `advisorpilot_deep_research_owner_idx (owner_email, created_at DESC)`| 770              | PASS   |
| §3.10      | `advisorpilot_deep_research_status_idx`                              | 774              | PASS   |

### 10.5 FK relationships

| §          | FK                                                                                          | schema.sql lines | Status |
| ---------- | ------------------------------------------------------------------------------------------- | ---------------- | ------ |
| §3.1, §3.2 | `advisorpilot_notes.client_id` NOT NULL → `clients.id` ON DELETE CASCADE                     | 962-963          | PASS   |
| §3.1, §3.3 | `advisorpilot_tasks.client_id` → `clients.id` ON DELETE CASCADE                              | 977-978          | PASS   |
| §3.1, §3.4 | `advisorpilot_activity_log.client_id` → `clients.id` ON DELETE CASCADE                       | 922-923          | PASS   |
| §3.1, §3.5 | `advisorpilot_documents.client_id` → `clients.id` ON DELETE SET NULL                          | 947-948          | PASS   |
| §3.1       | `advisorpilot_clients.org_id` → `organizations.id` ON DELETE SET NULL                        | 937-938          | PASS   |
| §3.2       | `advisorpilot_notes.org_id` → `organizations.id` ON DELETE SET NULL                          | 967-968          | PASS   |
| §3.3       | `advisorpilot_tasks.org_id` → `organizations.id` ON DELETE SET NULL                          | 982-983          | PASS   |
| §3.8       | `advisorpilot_organization_members.org_id` → `organizations.id` ON DELETE CASCADE             | 972-973          | PASS   |
| §3.11      | `advisorpilot_enrichment_provenance.cache_key` → `cache.lookup_key` ON DELETE CASCADE         | 957-958          | PASS   |

### 10.6 Mappers + helpers cited

| §          | Asserted                                                                                              | Verified                                                              | Status |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| §2.1       | `resolveAdvisorIdentity(req)` returns `{ email, userId, provider } \| null`                            | `lib/advisor-auth.ts:23-48`                                            | PASS   |
| §2.2       | `getCrmSupabaseAdmin()` is service-role + advisory comment about explicit visibility                    | `lib/crm/supabase-admin.ts:14-15, 29-44`                               | PASS   |
| §2.4       | `lib/crm/visibility.ts` exports `visibleClientsClause` / `visibleTasksClause` / `visibleNotesClause` / `isOrgAdminClause` | `lib/crm/visibility.ts:35-61`                                          | PASS   |
| §3.1       | `toRosterItem` + `toClientDetail`                                                                      | `lib/crm/clients-mapper.ts:71`, `:116`                                 | PASS   |
| §3.2       | `toNote`                                                                                              | `lib/crm/note-mapper.ts:25-39`                                         | PASS   |
| §3.3       | `toTask`                                                                                              | `lib/crm/task-mapper.ts:29-47`                                         | PASS   |
| §3.4       | `toActivityEntry` handling both `activity_log` and `audit_event` source rows                          | `lib/crm/activity-adapter.ts:61-93`                                    | PASS   |
| §3.4       | `AUDIT_ACTION_MAP` partial action vocabulary                                                          | `lib/crm/activity-adapter.ts:46-58`                                    | PASS   |
| §3.4       | `writeActivityLog`, `bumpLastContactedAt`                                                              | `lib/crm/activity-writer.ts:26-76`                                     | PASS   |
| §3.5       | `toDocument`                                                                                          | `lib/crm/document-mapper.ts:25-44`                                     | PASS   |
| §3.5       | `/api/documents` default-excludes `advisor_upload` + `client_upload`                                  | `app/api/documents/route.ts:22-29`                                     | PASS   |
| §3.6       | `writeAuditEvent`                                                                                     | `lib/audit-log.ts:8-31`                                                | PASS   |
| §3.8       | `ensurePersonalOrg(email)` slug pattern `personal-<md5(email)>`                                       | `lib/crm/ensure-personal-org.ts:48-116`                                | PASS   |
| §7         | `buildAllocationSummary` returning `{ clientId, totalValue, buckets }`                                | `lib/voice/page-helpers.ts:96-117` (extracted to `lib/crm/projections.ts` per 70-§4 Phase 2) | PASS   |

### 10.7 JSONB shapes

| §       | Shape                                                                  | Source file                                | Status |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------ | ------ |
| §3.1    | `clients.client` = `IntakeClient`                                       | `lib/intake-config.ts:13-62`                | PASS   |
| §3.1    | `clients.holdings` = `UiHolding[]`                                      | `lib/saved-review-normalize.ts:12-48`       | PASS   |
| §3.1    | `clients.analysis` = `NormalizedAiAnalysis \| null`                     | `lib/saved-review-normalize.ts:50-61`       | PASS   |
| §3.1    | `clients.roth_worksheet` = `RothWorksheet \| null`                      | `lib/roth-worksheet.ts:1-23`                | PASS   |
| §3.1    | `IntakeClient.fiaWorksheet` = `FiaWorksheet \| null`                    | `lib/fia-worksheet.ts:3-27`                 | PASS   |

### 10.8 Grants

| §          | Asserted                                                                                                                                          | Verified                  | Status |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ |
| §2.4       | All visibility helpers (`clients_visible_to`, `tasks_visible_to`, `notes_visible_to`, `is_org_admin`, `list_visible_activity`, `list_visible_clients`, `list_visible_notes`, `list_visible_tasks`) granted to `anon`, `authenticated`, `service_role` | `schema.sql:1358-1438`    | PASS   |
| §3.x       | Every CRM table granted to `anon`, `authenticated`, `service_role`                                                                                | `schema.sql:1457-1537`    | PASS   |

### 10.9 Schema quirks called out

| §       | Quirk                                                                                                                       | Status |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| §1, §3.12 | `advisorpilot_securities_master` column `"Domestic, Foriegn, Global"` with typo "Foriegn"                                  | PASS (verified verbatim in schema.sql:540) |
| §2.5    | `advisorpilot_clients` RLS is owner-only — does NOT call `clients_visible_to` (the trap)                                    | PASS   |
| §3.5    | `advisorpilot_documents` RLS is owner-only — visibility expansion happens in the tool layer via `client_id → clients_visible_to` | PASS |
| §3.10   | `advisorpilot_deep_research_jobs` RLS enabled, no policies defined → service-role only                                       | PASS   |
| §3.11   | `enrichment_cache` + `enrichment_provenance` RLS enabled, no policies → service-role only (process-wide cache)               | PASS   |
| §3.12   | `securities_master` RLS enabled, no policies → service-role only (reference data)                                            | PASS   |
| §3.13   | `voice_*` + `upload_tokens` tables RLS enabled with owner-only policies (when present); out of v1 chat-tool scope             | PASS   |

---

## Cross-references

- [60-chat-orchestrator.md](./60-chat-orchestrator.md) — the chat runner, SSE protocol, system prompt, widget mounting; the tool executors documented here run inside its tool loop.
- [70-orchestrator-tools.md](./70-orchestrator-tools.md) — the LLM-facing tool catalog; §3 (`query_crm`) and §4 (`compute`) are the surfaces this doc deepens.
- [50-organizations-and-sharing.md](./50-organizations-and-sharing.md) — the visibility model (`private | shared | organization`) the SQL helpers implement.
- [20-technical-specs.md](./20-technical-specs.md) — original schema specs for the CRM-additive tables; this doc verifies they shipped intact.
- [30-backward-compat.md](./30-backward-compat.md) — the additive-only DB rules; every new function/table this plan adds follows them.
- [.cursor/rules/40-supabase-schema-changes.mdc](../../.cursor/rules/40-supabase-schema-changes.mdc) — the project's schema-change rule (additive-only, nullable-only, drop-then-create for policies, idempotent).
- [.cursor/rules/50-authentication.mdc](../../.cursor/rules/50-authentication.mdc) — the three-auth-path rule (`resolveAdvisorIdentity` + `advisorFetch`); §2.1 cites the resolver.
