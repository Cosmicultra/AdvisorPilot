/**
 * `manage_task` — compound write tool for tasks (todos).
 *
 * Four operations:
 *   - create   (T2) — no confirmation; inserts a task
 *   - update   (T3) — preview-then-confirm; updates title/description/due/etc.
 *   - delete   (T4) — preview-then-confirm; removes a single task
 *   - complete (T3) — sugar for `update(status: "done")`; preview-then-confirm.
 *                     Separate operation because "complete this task" is the
 *                     most common write the advisor will ask Nova to do.
 *
 * Side effects mirror `app/api/tasks/route.ts` POST + `[id]/route.ts`
 * PATCH/DELETE: every create/update/delete writes an activity_log entry
 * to surface on the client's Timeline tab (or the global tasks list when
 * client_id is null).
 *
 * Visibility:
 *   - create  → if clientId provided, clients_visible_to(viewer, clientId)
 *   - update / delete / complete → tasks_visible_to(viewer, taskId)
 *
 * Spec: docs/crm/70-orchestrator-tools.md §5.2.
 */

import { writeActivityLog } from "@/lib/crm/activity-writer";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import {
  isTaskPriority,
  isTaskStatus,
  toTask,
  type TaskRow,
} from "@/lib/crm/task-mapper";
import type { Task } from "@/lib/crm/types";
import { diffShallow, withConfirmation } from "./confirmation";
import { isUuid } from "./query-crm-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Tool surface
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    operation: {
      type: "string",
      enum: ["create", "update", "delete", "complete"],
      description:
        "create = new task (no confirmation). update = change title/description/due/priority/status/tags (preview-then-confirm). delete = remove a task (preview-then-confirm). complete = sugar for update(status:'done') (preview-then-confirm).",
    },
    taskId: {
      type: "string",
      description: "UUID of the task. REQUIRED for update, delete, complete.",
    },
    clientId: {
      type: "string",
      description:
        "UUID of the parent client. Optional on create — pass null (or omit) to create a personal/global task that shows up in /app/tasks but not on any client's Tasks tab.",
    },
    title: {
      type: "string",
      description: "Task title. REQUIRED for create. Optional on update. Max 200 chars.",
    },
    description: {
      type: "string",
      description:
        "Free-form longer description. Optional. Max 4,000 chars. Pass empty string on update to clear.",
    },
    dueDate: {
      type: "string",
      description:
        "ISO date (YYYY-MM-DD). Optional. Pass null on update to clear.",
    },
    dueTime: {
      type: "string",
      description:
        "24h time (HH:MM). Optional; only meaningful when dueDate is set. Pass null on update to clear.",
    },
    priority: {
      type: "string",
      enum: ["High", "Medium", "Low"],
      description: "Defaults to 'Medium' on create.",
    },
    status: {
      type: "string",
      enum: ["open", "in_progress", "done", "cancelled"],
      description:
        "Defaults to 'open' on create. Use 'complete' operation for 'done' transitions when possible.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Free-form tag list. Replaces the existing list on update.",
    },
    _confirmed: {
      type: "boolean",
      description:
        "Set to true on the SECOND call after the advisor confirms an update / delete / complete preview. Omit on the first call to receive the preview.",
    },
  },
  required: ["operation"],
};

export const manageTaskTool: ChatTool = {
  name: "manage_task",
  description:
    "Write tool for tasks (todos). Operations: `create` (T2), `update` / `complete` (T3, preview-then-confirm), `delete` (T4, preview-then-confirm). Tasks can be client-scoped or personal/global (clientId omitted on create). Side effects: every successful write logs an activity-log entry; status transitions to 'done' produce a 'Task completed' entry for the timeline.",
  parameters: PARAMETERS,
  handler: handleManageTask,
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler — dispatches by operation
// ─────────────────────────────────────────────────────────────────────────────

async function handleManageTask(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const op = typeof args.operation === "string" ? args.operation : "";
  if (op !== "create" && op !== "update" && op !== "delete" && op !== "complete") {
    return { error: `Unknown operation '${op}'. Allowed: create | update | delete | complete.` };
  }

  try {
    if (op === "create") return await handleCreate(args, ctx);
    if (op === "update") return await handleUpdate(args, ctx);
    if (op === "delete") return await handleDelete(args, ctx);
    return await handleComplete(args, ctx);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// create (T2)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCreate(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const v = validateCreate(args);
  if (!v.ok) return { error: v.error };

  // org_id resolution: inherit from the client when clientId is set;
  // otherwise use advisor's personal org. Same flow as the API route.
  let orgId: string | null = null;
  if (v.clientId) {
    const vis = await ctx.supabase.rpc("clients_visible_to", {
      viewer_email: ctx.advisorEmail,
      client_id: v.clientId,
    });
    if (vis.error) return { error: `clients_visible_to failed: ${vis.error.message}` };
    if (vis.data !== true) return { error: "Client not found." };

    const { data: clientRow } = await ctx.supabase
      .from("advisorpilot_clients")
      .select("org_id")
      .eq("id", v.clientId)
      .maybeSingle();
    orgId = (clientRow?.org_id as string | undefined) ?? null;
  }
  if (!orgId) {
    orgId = await ensurePersonalOrg(ctx.advisorEmail);
  }

  const { data: inserted, error: insertError } = await ctx.supabase
    .from("advisorpilot_tasks")
    .insert({
      owner_email: ctx.advisorEmail,
      owner_user_id: null,
      client_id: v.clientId,
      org_id: orgId,
      visibility: "private",
      title: v.title,
      description: v.description,
      due_date: v.dueDate,
      due_time: v.dueTime,
      priority: v.priority,
      status: "open",
      tags: v.tags,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    return { error: insertError?.message ?? "Failed to create task." };
  }
  const task = toTask(inserted as TaskRow);

  await writeActivityLog(ctx.supabase, {
    ownerEmail: ctx.advisorEmail,
    ownerUserId: null,
    clientId: task.clientId,
    type: "task",
    title: `Task created: ${task.title}`,
    actorEmail: ctx.advisorEmail,
    metadata: {
      task_id: task.id,
      action: "created",
      priority: task.priority,
      created_by: "chat_tool",
    },
  });

  return { result: { success: true, action: "create_task", task } };
}

interface CreateValidationOk {
  ok: true;
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: Task["priority"];
  tags: string[];
}
interface CreateValidationError {
  ok: false;
  error: string;
}

function validateCreate(args: Record<string, unknown>): CreateValidationOk | CreateValidationError {
  // clientId: null OR UUID OR omitted (== null)
  let clientId: string | null = null;
  if (args.clientId !== undefined && args.clientId !== null) {
    if (typeof args.clientId !== "string" || !isUuid(args.clientId.trim())) {
      return { ok: false, error: "`clientId` must be a UUID or null/omitted for personal tasks." };
    }
    clientId = args.clientId.trim();
  }
  if (typeof args.title !== "string" || !args.title.trim()) {
    return { ok: false, error: "create requires `title`." };
  }
  const title = args.title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `\`title\` must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }
  let description: string | null = null;
  if (args.description !== undefined && args.description !== null) {
    if (typeof args.description !== "string") {
      return { ok: false, error: "`description` must be a string." };
    }
    const d = args.description.trim();
    if (d.length > MAX_DESCRIPTION_LENGTH) {
      return { ok: false, error: `\`description\` must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` };
    }
    description = d || null;
  }
  let dueDate: string | null = null;
  if (args.dueDate !== undefined && args.dueDate !== null) {
    if (typeof args.dueDate !== "string" || !ISO_DATE_RE.test(args.dueDate)) {
      return { ok: false, error: "`dueDate` must be YYYY-MM-DD or null." };
    }
    dueDate = args.dueDate;
  }
  let dueTime: string | null = null;
  if (args.dueTime !== undefined && args.dueTime !== null) {
    if (typeof args.dueTime !== "string" || !HHMM_RE.test(args.dueTime)) {
      return { ok: false, error: "`dueTime` must be HH:MM (24h) or null." };
    }
    dueTime = args.dueTime;
  }
  let priority: Task["priority"] = "Medium";
  if (args.priority !== undefined) {
    if (!isTaskPriority(args.priority)) {
      return { ok: false, error: "`priority` must be High|Medium|Low." };
    }
    priority = args.priority as Task["priority"];
  }
  const tags = Array.isArray(args.tags)
    ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  return { ok: true, clientId, title, description, dueDate, dueTime, priority, tags };
}

// ─────────────────────────────────────────────────────────────────────────────
// update (T3) — preview then confirm
// ─────────────────────────────────────────────────────────────────────────────

interface UpdatePatch {
  title?: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  priority?: Task["priority"];
  status?: Task["status"];
  tags?: string[];
  completed_at?: string | null;
}

async function handleUpdate(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const v = validateUpdate(args);
  if (!v.ok) return { error: v.error };
  const { taskId, patch } = v;
  if (Object.keys(patch).length === 0) {
    return {
      error: "update needs at least one of: title, description, dueDate, dueTime, priority, status, tags.",
    };
  }

  return withConfirmation({
    args,
    action: "update_task",
    buildPreview: () => buildUpdatePreview(ctx, taskId, patch),
    execute: () => executeUpdate(ctx, taskId, patch),
  });
}

interface UpdateValidationOk {
  ok: true;
  taskId: string;
  patch: UpdatePatch;
}
interface UpdateValidationError {
  ok: false;
  error: string;
}

function validateUpdate(args: Record<string, unknown>): UpdateValidationOk | UpdateValidationError {
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  if (!isUuid(taskId)) {
    return { ok: false, error: "update requires `taskId` (UUID)." };
  }
  const patch: UpdatePatch = {};
  if (args.title !== undefined) {
    if (typeof args.title !== "string" || !args.title.trim()) {
      return { ok: false, error: "`title` must be a non-empty string when provided." };
    }
    if (args.title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `\`title\` must be ${MAX_TITLE_LENGTH} characters or fewer.` };
    }
    patch.title = args.title.trim();
  }
  if (args.description !== undefined) {
    if (args.description === null) patch.description = null;
    else if (typeof args.description !== "string") {
      return { ok: false, error: "`description` must be a string or null." };
    } else {
      const d = args.description.trim();
      if (d.length > MAX_DESCRIPTION_LENGTH) {
        return { ok: false, error: `\`description\` must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` };
      }
      patch.description = d || null;
    }
  }
  if (args.dueDate !== undefined) {
    if (args.dueDate === null) patch.due_date = null;
    else if (typeof args.dueDate !== "string" || !ISO_DATE_RE.test(args.dueDate)) {
      return { ok: false, error: "`dueDate` must be YYYY-MM-DD or null." };
    } else {
      patch.due_date = args.dueDate;
    }
  }
  if (args.dueTime !== undefined) {
    if (args.dueTime === null) patch.due_time = null;
    else if (typeof args.dueTime !== "string" || !HHMM_RE.test(args.dueTime)) {
      return { ok: false, error: "`dueTime` must be HH:MM or null." };
    } else {
      patch.due_time = args.dueTime;
    }
  }
  if (args.priority !== undefined) {
    if (!isTaskPriority(args.priority)) {
      return { ok: false, error: "`priority` must be High|Medium|Low." };
    }
    patch.priority = args.priority as Task["priority"];
  }
  if (args.status !== undefined) {
    if (!isTaskStatus(args.status)) {
      return { ok: false, error: "`status` must be open|in_progress|done|cancelled." };
    }
    patch.status = args.status as Task["status"];
    if (args.status === "done") {
      patch.completed_at = new Date().toISOString();
    } else if (args.status === "open" || args.status === "in_progress") {
      // Reopening — clear the completed timestamp.
      patch.completed_at = null;
    }
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) {
      return { ok: false, error: "`tags` must be an array of strings." };
    }
    patch.tags = args.tags.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
  }
  return { ok: true, taskId, patch };
}

async function buildUpdatePreview(
  ctx: ChatToolContext,
  taskId: string,
  patch: UpdatePatch,
): Promise<{ taskId: string; diff: Record<string, { before: unknown; after: unknown }> } | { error: string }> {
  const visible = await fetchVisibleTask(ctx, taskId);
  if ("error" in visible) return visible;
  const previous = visible.task;
  // Map snake_case patch keys onto the camelCase Task shape for diff display.
  const camelPatch: Record<string, unknown> = {};
  if ("title" in patch) camelPatch.title = patch.title;
  if ("description" in patch) camelPatch.description = patch.description;
  if ("due_date" in patch) camelPatch.dueDate = patch.due_date;
  if ("due_time" in patch) camelPatch.dueTime = patch.due_time;
  if ("priority" in patch) camelPatch.priority = patch.priority;
  if ("status" in patch) camelPatch.status = patch.status;
  if ("tags" in patch) camelPatch.tags = patch.tags;

  const diff = diffShallow(previous as unknown as Record<string, unknown>, camelPatch);
  if (Object.keys(diff).length === 0) {
    return { error: "No-op update — the requested patch matches the current values." };
  }
  return { taskId, diff };
}

async function executeUpdate(
  ctx: ChatToolContext,
  taskId: string,
  patch: UpdatePatch,
): Promise<{ task: Task; statusTransition: { from: Task["status"]; to: Task["status"] } | null } | { error: string }> {
  const visible = await fetchVisibleTask(ctx, taskId);
  if ("error" in visible) return visible;
  const previous = visible.task;

  const { data: updatedRow, error: updateError } = await ctx.supabase
    .from("advisorpilot_tasks")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();
  if (updateError || !updatedRow) {
    return { error: updateError?.message ?? "Failed to update task." };
  }
  const updated = toTask(updatedRow as TaskRow);

  // Activity log: title varies by status transition for nice timeline reads.
  const statusChanged = updated.status !== previous.status;
  let activityTitle = `Task updated: ${updated.title}`;
  if (statusChanged && updated.status === "done") {
    activityTitle = `Task completed: ${updated.title}`;
  } else if (statusChanged && updated.status === "cancelled") {
    activityTitle = `Task cancelled: ${updated.title}`;
  } else if (statusChanged && (updated.status === "open" || updated.status === "in_progress")) {
    activityTitle = `Task reopened: ${updated.title}`;
  }

  await writeActivityLog(ctx.supabase, {
    ownerEmail: ctx.advisorEmail,
    ownerUserId: null,
    clientId: updated.clientId,
    type: "task",
    title: activityTitle,
    actorEmail: ctx.advisorEmail,
    metadata: {
      task_id: updated.id,
      action: "updated",
      status_from: previous.status,
      status_to: updated.status,
      edited_by: "chat_tool",
    },
  });

  return {
    task: updated,
    statusTransition: statusChanged
      ? { from: previous.status, to: updated.status }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// complete (T3) — sugar for update(status: 'done')
// ─────────────────────────────────────────────────────────────────────────────

async function handleComplete(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  if (!isUuid(taskId)) {
    return { error: "complete requires `taskId` (UUID)." };
  }
  return withConfirmation({
    args,
    action: "complete_task",
    buildPreview: async () => {
      const visible = await fetchVisibleTask(ctx, taskId);
      if ("error" in visible) return visible;
      const t = visible.task;
      if (t.status === "done") {
        return { error: "Task is already completed." };
      }
      return {
        taskId,
        snapshot: {
          title: t.title,
          currentStatus: t.status,
          willTransitionTo: "done" as const,
        },
      };
    },
    execute: () =>
      executeUpdate(ctx, taskId, {
        status: "done",
        completed_at: new Date().toISOString(),
      }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// delete (T4)
// ─────────────────────────────────────────────────────────────────────────────

async function handleDelete(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  if (!isUuid(taskId)) {
    return { error: "delete requires `taskId` (UUID)." };
  }
  return withConfirmation({
    args,
    action: "delete_task",
    buildPreview: async () => {
      const visible = await fetchVisibleTask(ctx, taskId);
      if ("error" in visible) return visible;
      const t = visible.task;
      return {
        taskId,
        snapshot: {
          title: t.title,
          status: t.status,
          priority: t.priority,
          clientId: t.clientId,
          dueDate: t.dueDate,
        },
      };
    },
    execute: async () => {
      const visible = await fetchVisibleTask(ctx, taskId);
      if ("error" in visible) return visible;
      const t = visible.task;

      const { error: deleteError } = await ctx.supabase
        .from("advisorpilot_tasks")
        .delete()
        .eq("id", taskId);
      if (deleteError) return { error: deleteError.message };

      await writeActivityLog(ctx.supabase, {
        ownerEmail: ctx.advisorEmail,
        ownerUserId: null,
        clientId: t.clientId,
        type: "task",
        title: `Task deleted: ${t.title}`,
        actorEmail: ctx.advisorEmail,
        metadata: { task_id: taskId, action: "deleted", deleted_by: "chat_tool" },
      });

      return { taskId, deleted: true };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

async function fetchVisibleTask(
  ctx: ChatToolContext,
  taskId: string,
): Promise<{ task: Task } | { error: string }> {
  const vis = await ctx.supabase.rpc("tasks_visible_to", {
    viewer_email: ctx.advisorEmail,
    task_id: taskId,
  });
  if (vis.error) return { error: `tasks_visible_to failed: ${vis.error.message}` };
  if (vis.data !== true) return { error: "Task not found." };

  const { data, error } = await ctx.supabase
    .from("advisorpilot_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) return { error: `task fetch failed: ${error.message}` };
  if (!data) return { error: "Task not found." };
  return { task: toTask(data as TaskRow) };
}
