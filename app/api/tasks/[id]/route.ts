import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import {
  isTaskPriority,
  isTaskStatus,
  toTask,
  type TaskRow,
} from "@/lib/crm/task-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { Task } from "@/lib/crm/types";

/**
 * /api/tasks/[id] — single-task endpoint.
 *
 * PATCH    update fields (title/description/due/priority/status/tags/completedAt).
 *          Side effect: writes activity_log entries for status transitions
 *          (open → done = "Task completed", etc.).
 * DELETE   remove the task. Side effect: writes activity_log entry.
 *
 * Visibility: tasks_visible_to gate before any read/write. Returns 404 for
 * not-visible to avoid leaking row existence.
 *
 * Spec: docs/crm/20-technical-specs.md §2.1.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;

// ─── PATCH ────────────────────────────────────────────────────────────────

export const PATCH = async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to update this task." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validatePatchBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    // Visibility gate.
    const visibleResult = await supabase.rpc("tasks_visible_to", {
      viewer_email: identity.email,
      task_id: id,
    });
    if (visibleResult.error) {
      console.error("[crm:api] route=/api/tasks/[id] PATCH visibility-rpc-error", visibleResult.error);
      return NextResponse.json({ error: visibleResult.error.message }, { status: 400 });
    }
    if (visibleResult.data !== true) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    // Fetch the current row so we can detect status transitions for the
    // activity-log entry.
    const { data: existingRow, error: existingError } = await supabase
      .from("advisorpilot_tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (existingError || !existingRow) {
      return NextResponse.json(
        { error: existingError?.message ?? "Task not found." },
        { status: existingError ? 400 : 404 }
      );
    }
    const previous = toTask(existingRow as TaskRow);

    // Build the partial update payload.
    const updatePayload: Record<string, unknown> = {};
    if ("title" in validation.patch) updatePayload.title = validation.patch.title;
    if ("description" in validation.patch) updatePayload.description = validation.patch.description;
    if ("dueDate" in validation.patch) updatePayload.due_date = validation.patch.dueDate;
    if ("dueTime" in validation.patch) updatePayload.due_time = validation.patch.dueTime;
    if ("priority" in validation.patch) updatePayload.priority = validation.patch.priority;
    if ("status" in validation.patch) updatePayload.status = validation.patch.status;
    if ("tags" in validation.patch) updatePayload.tags = validation.patch.tags;

    // completed_at: caller can override, but normally we set it automatically
    // when status transitions to 'done'.
    if (validation.patch.completedAt !== undefined) {
      updatePayload.completed_at = validation.patch.completedAt;
    } else if (
      validation.patch.status === "done" &&
      previous.status !== "done"
    ) {
      updatePayload.completed_at = new Date().toISOString();
    } else if (
      validation.patch.status &&
      validation.patch.status !== "done" &&
      previous.status === "done"
    ) {
      // Reopening a done task — clear completed_at.
      updatePayload.completed_at = null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ task: previous });
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("advisorpilot_tasks")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !updatedRow) {
      console.error("[crm:api] route=/api/tasks/[id] PATCH update-error", updateError);
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to update task." },
        { status: 400 }
      );
    }

    const updated = toTask(updatedRow as TaskRow);

    // Activity-log entry per PATCH — ONE entry summarizing all the changes.
    // Status transitions get a specific title ("Task completed: Foo"); other
    // field edits use a generic "Task updated: Foo". The list of changed
    // fields is captured in metadata so the Timeline can show detail later
    // if we want a richer view.
    const changedFields = computeChangedFields(validation.patch, previous);
    const statusChanged =
      validation.patch.status !== undefined && validation.patch.status !== previous.status;

    if (changedFields.length > 0) {
      const title = statusChanged
        ? `${describeStatusTransition(previous.status, updated.status)}: ${updated.title}`
        : `Task updated: ${updated.title}`;
      const body =
        !statusChanged && changedFields.length > 0
          ? `Updated ${humanizeFieldList(changedFields)}.`
          : null;

      await writeActivityLog(supabase, {
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        clientId: updated.clientId,
        type: "task",
        title,
        body,
        actorEmail: identity.email,
        metadata: {
          task_id: updated.id,
          action: statusChanged ? "status_change" : "updated",
          changed_fields: changedFields,
          ...(statusChanged
            ? { from: previous.status, to: updated.status }
            : {}),
        },
      });
    }

    console.info(
      `[crm:api] route=/api/tasks/${id} status=200 changed=${changedFields.join(",") || "none"}`
    );

    return NextResponse.json({ task: updated });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/tasks/[id] PATCH error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update task." },
      { status: 500 }
    );
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────

export const DELETE = async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to delete this task." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    const visibleResult = await supabase.rpc("tasks_visible_to", {
      viewer_email: identity.email,
      task_id: id,
    });
    if (visibleResult.error || visibleResult.data !== true) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    // Fetch first so the activity-log entry can capture title + clientId.
    const { data: existingRow } = await supabase
      .from("advisorpilot_tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const existing = existingRow ? toTask(existingRow as TaskRow) : null;

    const { error: deleteError } = await supabase
      .from("advisorpilot_tasks")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[crm:api] route=/api/tasks/[id] DELETE error", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    if (existing) {
      await writeActivityLog(supabase, {
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        clientId: existing.clientId,
        type: "task",
        title: `Task deleted: ${existing.title}`,
        actorEmail: identity.email,
        metadata: { task_id: id, action: "deleted" },
      });
    }

    console.info(`[crm:api] route=/api/tasks/${id} status=200 method=DELETE`);

    return NextResponse.json({ id });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/tasks/[id] DELETE error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete task." },
      { status: 500 }
    );
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────

interface TaskPatch {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: Task["priority"];
  status?: Task["status"];
  tags?: string[];
  completedAt?: string | null;
}

interface PatchValidationOk {
  ok: true;
  patch: TaskPatch;
}

interface PatchValidationError {
  ok: false;
  error: string;
}

function validatePatchBody(body: unknown): PatchValidationOk | PatchValidationError {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid body." };
  }
  const b = body as Record<string, unknown>;
  const patch: TaskPatch = {};

  if (b.title !== undefined) {
    if (typeof b.title !== "string") {
      return { ok: false, error: "title must be a string." };
    }
    const t = b.title.trim();
    if (!t) return { ok: false, error: "title cannot be empty." };
    if (t.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
    }
    patch.title = t;
  }

  if (b.description !== undefined) {
    if (b.description === null) {
      patch.description = null;
    } else if (typeof b.description === "string") {
      const d = b.description.trim();
      if (d.length > MAX_DESCRIPTION_LENGTH) {
        return {
          ok: false,
          error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
        };
      }
      patch.description = d.length > 0 ? d : null;
    } else {
      return { ok: false, error: "description must be a string or null." };
    }
  }

  if (b.dueDate !== undefined) {
    if (b.dueDate === null) {
      patch.dueDate = null;
    } else if (typeof b.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) {
      patch.dueDate = b.dueDate;
    } else {
      return { ok: false, error: "dueDate must be YYYY-MM-DD or null." };
    }
  }

  if (b.dueTime !== undefined) {
    if (b.dueTime === null) {
      patch.dueTime = null;
    } else if (typeof b.dueTime === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(b.dueTime)) {
      patch.dueTime = b.dueTime;
    } else {
      return { ok: false, error: "dueTime must be HH:MM or null." };
    }
  }

  if (b.priority !== undefined) {
    if (!isTaskPriority(b.priority)) {
      return { ok: false, error: "priority must be High|Medium|Low." };
    }
    patch.priority = b.priority;
  }

  if (b.status !== undefined) {
    if (!isTaskStatus(b.status)) {
      return { ok: false, error: "status must be open|in_progress|done|cancelled." };
    }
    patch.status = b.status;
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) {
      return { ok: false, error: "tags must be an array of strings." };
    }
    patch.tags = b.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  }

  if (b.completedAt !== undefined) {
    if (b.completedAt === null) {
      patch.completedAt = null;
    } else if (typeof b.completedAt === "string" && !Number.isNaN(Date.parse(b.completedAt))) {
      patch.completedAt = new Date(b.completedAt).toISOString();
    } else {
      return { ok: false, error: "completedAt must be an ISO datetime or null." };
    }
  }

  return { ok: true, patch };
}

function describeStatusTransition(from: Task["status"], to: Task["status"]): string {
  if (to === "done") return "Task completed";
  if (to === "cancelled") return "Task cancelled";
  if (to === "in_progress") return "Task started";
  if (from === "done" || from === "cancelled") return "Task reopened";
  return "Task status changed";
}

/** Returns the camelCase keys of the fields the patch actually changed
 *  vs. the previous Task. Used for audit metadata + human-friendly summary. */
function computeChangedFields(patch: TaskPatch, previous: Task): (keyof TaskPatch)[] {
  const changed: (keyof TaskPatch)[] = [];
  if (patch.title !== undefined && patch.title !== previous.title) changed.push("title");
  if (
    patch.description !== undefined &&
    (patch.description ?? null) !== (previous.description ?? null)
  )
    changed.push("description");
  if (patch.dueDate !== undefined && (patch.dueDate ?? null) !== (previous.dueDate ?? null))
    changed.push("dueDate");
  if (patch.dueTime !== undefined && (patch.dueTime ?? null) !== (previous.dueTime ?? null))
    changed.push("dueTime");
  if (patch.priority !== undefined && patch.priority !== previous.priority)
    changed.push("priority");
  if (patch.status !== undefined && patch.status !== previous.status) changed.push("status");
  if (patch.tags !== undefined && !sameTags(patch.tags, previous.tags)) changed.push("tags");
  if (
    patch.completedAt !== undefined &&
    (patch.completedAt ?? null) !== (previous.completedAt ?? null)
  )
    changed.push("completedAt");
  return changed;
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((tag, i) => tag === sortedB[i]);
}

/** Friendly label for a single TaskPatch key (for "Updated title, due date" body text). */
const FIELD_LABELS: Record<keyof TaskPatch, string> = {
  title: "title",
  description: "description",
  dueDate: "due date",
  dueTime: "due time",
  priority: "priority",
  status: "status",
  tags: "tags",
  completedAt: "completed timestamp",
};

function humanizeFieldList(fields: (keyof TaskPatch)[]): string {
  const labels = fields.map((f) => FIELD_LABELS[f] ?? String(f));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
