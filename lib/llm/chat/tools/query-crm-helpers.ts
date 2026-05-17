/**
 * Per-entity helpers for `query_crm`.
 *
 * Each entity (clients / tasks / notes / activity) has:
 *   - a filter allowlist + applier
 *   - a sort allowlist + applier
 *   - a mapper from raw Supabase row → the UI's typed shape
 *
 * Splitting them out keeps the tool handler in `query-crm.ts` short and
 * makes the per-entity logic unit-testable in isolation.
 *
 * Mirrors the GET handlers in `app/api/{clients,tasks,notes,activity}/route.ts`
 * — both API routes AND the chat tool eventually share the same extracted
 * helpers from `lib/crm/server/` (deferred to a separate refactor PR). For
 * now this file duplicates the filter/sort logic so PR 4 ships without a
 * cross-cutting refactor.
 *
 * Design + filter/sort allowlists: docs/crm/70-orchestrator-tools.md §3.3.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { toClientDetail, toRosterItem, type ClientRow } from "@/lib/crm/clients-mapper";
import { toTask, type TaskRow } from "@/lib/crm/task-mapper";
import { toNote, type NoteRow } from "@/lib/crm/note-mapper";
import {
  toActivityEntry,
  type VisibleActivityRow,
} from "@/lib/crm/activity-adapter";
import { toReport, type ReportRow } from "@/lib/crm/report-mapper";
import type {
  ActivityEntry,
  ClientDetail,
  ClientRosterItem,
  Note,
  Report,
  Task,
} from "@/lib/crm/types";

// ─────────────────────────────────────────────────────────────────────────────
// Common return shape
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryListResult<T> {
  rows: T[];
  count: number;
  hasMore: boolean;
  /** When `true`, the result was capped by the runner's per-call max (50). */
  capped: boolean;
}

/** Cap applied AFTER the entity-specific `limit` arg — prevents the model
 *  from asking for 10_000 and ballooning a prompt. */
const ABSOLUTE_MAX_ROWS = 50;
const DEFAULT_LIMIT = 20;

export function resolveLimit(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, ABSOLUTE_MAX_ROWS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation primitives
// ─────────────────────────────────────────────────────────────────────────────

export function isUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS — list + get
// ─────────────────────────────────────────────────────────────────────────────

interface ClientsFilters {
  stage?: string;
  status?: string;
  ownerEmail?: string;
  search?: string;
  tags?: string[];
  minAum?: number;
  maxAum?: number;
  staleDays?: number;
  reviewDueBefore?: string;
  reviewDueAfter?: string;
  nextMeetingBefore?: string;
}

interface ClientsListArgs {
  filters?: ClientsFilters;
  sort?: ClientSort;
  limit: number;
}

const CLIENT_SORTS = [
  "name-asc",
  "aum-desc",
  "aum-asc",
  "review-due-asc",
  "last-contact-desc",
  "next-meeting-asc",
] as const;
type ClientSort = (typeof CLIENT_SORTS)[number];

export function parseClientsListArgs(input: Record<string, unknown>): {
  ok: true;
  value: ClientsListArgs;
} | { ok: false; error: string } {
  const filters: ClientsListArgs["filters"] = {};
  const raw = isObject(input.filters) ? input.filters : {};

  if (isString(raw.stage)) filters.stage = raw.stage;
  if (isString(raw.status)) filters.status = raw.status;
  if (isString(raw.ownerEmail)) filters.ownerEmail = raw.ownerEmail.toLowerCase();
  if (isString(raw.search)) filters.search = raw.search;
  if (isStringArray(raw.tags)) filters.tags = raw.tags;
  if (isNumber(raw.minAum)) filters.minAum = raw.minAum;
  if (isNumber(raw.maxAum)) filters.maxAum = raw.maxAum;
  if (isNumber(raw.staleDays)) filters.staleDays = Math.floor(raw.staleDays);
  if (isString(raw.reviewDueBefore)) filters.reviewDueBefore = raw.reviewDueBefore;
  if (isString(raw.reviewDueAfter)) filters.reviewDueAfter = raw.reviewDueAfter;
  if (isString(raw.nextMeetingBefore)) filters.nextMeetingBefore = raw.nextMeetingBefore;

  let sort: ClientSort | undefined;
  if (typeof input.sort === "string") {
    if (!(CLIENT_SORTS as readonly string[]).includes(input.sort)) {
      return {
        ok: false,
        error: `Unknown sort '${input.sort}' for clients. Allowed: ${CLIENT_SORTS.join(", ")}`,
      };
    }
    sort = input.sort as ClientSort;
  }

  return { ok: true, value: { filters, sort, limit: resolveLimit(input.limit) } };
}

export async function listClients(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: ClientsListArgs,
): Promise<QueryListResult<ClientRosterItem>> {
  // Fetch the full visible-clients set via the existing RPC, then filter +
  // sort + cap in Node. Postgres-side filter pushdown can land later if we
  // see the in-memory list grow past a few hundred per advisor.
  const { data, error } = await supabase.rpc("list_visible_clients", {
    viewer_email: viewerEmail,
  });
  if (error) {
    throw new Error(`list_visible_clients failed: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    return { rows: [], count: 0, hasMore: false, capped: false };
  }

  const now = new Date();
  const allMapped: ClientRosterItem[] = data
    .filter((row): row is ClientRow => !!row && typeof row === "object")
    .map((row) => toRosterItem(row, { now }));

  const filtered = filterClientRows(allMapped, args.filters ?? {}, now);
  const sorted = sortClientRows(filtered, args.sort ?? "name-asc");
  return finalize(sorted, args.limit);
}

function filterClientRows(
  rows: ClientRosterItem[],
  f: ClientsFilters,
  now: Date,
): ClientRosterItem[] {
  return rows.filter((row) => {
    if (f.stage && row.stage !== f.stage) return false;
    if (f.status && row.status !== f.status) return false;
    if (f.ownerEmail && row.ownerEmail.toLowerCase() !== f.ownerEmail) return false;
    if (typeof f.minAum === "number" && (row.aum ?? -Infinity) < f.minAum) return false;
    if (typeof f.maxAum === "number" && (row.aum ?? Infinity) > f.maxAum) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay =
        `${row.firstName} ${row.lastName} ${row.householdLabel ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (Array.isArray(f.tags) && f.tags.length > 0) {
      // ANY-match — model gets the intuitive "tagged with at least one of these".
      const tagSet = new Set(row.tags.map((t) => t.toLowerCase()));
      const any = f.tags.some((t) => tagSet.has(t.toLowerCase()));
      if (!any) return false;
    }
    if (typeof f.staleDays === "number") {
      const ms = f.staleDays * 24 * 60 * 60 * 1000;
      const threshold = now.getTime() - ms;
      const lc = row.lastContactedAt ? new Date(row.lastContactedAt).getTime() : 0;
      // staleDays: rows last contacted MORE than N days ago (or never contacted).
      if (lc > threshold) return false;
    }
    if (f.reviewDueBefore) {
      if (!row.reviewDueAt) return false;
      if (row.reviewDueAt > f.reviewDueBefore) return false;
    }
    if (f.reviewDueAfter) {
      if (!row.reviewDueAt) return false;
      if (row.reviewDueAt < f.reviewDueAfter) return false;
    }
    if (f.nextMeetingBefore) {
      if (!row.nextMeetingAt) return false;
      if (row.nextMeetingAt > f.nextMeetingBefore) return false;
    }
    return true;
  });
}

function sortClientRows(
  rows: ClientRosterItem[],
  sort: ClientSort,
): ClientRosterItem[] {
  const out = [...rows];
  switch (sort) {
    case "name-asc":
      out.sort((a, b) =>
        `${a.lastName} ${a.firstName}`
          .toLowerCase()
          .localeCompare(`${b.lastName} ${b.firstName}`.toLowerCase()),
      );
      return out;
    case "aum-desc":
      out.sort((a, b) => (b.aum ?? -1) - (a.aum ?? -1));
      return out;
    case "aum-asc":
      out.sort((a, b) => (a.aum ?? Infinity) - (b.aum ?? Infinity));
      return out;
    case "review-due-asc":
      out.sort((a, b) => compareDateAscNullsLast(a.reviewDueAt, b.reviewDueAt));
      return out;
    case "last-contact-desc":
      out.sort((a, b) => compareDateDescNullsLast(a.lastContactedAt, b.lastContactedAt));
      return out;
    case "next-meeting-asc":
      out.sort((a, b) => compareDateAscNullsLast(a.nextMeetingAt, b.nextMeetingAt));
      return out;
  }
}

export async function getClient(
  supabase: SupabaseClient,
  viewerEmail: string,
  clientId: string,
): Promise<ClientDetail | null> {
  // Visibility gate FIRST — same pattern as app/api/clients/[id]/route.ts:
  // 404 (not 403) when not-visible to avoid leaking row existence.
  const { data: visible, error: visErr } = await supabase.rpc("clients_visible_to", {
    viewer_email: viewerEmail,
    client_id: clientId,
  });
  if (visErr) throw new Error(`clients_visible_to failed: ${visErr.message}`);
  if (visible !== true) return null;

  const [rowRes, tasksCount, notesCount] = await Promise.all([
    supabase
      .from("advisorpilot_clients")
      .select("*")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("advisorpilot_tasks")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("advisorpilot_notes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      ),
  ]);
  if (rowRes.error) throw new Error(`client fetch failed: ${rowRes.error.message}`);
  if (!rowRes.data) return null;

  return toClientDetail(rowRes.data as ClientRow, {
    openTaskCount: tasksCount.count ?? 0,
    recentNoteCount: notesCount.count ?? 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS — list + get
// ─────────────────────────────────────────────────────────────────────────────

interface TasksFilters {
  clientId?: string | null;
  status?: "open" | "in_progress" | "done" | "cancelled";
  priority?: "High" | "Medium" | "Low";
  due?: "today" | "week" | "overdue";
  dueBefore?: string;
  dueAfter?: string;
  tags?: string[];
  ownerEmail?: string;
}

interface TasksListArgs {
  filters?: TasksFilters;
  sort?: TaskSort;
  limit: number;
}

const TASK_SORTS = ["due-asc", "priority-desc", "created-desc"] as const;
type TaskSort = (typeof TASK_SORTS)[number];

const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const TASK_PRIORITIES = ["High", "Medium", "Low"] as const;
const TASK_DUE_TOKENS = ["today", "week", "overdue"] as const;

export function parseTasksListArgs(input: Record<string, unknown>): {
  ok: true;
  value: TasksListArgs;
} | { ok: false; error: string } {
  const filters: TasksListArgs["filters"] = {};
  const raw = isObject(input.filters) ? input.filters : {};

  if (raw.clientId === null) {
    filters.clientId = null; // explicit "personal/global tasks"
  } else if (isUuid(raw.clientId)) {
    filters.clientId = raw.clientId;
  } else if (raw.clientId !== undefined) {
    return { ok: false, error: "filters.clientId must be a UUID or null" };
  }
    if (isString(raw.status)) {
    if (!(TASK_STATUSES as readonly string[]).includes(raw.status)) {
      return {
        ok: false,
        error: `Unknown status '${raw.status}'. Allowed: ${TASK_STATUSES.join(", ")}`,
      };
    }
    filters.status = raw.status as TasksFilters["status"];
  }
  if (isString(raw.priority)) {
    if (!(TASK_PRIORITIES as readonly string[]).includes(raw.priority)) {
      return {
        ok: false,
        error: `Unknown priority '${raw.priority}'. Allowed: ${TASK_PRIORITIES.join(", ")}`,
      };
    }
    filters.priority = raw.priority as TasksFilters["priority"];
  }
  if (isString(raw.due)) {
    if (!(TASK_DUE_TOKENS as readonly string[]).includes(raw.due)) {
      return {
        ok: false,
        error: `Unknown due token '${raw.due}'. Allowed: ${TASK_DUE_TOKENS.join(", ")}`,
      };
    }
    filters.due = raw.due as TasksFilters["due"];
  }
  if (isString(raw.dueBefore)) filters.dueBefore = raw.dueBefore;
  if (isString(raw.dueAfter)) filters.dueAfter = raw.dueAfter;
  if (isStringArray(raw.tags)) filters.tags = raw.tags;
  if (isString(raw.ownerEmail)) filters.ownerEmail = raw.ownerEmail.toLowerCase();

  let sort: TaskSort | undefined;
  if (typeof input.sort === "string") {
    if (!(TASK_SORTS as readonly string[]).includes(input.sort)) {
      return {
        ok: false,
        error: `Unknown sort '${input.sort}' for tasks. Allowed: ${TASK_SORTS.join(", ")}`,
      };
    }
    sort = input.sort as TaskSort;
  }

  return { ok: true, value: { filters, sort, limit: resolveLimit(input.limit) } };
}

export async function listTasks(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: TasksListArgs,
): Promise<QueryListResult<Task>> {
  const { data, error } = await supabase.rpc("list_visible_tasks", {
    viewer_email: viewerEmail,
  });
  if (error) throw new Error(`list_visible_tasks failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const mapped: Task[] = data
    .filter((row): row is TaskRow => !!row && typeof row === "object")
    .map(toTask);

  const filtered = filterTaskRows(mapped, args.filters ?? {});
  const sorted = sortTaskRows(filtered, args.sort ?? "due-asc");
  return finalize(sorted, args.limit);
}

function filterTaskRows(
  rows: Task[],
  f: TasksFilters,
): Task[] {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const weekIso = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return rows.filter((row) => {
    if (f.clientId !== undefined && row.clientId !== f.clientId) return false;
    if (f.status && row.status !== f.status) return false;
    if (f.priority && row.priority !== f.priority) return false;
    if (f.ownerEmail && row.ownerEmail.toLowerCase() !== f.ownerEmail) return false;
    if (f.due) {
      const due = row.dueDate;
      if (!due) return false;
      if (f.due === "today" && due !== todayIso) return false;
      if (f.due === "week" && (due < todayIso || due > weekIso)) return false;
      if (f.due === "overdue" && due >= todayIso) return false;
    }
    if (f.dueBefore && (!row.dueDate || row.dueDate > f.dueBefore)) return false;
    if (f.dueAfter && (!row.dueDate || row.dueDate < f.dueAfter)) return false;
    if (Array.isArray(f.tags) && f.tags.length > 0) {
      const tagSet = new Set(row.tags.map((t) => t.toLowerCase()));
      if (!f.tags.some((t) => tagSet.has(t.toLowerCase()))) return false;
    }
    return true;
  });
}

const PRIORITY_RANK: Record<Task["priority"], number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

function sortTaskRows(rows: Task[], sort: TaskSort): Task[] {
  const out = [...rows];
  switch (sort) {
    case "due-asc":
      out.sort((a, b) => compareDateAscNullsLast(a.dueDate, b.dueDate));
      return out;
    case "priority-desc":
      out.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
      return out;
    case "created-desc":
      out.sort((a, b) => compareDateDescNullsLast(a.createdAt, b.createdAt));
      return out;
  }
}

export async function getTask(
  supabase: SupabaseClient,
  viewerEmail: string,
  taskId: string,
): Promise<Task | null> {
  const { data: visible, error: visErr } = await supabase.rpc("tasks_visible_to", {
    viewer_email: viewerEmail,
    task_id: taskId,
  });
  if (visErr) throw new Error(`tasks_visible_to failed: ${visErr.message}`);
  if (visible !== true) return null;

  const { data, error } = await supabase
    .from("advisorpilot_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(`task fetch failed: ${error.message}`);
  if (!data) return null;
  return toTask(data as TaskRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTES — list + get
// ─────────────────────────────────────────────────────────────────────────────

interface NotesFilters {
  clientId?: string;
  pinned?: boolean;
  source?: "manual" | "voice_agent" | "meeting_recap";
  authorEmail?: string;
  since?: string;
  search?: string;
  tags?: string[];
}

interface NotesListArgs {
  filters?: NotesFilters;
  sort?: NoteSort;
  limit: number;
}

const NOTE_SORTS = ["pinned-then-recent", "created-desc"] as const;
type NoteSort = (typeof NOTE_SORTS)[number];

const NOTE_SOURCES = ["manual", "voice_agent", "meeting_recap"] as const;

export function parseNotesListArgs(input: Record<string, unknown>): {
  ok: true;
  value: NotesListArgs;
} | { ok: false; error: string } {
  const filters: NotesListArgs["filters"] = {};
  const raw = isObject(input.filters) ? input.filters : {};

  if (raw.clientId !== undefined) {
    if (!isUuid(raw.clientId)) {
      return { ok: false, error: "filters.clientId must be a UUID" };
    }
    filters.clientId = raw.clientId;
  }
  if (typeof raw.pinned === "boolean") filters.pinned = raw.pinned;
  if (isString(raw.source)) {
    if (!(NOTE_SOURCES as readonly string[]).includes(raw.source)) {
      return {
        ok: false,
        error: `Unknown source '${raw.source}'. Allowed: ${NOTE_SOURCES.join(", ")}`,
      };
    }
    filters.source = raw.source as NotesFilters["source"];
  }
  if (isString(raw.authorEmail)) filters.authorEmail = raw.authorEmail.toLowerCase();
  if (isString(raw.since)) filters.since = raw.since;
  if (isString(raw.search)) filters.search = raw.search;
  if (isStringArray(raw.tags)) filters.tags = raw.tags;

  let sort: NoteSort | undefined;
  if (typeof input.sort === "string") {
    if (!(NOTE_SORTS as readonly string[]).includes(input.sort)) {
      return {
        ok: false,
        error: `Unknown sort '${input.sort}' for notes. Allowed: ${NOTE_SORTS.join(", ")}`,
      };
    }
    sort = input.sort as NoteSort;
  }

  return { ok: true, value: { filters, sort, limit: resolveLimit(input.limit) } };
}

export async function listNotes(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: NotesListArgs,
): Promise<QueryListResult<Note>> {
  const { data, error } = await supabase.rpc("list_visible_notes", {
    viewer_email: viewerEmail,
  });
  if (error) throw new Error(`list_visible_notes failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const mapped: Note[] = data
    .filter((row): row is NoteRow => !!row && typeof row === "object")
    .map(toNote);

  const filtered = filterNoteRows(mapped, args.filters ?? {});
  const sorted = sortNoteRows(filtered, args.sort ?? "pinned-then-recent");
  return finalize(sorted, args.limit);
}

function filterNoteRows(
  rows: Note[],
  f: NotesFilters,
): Note[] {
  return rows.filter((row) => {
    if (f.clientId && row.clientId !== f.clientId) return false;
    if (typeof f.pinned === "boolean" && row.pinned !== f.pinned) return false;
    if (f.source && row.source !== f.source) return false;
    if (f.authorEmail && row.authorEmail.toLowerCase() !== f.authorEmail) return false;
    if (f.since && row.createdAt < f.since) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!row.body.toLowerCase().includes(q)) return false;
    }
    if (Array.isArray(f.tags) && f.tags.length > 0) {
      const tagSet = new Set(row.tags.map((t) => t.toLowerCase()));
      if (!f.tags.some((t) => tagSet.has(t.toLowerCase()))) return false;
    }
    return true;
  });
}

function sortNoteRows(rows: Note[], sort: NoteSort): Note[] {
  const out = [...rows];
  switch (sort) {
    case "pinned-then-recent":
      out.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return compareDateDescNullsLast(a.createdAt, b.createdAt);
      });
      return out;
    case "created-desc":
      out.sort((a, b) => compareDateDescNullsLast(a.createdAt, b.createdAt));
      return out;
  }
}

export async function getNote(
  supabase: SupabaseClient,
  viewerEmail: string,
  noteId: string,
): Promise<Note | null> {
  const { data: visible, error: visErr } = await supabase.rpc("notes_visible_to", {
    viewer_email: viewerEmail,
    note_id: noteId,
  });
  if (visErr) throw new Error(`notes_visible_to failed: ${visErr.message}`);
  if (visible !== true) return null;

  const { data, error } = await supabase
    .from("advisorpilot_notes")
    .select("*")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw new Error(`note fetch failed: ${error.message}`);
  if (!data) return null;
  return toNote(data as NoteRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY — list only (no get; activity isn't an editable entity)
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVITY_TYPES = [
  "note",
  "meeting",
  "document",
  "email",
  "call",
  "task",
  "analysis",
  "system",
] as const;

interface ActivityFilters {
  clientId?: string;
  type?: (typeof ACTIVITY_TYPES)[number];
  since?: string;
  actorEmail?: string;
  source?: "activity_log" | "audit_event";
}

interface ActivityListArgs {
  filters?: ActivityFilters;
  limit: number;
}

export function parseActivityListArgs(input: Record<string, unknown>): {
  ok: true;
  value: ActivityListArgs;
} | { ok: false; error: string } {
  const filters: ActivityListArgs["filters"] = {};
  const raw = isObject(input.filters) ? input.filters : {};

  if (raw.clientId !== undefined) {
    if (!isUuid(raw.clientId)) {
      return { ok: false, error: "filters.clientId must be a UUID" };
    }
    filters.clientId = raw.clientId;
  }
  if (isString(raw.type)) {
    if (!(ACTIVITY_TYPES as readonly string[]).includes(raw.type)) {
      return {
        ok: false,
        error: `Unknown type '${raw.type}'. Allowed: ${ACTIVITY_TYPES.join(", ")}`,
      };
    }
    filters.type = raw.type as ActivityFilters["type"];
  }
  if (isString(raw.since)) filters.since = raw.since;
  if (isString(raw.actorEmail)) filters.actorEmail = raw.actorEmail.toLowerCase();
  if (raw.source === "activity_log" || raw.source === "audit_event") {
    filters.source = raw.source;
  }

  return { ok: true, value: { filters, limit: resolveLimit(input.limit) } };
}

export async function listActivity(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: ActivityListArgs,
): Promise<QueryListResult<ActivityEntry>> {
  const { data, error } = await supabase.rpc("list_visible_activity", {
    viewer_email: viewerEmail,
    target_client_id: args.filters?.clientId ?? null,
    since_ts: args.filters?.since ?? null,
    limit_n: args.limit, // pre-capped via resolveLimit
  });
  if (error) throw new Error(`list_visible_activity failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const mapped: ActivityEntry[] = data
    .filter((row): row is VisibleActivityRow => !!row && typeof row === "object")
    .map(toActivityEntry);

  // Post-filter by type / actor / source — these aren't passed to the RPC
  // because list_visible_activity doesn't take them. Cheap because we
  // already capped via limit_n.
  const filtered = mapped.filter((row) => {
    const f = args.filters;
    if (!f) return true;
    if (f.type && row.type !== f.type) return false;
    if (f.actorEmail && (row.actorEmail ?? "").toLowerCase() !== f.actorEmail) return false;
    if (f.source && row.source !== f.source) return false;
    return true;
  });

  // No additional sort — list_visible_activity returns newest-first.
  return {
    rows: filtered,
    count: filtered.length,
    hasMore: false, // we already capped at the SQL boundary
    capped: filtered.length >= args.limit,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE — single dispatch through the query_crm_aggregate RPC
// ─────────────────────────────────────────────────────────────────────────────

/** Validated, fully-typed aggregate spec the RPC accepts. */
export interface AggregateArgs {
  entity: "clients" | "tasks" | "notes" | "activity" | "documents";
  groupBy?: string | null;
  aggregates: Array<{ fn: "count" | "sum" | "avg" | "min" | "max"; field?: string; as: string }>;
  filters: Record<string, unknown>;
  limit: number;
}

const AGGREGATE_ENTITIES = [
  "clients",
  "tasks",
  "notes",
  "activity",
  "documents",
] as const;
const AGGREGATE_FNS = ["count", "sum", "avg", "min", "max"] as const;
const MAX_AGGREGATES_PER_CALL = 5;
const ABSOLUTE_MAX_BUCKETS = 1_000;

export function parseAggregateArgs(input: Record<string, unknown>): {
  ok: true;
  value: AggregateArgs;
} | { ok: false; error: string } {
  const entityRaw = typeof input.entity === "string" ? input.entity : "";
  if (!(AGGREGATE_ENTITIES as readonly string[]).includes(entityRaw)) {
    return {
      ok: false,
      error: `Unknown entity '${entityRaw}'. Allowed for aggregate: ${AGGREGATE_ENTITIES.join(", ")}`,
    };
  }
  const entity = entityRaw as AggregateArgs["entity"];

  const groupBy =
    typeof input.groupBy === "string" && input.groupBy.length > 0 ? input.groupBy : null;

  const aggregatesRaw = Array.isArray(input.aggregates) ? input.aggregates : [];
  if (aggregatesRaw.length > MAX_AGGREGATES_PER_CALL) {
    return {
      ok: false,
      error: `At most ${MAX_AGGREGATES_PER_CALL} aggregate expressions per call (got ${aggregatesRaw.length}).`,
    };
  }
  const aggregates: AggregateArgs["aggregates"] = [];
  for (let i = 0; i < aggregatesRaw.length; i += 1) {
    const a = aggregatesRaw[i];
    if (!a || typeof a !== "object") {
      return { ok: false, error: `aggregates[${i}] must be an object.` };
    }
    const rec = a as Record<string, unknown>;
    const fn = typeof rec.fn === "string" ? rec.fn : "";
    const alias = typeof rec.as === "string" ? rec.as.trim() : "";
    const field = typeof rec.field === "string" ? rec.field : undefined;
    if (!(AGGREGATE_FNS as readonly string[]).includes(fn)) {
      return {
        ok: false,
        error: `aggregates[${i}].fn must be one of ${AGGREGATE_FNS.join(", ")} (got '${fn}').`,
      };
    }
    if (!alias) {
      return { ok: false, error: `aggregates[${i}].as is required (output alias).` };
    }
    if (fn !== "count" && !field) {
      return { ok: false, error: `aggregates[${i}] fn '${fn}' requires a 'field'.` };
    }
    aggregates.push({ fn: fn as AggregateArgs["aggregates"][number]["fn"], field, as: alias });
  }

  const filters: Record<string, unknown> = isObject(input.filters) ? { ...input.filters } : {};

  const limit = resolveAggregateLimit(input.limit);

  return { ok: true, value: { entity, groupBy, aggregates, filters, limit } };
}

function resolveAggregateLimit(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : 100;
  if (!Number.isFinite(n) || n < 1) return 100;
  return Math.min(n, ABSOLUTE_MAX_BUCKETS);
}

export interface AggregateResult {
  /** One row per groupBy bucket. Ungrouped queries return exactly one row with bucket='ALL'. */
  buckets: Array<{ bucket: string; metrics: Record<string, unknown> }>;
  count: number;
  /** True when buckets.length === limit; the model may want to add a more selective filter. */
  capped: boolean;
}

export async function runAggregate(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: AggregateArgs,
): Promise<AggregateResult> {
  // The RPC validates all allowlists server-side too — defense in depth.
  // We do the TS-side validation so the model gets a fast error without a
  // round trip when it sends a garbage payload.
  const { data, error } = await supabase.rpc("query_crm_aggregate", {
    viewer_email: viewerEmail,
    entity: args.entity,
    group_by: args.groupBy,
    aggregates: args.aggregates,
    filters: args.filters,
    limit_n: args.limit,
  });
  if (error) throw new Error(`query_crm_aggregate failed: ${error.message}`);
  const rows: Array<{ bucket: string; metrics: Record<string, unknown> }> = [];
  if (Array.isArray(data)) {
    for (const r of data) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const bucket = typeof rec.bucket === "string" ? rec.bucket : String(rec.bucket ?? "ALL");
      const metrics = isObject(rec.metrics) ? rec.metrics : {};
      rows.push({ bucket, metrics });
    }
  }
  return {
    buckets: rows,
    count: rows.length,
    capped: rows.length >= args.limit,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — TS-side ILIKE over the already-list_visible-* result sets
//
// No new SQL. The visibility-checked list comes from the same RPCs the `list`
// branch uses; we just substring-match per entity AFTER the RPC. Cheap because
// the RPC already caps to the viewer's visible cohort (which is small per
// advisor); for an advisor with many thousand visible rows we'd push search
// into Postgres, but that's a Phase 4+ optimization.
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchArgs {
  entity: "clients" | "tasks" | "notes" | "activity";
  /** Free-text query. Case-insensitive. Whitespace trimmed. */
  q: string;
  limit: number;
}

const SEARCH_ENTITIES = ["clients", "tasks", "notes", "activity"] as const;

export function parseSearchArgs(input: Record<string, unknown>): {
  ok: true;
  value: SearchArgs;
} | { ok: false; error: string } {
  const entityRaw = typeof input.entity === "string" ? input.entity : "";
  if (!(SEARCH_ENTITIES as readonly string[]).includes(entityRaw)) {
    return {
      ok: false,
      error: `Unknown entity '${entityRaw}'. Allowed for search: ${SEARCH_ENTITIES.join(", ")}`,
    };
  }
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (!q) {
    return { ok: false, error: "search requires a non-empty `q` string." };
  }
  // Guard against pathological queries that would return effectively everything.
  if (q.length < 2) {
    return { ok: false, error: "search `q` must be at least 2 characters." };
  }
  return {
    ok: true,
    value: {
      entity: entityRaw as SearchArgs["entity"],
      q,
      limit: resolveLimit(input.limit),
    },
  };
}

export async function searchClients(
  supabase: SupabaseClient,
  viewerEmail: string,
  q: string,
  limit: number,
): Promise<QueryListResult<ClientRosterItem>> {
  const { data, error } = await supabase.rpc("list_visible_clients", {
    viewer_email: viewerEmail,
  });
  if (error) throw new Error(`list_visible_clients failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const ql = q.toLowerCase();
  const rows = data
    .filter((r): r is ClientRow => !!r && typeof r === "object")
    .map((r) => toRosterItem(r))
    .filter((c) =>
      `${c.firstName} ${c.lastName} ${c.householdLabel ?? ""}`
        .toLowerCase()
        .includes(ql),
    );
  return finalize(rows, limit);
}

export async function searchTasks(
  supabase: SupabaseClient,
  viewerEmail: string,
  q: string,
  limit: number,
): Promise<QueryListResult<Task>> {
  const { data, error } = await supabase.rpc("list_visible_tasks", {
    viewer_email: viewerEmail,
  });
  if (error) throw new Error(`list_visible_tasks failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const ql = q.toLowerCase();
  const rows = data
    .filter((r): r is TaskRow => !!r && typeof r === "object")
    .map(toTask)
    .filter((t) =>
      `${t.title} ${t.description ?? ""}`.toLowerCase().includes(ql),
    );
  return finalize(rows, limit);
}

export async function searchNotes(
  supabase: SupabaseClient,
  viewerEmail: string,
  q: string,
  limit: number,
): Promise<QueryListResult<Note>> {
  const { data, error } = await supabase.rpc("list_visible_notes", {
    viewer_email: viewerEmail,
  });
  if (error) throw new Error(`list_visible_notes failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const ql = q.toLowerCase();
  const rows = data
    .filter((r): r is NoteRow => !!r && typeof r === "object")
    .map(toNote)
    .filter((n) => n.body.toLowerCase().includes(ql));
  return finalize(rows, limit);
}

export async function searchActivity(
  supabase: SupabaseClient,
  viewerEmail: string,
  q: string,
  limit: number,
): Promise<QueryListResult<ActivityEntry>> {
  // For activity, search runs against title + body. Cap pulled-back rows
  // higher than the user's `limit` so we still find matches deep in the
  // recent history.
  const { data, error } = await supabase.rpc("list_visible_activity", {
    viewer_email: viewerEmail,
    target_client_id: null,
    since_ts: null,
    limit_n: 500,
  });
  if (error) throw new Error(`list_visible_activity failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const ql = q.toLowerCase();
  const rows = data
    .filter((r): r is VisibleActivityRow => !!r && typeof r === "object")
    .map(toActivityEntry)
    .filter((a) =>
      `${a.title} ${a.body ?? ""}`.toLowerCase().includes(ql),
    );
  return finalize(rows, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH — surgical JSONB extraction via query_crm_path RPC
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PATHS_PER_CALL = 25;
const MAX_PATH_LENGTH = 200;

export interface PathArgs {
  entity: "clients";
  id: string;
  paths: string[];
}

export function parsePathArgs(input: Record<string, unknown>): {
  ok: true;
  value: PathArgs;
} | { ok: false; error: string } {
  if (input.entity !== "clients") {
    return {
      ok: false,
      error: "path is supported for `clients` only in v1.",
    };
  }
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!isUuid(id)) {
    return { ok: false, error: "path requires `id` (UUID)." };
  }
  if (!Array.isArray(input.paths) || input.paths.length === 0) {
    return {
      ok: false,
      error: "path requires `paths` (non-empty array of dotted strings).",
    };
  }
  if (input.paths.length > MAX_PATHS_PER_CALL) {
    return {
      ok: false,
      error: `At most ${MAX_PATHS_PER_CALL} paths per call (got ${input.paths.length}).`,
    };
  }
  const paths: string[] = [];
  for (let i = 0; i < input.paths.length; i += 1) {
    const p = input.paths[i];
    if (typeof p !== "string" || !p.trim()) {
      return { ok: false, error: `paths[${i}] must be a non-empty string.` };
    }
    if (p.length > MAX_PATH_LENGTH) {
      return {
        ok: false,
        error: `paths[${i}] is too long (max ${MAX_PATH_LENGTH} chars).`,
      };
    }
    paths.push(p.trim());
  }
  return { ok: true, value: { entity: "clients", id, paths } };
}

export interface PathResult {
  id: string;
  values: Record<string, unknown>;
}

export async function runPath(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: PathArgs,
): Promise<PathResult | { notFound: true }> {
  const { data, error } = await supabase.rpc("query_crm_path", {
    viewer_email: viewerEmail,
    entity: args.entity,
    id_text: args.id,
    paths: args.paths,
  });
  if (error) throw new Error(`query_crm_path failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    return { notFound: true };
  }
  // The SQL function returns columns `(id, extracted)` — `values` is a
  // reserved keyword in Postgres so we use `extracted` server-side. We
  // re-key it as `values` here for the LLM-facing response shape which
  // is more intuitive to narrate ("here are the values you asked for").
  const row = data[0] as Record<string, unknown>;
  const extracted =
    row && typeof row.extracted === "object" && row.extracted !== null
      ? (row.extracted as Record<string, unknown>)
      : {};
  return { id: args.id, values: extracted };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS — list with owner-or-client-visible expansion
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentListArgs {
  filters?: {
    clientId?: string;
    source?: string;
    status?: string;
    mimeType?: string;
    /** Match the existing /api/documents convention — statements excluded by default. */
    includeStatements?: boolean;
    since?: string;
  };
  limit: number;
}

export interface DocumentRow {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  storageBucket: string;
  storagePath: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sha256: string | null;
  source: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const STATEMENT_SOURCES = new Set(["advisor_upload", "client_upload"]);

export function parseDocumentsListArgs(input: Record<string, unknown>): {
  ok: true;
  value: DocumentListArgs;
} | { ok: false; error: string } {
  const filters: DocumentListArgs["filters"] = {};
  const raw = isObject(input.filters) ? input.filters : {};
  if (raw.clientId !== undefined) {
    if (!isUuid(raw.clientId)) {
      return { ok: false, error: "filters.clientId must be a UUID." };
    }
    filters.clientId = raw.clientId;
  }
  if (isString(raw.source)) filters.source = raw.source;
  if (isString(raw.status)) filters.status = raw.status;
  if (isString(raw.mimeType)) filters.mimeType = raw.mimeType;
  if (isString(raw.since)) filters.since = raw.since;
  if (typeof raw.includeStatements === "boolean") {
    filters.includeStatements = raw.includeStatements;
  }
  return { ok: true, value: { filters, limit: resolveLimit(input.limit) } };
}

export async function listDocuments(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: DocumentListArgs,
): Promise<QueryListResult<DocumentRow>> {
  // Visibility: owner_email match OR client_id is visible to viewer.
  // No `list_visible_documents` RPC exists, so we run TWO queries (owner +
  // client-visible) and dedupe in TS. Cheaper than building a generic RPC
  // for the small per-advisor document set.
  const lowered = viewerEmail.toLowerCase();

  const [ownerRes, clientRes] = await Promise.all([
    supabase
      .from("advisorpilot_documents")
      .select("*")
      .ilike("owner_email", lowered)
      .order("created_at", { ascending: false })
      .limit(500),
    args.filters?.clientId
      ? supabase
          .from("advisorpilot_documents")
          .select("*")
          .eq("client_id", args.filters.clientId)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (ownerRes.error) throw new Error(`documents fetch failed: ${ownerRes.error.message}`);
  if (clientRes.error) throw new Error(`documents fetch failed: ${clientRes.error.message}`);

  const byId = new Map<string, DocumentRow>();
  const ingest = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      if (typeof row.id !== "string") continue;
      // For client-scoped rows that aren't owner-visible we still need
      // visibility on the parent client. The /api/documents route enforces
      // this; for v1 we delegate to the simpler "clientId filter implies
      // the caller already has the client in scope" assumption — the chat
      // route only reaches this code with a client the model derived from
      // a prior query_crm call (which itself was visibility-gated).
      byId.set(row.id, toDocumentRow(row));
    }
  };
  ingest(ownerRes.data);
  if (args.filters?.clientId && clientRes.data) ingest(clientRes.data);

  let docs = [...byId.values()];

  // Apply post-filters.
  const f = args.filters ?? {};
  if (f.clientId) docs = docs.filter((d) => d.clientId === f.clientId);
  if (f.source) docs = docs.filter((d) => d.source === f.source);
  if (f.status) docs = docs.filter((d) => d.status === f.status);
  if (f.mimeType) docs = docs.filter((d) => d.mimeType === f.mimeType);
  if (f.since) docs = docs.filter((d) => d.createdAt >= f.since!);

  // Statements excluded by default — matches /api/documents behavior.
  if (f.includeStatements !== true) {
    docs = docs.filter((d) => !STATEMENT_SOURCES.has(d.source));
  }

  // Sort newest first across the merged set.
  docs.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

  return finalize(docs, args.limit);
}

function toDocumentRow(r: Record<string, unknown>): DocumentRow {
  return {
    id: String(r.id),
    ownerEmail: String(r.owner_email ?? ""),
    clientId: typeof r.client_id === "string" ? r.client_id : null,
    storageBucket: String(r.storage_bucket ?? ""),
    storagePath: String(r.storage_path ?? ""),
    originalFileName: typeof r.original_file_name === "string" ? r.original_file_name : null,
    mimeType: typeof r.mime_type === "string" ? r.mime_type : null,
    fileSizeBytes: typeof r.file_size_bytes === "number" ? r.file_size_bytes : null,
    sha256: typeof r.sha256 === "string" ? r.sha256 : null,
    source: String(r.source ?? ""),
    status: String(r.status ?? ""),
    metadata: isObject(r.metadata) ? r.metadata : {},
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH JOBS — list (owner-only)
// ─────────────────────────────────────────────────────────────────────────────

interface ResearchJobFilters {
  status?: "queued" | "running" | "complete" | "error";
  tier?: string;
  since?: string;
}

export interface ResearchJobListArgs {
  filters?: ResearchJobFilters;
  limit: number;
}

export interface ResearchJobRow {
  id: string;
  ownerEmail: string;
  provider: string;
  tier: string;
  status: string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  externalHandle: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const RESEARCH_STATUSES = ["queued", "running", "complete", "error"] as const;

export function parseResearchJobsListArgs(input: Record<string, unknown>): {
  ok: true;
  value: ResearchJobListArgs;
} | { ok: false; error: string } {
  const filters: ResearchJobListArgs["filters"] = {};
  const raw = isObject(input.filters) ? input.filters : {};
  if (raw.status !== undefined) {
    if (!isString(raw.status) || !(RESEARCH_STATUSES as readonly string[]).includes(raw.status)) {
      return {
        ok: false,
        error: `Unknown status '${String(raw.status)}'. Allowed: ${RESEARCH_STATUSES.join(", ")}`,
      };
    }
    filters.status = raw.status as ResearchJobFilters["status"];
  }
  if (isString(raw.tier)) filters.tier = raw.tier;
  if (isString(raw.since)) filters.since = raw.since;
  return { ok: true, value: { filters, limit: resolveLimit(input.limit) } };
}

export async function listResearchJobs(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: ResearchJobListArgs,
): Promise<QueryListResult<ResearchJobRow>> {
  // Owner-only — the table has no shared/org dimension; advisors only see
  // their own research jobs.
  let q = supabase
    .from("advisorpilot_deep_research_jobs")
    .select("*")
    .ilike("owner_email", viewerEmail.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(args.limit);

  const f = args.filters ?? {};
  if (f.status) q = q.eq("status", f.status);
  if (f.tier) q = q.eq("tier", f.tier);
  if (f.since) q = q.gte("created_at", f.since);

  const { data, error } = await q;
  if (error) throw new Error(`research_jobs fetch failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const rows: ResearchJobRow[] = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    rows.push({
      id: String(row.id),
      ownerEmail: String(row.owner_email ?? ""),
      provider: String(row.provider ?? ""),
      tier: String(row.tier ?? ""),
      status: String(row.status ?? ""),
      request: isObject(row.request) ? row.request : {},
      result: isObject(row.result) ? row.result : null,
      error: typeof row.error === "string" ? row.error : null,
      externalHandle: typeof row.external_handle === "string" ? row.external_handle : null,
      startedAt: typeof row.started_at === "string" ? row.started_at : null,
      completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    });
  }

  return finalize(rows, args.limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS — list + get
// ─────────────────────────────────────────────────────────────────────────────

interface ReportsFilters {
  clientId?: string;
  status?: "draft" | "published" | "archived";
  source?: "ai_generated" | "advisor_authored" | "imported";
  /** Filter to only the advisor's own reports (excludes org/shared). */
  ownerOnly?: boolean;
  /** Substring match on title (case-insensitive). */
  search?: string;
  /** ISO datetime — only reports created on/after this point. */
  since?: string;
}

interface ReportsListArgs {
  filters?: ReportsFilters;
  sort?: ReportSort;
  limit: number;
}

const REPORT_SORTS = ["created-desc", "created-asc", "title-asc"] as const;
type ReportSort = (typeof REPORT_SORTS)[number];

const REPORT_STATUSES = ["draft", "published", "archived"] as const;
const REPORT_SOURCES = ["ai_generated", "advisor_authored", "imported"] as const;

export function parseReportsListArgs(input: Record<string, unknown>): {
  ok: true;
  value: ReportsListArgs;
} | { ok: false; error: string } {
  const filters: ReportsFilters = {};
  const raw = isObject(input.filters) ? input.filters : {};

  if (raw.clientId !== undefined) {
    if (!isUuid(raw.clientId)) {
      return { ok: false, error: "filters.clientId must be a UUID." };
    }
    filters.clientId = raw.clientId;
  }
  if (isString(raw.status)) {
    if (!(REPORT_STATUSES as readonly string[]).includes(raw.status)) {
      return {
        ok: false,
        error: `Unknown status '${raw.status}'. Allowed: ${REPORT_STATUSES.join(", ")}`,
      };
    }
    filters.status = raw.status as ReportsFilters["status"];
  }
  if (isString(raw.source)) {
    if (!(REPORT_SOURCES as readonly string[]).includes(raw.source)) {
      return {
        ok: false,
        error: `Unknown source '${raw.source}'. Allowed: ${REPORT_SOURCES.join(", ")}`,
      };
    }
    filters.source = raw.source as ReportsFilters["source"];
  }
  if (typeof raw.ownerOnly === "boolean") filters.ownerOnly = raw.ownerOnly;
  if (isString(raw.search)) filters.search = raw.search;
  if (isString(raw.since)) filters.since = raw.since;

  let sort: ReportSort | undefined;
  if (typeof input.sort === "string") {
    if (!(REPORT_SORTS as readonly string[]).includes(input.sort)) {
      return {
        ok: false,
        error: `Unknown sort '${input.sort}' for reports. Allowed: ${REPORT_SORTS.join(", ")}`,
      };
    }
    sort = input.sort as ReportSort;
  }

  return { ok: true, value: { filters, sort, limit: resolveLimit(input.limit) } };
}

export async function listReports(
  supabase: SupabaseClient,
  viewerEmail: string,
  args: ReportsListArgs,
): Promise<QueryListResult<Report>> {
  const { data, error } = await supabase.rpc("list_visible_reports", {
    viewer_email: viewerEmail,
  });
  if (error) throw new Error(`list_visible_reports failed: ${error.message}`);
  if (!Array.isArray(data)) return { rows: [], count: 0, hasMore: false, capped: false };

  const lowered = viewerEmail.toLowerCase();
  const mapped: Report[] = data
    .filter((row): row is ReportRow => !!row && typeof row === "object")
    .map(toReport);

  const f = args.filters ?? {};
  const filtered = mapped.filter((r) => {
    if (f.clientId && r.clientId !== f.clientId) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.source && r.source !== f.source) return false;
    if (f.ownerOnly && r.ownerEmail.toLowerCase() !== lowered) return false;
    if (f.since && r.createdAt < f.since) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!r.title.toLowerCase().includes(q)) return false;
    }
    // Archived reports are hidden by default (matches the UI's
    // "archived = hidden from main list" convention). Status='archived'
    // filter is the explicit opt-in.
    if (!f.status && r.status === "archived") return false;
    return true;
  });

  const sorted = sortReportRows(filtered, args.sort ?? "created-desc");
  return finalize(sorted, args.limit);
}

function sortReportRows(rows: Report[], sort: ReportSort): Report[] {
  const out = [...rows];
  switch (sort) {
    case "created-desc":
      out.sort((a, b) => compareDateDescNullsLast(a.createdAt, b.createdAt));
      return out;
    case "created-asc":
      out.sort((a, b) => compareDateAscNullsLast(a.createdAt, b.createdAt));
      return out;
    case "title-asc":
      out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
      return out;
  }
}

export async function getReport(
  supabase: SupabaseClient,
  viewerEmail: string,
  reportId: string,
): Promise<Report | null> {
  const { data: visible, error: visErr } = await supabase.rpc("reports_visible_to", {
    viewer_email: viewerEmail,
    report_id: reportId,
  });
  if (visErr) throw new Error(`reports_visible_to failed: ${visErr.message}`);
  if (visible !== true) return null;

  const { data, error } = await supabase
    .from("advisorpilot_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw new Error(`report fetch failed: ${error.message}`);
  if (!data) return null;
  return toReport(data as ReportRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVISOR PROFILE — single-row entity; no filters
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvisorProfileRow {
  ownerEmail: string;
  advisorName: string | null;
  advisorTitle: string | null;
  advisorLicense: string | null;
  emailSignature: string | null;
  logoUrl: string | null;
  calendarLink: string | null;
  officeAddress: string | null;
  officePhone: string | null;
  cellPhone: string | null;
  website: string | null;
  disclosuresText: string | null;
  disclosuresImageUrl: string | null;
  llmProvider: string | null;
  llmModelOverrides: Record<string, string> | null;
  defaultResearchTier: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getAdvisorProfile(
  supabase: SupabaseClient,
  viewerEmail: string,
): Promise<AdvisorProfileRow | null> {
  const { data, error } = await supabase
    .from("advisorpilot_advisor_profiles")
    .select(
      "owner_email, advisor_name, advisor_title, advisor_license, email_signature, logo_url, calendar_link, office_address, office_phone, cell_phone, website, disclosures_text, disclosures_image_url, llm_provider, llm_model_overrides, default_research_tier, created_at, updated_at",
    )
    .ilike("owner_email", viewerEmail.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`advisor_profile fetch failed: ${error.message}`);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    ownerEmail: String(r.owner_email ?? viewerEmail),
    advisorName: typeof r.advisor_name === "string" ? r.advisor_name : null,
    advisorTitle: typeof r.advisor_title === "string" ? r.advisor_title : null,
    advisorLicense: typeof r.advisor_license === "string" ? r.advisor_license : null,
    emailSignature: typeof r.email_signature === "string" ? r.email_signature : null,
    logoUrl: typeof r.logo_url === "string" ? r.logo_url : null,
    calendarLink: typeof r.calendar_link === "string" ? r.calendar_link : null,
    officeAddress: typeof r.office_address === "string" ? r.office_address : null,
    officePhone: typeof r.office_phone === "string" ? r.office_phone : null,
    cellPhone: typeof r.cell_phone === "string" ? r.cell_phone : null,
    website: typeof r.website === "string" ? r.website : null,
    disclosuresText: typeof r.disclosures_text === "string" ? r.disclosures_text : null,
    disclosuresImageUrl: typeof r.disclosures_image_url === "string" ? r.disclosures_image_url : null,
    llmProvider: typeof r.llm_provider === "string" ? r.llm_provider : null,
    llmModelOverrides: isObject(r.llm_model_overrides)
      ? (r.llm_model_overrides as Record<string, string>)
      : null,
    defaultResearchTier:
      typeof r.default_research_tier === "string" ? r.default_research_tier : null,
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────────────

function finalize<T>(rows: T[], limit: number): QueryListResult<T> {
  const limited = rows.slice(0, limit);
  return {
    rows: limited,
    count: limited.length,
    hasMore: rows.length > limit,
    capped: limited.length >= ABSOLUTE_MAX_ROWS,
  };
}

function compareDateAscNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function compareDateDescNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a > b ? -1 : 1;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
