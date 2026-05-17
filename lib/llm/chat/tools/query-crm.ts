/**
 * `query_crm` — the compound read tool.
 *
 * One tool, ten operation/entity combinations in this v1 (Phase 0 from
 * docs/crm/70-orchestrator-tools.md §11):
 *
 *   operation: list | get
 *   entity:    clients | tasks | notes | activity     (activity is list-only)
 *
 * The model picks an `(operation, entity)` pair plus optional `filters` /
 * `sort` / `limit` / `id`. The tool dispatches to the right helper in
 * `query-crm-helpers.ts` and returns a structured payload the model can
 * narrate.
 *
 * Aggregations (`aggregate`, `search`, `path`) and the rest of the entity
 * menu (documents, reports, research_jobs, etc.) ship in a follow-up PR.
 *
 * Per-entity filter / sort allowlists + safety constraints:
 * docs/crm/70-orchestrator-tools.md §3.3.
 */

import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";
import {
  getAdvisorProfile,
  getClient,
  getNote,
  getReport,
  getTask,
  isUuid,
  listActivity,
  listClients,
  listDocuments,
  listNotes,
  listReports,
  listResearchJobs,
  listTasks,
  parseActivityListArgs,
  parseAggregateArgs,
  parseClientsListArgs,
  parseDocumentsListArgs,
  parseNotesListArgs,
  parsePathArgs,
  parseReportsListArgs,
  parseResearchJobsListArgs,
  parseSearchArgs,
  parseTasksListArgs,
  runAggregate,
  runPath,
  searchActivity,
  searchClients,
  searchNotes,
  searchTasks,
} from "./query-crm-helpers";

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema the model sees
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    operation: {
      type: "string",
      enum: ["list", "get", "aggregate", "search", "path"],
      description:
        "list = many rows of one entity with filters/sort/pagination; get = one row by id (full JSONB included); aggregate = grouped count/sum/avg/min/max over an entity (e.g. AUM by stage); search = case-insensitive substring search across an entity's text + JSONB-text fields; path = surgical JSONB extraction — pick specific fields out of one client row without pulling the whole 50KB record (e.g. just `intake.spouseFirstName` + `analysis.synopsis`).",
    },
    entity: {
      type: "string",
      enum: ["clients", "tasks", "notes", "activity", "documents", "reports", "research_jobs", "advisor_profile"],
      description:
        "Which entity to read. clients = CRM households. tasks = todos. notes = client-scoped notes. activity = audit + activity-log timeline (list/search-only). documents = uploaded files (list excludes statement uploads by default; aggregate supported). reports = markdown reports authored by Nova or the advisor (list/get; archived reports hidden by default). research_jobs = deep-research jobs (list-only; owner-only). advisor_profile = signed-in advisor's profile (single-row; just use `list` with no filters and ignore the limit).",
    },
    id: {
      type: "string",
      description:
        "UUID of the row when operation=get or operation=path. Returns null/notFound if the row exists but is not visible to the viewer.",
    },
    paths: {
      type: "array",
      items: { type: "string" },
      description:
        "For operation=path only. Dotted-string field paths on a `clients` row. Synthetic namespace: `intake.X` → client intake JSONB; `analysis.X` → analysis JSONB; `rothWorksheet.X` → roth_worksheet JSONB; `top.X` → top-level column. Example: ['intake.spouseFirstName', 'intake.fiaWorksheet.carrierName', 'analysis.synopsis']. At most 25 paths per call.",
    },
    filters: {
      type: "object",
      additionalProperties: true,
      description:
        "Per-entity filter map. clients (list): { stage, status, ownerEmail, search, tags[], minAum, maxAum, staleDays, reviewDueBefore, reviewDueAfter, nextMeetingBefore }. tasks (list): { clientId|null, status, priority, due ('today'|'week'|'overdue'), dueBefore, dueAfter, tags[], ownerEmail }. notes (list): { clientId, pinned, source ('manual'|'voice_agent'|'meeting_recap'), authorEmail, since (ISO), search, tags[] }. activity (list): { clientId, type ('note'|'meeting'|'document'|'email'|'call'|'task'|'analysis'|'system'), since (ISO), actorEmail, source ('activity_log'|'audit_event') }. For aggregate, the filter allowlist is wider — see operation:aggregate description. Unknown filter keys raise structured errors.",
    },
    sort: {
      type: "string",
      description:
        "Per-entity sort token (list/search only). clients: 'name-asc'|'aum-desc'|'aum-asc'|'review-due-asc'|'last-contact-desc'|'next-meeting-asc' (default name-asc). tasks: 'due-asc'|'priority-desc'|'created-desc' (default due-asc). notes: 'pinned-then-recent'|'created-desc' (default pinned-then-recent). activity is always newest-first server-side.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 1000,
      description:
        "Max rows for list/search (default 20, hard cap 50) OR max buckets for aggregate (default 100, hard cap 1000). Use small caps for narration; large caps only when the model truly needs all buckets.",
    },
    groupBy: {
      type: "string",
      description:
        "For aggregate only. Allowlist per entity. clients: stage | status | owner_email | inception_year | review_month | intake.riskProfile | intake.federalTaxBracket | intake.calibration | intake.married | intake.takingSocialSecurity | analysis.hasRedFlags | analysis.hasAnalysis | holdings.dominant_asset_class | account_count_bucket. tasks: status | priority | client_id | due_week | is_overdue. notes: client_id | source | pinned | created_week | author_email. activity: type | client_id | actor_email | occurred_week | occurred_month | source. documents: source | client_id | status | mime_type | created_month. Omit for an ungrouped query (returns one bucket named 'ALL').",
    },
    aggregates: {
      type: "array",
      description:
        "For aggregate only. Array of {fn, field?, as} pairs. fn ∈ count|sum|avg|min|max. `field` required when fn != 'count'. `as` is the output alias the model reads back. At most 5 expressions per call. Default when omitted: [{fn:'count', as:'count'}]. Numeric fields by entity — clients: total_value, ytd_return, inception_year, intake.age, intake.retirementAge, intake.adjustedGrossIncomeAnnual, intake.retirementSpendableIncomeAnnual, intake.socialSecurityMonthlyClient, holdings.totalValue, holdings.count. tasks: days_overdue.",
      items: {
        type: "object",
        properties: {
          fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
          field: { type: "string" },
          as: { type: "string" },
        },
        required: ["fn", "as"],
      },
    },
    q: {
      type: "string",
      description:
        "For search only. Substring (case-insensitive). Min 2 chars. Searched fields by entity — clients: firstName + lastName + householdLabel; tasks: title + description; notes: body; activity: title + body.",
    },
  },
  required: ["operation", "entity"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Public tool entry
// ─────────────────────────────────────────────────────────────────────────────

export const queryCrmTool: ChatTool = {
  name: "query_crm",
  description:
    "Read data from the AdvisorPilot CRM database. Five operations: `list` (rows with filters/sort), `get` (one row by id with full JSONB), `aggregate` (grouped count/sum/avg/min/max — e.g. AUM by stage), `search` (substring across text + JSONB-text fields), `path` (surgical extraction of specific JSONB fields without pulling the whole row). Visibility (private / shared / organization) is enforced server-side — you never see data the advisor can't see. Returns structured JSON the advisor can ask follow-up questions on.",
  parameters: PARAMETERS,
  handler: queryCrmHandler,
};

async function queryCrmHandler(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const op = typeof args.operation === "string" ? args.operation : "";
  const entity = typeof args.entity === "string" ? args.entity : "";

  if (op !== "list" && op !== "get" && op !== "aggregate" && op !== "search" && op !== "path") {
    return {
      error: `Unknown operation '${op}'. Allowed: list | get | aggregate | search | path.`,
    };
  }

  // path is a surgical-extraction op — currently only supported on `clients`
  // (the only entity with deep JSONB worth picking from). Delegate before
  // the broader list/get gates.
  if (op === "path") {
    if (entity !== "clients") {
      return {
        error: `path is only supported for entity=clients in v1 (got '${entity}').`,
      };
    }
    try {
      return await handlePath(args, ctx);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Aggregate accepts one extra entity (`documents`); list/get/search use the
  // narrower set. Validate per-op so the model gets a clear rejection rather
  // than a Supabase RPC error.
  if (op === "aggregate") {
    if (
      entity !== "clients" &&
      entity !== "tasks" &&
      entity !== "notes" &&
      entity !== "activity" &&
      entity !== "documents"
    ) {
      return {
        error: `Unknown entity '${entity}' for aggregate. Allowed: clients | tasks | notes | activity | documents.`,
      };
    }
    try {
      return await handleAggregate(args, ctx);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // list now accepts more entities than get / search.
  const listOk =
    entity === "clients" ||
    entity === "tasks" ||
    entity === "notes" ||
    entity === "activity" ||
    entity === "documents" ||
    entity === "reports" ||
    entity === "research_jobs" ||
    entity === "advisor_profile";
  // get is supported for the entities that have a single editable record
  // surface (i.e. clients/tasks/notes/reports). search stays narrower.
  const getOk =
    entity === "clients" ||
    entity === "tasks" ||
    entity === "notes" ||
    entity === "reports";
  const searchOk =
    entity === "clients" || entity === "tasks" || entity === "notes" || entity === "activity";

  if (op === "list" && !listOk) {
    return {
      error: `Unknown entity '${entity}' for list. Allowed: clients | tasks | notes | activity | documents | reports | research_jobs | advisor_profile.`,
    };
  }
  if (op === "get" && !getOk) {
    return {
      error: `Unknown entity '${entity}' for get. Allowed: clients | tasks | notes | reports.`,
    };
  }
  if (op === "search" && !searchOk) {
    return {
      error: `Unknown entity '${entity}' for search. Allowed: clients | tasks | notes | activity.`,
    };
  }

  // get:activity is intentionally not supported — activity rows aren't an
  // editable entity, and the row id space is split across two source tables.
  if (op === "get" && entity === "activity") {
    return {
      error:
        "get is not supported for `activity` — use `list` with filters like { clientId, since } instead.",
    };
  }

  try {
    if (op === "get") {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!isUuid(id)) {
        return { error: "operation=get requires a valid UUID in `id`." };
      }
      return await handleGet(entity as "clients" | "tasks" | "notes" | "reports", id, ctx);
    }

    if (op === "search") {
      return await handleSearch(entity as "clients" | "tasks" | "notes" | "activity", args, ctx);
    }

    return await handleList(entity, args, ctx);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// List branch
// ─────────────────────────────────────────────────────────────────────────────

async function handleList(
  entity: string,
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  switch (entity) {
    case "clients": {
      const parsed = parseClientsListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      const result = await listClients(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "tasks": {
      const parsed = parseTasksListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      const result = await listTasks(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "notes": {
      const parsed = parseNotesListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      // Encourage clientId scoping — notes are noisy without it. We don't
      // hard-reject; just hint via the response shape so the model can
      // narrow on the next call if rows balloon.
      const result = await listNotes(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "activity": {
      const parsed = parseActivityListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      const result = await listActivity(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "documents": {
      const parsed = parseDocumentsListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      const result = await listDocuments(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "reports": {
      const parsed = parseReportsListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      const result = await listReports(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "research_jobs": {
      const parsed = parseResearchJobsListArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      const result = await listResearchJobs(ctx.supabase, ctx.advisorEmail, parsed.value);
      return { result };
    }
    case "advisor_profile": {
      // Single-row entity — no filters / sort / paginate. Returns the
      // viewer's row wrapped in { profile } for shape uniformity with
      // the other list responses (.rows convention doesn't fit a single row).
      const profile = await getAdvisorProfile(ctx.supabase, ctx.advisorEmail);
      return { result: { profile } };
    }
    default:
      return { error: `list not implemented for entity '${entity}'.` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// path — surgical JSONB extraction (delegates to query_crm_path RPC)
// ─────────────────────────────────────────────────────────────────────────────

async function handlePath(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const parsed = parsePathArgs({ ...args, entity: "clients" });
  if (!parsed.ok) return { error: parsed.error };
  const result = await runPath(ctx.supabase, ctx.advisorEmail, parsed.value);
  if ("notFound" in result) {
    return { result: { id: parsed.value.id, notFound: true } };
  }
  return { result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get branch — visibility-checked; 404-style null when not visible
// ─────────────────────────────────────────────────────────────────────────────

async function handleGet(
  entity: "clients" | "tasks" | "notes" | "reports",
  id: string,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  switch (entity) {
    case "clients": {
      const row = await getClient(ctx.supabase, ctx.advisorEmail, id);
      if (!row) return { result: { row: null, notFound: true } };
      return { result: { row } };
    }
    case "tasks": {
      const row = await getTask(ctx.supabase, ctx.advisorEmail, id);
      if (!row) return { result: { row: null, notFound: true } };
      return { result: { row } };
    }
    case "notes": {
      const row = await getNote(ctx.supabase, ctx.advisorEmail, id);
      if (!row) return { result: { row: null, notFound: true } };
      return { result: { row } };
    }
    case "reports": {
      const row = await getReport(ctx.supabase, ctx.advisorEmail, id);
      if (!row) return { result: { row: null, notFound: true } };
      return { result: { row } };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate branch — delegates to query_crm_aggregate RPC
// ─────────────────────────────────────────────────────────────────────────────

async function handleAggregate(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const parsed = parseAggregateArgs(args);
  if (!parsed.ok) return { error: parsed.error };
  const result = await runAggregate(ctx.supabase, ctx.advisorEmail, parsed.value);
  return { result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Search branch — TS-side ILIKE over the visible cohort
// ─────────────────────────────────────────────────────────────────────────────

async function handleSearch(
  entity: "clients" | "tasks" | "notes" | "activity",
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const parsed = parseSearchArgs({ ...args, entity });
  if (!parsed.ok) return { error: parsed.error };
  const { q, limit } = parsed.value;

  switch (entity) {
    case "clients":
      return { result: await searchClients(ctx.supabase, ctx.advisorEmail, q, limit) };
    case "tasks":
      return { result: await searchTasks(ctx.supabase, ctx.advisorEmail, q, limit) };
    case "notes":
      return { result: await searchNotes(ctx.supabase, ctx.advisorEmail, q, limit) };
    case "activity":
      return { result: await searchActivity(ctx.supabase, ctx.advisorEmail, q, limit) };
  }
}
