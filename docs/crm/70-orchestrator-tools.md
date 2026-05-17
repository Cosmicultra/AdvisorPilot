# 70 · Orchestrator Tools — full read DSL, computed projections, writes, reports

> **Status:** Design doc — no code yet. **Date:** 2026-05-16. **Scope:** the chat orchestrator's tool surface — what the LLM can READ from Supabase, COMPUTE from the read data, WRITE back (reports / tasks / notes / client metadata), KICK OFF (analysis / fee analysis / enrichment / deep research), and EMBED in the report renderer (markdown + Chart.js + ECharts + Mermaid).
>
> **Companion doc:** [75-database-tools.md](./75-database-tools.md) is the SQL-facing reference for the `query_crm` + `compute` surface — full per-table inventory, RLS policy audit, literal SQL behind every operation, and the new `query_crm_aggregate` / `query_crm_path` function bodies. This doc stays LLM-facing (tool shapes, operations, filter allowlists); 75 covers what runs under the hood.
>
> **Read 60 first.** This doc builds on the streaming-runner + provider-adapter + SSE event vocabulary in [60-chat-orchestrator.md](./60-chat-orchestrator.md). It assumes `ChatTool`, `ChatToolContext`, and `ChatToolResult` from §B.11 of that doc.
>
> **Self-audit:** every column / RPC / route / helper / JSONB path cited below is verified against today's repo in [§14](#14--self-audit-line-by-line). Status labels: **PASS** (exists today), **GAP** (intentional new code in this plan), **REUSE** (existing helper we delegate to).

---

## Table of contents

1. [Design philosophy — what the LLM gets to see](#1--design-philosophy)
2. [Tool list at a glance](#2--tool-list-at-a-glance)
3. [`query_crm` — the compound read DSL (full JSONB exposure)](#3--query_crm--the-compound-read-dsl)
4. [`compute_*` — derived projections (allocation, holdings, scores)](#4--compute_--derived-projections)
5. [Writes — `manage_note`, `manage_task`, `manage_client`](#5--writes--manage_note-manage_task-manage_client)
6. [`run_*` — kicking off existing AI surfaces (analysis, fee, enrichment, research)](#6--run_--kicking-off-existing-ai-surfaces)
7. [`manage_report` + `generate_report_content` — the report surface](#7--manage_report--generate_report_content--the-report-surface)
8. [Report markdown extensions — Chart.js / ECharts / Mermaid / embed_image](#8--report-markdown-extensions)
9. [The web renderer (`lib/markdown/`)](#9--the-web-renderer-libmarkdown)
10. [Persistence — the new Supabase tables](#10--persistence--the-new-supabase-tables)
11. [Phasing — eight shippable PRs](#11--phasing--eight-shippable-prs)
12. [Self-audit (line-by-line)](#12--self-audit-line-by-line)
13. [File inventory](#13--file-inventory)

---

## 1 · Design philosophy

Three rules drive every tool below.

**Rule 1 — Expose everything the advisor owns.** The advisor is the *data owner*. The chat orchestrator runs as them, authenticated via `resolveAdvisorIdentity`. Visibility (`private | shared | organization`) is already enforced row-level by the SQL helpers (`clients_visible_to`, `tasks_visible_to`, `notes_visible_to`, `reports_visible_to`). There is **no reason to hide columns** from the LLM beyond that. The entire `client` intake JSONB (10-question wizard answers + spouse + risk profile + FIA worksheet), the entire `holdings` JSONB (with enrichment metadata, validation status, account numbers, cost basis, FIGI codes), the entire `analysis` JSONB (synopsis, red flags, recommendations, talking points, objection handling), the entire `roth_worksheet`, the entire `meeting_notes` — all of it is fair game. The same data the human advisor sees in the UI, the LLM sees through the tools.

**Rule 2 — Compose, don't constrain.** The right tool shape is *compound* (one tool, many operations) — same pattern Control Tower's `manage_table`, `manage_rows`, `manage_report`, `manage_entity_intel` proved at scale. Six compound tools (`query_crm`, `compute`, `manage_note`, `manage_task`, `manage_client`, `manage_report`) plus one one-shot (`generate_report_content`) plus four `run_*` wrappers around existing AI routes. About 11 LLM-facing tool names total — small enough to fit in the system prompt without truncation, large enough to cover any advisor workflow.

**Rule 3 — Server-side parity with the UI and the voice agent.** The voice agent (`lib/voice/tool-handlers.ts`) already exposes `find_clients_by_criteria`, `get_holdings_breakdown`, `get_allocation_summary`, `get_meeting_guide`, `get_red_flags`, `get_overlap_insights`, `get_roth_summary`, `client_overview`, `read_analysis_section`. The chat orchestrator's tools route through **the same helper functions** (`buildAllocationSummary`, `buildHoldingsBreakdown` in `lib/voice/page-helpers.ts`) — extracted to `lib/crm/projections.ts` so both agents share one implementation. When the UI's allocation card or accounts card changes math, the chat agent and the voice agent change with it. No drift.

**Not in this plan:**

- No rate limiter on tool calls per turn. The chat-runner already caps total tool-loop iterations at `maxToolLoops` (12 — see [60-chat-orchestrator.md §B.4](./60-chat-orchestrator.md#b4-the-chat-runner)) and tools are billed per-call; that's the only cap we need.
- No "the LLM might query data it shouldn't" filtering. The advisor owns the data; show the advisor's data to the advisor's agent.
- No DuckDB. Postgres jsonb operators (`->`, `->>`, `#>`, `#>>`, `jsonb_path_query`, `jsonb_array_elements`) cover every aggregation we need against the JSONB columns.

---

## 2 · Tool list at a glance

| Tool                       | Risk    | Compound | Touches                                     | Replaces / Reuses                                                                        |
| -------------------------- | ------- | -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `query_crm`                | T1      | ✅       | clients, tasks, notes, activity, documents, advisor_profile, reports, research_jobs, enrichment_cache — read-only | Mirrors `app/api/{clients,tasks,notes,documents,activity}` GET handlers + the `list_visible_*` RPCs |
| `compute`                  | T1      | ✅       | `clients.holdings` / `.analysis` JSONB; computed projections | Wraps `lib/voice/page-helpers.ts` (`buildAllocationSummary`, `buildHoldingsBreakdown`) + `lib/fee-analysis.ts` math |
| `manage_note`              | T2/T3/T4| ✅       | `advisorpilot_notes` + activity_log side-effect | Mirrors `app/api/notes/route.ts` POST + `app/api/notes/[id]/route.ts` PATCH/DELETE       |
| `manage_task`              | T2/T3/T4| ✅       | `advisorpilot_tasks` + activity_log side-effect | Mirrors `app/api/tasks/route.ts` POST + `app/api/tasks/[id]/route.ts` PATCH/DELETE       |
| `manage_client`            | T3/T4   | ✅       | `advisorpilot_clients` (top-level CRM cols only — stage / tags / location / next_meeting_at / etc.; NEVER touches intake/holdings JSONB) | Mirrors `app/api/clients/[id]/route.ts` PATCH                                            |
| `manage_report`            | T2/T3/T4| ✅       | `advisorpilot_reports` (NEW) — markdown + versions | Pattern from `server/ai/tools/report-manage.ts` (CT) — 13 operations including line-level edits + version restore + embed_image |
| `generate_report_content`  | T2      | —        | LLM-only (calls `complete()`) → returns markdown | Pattern from `server/ai/tools/report-generate.ts` (CT)                                   |
| `run_analysis`             | T2      | —        | Kicks off `/api/generate-analysis`; persists result to `clients.analysis` jsonb | Wraps existing route                                                                     |
| `run_fee_analysis`         | T1      | —        | Kicks off `/api/fee-analysis`; returns the API's `FeeAnalysisApiResponse` shape | Wraps existing route                                                                     |
| `run_enrich_holdings`      | T2      | —        | Kicks off `/api/enrich-holdings` for a client; returns enriched UiHolding[] | Wraps existing route                                                                     |
| `run_deep_research`        | T2      | —        | Calls `/api/research/start`; returns `{ jobId }` → poll via `query_crm({ entity: 'research_jobs' })` | Wraps existing async route                                                               |

**Risk tier semantics (Control Tower's convention):** T1 = read-only (no confirmation); T2 = create / non-destructive (no confirmation); T3 = update (returns a preview the first call, confirms on `_confirmed: true`); T4 = single delete (requires `_confirmed: true`); T5 = bulk delete / table delete (requires the advisor to type a confirmation phrase). T5 is **not** used by any tool in this plan.

**What's intentionally absent:**

- `manage_memory` / `manage_intel` — durable cross-session knowledge stores. Deferred. The orchestrator gets its context per turn via the existing preflight (advisor profile + current client + recent activity + pinned notes — see [60-§B.5](./60-chat-orchestrator.md#b5-context-built-into-the-system-prompt)). When we want persistent advisor preferences or entity-scoped intel, we'll add pgvector tables + the two compound tools as a separate enrichment doc. Not v1.
- `propose_plan` — the interactive Q&A pattern from Control Tower. Reserved as a forward-compatible SSE event in [60-§A.2](./60-chat-orchestrator.md#a2-the-three-things-that-make-this-design-good) (`plan:proposal`) but not built. v1 lets the LLM ask clarifying questions in plain language.
- `send_email` — emails go out through the existing surfaces (`/api/email-client-snapshot`, intake follow-up). The chat agent doesn't compose-and-send. Deferred.
- `manage_organization` / `manage_share_grant` — the sharing UI lives in Phase 6 of the broader CRM plan ([50-organizations-and-sharing.md](./50-organizations-and-sharing.md) §6). The LLM doesn't need to invite teammates or change org membership.
- `manage_document` — documents are uploaded by humans (via `/api/analyze-statement` or the magic-link path) or generated by AI tools (via `manage_report` → PDF export). There's no compound tool to upload files mid-chat. Future work if a need emerges.
- A separate "navigation" tool. The chat widget already knows the current URL from `usePathname` and passes `currentClientId` + `currentRoute` into the system prompt (see [60-§B.5](./60-chat-orchestrator.md#b5-context-built-into-the-system-prompt)). The LLM doesn't *navigate* the advisor's browser — the advisor does that themselves.

---

## 3 · `query_crm` — the compound read DSL

> **For the SQL behind every operation, the per-table reference (columns + indexes + RLS), and the security model see [75-database-tools.md](./75-database-tools.md).** This section is the LLM-facing schema only — what the model sees, not what runs under the hood.

### 3.1 The five operations

```
operation:  list | get | aggregate | search | path
```

Every operation takes an `entity` argument from a fixed enum. Per-entity allowlists for filters, sort keys, group-by tokens, and aggregate functions live in the executor — the JSON schema for the LLM only shows the operation/entity menu, the full filter shape is documented in the description.

| Operation   | What it does                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`      | Rows of one entity with filters + sort + paginate. Returns the SAME mapper shape the UI uses (e.g. `ClientRosterItem` for `entity: 'clients'`). Visibility-filtered via `list_visible_*` RPC. |
| `get`       | One row by id, full content (including all JSONB columns). Visibility-checked via the appropriate `_visible_to` predicate. 404 (not 403) on not-visible — same leak-prevention as the existing API. |
| `aggregate` | Grouped count / sum / avg / min / max over an entity, against either top-level columns OR JSONB paths. Compiled to a single `query_crm_aggregate(...)` Postgres function call (§3.4).         |
| `search`    | Case-insensitive substring search across an entity's text + JSONB-text fields. Backed by a new `query_crm_search` RPC that uses `to_tsvector` or `ILIKE` depending on entity.                  |
| `path`      | Fetches a specific JSONB path (or array of paths) from one row, without sending the whole row. Backed by the Postgres `#>>` and `jsonb_path_query` operators. Useful for "what's Sarah's spouse's first name?" without pulling all 50 KB of holdings. |

### 3.2 The full entity menu

The nine entities the LLM can read (read-only — writes use `manage_*` tools):

| Entity              | Source table / RPC                                       | Default projection                                                                                  | Full JSONB exposed?                                                                                                                                  |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`           | `advisorpilot_clients` via `list_visible_clients(email)` | `ClientRosterItem` (id, name, stage, status, aum, accountsCount, custodians, tags, reviewDueAt, etc. — `lib/crm/types.ts:204-237`) | YES on `get`: returns `ClientDetail` (`lib/crm/types.ts:252-267`) including `client` (intake JSONB), `holdings`, `analysis`, `rothWorksheet`, `meetingNotes`. |
| `tasks`             | `advisorpilot_tasks` via `list_visible_tasks(email)`     | `Task` (`lib/crm/types.ts:126-142`)                                                                  | N/A (no JSONB columns beyond `tags`)                                                                                                                |
| `notes`             | `advisorpilot_notes` via `list_visible_notes(email)`     | `Note` (`lib/crm/types.ts:150-162`)                                                                  | N/A (body is plain text)                                                                                                                            |
| `activity`          | UNION of `advisorpilot_activity_log` + `advisorpilot_audit_events` via `list_visible_activity(email, target_client_id, since_ts, limit_n)` | `ActivityEntry` (`lib/crm/types.ts:181-196`)                                                         | `metadata` jsonb returned verbatim                                                                                                                  |
| `documents`         | `advisorpilot_documents` + visibility gate via `clients_visible_to`              | `Document` (`lib/crm/types.ts:76-91`)                                                                | `metadata` jsonb returned verbatim                                                                                                                  |
| `reports`           | `advisorpilot_reports` (NEW §10.1) via `list_visible_reports(email)`             | `Report` (NEW type — see §7)                                                                         | `content` (markdown) returned verbatim; `embedded_media` jsonb returned verbatim                                                                    |
| `advisor_profile`   | `advisorpilot_advisor_profiles` filtered to viewer's row                         | Full row including signature, branding, model preferences                                            | `llm_model_overrides` jsonb returned verbatim                                                                                                       |
| `research_jobs`     | `advisorpilot_deep_research_jobs` filtered to viewer's owner_email               | Full row (status, tier, result, error, started_at, completed_at)                                     | `request` + `result` jsonb returned verbatim                                                                                                        |
| `enrichment_cache`  | `advisorpilot_security_enrichment_cache` + `advisorpilot_enrichment_provenance`   | Ticker → enrichment hits (advisor-owned cache lookups; useful for "what did we look up for SPY?")    | Provenance citations returned                                                                                                                       |

### 3.3 Per-entity filter, sort, and projection allowlists

This is the part the LLM reads in the tool description. Every key listed is bound to a TS allowlist in the executor — the schema does not enforce it, but the executor rejects unknown keys with a structured error the LLM can recover from.

#### `clients`

```jsonc
filters: {
  // Top-level + Phase-0 additive columns
  stage:                    "Review due" | "Upcoming" | "Stable" | "At risk" | "Onboarding" | "Prospect",
  status:                   string,                  // free-form (existing column default 'Analyzed')
  tags:                     string[],                // ANY match
  ownerEmail:               string,                  // for shared/org-visible clients you want to filter to your own
  search:                   string,                  // matches firstName + lastName + householdLabel
  staleDays:                integer,                 // last_contacted_at older than N (or null)
  reviewDueBefore:          "YYYY-MM-DD",
  reviewDueAfter:           "YYYY-MM-DD",
  nextMeetingBefore:        "YYYY-MM-DD",
  minAum:                   number,                  // total_value >= N
  maxAum:                   number,
  inceptionYearMin:         integer,
  inceptionYearMax:         integer,

  // ── JSONB filters into clients.client (intake) ──────────────────────────
  age:                      { min?: number, max?: number },        // client.client.age (string coerced)
  retirementAge:            { min?: number, max?: number },        // client.client.retirementAge
  riskProfile:              string,                                // exact match on client.client.riskProfile
  federalTaxBracket:        "10"|"12"|"22"|"24"|"32"|"35"|"37",   // client.client.federalTaxBracket
  married:                  boolean,                               // client.client.married
  takingSocialSecurity:     boolean,                               // client.client.takingSocialSecurity
  minAdjustedGrossIncome:   number,                                // client.client.adjustedGrossIncomeAnnual (string coerced)
  goalKeyword:              string,                                // substring match on client.client.goal
  hasFiaWorksheet:          boolean,                               // client.client.fiaWorksheet IS NOT NULL
  hasRothWorksheet:         boolean,                               // clients.roth_worksheet IS NOT NULL

  // ── JSONB filters into clients.analysis ─────────────────────────────────
  hasRedFlags:              boolean,                               // jsonb_array_length(analysis -> 'redFlags') > 0
  hasAnalysis:              boolean,                               // analysis IS NOT NULL
  redFlagKeyword:           string,                                // ANY red-flag entry contains substring
  recommendationKeyword:    string,                                // ANY recommendations entry contains substring

  // ── JSONB filters into clients.holdings ─────────────────────────────────
  holdsTicker:              string,                                // ANY holding's enrichmentResolvedTicker == ticker
  holdsAssetClass:          string,                                // ANY holding.assetClass matches
  hasAccountNumber:         string,                                // ANY holding.accountNumber == X
  holdingsNeedReview:       boolean,                               // ANY holding.enrichmentNeedsReview === true
  hasRegistrationType:      "ira" | "roth_ira" | "joint" | "individual" | "trust" | ...,
}

select: [
  // Top-level
  "id" | "firstName" | "lastName" | "stage" | "status" | "aum" | "accountsCount" |
  "custodians" | "tags" | "ownerEmail" | "lastContactedAt" | "nextMeetingAt" | "reviewDueAt" |
  "isOverdue" | "visibility" | "householdLabel" | "location" | "email" | "phone" |

  // JSONB sub-trees (returned in full if listed)
  "intake" |        // == clients.client jsonb (the IntakeClient shape)
  "holdings" |      // == clients.holdings jsonb (UiHolding[])
  "analysis" |      // == clients.analysis jsonb (NormalizedAiAnalysis | null)
  "rothWorksheet" | // == clients.roth_worksheet jsonb (RothWorksheet | null)
  "meetingNotes" |
  "fiaWorksheet"    // == clients.client.fiaWorksheet (nested in intake)
]

sort: "review-due-asc" | "aum-desc" | "name-asc" | "last-contact-desc" | "next-meeting-asc"
```

#### `tasks`

```jsonc
filters: {
  clientId:    "uuid" | null,
  status:      "open" | "in_progress" | "done" | "cancelled",
  priority:    "High" | "Medium" | "Low",
  due:         "today" | "week" | "overdue",
  dueBefore:   "YYYY-MM-DD",
  dueAfter:    "YYYY-MM-DD",
  tags:        string[],                              // ANY match
  ownerEmail:  string,
  visibility:  "private" | "shared" | "organization",
}
sort: "due-asc" | "priority-desc" | "created-desc"
```

#### `notes`

```jsonc
filters: {
  clientId: "uuid",                                    // required for most queries (notes are always client-scoped)
  pinned:   boolean,
  source:   "manual" | "voice_agent" | "meeting_recap",
  authorEmail: string,
  since:    "ISO datetime",
  search:   string,                                    // substring on body
  tags:     string[],
}
sort: "pinned-then-recent" | "created-desc"
```

#### `activity`

```jsonc
filters: {
  clientId: "uuid",
  type:     "note" | "meeting" | "document" | "email" | "call" | "task" | "analysis" | "system",
  since:    "ISO datetime",
  actorEmail: string,
  source:   "activity_log" | "audit_event",
  limit:    integer (default 50, max 200, passed straight to list_visible_activity's limit_n)
}
```

(No sort — `list_visible_activity` always returns newest-first.)

#### `documents`

```jsonc
filters: {
  clientId:          "uuid",
  source:            string,                          // 'advisor_upload', 'client_upload', 'generated_client_snapshot', 'generated_report', etc.
  includeStatements: boolean,                         // default false — mirrors /api/documents:24-29
  status:            string,                          // 'uploaded', 'processing', 'extracted', 'complete'
  since:             "ISO datetime",
  mimeType:          string,
  sha256:            string,                          // for dedup
}
```

#### `reports`, `research_jobs`, `advisor_profile`, `enrichment_cache`

`reports` per-entity filters: `clientId`, `visibility`, `tags`, `status` (draft/published/archived), `since`. Defined alongside the write tool in §7.
`research_jobs`: filters `status` (queued/running/complete/error), `tier`, `since`. Sort `created-desc`.
`advisor_profile`: single-row entity — no filters, just returns the signed-in advisor's row.
`enrichment_cache`: filters `ticker`, `cusip`, `figi`, `since`, `provider`.

### 3.4 `aggregate` — the JSONB-aware DSL

This is what separates the AdvisorPilot tool from a generic CRUD wrapper. The advisor asks "what's my AUM by stage?" or "how many of my clients have a red flag mentioning 'concentrated'?" — and the executor compiles that into a single Postgres call.

**Tool argument shape:**

```jsonc
{
  "operation": "aggregate",
  "entity":    "clients",
  "groupBy":   "stage",                                // OR a JSONB-path token (see below)
  "aggregates": [
    { "fn": "sum",   "field": "total_value", "as": "aum" },
    { "fn": "count", "as": "n" },
    { "fn": "avg",   "field": "intake.age",  "as": "avg_age" }    // JSONB path notation
  ],
  "filters":   { "stage": "Review due" }
}
```

**Group-by allowlist** (per entity — extends what was in v1 of this doc):

| Entity            | groupBy tokens                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `clients`         | `stage`, `status`, `owner_email`, `review_month`, `inception_year`, `intake.riskProfile`, `intake.federalTaxBracket`, `intake.calibration`, `intake.married`, `intake.takingSocialSecurity`, `analysis.hasRedFlags`, `analysis.hasAnalysis`, `holdings.dominant_asset_class`, `tags[]` (one row per tag), `account_count_bucket` ("0", "1", "2-3", "4+") |
| `tasks`           | `status`, `priority`, `client_id`, `due_week`, `is_overdue`, `tags[]`                                     |
| `notes`           | `client_id`, `source`, `pinned`, `created_week`, `author_email`, `tags[]`                                 |
| `activity`        | `type`, `client_id`, `actor_email`, `occurred_week`, `occurred_month`, `source`                           |
| `documents`       | `source`, `client_id`, `status`, `mime_type`, `created_month`                                             |
| `reports`         | `client_id`, `visibility`, `tags[]`, `generated_by_provider`, `created_month`                             |

**JSONB-path notation in `groupBy` and `aggregates.field`:** dotted paths are translated by the executor to Postgres jsonb operators:

- `intake.age`                   → `(c.client ->> 'age')::numeric`
- `intake.riskProfile`           → `c.client ->> 'riskProfile'`
- `intake.married`               → `(c.client ->> 'married')::boolean`
- `intake.fiaWorksheet.carrierName` → `c.client #>> '{fiaWorksheet,carrierName}'`
- `analysis.hasRedFlags`         → `(c.analysis ? 'redFlags') AND jsonb_array_length(c.analysis -> 'redFlags') > 0`
- `holdings.value` (in sum/avg)  → `(SELECT sum((h ->> 'value')::numeric) FROM jsonb_array_elements(c.holdings) h)`
- `holdings.dominant_asset_class`→ a CTE the executor expands; returns the asset class with the largest sum within each row's holdings array

**New SQL function** (lands in `_apply_crm_phase3_migrations.sql`):

```sql
create or replace function public.query_crm_aggregate(
  viewer_email text,
  entity text,                                  -- 'clients'|'tasks'|'notes'|'activity'|'documents'|'reports'|'memories'|'intel'
  group_by text default null,                   -- per-entity allowlist incl. dotted JSONB paths
  aggregates jsonb default '[]'::jsonb,         -- [{fn, field?, as}, ...]
  filters jsonb default '{}'::jsonb,            -- per-entity filter map (mirrors §3.3)
  limit_n integer default 1000
)
returns table (
  bucket text,
  metrics jsonb
)
language plpgsql stable
security invoker
as $$
declare
  v_visible_set_sql text;
  v_group_expr text;
  v_select_metrics text;
  v_filters_where text;
  v_sql text;
begin
  if entity not in (
    'clients','tasks','notes','activity','documents','reports'
  ) then
    raise exception 'query_crm_aggregate: invalid entity %', entity;
  end if;

  -- Visibility CTE
  v_visible_set_sql := public._qcrm_visible_set_sql(viewer_email, entity);
  -- groupBy → Postgres expression (validates path against the per-entity allowlist)
  v_group_expr      := public._qcrm_build_group_expr(entity, group_by);
  -- aggregates → SELECT list emitting one jsonb object per row of metrics
  v_select_metrics  := public._qcrm_build_aggregate_metrics(entity, aggregates);
  -- filters → WHERE fragment (values bound, not interpolated)
  v_filters_where   := public._qcrm_build_filter_where(entity, filters);

  v_sql := format(
    'with visible as (%s) ' ||
    'select %s::text as bucket, %s as metrics ' ||
    'from visible src %s group by %s ' ||
    'order by 1 nulls last limit %s',
    v_visible_set_sql,
    v_group_expr,
    v_select_metrics,
    v_filters_where,
    v_group_expr,
    greatest(coalesce(limit_n, 1000), 1)
  );

  return query execute v_sql;
end;
$$;

grant execute on function public.query_crm_aggregate(text, text, text, jsonb, jsonb, integer)
  to anon, authenticated, service_role;
```

Four private helper functions (`_qcrm_visible_set_sql`, `_qcrm_build_group_expr`, `_qcrm_build_aggregate_metrics`, `_qcrm_build_filter_where`) enforce the per-entity allowlists. They only emit SQL constructed from validated identifier tokens; filter VALUES are bound through jsonb operators (`filters ->> 'stage'`, etc.) never string-interpolated. Adversarial input to `filters` is structurally inert.

### 3.5 `path` — surgical JSONB read

When the LLM only needs one field, it shouldn't have to pull a 50KB `get`. The `path` operation:

```jsonc
{
  "operation": "path",
  "entity":    "clients",
  "id":        "uuid",
  "paths":     [
    "intake.spouseFirstName",
    "intake.fiaWorksheet.carrierName",
    "analysis.redFlags",
    "holdings[0].enrichmentResolvedTicker",
    "holdings[*].value"            // array projection — returns numeric[] of every holding's value
  ]
}
```

Backed by a Postgres function that uses `jsonb_path_query` for `[*]` paths and `#>>` for scalar paths. Returns:

```jsonc
{
  "id": "...",
  "values": {
    "intake.spouseFirstName": "Margaret",
    "intake.fiaWorksheet.carrierName": "Athene",
    "analysis.redFlags": ["Concentrated in US large-cap (62%)", "..."],
    "holdings[0].enrichmentResolvedTicker": "SPY",
    "holdings[*].value": [125000, 87500, 42000, ...]
  }
}
```

This is the LLM's surgical instrument for "what's John's wife's name?" without a 4-second round trip.

### 3.6 Real-world compound queries the LLM will write

These are the patterns the system prompt teaches by example — and what the executor needs to handle gracefully.

**Patterns the read DSL is built for:**

1. *"Who's overdue for a review with high AUM?"* → `list:clients` filtered `{ stage: "Review due", minAum: 500000 }` sorted `review-due-asc`.
2. *"What's my total AUM by stage?"* → `aggregate:clients` groupBy `stage` aggregates `[{fn:sum, field:total_value, as:aum}]`.
3. *"How many clients hold SPY?"* → `aggregate:clients` filters `{ holdsTicker: "SPY" }` aggregates `[{fn:count, as:n}]` no groupBy.
4. *"Average client age by risk profile"* → `aggregate:clients` groupBy `intake.riskProfile` aggregates `[{fn:avg, field:intake.age, as:avg_age}, {fn:count, as:n}]`.
5. *"My overdue tasks this week, grouped by client"* → `aggregate:tasks` filters `{ due: "overdue" }` groupBy `client_id`.
6. *"What's John's wife's name?"* → `path:clients id=<johnId> paths=["intake.spouseFirstName","intake.spouseLastName"]`.
7. *"Show me the bottom 5 holdings by AUM for client X"* → `path:clients id=X paths=["holdings[*].value","holdings[*].enrichmentResolvedTicker"]` + sort in TS, OR `compute:bottom_holdings clientId=X n=5` (see §4).
8. *"Find clients who have an enrichmentNeedsReview=true holding"* → `list:clients` filters `{ holdingsNeedReview: true }`.
9. *"What red flags do my clients have in common?"* → `list:clients` select `["id","firstName","lastName","analysis"]`, then the LLM dedupes red flags client-side OR (better) we add `aggregate:clients` with a special `redFlagsByPhrase` synthetic groupBy that uses `jsonb_array_elements_text(analysis -> 'redFlags')` + `to_tsvector` clustering. Phase 3 polish.
10. *"All meetings I had last quarter"* → `list:activity` filters `{ type: "meeting", since: "2026-01-01" }`.

### 3.7 Executor sketch

```ts
// lib/llm/chat/tools/query-crm.ts
import { getCrmSupabaseAdmin } from "@/lib/crm/supabase-admin";
import { toRosterItem, toClientDetail } from "@/lib/crm/clients-mapper";
import { toTask } from "@/lib/crm/task-mapper";
import { toNote } from "@/lib/crm/note-mapper";
import { toDocument } from "@/lib/crm/document-mapper";
import { toActivityEntry } from "@/lib/crm/activity-adapter";
import type { ChatTool, ChatToolContext, ChatToolResult } from "./types";

export const queryCrm: ChatTool = {
  name: "query_crm",
  // ...full description per §3.1-3.5...
  async executor(args, ctx): Promise<ChatToolResult> {
    const op = String(args.operation);
    const entity = String(args.entity);
    const supabase = getCrmSupabaseAdmin();

    switch (`${op}:${entity}`) {
      case "list:clients":  return listClients(supabase, ctx, args);
      case "list:tasks":    return listTasks(supabase, ctx, args);
      case "list:notes":    return listNotes(supabase, ctx, args);
      case "list:activity": return listActivity(supabase, ctx, args);
      case "list:documents":return listDocuments(supabase, ctx, args);
      case "list:reports":  return listReports(supabase, ctx, args);
      case "list:research_jobs":  return listResearchJobs(supabase, ctx, args);
      case "list:enrichment_cache": return listEnrichmentCache(supabase, ctx, args);

      case "get:clients":         return getClient(supabase, ctx, args);    // returns ClientDetail with ALL jsonb
      case "get:tasks":           return getTask(supabase, ctx, args);
      case "get:notes":           return getNote(supabase, ctx, args);
      case "get:documents":       return getDocument(supabase, ctx, args);
      case "get:reports":         return getReport(supabase, ctx, args);
      case "get:advisor_profile": return getAdvisorProfile(supabase, ctx);
      case "get:research_jobs":   return getResearchJob(supabase, ctx, args);

      case "aggregate:clients":
      case "aggregate:tasks":
      case "aggregate:notes":
      case "aggregate:activity":
      case "aggregate:documents":
      case "aggregate:reports":
        return runAggregate(supabase, ctx, entity, args);

      case "search:clients":
      case "search:notes":
      case "search:tasks":
      case "search:reports":
        return runSearch(supabase, ctx, entity, args);

      case "path:clients":
      case "path:reports":
        return runJsonbPath(supabase, ctx, entity, args);

      default:
        return { success: false, error: `Unsupported ${op}:${entity}` };
    }
  },
};
```

Each `list*` / `get*` helper is ~40 LOC — the same pattern the existing API routes use, called as a function (`listClients(...)`) instead of an HTTP handler.

`get:clients` (specifically) is **not** filtered. It returns the entire row, including `client.client` (intake jsonb), `client.holdings` (UiHolding[]), `client.analysis` (NormalizedAiAnalysis), `client.rothWorksheet`, `client.meetingNotes`. The LLM gets everything the human advisor sees. This is the Rule 1 commitment.

---

## 4 · `compute_*` — derived projections

> **For the implementation of every projection (`buildAllocationSummary`, `buildHoldingsBreakdown`, etc.) including the source line numbers and a worked end-to-end trace, see [75-database-tools.md §7](./75-database-tools.md#7--worked-end-to-end-trace).**

The advisor's UI computes a dozen derived metrics on read (`aum` from summing holdings, `accountsCount` from distinct account numbers, `allocationSummary` from bucketing holdings, etc.). The LLM shouldn't have to redo any of that math — `compute` exposes the existing helpers as one tool.

```jsonc
{
  "name": "compute",
  "parameters": {
    "operation": "allocation_summary"
                | "holdings_breakdown"
                | "accounts_summary"
                | "fee_breakdown"
                | "retirement_readiness"
                | "concentration_risk"
                | "asset_class_drift"
                | "income_summary"
                | "tax_bracket_summary"
                | "advisor_overview",
    "clientId":  "uuid",                          // required for client-scoped ops; null for advisor-scoped
    "params":    { ... }                          // op-specific
  }
}
```

| Operation               | Returns                                                                                                              | Implementation                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `allocation_summary`    | `{ clientId, totalValue, buckets: [{name, valueUsd, weightPct}] }`                                                   | `buildAllocationSummary` in `lib/voice/page-helpers.ts:96-117` — **moved/exported to `lib/crm/projections.ts` so both voice + chat share it** |
| `holdings_breakdown`    | `{ clientId, totalValue, holdingCount, topPositions: [{ticker, name, assetClass, valueUsd, weightPct}] }`            | `buildHoldingsBreakdown` in `lib/voice/page-helpers.ts:71-90`                                               |
| `accounts_summary`      | `[{ accountNumber, registrationType, totalValue, holdingCount }]` sorted by totalValue desc                          | `summarizeAccounts` in `components/crm/overview/accounts-card.tsx:71-91` — move to `lib/crm/projections.ts` |
| `fee_breakdown`         | Per-fund expense ratios + advisor-fee impact + weighted blended cost                                                 | Calls `/api/fee-analysis` internally (Same shape as `FeeAnalysisApiResponse` from `lib/fee-analysis.ts:83`) |
| `retirement_readiness`  | Income-readiness score (0-100) + components + flagged shortfalls                                                     | NEW helper consolidating the math currently scattered across the legacy app page                            |
| `concentration_risk`    | Top single-position weight, top sector weight, single-issuer overlap                                                 | NEW helper                                                                                                  |
| `asset_class_drift`     | Current vs target allocation per bucket; flag drift > N%                                                             | NEW helper (uses target risk profile from `intake.riskProfile` against `RISK_PROFILES` table)               |
| `income_summary`        | Annual after-tax need vs estimated portfolio income (interest + dividends + SS) + gap                                | NEW helper                                                                                                  |
| `tax_bracket_summary`   | Current federal bracket + estimated AGI from intake + headroom inside bracket                                        | NEW helper                                                                                                  |
| `advisor_overview`      | Snapshot of the SIGNED-IN ADVISOR: client count, total AUM, by-stage breakdown, overdue review count, open task count, recent activity count | NEW — composes 5+ `aggregate:clients`/`tasks`/`notes` calls and presents one summary blob                  |

**Why this isn't part of `query_crm`:** `query_crm` is generic SQL-ish stuff. `compute` is named, opinionated, business-logic helpers that match what the UI shows. The LLM should reach for `compute` first ("get this client's allocation"), and only fall back to `query_crm` + custom math when no `compute` op fits.

**Tool description tells the LLM exactly when to use each:**

```
Use `compute` for any "what's this client's X" question that has a UI equivalent.
Use `query_crm:get` to fetch the raw row and reason about fields the UI doesn't surface.
Use `query_crm:aggregate` for cross-client analytics ("AUM by stage").
Use `query_crm:path` for surgical single-field reads ("what's John's wife's first name?").
```

---

## 5 · Writes — `manage_note`, `manage_task`, `manage_client`

Three compound tools mirror the three write surfaces the existing API exposes. Each tool's executor uses the SAME helper functions the API routes use — both call into shared `lib/crm/server/*.ts` modules that we extract out of the route bodies in Phase 1.

### 5.1 `manage_note`

```jsonc
{
  "name": "manage_note",
  "parameters": {
    "operation":  "create" | "update" | "delete" | "pin" | "unpin",
    "noteId":     "uuid",                                // required for update/delete/pin/unpin
    "clientId":   "uuid",                                // required for create
    "body":       "string",                              // required for create
    "tags":       ["string"],
    "pinned":     boolean,
    "source":     "manual" | "voice_agent" | "meeting_recap",   // default "manual"
    "visibility": "private" | "shared" | "organization",        // default "private"
    "_confirmed": boolean                                       // required for delete (T4)
  }
}
```

**Side effects on `create` (same as POST /api/notes):**

- Inserts into `advisorpilot_activity_log` via `writeActivityLog` (`lib/crm/activity-writer.ts`).
- Bumps `advisorpilot_clients.last_contacted_at` via `bumpLastContactedAt` (a note is a touchpoint).
- Visibility-gated via `clients_visible_to` for the parent client (404 not-visible).
- Inherits `org_id` from the client; falls back to `ensurePersonalOrg(advisorEmail)`.

The executor's logic is *the body of `POST /api/notes`* (`app/api/notes/route.ts:117-227`) extracted into a function `createNote(identity, input)`. The route handler becomes a thin wrapper that validates body shape and calls `createNote`; the chat tool calls the same `createNote` directly. No internal HTTP fetch.

### 5.2 `manage_task`

```jsonc
{
  "name": "manage_task",
  "parameters": {
    "operation":   "create" | "update" | "delete" | "complete" | "reopen",
    "taskId":      "uuid",
    "clientId":    "uuid" | null,                        // null = personal task
    "title":       "string",
    "description": "string",
    "dueDate":     "YYYY-MM-DD",
    "dueTime":     "HH:MM",
    "priority":    "High" | "Medium" | "Low",
    "status":      "open" | "in_progress" | "done" | "cancelled",
    "tags":        ["string"],
    "reminderAt":  "ISO datetime",
    "visibility":  "private" | "shared" | "organization",
    "_confirmed":  boolean
  }
}
```

Same extraction pattern as `manage_note`. `create` mirrors `POST /api/tasks` (`app/api/tasks/route.ts:108-212`) including the visibility gate + org inheritance + activity_log side effect.

### 5.3 `manage_client`

T3-and-above tool that updates the CRM-only top-level columns on `advisorpilot_clients`. It **does NOT touch the intake JSONB** (`client`), **holdings JSONB**, **analysis JSONB**, or **roth_worksheet JSONB** — those are owned by the existing wizard / extractor / generate-analysis routes. The agent can READ all of them via `query_crm`, but it can only WRITE the CRM-shell columns (stage, tags, location, contact info, review_due_at, next_meeting_at, etc.).

```jsonc
{
  "name": "manage_client",
  "parameters": {
    "operation":    "update",                            // only "update" in v1; "create" stays in the intake flow
    "clientId":     "uuid",                              // required
    "stage":        "Review due" | "Upcoming" | ...,
    "status":       "string",
    "tags":         ["string"],
    "location":     "string",
    "email":        "string",                            // client's email (not advisor's)
    "phone":        "string",
    "householdLabel":"string",
    "nextMeetingAt":"ISO datetime",
    "reviewDueAt":  "YYYY-MM-DD",
    "ownerInitials":"string",
    "inceptionYear":integer,
    "ytdReturn":    number,
    "visibility":   "private" | "shared" | "organization",
    "_confirmed":   boolean                              // required for stage changes that downgrade
  }
}
```

Same extraction pattern. Mirrors `PATCH /api/clients/[id]` (`app/api/clients/[id]/route.ts:192-260`+).

**Why `_confirmed` for some `update` calls:** the existing PATCH route accepts the change blindly; the chat tool adds a soft guard — if the operation would downgrade `stage` from `Review due` → `Stable` (i.e., mark the client as no-longer-needing review without actually doing one), the executor returns a preview and waits for `_confirmed: true`. This is a tool-level UX safety net, not an RLS thing.

---

## 6 · `run_*` — kicking off existing AI surfaces

Four wrappers turn AdvisorPilot's existing AI routes into chat-callable tools. They don't reimplement anything — they POST to the existing route with the right body, get back the same JSON the UI gets, and return it to the LLM.

### 6.1 `run_analysis`

```jsonc
{
  "name": "run_analysis",
  "parameters": {
    "clientId":   "uuid",                                // required
    "persist":    boolean                                // default true — writes result back to clients.analysis JSONB
  }
}
```

**Implementation:** loads the client via `query_crm:get`, calls `POST /api/generate-analysis` with the client + holdings + allocation + totalValue body the route expects (`app/api/generate-analysis/route.ts:7-80`), returns `{ analysis: NormalizedAiAnalysis, durationMs, provider, model }`. If `persist`, writes the result back to `advisorpilot_clients.analysis` via the service-role client.

T2 — non-destructive (worst case: re-runs the analysis the advisor already ran in the UI), but expensive enough to confirm at the chat-runner level if the chat-runner gets a budget-warning system later.

### 6.2 `run_fee_analysis`

```jsonc
{
  "name": "run_fee_analysis",
  "parameters": {
    "clientId":         "uuid",
    "advisorFeeAnnual": number,                          // 0.0 - 0.2 (matches /api/fee-analysis validation)
  }
}
```

**Implementation:** loads holdings, calls `POST /api/fee-analysis` (`app/api/fee-analysis/route.ts:36-80+`), returns the `FeeAnalysisApiResponse` shape (`lib/fee-analysis.ts:83`). Pure read — T1.

### 6.3 `run_enrich_holdings`

```jsonc
{
  "name": "run_enrich_holdings",
  "parameters": {
    "clientId":      "uuid",
    "tickers":       ["string"],                         // optional — defaults to all holdings needing enrichment
    "forceRefresh":  boolean                             // default false — bypass the enrichment cache
  }
}
```

**Implementation:** calls `POST /api/enrich-holdings`. T2.

### 6.4 `run_deep_research`

```jsonc
{
  "name": "run_deep_research",
  "parameters": {
    "user":             "string",                        // required — research prompt
    "knownUrls":        ["string"],
    "allowedDomains":   ["string"],
    "blockedDomains":   ["string"],
    "includeSocialSignals": boolean,                     // Grok-only
    "jsonSchema":       object                           // optional — structured JSON response
  }
}
```

**Implementation:** calls `POST /api/research/start` (`app/api/research/start/route.ts:32-81`). Returns `{ jobId, status }`. The LLM polls via `query_crm({ entity: "research_jobs", operation: "get", id: jobId })` until `status === 'complete'`, then reads `result` jsonb.

T2 — non-destructive but cost-bearing (Deep Research is expensive). The tool description tells the LLM to **confirm scope in plain language with the advisor** before kicking off a deep-research job ("This will take 5–60 minutes and search up to 25 sources — should I proceed?").

---

## 7 · `manage_report` + `generate_report_content` — the report surface

This is the upgraded report tool. v1's plan had 6 operations; we now adopt **all 13 of Control Tower's operations** including line-level editing, version history, and `embed_image`. The advisor's CRM is exactly the kind of surface where "edit paragraph 3 of last Tuesday's report" is a daily request.

### 7.1 `manage_report` — 13-operation compound tool

```jsonc
{
  "name": "manage_report",
  "parameters": {
    "operation":
        "list" | "get" | "create" | "update" | "delete" | "duplicate" |
        "get_lines" | "insert_lines" | "replace_lines" | "delete_lines" |
        "list_versions" | "restore_version" | "embed_image",

    "reportId":         "uuid",                          // required for most ops
    "clientId":         "uuid" | null,                   // link the report to a client (or null = standalone)
    "title":            "string",                        // for create/update
    "content":          "string",                        // markdown body for create/update/insert_lines/replace_lines
    "tags":             ["string"],
    "visibility":       "private" | "shared" | "organization",
    "icon":             "string",                        // emoji, default 📄
    "color":            "string",                        // accent
    "status":           "draft" | "published" | "archived",
    "saveVersion":      boolean,                         // create a version snapshot (default true for line edits)
    "versionDescription":"string",

    // Line-level (1-indexed; atLine: -1 to append)
    "startLine":        integer,
    "endLine":          integer,
    "atLine":           integer,

    // Version
    "versionId":        "uuid",

    // embed_image
    "prompt":           "string",
    "caption":          "string",
    "aspectRatio":      "16:9" | "4:3" | "1:1",
    "style":            "string",

    "_confirmed":       boolean                          // for delete
  }
}
```

**Why line-level editing matters for AdvisorPilot:** advisor reports are reread, edited, and reshared. "Update the Q2 review I sent John last week — replace the AUM section with the May 31 numbers" is a real workflow. Without line-level editing, the LLM would have to re-emit the entire 30-section report — wasting tokens, risking drift in the unchanged sections.

**The executor returns the full report content with line numbers** after every line-level edit (mirrors CT `report-manage.ts:35-45 → formatWithLineNumbers`). The LLM uses that to verify the edit took, then plans the next edit against the NEW line numbers.

### 7.2 `generate_report_content` — markdown generator with embedded charts/maps

> **Shipped — PR 10 (May 2026).** The implementation is in `lib/llm/chat/tools/generate-report-content.ts` + the prompt builder in `lib/llm/chat/report-author-prompt.ts`. The shipped surface is narrower than the original design sketch below — see the "What actually shipped" callout at the end of this section for the diff. The original design language is kept as the long-term roadmap.

Same shape as v1 of this doc, but the system prompt now explicitly teaches all FOUR rich-content conventions (was three): `chart:chartjs`, `chart:echarts`, `mermaid` fenced blocks, plus the `embed_image` operation on `manage_report` for AI-generated images inserted at a line number. (Google Maps blocks are NOT in scope — AdvisorPilot doesn't have a Google Maps API key. See §8.)

```jsonc
{
  "name": "generate_report_content",
  "parameters": {
    "instruction": "string",                             // the advisor's request, verbatim
    "style":       "executive" | "advisor-deep-dive" | "client-friendly" | "internal-memo",
    "sections":    ["string"],                           // optional outline; model picks if omitted
    "context":     {},                                   // the data the LLM gathered via query_crm/compute
    "includeCharts":   boolean,                          // default true
    "includeDiagrams": boolean,                          // default false — for process diagrams
    "maxOutputTokens": integer                           // default 4000
  }
}
```

**Returns `{ markdown: string }`.** The orchestrator's next move is typically `manage_report({ operation: "create" })` to persist it; the LLM may instead show the draft to the advisor first ("here's a draft — should I save it?").

**What actually shipped (PR 10):**

The shipped surface differs from the v1 sketch above in three pragmatic ways:

| Item                  | Sketch (above)                                                                                                                                | Shipped                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Tool returns          | `{ markdown }` (caller persists via `manage_report.create`)                                                                                   | `{ reportId, title, status: 'draft', contentLength, contentPreview }` — the tool persists itself. Two LLM round-trips collapse to one (`generate_report_content` → done).                                                                       |
| Args                  | `instruction`, `style`, `length`, `audience`, `embedded_charts`, `embedded_maps`, `embedded_diagrams`, …                                       | `title`, `reportType`, `prompt`, optional `clientId`/`sections`/`audience`/`sourceData`/`tags`/`visibility`/`icon`. The author prompt teaches the chart contract; the LLM decides when to embed.                                                |
| Map blocks             | Spec'd to forbid them in the system prompt; renderer is supposed to error on `map:google`                                                     | Same outcome — system prompt forbids them. (No code path emits or renders them.)                                                                                                                                                                |
| Mermaid + ECharts      | Spec'd as taught to the author                                                                                                                | Author prompt FORBIDS both — deferred until the matching block renderers ship (§B.15 only ships `chart:chartjs` in v1). Adding them is a one-line change in `lib/markdown/fence-tokenizer.ts` + a renderer + a one-line prompt edit.            |
| Streaming back to UI   | Implicit (author runs to completion before returning)                                                                                          | Same — tool runs to completion. Future: emit `tool_call_done.result.contentPartial` events to stream the markdown into the chat in flight. Filed as a follow-up; not blocking.                                                                  |
| Provider selection     | Implicit (use whatever provider is configured)                                                                                                 | Explicit — `ChatToolContext.selection` is threaded from the chat-runner and passed to the nested `streamChat()` call. Author runs on the SAME provider + model the advisor configured for chat.                                                 |
| Session isolation      | Not addressed                                                                                                                                  | `sessionId = "report:<conv>:<nonce>"` so the OpenAI Responses-API adapter cache for the outer chat isn't polluted. Two parallel author runs don't collide.                                                                                       |

Full design walkthrough lives in [60-§B.21a](./60-chat-orchestrator.md#b21a-spotlight--generate_report_content-pr-10).

### 7.3 The advisor's typical workflow (illustrated, end-to-end)

```
USER:    "Write me a Q2 review for John Smith and save it."

A:
  → query_crm({ operation: "get", entity: "clients", id: "<johnId>" })
  ← { id, client (intake), holdings (50 entries), analysis (5 red flags + 7 recs), rothWorksheet, meetingNotes, ... }

  → compute({ operation: "allocation_summary", clientId: "<johnId>" })
  ← { totalValue: 1_420_000, buckets: [{ name: "Equity", valueUsd: ..., weightPct: 62.1 }, ...] }

  → compute({ operation: "asset_class_drift", clientId: "<johnId>", params: { vs: "intake.riskProfile" } })
  ← { driftedBuckets: [{ name: "International", current: 8.2, target: 18.0, deltaPct: -9.8 }, ...] }

  → query_crm({ operation: "list", entity: "activity",
                filters: { clientId: "<johnId>", since: "2026-04-01" }, limit: 50 })
  ← { rows: [...30 activity entries...] }

  → query_crm({ operation: "list", entity: "notes",
                filters: { clientId: "<johnId>", pinned: true } })
  ← { rows: [3 pinned notes] }

  → generate_report_content({
      instruction: "Q2 2026 portfolio review for John Smith. Cover allocation, drift vs target, "
                 + "notable activity, action items.",
      style: "advisor-deep-dive",
      sections: ["Summary", "Allocation", "Drift + rebalance proposal", "Notable activity", "Action items"],
      context: { client: {...}, allocation, drift, activity, pinnedNotes },
      includeCharts: true
    })
  ← { markdown: "*Q2 2026 review for John Smith.*\n\n## Summary\n\nAUM ...\n\n```chart:chartjs\n{...allocation bar...}\n```\n\n## Allocation\n..." }

  → manage_report({
      operation:   "create",
      clientId:    "<johnId>",
      title:       "Q2 2026 Review — John Smith",
      content:     "<the markdown from above>",
      tags:        ["q2", "review", "2026"],
      visibility:  "private",
      saveVersion: true
    })
  ← { reportId: "rpt_...", url: "/app/reports/rpt_..." }

  → assistant text:
    "Done. Saved 'Q2 2026 Review — John Smith' to your Reports archive.

     **Highlights I flagged in the report**

     - AUM $1.42M, up 4.1% YTD
     - International equity is 9.8 percentage points UNDER target — rebalance proposal included
     - Pinned-note action: 529 conversation for daughter (started Fall 2027) — added as task

     [Open the report →](/app/reports/rpt_...)"
```

Seven tool calls, one round of model emission. Total advisor effort: one sentence. This is what the rest of this doc enables.

---

## 8 · Report markdown extensions

The report renderer (§9) consumes standard CommonMark + GitHub-flavored Markdown PLUS five fenced-block extensions. The `generate_report_content` system prompt teaches all five — same conventions Control Tower uses (`server/ai/tools/report-generate.ts:18-172` and `server/ai/tools/report-manage.ts:145-228`).

### 8.1 `chart:chartjs` — Chart.js v4

````md
```chart:chartjs
{
  "type": "bar",
  "data": {
    "labels": ["Equities","Fixed Income","Cash","Alternatives"],
    "datasets": [{
      "label": "Current allocation (%)",
      "data": [62, 25, 8, 5],
      "backgroundColor": ["#163765","#4f7cac","#a8c1e3","#d3dff0"]
    }]
  },
  "options": {
    "plugins": { "title": { "display": true, "text": "Current allocation" } }
  }
}
```
````

Supported types: `bar | line | pie | doughnut | radar | scatter | bubble`.

### 8.2 `chart:echarts` — Apache ECharts (Sankey, heatmap, treemap, etc.)

Use for chart types Chart.js does poorly: `sankey | heatmap | treemap | sunburst | graph | gauge | candlestick`. Income-flow Sankeys, allocation treemaps, household-relationship network graphs.

### 8.3 `mermaid` — process diagrams + ERDs + Gantt

Supported: `flowchart | sequenceDiagram | erDiagram | gantt | journey | pie`. Useful for advisor reports as "decision tree for the Roth conversion" or "review meeting prep sequence."

### 8.4 `embed_image` (operation on `manage_report`, not a fenced block)

Generates an AI image via OpenAI / Gemini image gen and inserts `![caption](signed_url)` at a specific line. Useful for "concept illustration" reports (e.g., a diagram of "the three-bucket retirement strategy"). Image bytes go to Supabase Storage (the same `advisorpilot-statements` bucket under `reports/{owner}/embedded/{ts}.png`); the markdown URL is signed and refreshed by the renderer.

Phase 7 work — requires picking an image-gen provider (OpenAI `gpt-image-1` is the obvious default since we already have OPENAI_API_KEY).

### 8.5 NOT included — `map:google`

Control Tower's `manage_report.description` (`server/ai/tools/report-manage.ts:188-228`) defines a fifth fenced-block extension, `map:google`, for geographic visualizations (markers, paths, circles, directions, boundaries). **AdvisorPilot does not implement this in v1.** Reason: no Google Maps API key is provisioned for the project. The renderer must not silently accept ` ```map:google ` blocks (they'd render as a plain code block and confuse the advisor); instead, the system prompt for `generate_report_content` MUST explicitly forbid the LLM from emitting them. If a future iteration acquires a Maps API key, the integration plan would be a single new dependency (`@vis.gl/react-google-maps`), a new `<GoogleMapBlock />` renderer (~30 LOC), a new env var (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`), and a system-prompt update — small enough that we just write it then, not preemptively.

---

## 9 · The web renderer (`lib/markdown/`)

### 9.1 Dependencies (NEW)

```jsonc
// package.json additions
{
  "dependencies": {
    "react-markdown":          "^10.x",
    "remark-gfm":              "^4.x",
    "chart.js":                "^4.x",
    "react-chartjs-2":         "^5.x",
    "echarts":                 "^6.x",
    "echarts-for-react":       "^4.x",
    "mermaid":                 "^11.x"
  }
}
```

`recharts: ^2.15.4` is already installed and stays for the existing chart components (`components/fia-scenario-return-chart.tsx`, `components/retirement-income-analysis-chart.tsx`, `components/crm/overview/current-allocation-card.tsx`) — we don't migrate those. Two chart libraries living side-by-side is fine; the report renderer's bundle splits per route.

### 9.2 Component structure

```
lib/markdown/
├── report-renderer.tsx         # <ReportRenderer markdown={...} />
├── chart-theme.ts              # AdvisorPilot brand defaults for all three libraries
└── blocks/
    ├── chartjs-block.tsx       # ```chart:chartjs → <Chart {...} />
    ├── echarts-block.tsx       # ```chart:echarts → <ReactECharts option={...} />
    ├── mermaid-block.tsx       # ```mermaid → mermaid.run()
    └── error-fallback.tsx      # Shared "render failed" badge with raw JSON visible
```

Each block component is ~30 LOC: parse JSON, try-catch, render. On parse error, render `<ErrorFallback>` with the raw JSON in a copy-friendly `<pre>` — never break the whole report.

If the renderer encounters a fence language it doesn't recognize (e.g. ` ```map:google ` from a stray LLM emission), it falls through to the default `<pre><code>` branch — visible to the advisor as a plain code block so the bad content is obvious, not silently dropped.

### 9.3 Lazy loading

The three block renderers are lazy-loaded:

```tsx
const ChartjsBlock = lazy(() => import("./blocks/chartjs-block"));
const EchartsBlock = lazy(() => import("./blocks/echarts-block"));
const MermaidBlock = lazy(() => import("./blocks/mermaid-block"));
```

A report containing only Chart.js never downloads ECharts (~800 KB minified) or Mermaid (~250 KB).

### 9.4 Brand theme

```ts
// lib/markdown/chart-theme.ts
import { defaults } from "chart.js";

export const AP_BRAND_PALETTE = [
  "#163765",  // ap-navy
  "#4f7cac",  // ap-royal
  "#a8c1e3",  // ap-light-blue
  "#22a06b",  // ap-green
  "#d97706",  // ap-amber
  "#dc2626",  // ap-red
];

defaults.color           = "#0f172a";
defaults.font.family     = "Inter, -apple-system, sans-serif";
defaults.font.size       = 12;
defaults.plugins.legend.position = "bottom";
```

Mermaid: `mermaid.initialize({ theme: "base", themeVariables: { primaryColor: "#163765", ... }, securityLevel: "strict" })`.
ECharts: register a single theme JSON loaded at module init.

### 9.5 Hardening

- `react-markdown` HTML mode is OFF. No raw HTML in reports.
- Mermaid `securityLevel: 'strict'` — no clickable `javascript:` URLs inside diagrams.
- Chart-block JSON size cap: 50 KB per block (return `<ErrorFallback>` if larger).
- Per-report render cap: 20 chart blocks + 10 mermaid blocks. Beyond that, render "report too dense — open in full screen."

---

## 10 · Persistence — the new Supabase tables

Two new tables (`advisorpilot_reports` and its `*_versions` sidecar). Both follow the same shape as `advisorpilot_notes`: owner_email + owner_user_id + (optional) client_id + org_id + visibility, RLS-on, with a `reports_visible_to(viewer_email, id)` SQL helper and a `list_visible_reports(viewer_email)` function. Same pattern, same `is_org_admin` write override, same `share_grants.entity_type` extension via convention (the column is `text not null` — see `advisorpilot_crm_schema.sql:107` — accepts any value).

### 10.1 `advisorpilot_reports` — markdown report storage + version history

```sql
create table if not exists public.advisorpilot_reports (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,
  client_id uuid references public.advisorpilot_clients(id) on delete set null,
  org_id uuid references public.advisorpilot_organizations(id) on delete set null,
  visibility text default 'private',

  title text not null,
  content text not null,                                -- markdown body
  embedded_media jsonb default '[]'::jsonb,             -- [{ type: 'image', storagePath, caption, atLine }, ...]
  icon text default '📄',
  color text,
  status text default 'draft',                          -- 'draft' | 'published' | 'archived'

  tags jsonb default '[]'::jsonb,
  source text default 'ai_generated',                   -- 'ai_generated' | 'advisor_authored' | 'imported'
  generated_by_model text,
  generated_by_provider text,
  generated_in_conversation_id text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advisorpilot_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.advisorpilot_reports(id) on delete cascade,
  version_number integer not null,
  content text not null,
  embedded_media jsonb default '[]'::jsonb,
  description text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  unique (report_id, version_number)
);

create index if not exists advisorpilot_reports_owner_created_idx
  on public.advisorpilot_reports (owner_email, created_at desc);
create index if not exists advisorpilot_reports_client_created_idx
  on public.advisorpilot_reports (client_id, created_at desc) where archived_at is null;
create index if not exists advisorpilot_reports_org_visibility_idx
  on public.advisorpilot_reports (org_id, visibility);
create index if not exists advisorpilot_report_versions_report_idx
  on public.advisorpilot_report_versions (report_id, version_number desc);

alter table public.advisorpilot_reports enable row level security;
alter table public.advisorpilot_report_versions enable row level security;
-- + reports_visible_to(viewer_email, report_id) helper + list_visible_reports + 4 RLS policies + grants
-- (Same structural pattern as advisorpilot_notes — see _apply_crm_phase0_migrations.sql for the template)
```

### 10.2 Why a separate table (not `advisorpilot_documents`)

`advisorpilot_documents` is shaped for binary files in Supabase Storage: `storage_bucket`, `storage_path`, `mime_type`, `file_size_bytes`, `sha256` (`schema.sql:176-195`). A markdown report is a TEXT blob with structured metadata + version history — fundamentally different. Coercing it into `documents` would force markdown into Storage (or `metadata.content`), block version history on the same row, and confuse the Documents tab (which is already excluded from showing statement uploads — see `app/api/documents/route.ts:24-29`).

A purpose-built table is cleaner. The Documents tab handles uploaded artifacts; the Reports archive handles AI-generated content. The two surfaces link through `client_id` on both.

---

## 11 · Phasing — eight shippable PRs

| Phase | What ships                                                                                                                                                                                                                                                                                                | Gate                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** | `query_crm` with `list:*`, `get:*` (full JSONB on `get:clients`), `path:clients`. No aggregate. Wires through 60's chat runner. Per-entity allowlist enforcement.                                                                                                                                            | Smoke: "what's my client John's wife's name?" → `path:clients` fires → answers from `intake.spouseFirstName`. "Show me my five most overdue tasks" → `list:tasks` filters/sort/paginate. |
| **1** | Extract route handler bodies into `lib/crm/server/{clients,notes,tasks,activity,documents}.ts` reusable functions. Both API routes AND chat tools call them. Adds `manage_note`, `manage_task`, `manage_client` (T2/T3/T4 risk tiers; `_confirmed` flow).                                                       | Advisor: "Log a note on John that he wants to consolidate his late wife's IRA, pin it." → note appears in his Pinned-note card. Activity log shows the entry. `last_contacted_at` bumped. |
| **2** | `compute` tool. Extract `buildAllocationSummary`, `buildHoldingsBreakdown`, `summarizeAccounts` to `lib/crm/projections.ts`. Both voice agent + chat orchestrator use them.                                                                                                                                  | "What's John's allocation?" → `compute({ operation: 'allocation_summary' })` → answers with exact same buckets the Overview card shows.   |
| **3** | `aggregate:*` operations + `query_crm_aggregate` SQL function + 4 helper functions + per-entity allowlists for groupBy / aggregates / filters. `search:*` operations.                                                                                                                                       | "AUM by stage?" "Average client age by risk profile?" "Clients holding SPY?" all answer in under 2 sec.                                    |
| **4** | NEW `advisorpilot_reports` + `advisorpilot_report_versions` tables + helpers + RPCs. NEW `lib/markdown/` with `chart:chartjs` / `chart:echarts` / `mermaid` blocks. NEW Reports tab routes (`/app/reports`, `/app/reports/[reportId]`).                                                                       | Advisor creates a report row via SQL → opens the route → renders correctly with a multi-bucket Chart.js bar chart. Existing /app/reports placeholder is replaced. |
| **5** | `manage_report` (all 13 operations: CRUD + 4 line-level + 2 version + embed_image-placeholder) + `generate_report_content`. End-to-end "write me a Q2 review for John Smith and save it" works. `LlmPass = "report.generate"` lands in `lib/llm/types.ts`. NEW route `app/api/reports/[id]/route.ts` (GET/PATCH/DELETE). | The 7-step illustrative workflow in §7.3 runs end-to-end without manual intervention. Line-edit operation returns numbered content.        |
| **6** | `run_analysis`, `run_fee_analysis`, `run_enrich_holdings`, `run_deep_research` wrappers. Chat-runner gains `query_crm:research_jobs` polling pattern. UI surfaces deep-research jobs in a "Running" pill in the chat widget while a job is queued.                                                                                            | "Refresh John's analysis and tell me what changed." → `run_analysis` fires → diff between old and new analysis surfaced inline.                                          |
| **7** | Report PDF export (`app/api/reports/[id]/pdf/route.ts`) using headless browser to rasterize markdown → PDF. Existing `saveGeneratedPdf` path used for archival in `advisorpilot_documents`. `embed_image` operation on `manage_report` (calls OpenAI `gpt-image-1`). Optional power-user `query_crm_sql({ sql })` SQL escape hatch — gated by `advisor_profile.allow_sql_tool=true` (NEW column). | Generated markdown report → "Download PDF" button works → PDF arrives identical to web view. embed_image inserts a generated image at a line and the report renders it. |

Phases 0–5 are the "ship the orchestrator" set. Phases 6–7 are deepening.

---

## 12 · Self-audit (line-by-line)

Every assertion in this doc that references the AdvisorPilot codebase is verified against today's repo below. **PASS** = exists exactly as referenced. **GAP** = new code this plan introduces (intentional). **REUSE** = existing helper the new code will call.

### 12.1 Visibility helpers + list RPCs

| §             | Asserted                                                                                                            | Verified                                                                                          | Status |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| §3.1, §5      | `clients_visible_to(viewer_email, client_id)`, `tasks_visible_to`, `notes_visible_to`, `is_org_admin`                | `supabase/advisorpilot_rls_helpers.sql:45-180`                                                    | PASS   |
| §3.2          | `list_visible_clients(viewer_email)` returns `setof public.advisorpilot_clients`                                     | `supabase/_apply_crm_phase1_migrations.sql:36-45`                                                  | PASS   |
| §3.2          | `list_visible_tasks` + `list_visible_notes`                                                                          | `supabase/_apply_crm_phase2_migrations.sql:30-58`                                                  | PASS   |
| §3.2          | `list_visible_activity(viewer_email, target_client_id, since_ts, limit_n)` signature                                  | `supabase/_apply_crm_phase1_migrations.sql:71-140`                                                 | PASS   |
| §3.4          | A new function `query_crm_aggregate(viewer_email, entity, group_by, aggregates, filters, limit_n)` lands in `_apply_crm_phase3_migrations.sql` | Does not exist yet.                                                                               | GAP    |
| §3.5          | A new function `query_crm_path(viewer_email, entity, id, paths)` lands alongside `query_crm_aggregate`                | Does not exist yet.                                                                               | GAP    |

### 12.2 Existing entity tables + columns

| §           | Asserted                                                                                                                                                                              | Verified                                                                                                                              | Status |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| §3.2, §3.3  | `advisorpilot_clients` base columns: `id, owner_email, client jsonb, holdings jsonb, meeting_notes text, demo_mode bool, analysis jsonb, total_value numeric, status text, last_contacted_at, owner_user_id, source, roth_worksheet jsonb` | `schema.sql:133-149`                                                                                                                  | PASS   |
| §3.2, §3.3  | `advisorpilot_clients` CRM additive columns: `stage, owner_initials, household_label, tags, location, email, phone, inception_year, next_meeting_at, review_due_at, ytd_return, org_id, visibility` — ALL NULLABLE | `supabase/advisorpilot_crm_schema.sql:237-250`                                                                                         | PASS   |
| §3.2        | `advisorpilot_tasks` shape                                                                                                                                                            | `supabase/advisorpilot_crm_schema.sql:136-154`                                                                                         | PASS   |
| §3.2        | `advisorpilot_notes` shape                                                                                                                                                            | `supabase/advisorpilot_crm_schema.sql:173-187`                                                                                         | PASS   |
| §3.2        | `advisorpilot_activity_log` shape                                                                                                                                                     | `supabase/advisorpilot_crm_schema.sql:203-215`                                                                                         | PASS   |
| §3.2        | `advisorpilot_audit_events` shape (`id, owner_email, actor_email, action, entity_type, entity_id, metadata, created_at`)                                                              | `schema.sql:117-127`                                                                                                                  | PASS   |
| §3.2        | `advisorpilot_documents` shape — and `/api/documents` default-excludes `advisor_upload` + `client_upload` rows                                                                          | `schema.sql:176-195` + `app/api/documents/route.ts:22-29`                                                                              | PASS   |
| §3.2        | `advisorpilot_deep_research_jobs` columns (`id, owner_email, provider, tier, request, status, result, error, external_handle, started_at, completed_at`)                              | `schema.sql:155-170`                                                                                                                  | PASS   |
| §3.2, §6.3  | `advisorpilot_security_enrichment_cache` (PK `lookup_key`, e.g. `sym:SPY` / `figi:...` / `cusip:...`) + `advisorpilot_enrichment_provenance` sidecar (FK `cache_key → cache.lookup_key on delete cascade`) | Cache table at `schema.sql:223-230`; provenance sidecar at `:198-204`; FK at `:488`         | PASS   |
| §3.3, §10   | `advisorpilot_share_grants.entity_type` is `text not null` (no enum constraint) — accepts arbitrary tokens (we add `'report'` by convention without ALTER)                              | `supabase/advisorpilot_crm_schema.sql:105-115`                                                                                          | PASS   |

### 12.3 JSONB shapes the LLM gets to see (Rule 1)

| §           | Asserted                                                                                                            | Verified                                                                                                                                 | Status |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| §3.2, §3.3  | `clients.client` jsonb shape is `IntakeClient` (firstName, lastName, dob, age, federalTaxBracket, adjustedGrossIncomeAnnual, retirementAge, retirementSpendableIncomeAnnual, socialSecurityMonthlyClient, socialSecurityMonthlySpouse, riskProfile, riskIntakeKnown, riskIntakeScreen, riskQuizAnswers, riskQuizStepIndex, riskProfileSuggested, calibration, goal, advisorEmail (which is the CLIENT's email — misleading name), married, spouseFirstName/spouseLastName/spouseDob/spouseAge/spouseRetirementAge, takingSocialSecurity, fiaWorksheet?, persistedAdvisorUi?) | `lib/intake-config.ts:13-62`                                                                                                              | PASS   |
| §3.2, §3.3  | `clients.holdings` jsonb shape is `UiHolding[]` — rawName, suggested, confidence, assetClass, value, status, options, accountNumber, registrationType, costBasis, plus enrichmentResolvedTicker/Name/ShareClass/MappedAssetClass/SourceUrls/Figi/FigiSecurityType/Confidence/IsProprietaryOrThinData/NeedsReview/Notes, plus validationStatus/validationMetadata/duplicateKey/duplicateOfIndex/masterResolvedSymbol/masterResolvedNote | `lib/saved-review-normalize.ts:12-48`                                                                                                     | PASS   |
| §3.2, §3.3  | `clients.analysis` jsonb shape is `NormalizedAiAnalysis` — synopsis, portfolioHighlights, strategies, redFlags, overlapInsights, displayWhatThisMeans, recommendations, talkingPoints, advisorOpeningScript, objectionHandling | `lib/saved-review-normalize.ts:50-61`                                                                                                     | PASS   |
| §3.2        | `clients.roth_worksheet` jsonb shape is `RothWorksheet` — useEntireQualifiedBalance, qualifiedAssetValue, specificConversionAmount, useFixedIndexContract, fic.{carrierName, productName, premiumBonusPct, trailingBonusPct, trailBonusYears, contractEstimatedRateOfReturnPct, maxTaxRatePct, protectInitialInvestment, penaltyFreeWithdrawalPct, surrenderYears} | `lib/roth-worksheet.ts:1-23`                                                                                                              | PASS   |
| §3.2        | `IntakeClient.fiaWorksheet` is `FiaWorksheet \| null` — premiumSource, premiumAmount, registrationPremiumOverride, carrierName, productName, premiumBonusPct, trailingBonusPct, trailBonusYears, contractCapRatePct, penaltyFreeWithdrawalPct, surrenderYears, hasIncomeRider, incomeRiderGuaranteePct, contractEarningsAddToRiderBase, incomeRiderFeePct | `lib/fia-worksheet.ts:3-27` + `lib/intake-config.ts:54`                                                                                  | PASS   |
| §3.3        | Profile facts UI reads from `client.client.age/dob/retirementAge/married/spouseFirstName/spouseLastName/spouseAge/spouseRetirementAge/adjustedGrossIncomeAnnual/federalTaxBracket/retirementSpendableIncomeAnnual/takingSocialSecurity/socialSecurityMonthlyClient/socialSecurityMonthlySpouse/goal/riskProfile/riskProfileSuggested/calibration` and from top-level `relationshipSummary/householdLabel/location/inceptionYear` | `components/crm/overview/profile-facts-card.tsx:103-211`                                                                                  | PASS   |
| §3.3        | Accounts UI groups holdings by `accountNumber` + `registrationType`                                                                                                                  | `components/crm/overview/accounts-card.tsx:71-91`                                                                                          | PASS   |

### 12.4 API routes the tools mirror (extraction targets)

| §         | Asserted                                                                                                                                                                              | Verified                                                                                                                              | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| §3.3, §5.1| `POST /api/notes` flow: validate → `clients_visible_to` gate → inherit org_id (or `ensurePersonalOrg`) → insert → write activity_log (type='note') → bump `clients.last_contacted_at` | `app/api/notes/route.ts:117-227`                                                                                                       | PASS   |
| §3.3, §5.2| `POST /api/tasks` flow: validate → if clientId, `clients_visible_to` gate + inherit org_id from client → insert → write activity_log (type='task')                                     | `app/api/tasks/route.ts:108-212`                                                                                                       | PASS   |
| §5.3      | `PATCH /api/clients/[id]` updates CRM-only top-level columns (stage, tags, location, email, phone, nextMeetingAt, reviewDueAt, ownerInitials, householdLabel, inceptionYear, ytdReturn) — explicitly NOT touching intake/holdings/analysis JSONB | `app/api/clients/[id]/route.ts:163-191` (PATCH docstring lists editable fields exactly)                                               | PASS   |
| §6.1      | `POST /api/generate-analysis` accepts `{ client, holdings, allocation, totalValue, demoMode }`, calls `research()` + `complete()`, returns analysis JSON                              | `app/api/generate-analysis/route.ts:7-80`+                                                                                             | PASS   |
| §6.2      | `POST /api/fee-analysis` accepts `{ accounts: [...], totalValue, advisorFeeAnnual, demoMode }`, returns `FeeAnalysisApiResponse`                                                       | `app/api/fee-analysis/route.ts:36-80`+ and `lib/fee-analysis.ts:83`                                                                    | PASS   |
| §6.4      | `POST /api/research/start` accepts research request, returns `{ jobId, status, job }`                                                                                                  | `app/api/research/start/route.ts:32-81`                                                                                                | PASS   |

### 12.5 Helpers + mappers the tools reuse (no reimplementation)

| §        | Asserted                                                                                                                                | Verified                                                                                                  | Status |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| §3.7     | `lib/crm/supabase-admin.ts` exports `getCrmSupabaseAdmin()` (service-role)                                                              | `lib/crm/supabase-admin.ts:29-44`                                                                          | REUSE  |
| §3.7     | `lib/crm/clients-mapper.ts` exports `toRosterItem` + `toClientDetail`                                                                   | `lib/crm/clients-mapper.ts:71`, `:116`                                                                     | REUSE  |
| §3.7     | `lib/crm/task-mapper.ts` exports `toTask`                                                                                               | `lib/crm/task-mapper.ts:29`                                                                                | REUSE  |
| §3.7     | `lib/crm/note-mapper.ts` exports `toNote`                                                                                               | `lib/crm/note-mapper.ts:25`                                                                                | REUSE  |
| §3.7     | `lib/crm/document-mapper.ts` exports `toDocument`                                                                                       | (referenced from `app/api/documents/route.ts:3`)                                                           | REUSE  |
| §3.7     | `lib/crm/activity-adapter.ts` exports `toActivityEntry`                                                                                  | (referenced from `app/api/activity/route.ts:3-6`)                                                          | REUSE  |
| §4       | `buildAllocationSummary(review)` returns `{ clientId, totalValue, buckets: [{name, valueUsd, weightPct}] }`                              | `lib/voice/page-helpers.ts:96-117`                                                                         | REUSE  |
| §4       | `buildHoldingsBreakdown(review)` returns `{ clientId, totalValue, holdingCount, topPositions: [{ticker, name, assetClass, valueUsd, weightPct}] }` (top-5) | `lib/voice/page-helpers.ts:71-90`                                                                          | REUSE  |
| §4       | `summarizeAccounts(client)` returns `[{accountNumber, registrationType, totalValue, holdingCount}]` sorted desc                          | `components/crm/overview/accounts-card.tsx:71-91`                                                          | REUSE  |
| §5.1, §5.2| `writeActivityLog` writes to `advisorpilot_activity_log`; `bumpLastContactedAt` updates `clients.last_contacted_at`                       | `lib/crm/activity-writer.ts:26-76`                                                                         | REUSE  |
| §5.1, §5.2| `ensurePersonalOrg(advisorEmail)` is idempotent and returns the personal org id                                                          | `lib/crm/ensure-personal-org.ts:48-116`                                                                    | REUSE  |
| §6.3     | `lib/crm/save-generated-pdf.ts` accepts `source: 'generated_report'` in its union type                                                   | `lib/crm/save-generated-pdf.ts:53-58`                                                                      | REUSE  |
| §3.2, §6.4| `lib/audit-log.ts:writeAuditEvent` exists for the audit trail                                                                            | `lib/audit-log.ts:8-31`                                                                                    | REUSE  |

### 12.6 Voice agent parity (Rule 3)

| §          | Asserted                                                                                                              | Verified                                                                                                  | Status |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| §1, §4     | Voice agent has READ-only Q&A tools matching what chat needs: `get_holdings_breakdown`, `get_allocation_summary`, `get_meeting_guide`, `get_red_flags`, `get_overlap_insights`, `get_roth_summary`, `client_overview`, `read_analysis_section`, `find_clients_by_criteria` (alias of `search_clients`) | `lib/voice/tool-handlers.ts:148-348`                                                                       | PASS   |
| §1, §4     | `VoiceAppActions` interface exposes `getHoldingsBreakdown / getAllocationSummary / getMeetingGuide / getRecommendations / getRedFlags / getOverlapInsights / getRothSummary / getClientOverview / findClientsByCriteria` | `lib/voice/tool-handlers.ts:21-40`                                                                         | PASS   |
| §4         | `FindClientsCriteria` allows filtering by `search/riskProfile/minAge/maxAge/minTotalValue/maxTotalValue/staleDays/maxIncomeReadinessScore/hasRedFlags/status` | `lib/voice/tool-handlers.ts:48-69`                                                                         | PASS   |

### 12.7 Report system (current vs target)

| §          | Asserted                                                                                                                                | Verified                                                                                                                                       | Status |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| §1, §7, §8 | Current report system is PDF-only via `pdf-lib`; NO markdown/mermaid/chart/map renderer exists in the project today                      | `app/api/generate-report/route.ts:1-30` imports `pdf-lib` only. Workspace search for `mermaid` returns ZERO matches in code (only in docs).    | PASS (confirms target-state framing) |
| §9.1       | No existing markdown renderer means we add `react-markdown`, `remark-gfm`, `chart.js`, `react-chartjs-2`, `echarts`, `echarts-for-react`, `mermaid` as NEW dependencies | `package.json` has `recharts: ^2.15.4` but none of the others.                                                                                  | GAP — intentional |
| §10.1      | `advisorpilot_documents` has no `content` column — markdown can't live there                                                            | `schema.sql:176-195` — only `storage_bucket`, `storage_path`, `mime_type`, `file_size_bytes`, `sha256`, `metadata jsonb`                       | PASS   |
| §7.3       | Existing `app/app/(crm)/reports/page.tsx` is a placeholder                                                                              | `app/app/(crm)/reports/page.tsx:1-14`                                                                                                          | PASS   |

### 12.8 Control Tower source patterns (we copy these verbatim)

| §          | Asserted                                                                                                              | Verified                                                                                                                                       | Status |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| §1, §2     | CT compound-tool pattern: single tool, top-level `operation` enum, per-operation optional fields, switch-on-operation executor | `server/ai/tools/data-management.ts` (`manage_workspace/table/rows`), `server/ai/tools/report-manage.ts:99-126` (13 ops)                       | PASS   |
| §7.1       | CT `manage_report` 13 operations (list/get/create/update/delete/duplicate + get_lines/insert_lines/replace_lines/delete_lines + list_versions/restore_version + embed_image) | `server/ai/tools/report-manage.ts:104-125`                                                                                                     | PASS   |
| §7.2, §8   | CT `generate_report_content` system prompt defines `chart:chartjs` + `chart:echarts` + `mermaid` fenced-block conventions | `server/ai/tools/report-generate.ts:18-172`                                                                                                    | PASS   |
| §8.5       | CT `manage_report.description` defines a `map:google` fenced-block convention — exists in CT, **deliberately not ported to AdvisorPilot** (no Maps API key) | `server/ai/tools/report-manage.ts:188-228` (CT-only reference)                                                                                  | PASS (excluded by design) |

### 12.9 Things this plan explicitly does NOT assume exist

- `ChatToolContext`, `ChatTool`, `ChatToolResult` — defined for the first time in [60-§B.21](./60-chat-orchestrator.md#b21-event-shape-compatibility-forward--the-tools-well-add-later); this doc populates the registry.
- A chat tool registry (`CHAT_TOOL_REGISTRY`) — reserved in 60 §B.21.
- `advisorpilot_reports`, `advisorpilot_report_versions` tables — new in §10 of this doc.
- `query_crm_aggregate`, `query_crm_path` Postgres functions — new in §3.4-3.5.
- `LlmPass = "report.generate"` value — new in this doc; lands as a `lib/llm/types.ts` edit in Phase 5.

### 12.10 Drift checks (places where prior iterations of this doc were sloppy)

| Earlier claim                                                                                       | Now corrected to                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Are `advisorpilot_clients.client` and `.holdings` jsonb columns ever exposed to the LLM directly?" — flagged as future-phase reconsideration | **Yes, fully exposed via `get:clients` and `path:clients` from day 1.** Rule 1 (§1).                                                                                |
| "Per-conversation rate limiter (`MAX_CALLS_PER_TURN = 6`)"                                          | **Removed entirely.** The chat-runner's existing `maxToolLoops = 12` cap is the only enforcement. Per-call billing tracking lives in `advisorpilot_chat_call_log` (60-§B.7), not in a rate limiter. |
| "Sixteen tools including `manage_memory`, `manage_intel`, `propose_plan`, `send_email`"             | **Cut to eleven.** Memory + intel deferred (the per-turn context preflight in 60-§B.5 is sufficient for v1). `propose_plan` deferred — the `plan:proposal` SSE event stays reserved in 60-§A.2 but no tool emits it. `send_email` deferred — existing email surfaces stay human-driven. |
| "Only 6 operations on `manage_report` in v1"                                                        | **All 13 CT operations land in Phase 5.** Line-level editing is exactly the workflow this surface is built for.                                                    |
| "Three fenced-block extensions plus `map:google`"                                                  | **Three fenced-block extensions** (`chart:chartjs`, `chart:echarts`, `mermaid`) **plus the `embed_image` operation** that inserts AI-generated images at a specific line. `map:google` deliberately excluded — no Maps API key in this project (see §8.5). |

---

## 13 · File inventory

### NEW files (this plan)

```
lib/llm/chat/tools/
├── types.ts                       # ChatTool, ChatToolContext, ChatToolResult     (first defined here per 60-§B.21)
├── index.ts                       # CHAT_TOOL_REGISTRY (Map<name, ChatTool>)
├── query-crm.ts                   # Compound read DSL (§3)
├── query-crm-helpers.ts           # applyClientFilters/applyTaskFilters/sortClients/etc. (mirror existing routes)
├── compute.ts                     # compute(allocation_summary|holdings_breakdown|...) (§4)
├── manage-note.ts                 # §5.1
├── manage-task.ts                 # §5.2
├── manage-client.ts               # §5.3
├── manage-report.ts               # §7.1 — 13 operations
├── generate-report-content.ts     # §7.2
├── run-analysis.ts                # §6.1
├── run-fee-analysis.ts            # §6.2
├── run-enrich-holdings.ts         # §6.3
└── run-deep-research.ts           # §6.4

lib/crm/server/                    # Extracted route-handler bodies (Phase 1)
├── clients.ts                     # listClients(), getClient(), updateClient()
├── notes.ts                       # listNotes(), createNote(), updateNote(), deleteNote()
├── tasks.ts                       # listTasks(), createTask(), updateTask(), deleteTask()
├── activity.ts                    # listActivity()
└── documents.ts                   # listDocuments(), getDocumentSignedUrls()

lib/crm/projections.ts             # buildAllocationSummary, buildHoldingsBreakdown, summarizeAccounts (extracted from lib/voice/ + components/crm/overview/)

lib/markdown/                      # Web renderer for reports
├── report-renderer.tsx
├── chart-theme.ts
└── blocks/
    ├── chartjs-block.tsx
    ├── echarts-block.tsx
    ├── mermaid-block.tsx
    └── error-fallback.tsx

app/app/(crm)/reports/
├── page.tsx                       # REPLACES placeholder — list view (Phase 4)
└── [reportId]/
    └── page.tsx                   # Single-report viewer (Phase 4)

app/api/reports/
├── route.ts                       # GET (list), POST (create — non-AI surface; advisor-authored)
├── [id]/route.ts                  # GET, PATCH, DELETE
└── [id]/pdf/route.ts              # Phase 7 — markdown → PDF via headless browser

supabase/
├── _apply_crm_phase3_migrations.sql   # query_crm_aggregate + 4 helpers (Phase 3)
└── _apply_crm_phase4_migrations.sql   # advisorpilot_reports + advisorpilot_report_versions + RLS (Phase 4)
```

### Modified files (this plan)

```
app/api/notes/route.ts             # Body extracted to lib/crm/server/notes.ts; route becomes thin wrapper
app/api/notes/[id]/route.ts        # Same
app/api/tasks/route.ts             # Same → lib/crm/server/tasks.ts
app/api/tasks/[id]/route.ts        # Same
app/api/clients/route.ts           # Body extracted to lib/crm/server/clients.ts (listClients)
app/api/clients/[id]/route.ts      # Body extracted (getClient + updateClient)
app/api/activity/route.ts          # Body extracted (listActivity)
app/api/documents/route.ts         # Body extracted (listDocuments)

lib/llm/types.ts                   # +1 LlmPass: "report.generate" (Phase 5)
lib/llm/registry.ts                # +1 HARDCODED_MODEL_DEFAULTS row + PASS_TO_ENV entry
lib/llm/capabilities.ts            # +1 entry per provider (all "native")
lib/llm/model-catalog.ts           # +1 dropdown row in LlmSettingsDrawer

lib/voice/page-helpers.ts          # buildAllocationSummary + buildHoldingsBreakdown re-exported from lib/crm/projections.ts (no behavior change)
components/crm/overview/accounts-card.tsx  # summarizeAccounts moved to lib/crm/projections.ts; card imports it

app/app/legacy-app-shell.tsx       # +1 useEffect calling useChatLocation().setClient({ id, name }) when its in-page client state changes (per 60-§B.14.3) — the only edit to the 8,331-LOC legacy shell
package.json                       # +react-markdown +remark-gfm +chart.js +react-chartjs-2 +echarts +echarts-for-react +mermaid
docs/crm/README.md                 # +link to this doc (already done in v1)
```

### Existing files this plan READS but does not modify

```
lib/advisor-auth.ts                # resolveAdvisorIdentity (used by SSE route from 60)
lib/advisor-fetch.ts               # advisorFetch (used by chat client from 60)
lib/audit-log.ts                   # writeAuditEvent (called by all write tools)
lib/crm/supabase-admin.ts          # getCrmSupabaseAdmin (every tool's executor)
lib/crm/visibility.ts              # SQL-fragment helpers (Phase 7 raw-SQL escape hatch only)
lib/crm/clients-mapper.ts          # toRosterItem, toClientDetail (query_crm read paths)
lib/crm/task-mapper.ts             # toTask
lib/crm/note-mapper.ts             # toNote
lib/crm/document-mapper.ts         # toDocument
lib/crm/activity-adapter.ts        # toActivityEntry
lib/crm/activity-writer.ts         # writeActivityLog, bumpLastContactedAt
lib/crm/ensure-personal-org.ts     # ensurePersonalOrg
lib/crm/save-generated-pdf.ts      # saveGeneratedPdf (Phase 7 PDF export)
lib/intake-config.ts               # IntakeClient type (the LLM's intake jsonb shape)
lib/saved-review-normalize.ts      # UiHolding + NormalizedAiAnalysis types (holdings/analysis jsonb shapes)
lib/roth-worksheet.ts              # RothWorksheet type
lib/fia-worksheet.ts               # FiaWorksheet type
lib/fee-analysis.ts                # FeeAnalysisApiResponse + math helpers (run_fee_analysis wrapper)
lib/voice/tool-handlers.ts         # VOICE_TOOL_HANDLERS + VoiceAppActions (parity reference)
lib/voice/page-helpers.ts          # buildAllocationSummary, buildHoldingsBreakdown (until extracted to lib/crm/projections.ts in Phase 2)
lib/llm/index.ts                   # complete() — generate_report_content delegates here
```

---

## Cross-references

- [60-chat-orchestrator.md](./60-chat-orchestrator.md) — the orchestrator + chat widget + SSE wire protocol these tools execute under.
- [75-database-tools.md](./75-database-tools.md) — the SQL-facing deep reference for `query_crm` + `compute`: per-table inventory, RLS policy audit, literal SQL for every operation, full bodies of `query_crm_aggregate` + `query_crm_path`, performance characteristics, worked end-to-end trace.
- [docs/multi-provider-llm-plan.md](../multi-provider-llm-plan.md) — owns `complete()` / `research()` / `tts()` / `stt()` (which `generate_report_content` and `run_*` wrappers call) and the provider/model resolver.
- [docs/voice-agent-plan.md](../voice-agent-plan.md) — Gemini Live voice agent. The chat orchestrator's `compute` tool reuses helpers built for the voice agent; future Phase: a shared tool dispatcher both agents call.
- [docs/crm/00-fundamentals.md](./00-fundamentals.md), [10-implementation.md](./10-implementation.md), [20-technical-specs.md](./20-technical-specs.md), [30-backward-compat.md](./30-backward-compat.md), [40-path-forward.md](./40-path-forward.md), [50-organizations-and-sharing.md](./50-organizations-and-sharing.md) — the broader CRM plan this orchestrator surface sits inside.
- [.cursor/rules/50-authentication.mdc](../../.cursor/rules/50-authentication.mdc) — the three auth paths every tool's executor must honor (via `resolveAdvisorIdentity` in the SSE route).
- Source code we port from: `~/Code/fragilepak-mcp-servers/control_tower/server/ai/tools/{data-management,analytics,report-manage,report-generate,navigation,guardrails}.ts` and `~/Code/fragilepak-mcp-servers/control_tower/server/lib/orchestrator/chat-runner.ts`.
