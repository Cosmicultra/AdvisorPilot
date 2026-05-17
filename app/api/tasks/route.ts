import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import {
  isTaskPriority,
  toTask,
  type TaskRow,
} from "@/lib/crm/task-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import type { Task } from "@/lib/crm/types";

/**
 * /api/tasks — collection endpoint.
 *
 * GET    list visible tasks (filter by clientId/status/due/priority,
 *        sort by due-date asc, paginate)
 * POST   create a task. clientId optional (personal task when omitted).
 *        Side effect: writes activity_log (type='task').
 *
 * Visibility on read: list_visible_tasks SQL function.
 * Visibility on write: when clientId is set, viewer must be able to see
 * the client (clients_visible_to). Otherwise return 404 (don't leak existence).
 *
 * Spec: docs/crm/20-technical-specs.md §2.1.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;

// ─── GET ──────────────────────────────────────────────────────────────────

export const GET = async (req: Request) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to load tasks." }, { status: 401 });
    }

    const params = new URL(req.url).searchParams;
    const clientId = trimOrNull(params.get("clientId"));
    if (clientId !== null && !isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid clientId." }, { status: 400 });
    }
    const statusFilter = trimOrNull(params.get("status"));
    const priorityFilter = trimOrNull(params.get("priority"));
    const dueFilter = trimOrNull(params.get("due")); // 'today' | 'week' | 'overdue' | null
    const limit = clamp(numOr(params.get("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT);
    const offset = Math.max(0, numOr(params.get("offset"), 0));

    const supabase = getCrmSupabaseAdmin();
    const startedAt = Date.now();
    const { data, error } = await supabase.rpc("list_visible_tasks", {
      viewer_email: identity.email,
    });
    const fetchMs = Date.now() - startedAt;

    if (error) {
      console.error("[crm:api] route=/api/tasks rpc-error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const all = ((data ?? []) as TaskRow[]).map(toTask);
    const filtered = applyFilters(all, {
      clientId,
      status: statusFilter,
      priority: priorityFilter,
      due: dueFilter,
    });
    const sorted = [...filtered].sort(sortTasks);
    const paged = sorted.slice(offset, offset + limit);

    console.info(
      `[crm:api] route=/api/tasks status=200 fetchMs=${fetchMs} rows=${all.length} returned=${paged.length}`
    );

    return NextResponse.json({
      tasks: paged,
      total: filtered.length,
      hasMore: offset + paged.length < filtered.length,
    });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/tasks GET error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load tasks." },
      { status: 500 }
    );
  }
};

// ─── POST ─────────────────────────────────────────────────────────────────

export const POST = async (req: Request) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to create a task." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateNewTaskBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    // Resolve org_id: inherit from the client when clientId is set; else use
    // advisor's personal org. Also gates access via clients_visible_to.
    let orgId: string | null = null;
    if (validation.clientId) {
      const visibleResult = await supabase.rpc("clients_visible_to", {
        viewer_email: identity.email,
        client_id: validation.clientId,
      });
      if (visibleResult.error) {
        console.error("[crm:api] route=/api/tasks POST visibility-rpc-error", visibleResult.error);
        return NextResponse.json({ error: visibleResult.error.message }, { status: 400 });
      }
      if (visibleResult.data !== true) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }
      const { data: clientRow } = await supabase
        .from("advisorpilot_clients")
        .select("org_id")
        .eq("id", validation.clientId)
        .maybeSingle();
      orgId = (clientRow?.org_id as string | undefined) ?? null;
    }
    if (!orgId) {
      orgId = await ensurePersonalOrg(identity.email);
    }

    const insertPayload = {
      owner_email: identity.email,
      owner_user_id: identity.userId,
      client_id: validation.clientId,
      org_id: orgId,
      visibility: "private",
      title: validation.title,
      description: validation.description,
      due_date: validation.dueDate,
      due_time: validation.dueTime,
      priority: validation.priority,
      status: "open",
      tags: validation.tags,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("advisorpilot_tasks")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !inserted) {
      console.error("[crm:api] route=/api/tasks POST insert-error", insertError);
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create task." },
        { status: 400 }
      );
    }

    const task = toTask(inserted as TaskRow);

    // Side effect: activity_log entry (best-effort).
    await writeActivityLog(supabase, {
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      clientId: task.clientId,
      type: "task",
      title: `Task created: ${task.title}`,
      actorEmail: identity.email,
      metadata: { task_id: task.id, action: "created", priority: task.priority },
    });

    console.info(`[crm:api] route=/api/tasks status=201 task_id=${task.id}`);

    return NextResponse.json({ task }, { status: 201 });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/tasks POST error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create task." },
      { status: 500 }
    );
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────

interface NewTaskValidation {
  ok: true;
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: Task["priority"];
  tags: string[];
}

interface NewTaskValidationError {
  ok: false;
  error: string;
}

function validateNewTaskBody(body: unknown): NewTaskValidation | NewTaskValidationError {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid body." };
  }
  const b = body as Record<string, unknown>;

  const titleRaw = typeof b.title === "string" ? b.title.trim() : "";
  if (!titleRaw) {
    return { ok: false, error: "title is required." };
  }
  if (titleRaw.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }

  let clientId: string | null = null;
  if (b.clientId !== undefined && b.clientId !== null && b.clientId !== "") {
    if (typeof b.clientId !== "string" || !isUuid(b.clientId)) {
      return { ok: false, error: "clientId must be a UUID or null." };
    }
    clientId = b.clientId;
  }

  let description: string | null = null;
  if (typeof b.description === "string" && b.description.trim()) {
    description = b.description.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
      };
    }
  }

  let dueDate: string | null = null;
  if (typeof b.dueDate === "string" && b.dueDate.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate.trim())) {
      return { ok: false, error: "dueDate must be YYYY-MM-DD." };
    }
    dueDate = b.dueDate.trim();
  }

  let dueTime: string | null = null;
  if (typeof b.dueTime === "string" && b.dueTime.trim()) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(b.dueTime.trim())) {
      return { ok: false, error: "dueTime must be HH:MM or HH:MM:SS." };
    }
    dueTime = b.dueTime.trim();
  }

  let priority: Task["priority"] = "Medium";
  if (b.priority !== undefined && b.priority !== null) {
    if (!isTaskPriority(b.priority)) {
      return { ok: false, error: "priority must be High|Medium|Low." };
    }
    priority = b.priority;
  }

  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  return { ok: true, clientId, title: titleRaw, description, dueDate, dueTime, priority, tags };
}

interface TaskListFilters {
  clientId: string | null;
  status: string | null;
  priority: string | null;
  due: string | null; // 'today' | 'week' | 'overdue'
}

function applyFilters(tasks: Task[], f: TaskListFilters): Task[] {
  const now = new Date();
  const today = ymd(now);
  const weekFromNow = ymd(addDays(now, 7));

  return tasks.filter((t) => {
    if (f.clientId && t.clientId !== f.clientId) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.priority && t.priority !== f.priority) return false;

    if (f.due === "overdue") {
      if (!t.dueDate || t.dueDate >= today) return false;
      if (t.status === "done" || t.status === "cancelled") return false;
    } else if (f.due === "today") {
      if (t.dueDate !== today) return false;
    } else if (f.due === "week") {
      if (!t.dueDate || t.dueDate < today || t.dueDate > weekFromNow) return false;
    }

    return true;
  });
}

function sortTasks(a: Task, b: Task): number {
  // Done items sink to the bottom; otherwise ascending due date (nulls last).
  const aDone = a.status === "done" || a.status === "cancelled";
  const bDone = b.status === "done" || b.status === "cancelled";
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function numOr(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Number(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
