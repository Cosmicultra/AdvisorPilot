import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import {
  isReportStatus,
  toReport,
  type ReportRow,
} from "@/lib/crm/report-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { Report, ReportStatus, Visibility } from "@/lib/crm/types";

/**
 * /api/reports/[id] — single-report endpoint.
 *
 *   GET     fetch a single report (visibility-gated; full markdown body).
 *   PATCH   update title / content / status / visibility / tags / icon /
 *           color. Setting status='archived' bumps archived_at; reverting
 *           to draft/published clears it.
 *   DELETE  permanently remove the report.
 *
 * Visibility: reports_visible_to gate before any read/write. Returns 404
 * for not-visible to avoid leaking row existence (mirrors notes/tasks).
 *
 * Same audit-log pattern as `manage_report` (chat tool) — every state-
 * changing write produces an activity_log entry so the client Timeline
 * stays accurate regardless of whether the change came from the chat or
 * from a UI button.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a, docs/crm/70-orchestrator-tools.md §7.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TITLE_LENGTH = 250;
const MAX_CONTENT_LENGTH = 200_000;
const VALID_VISIBILITY: Visibility[] = ["private", "shared", "organization"];

// ─── GET ──────────────────────────────────────────────────────────────────

export const GET = async (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to load this report." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid report id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();
    const visible = await checkVisibility(supabase, identity.email, id);
    if (visible.error) return visible.error;

    const { data, error } = await supabase
      .from("advisorpilot_reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    const report = toReport(data as ReportRow);

    console.info(`[crm:api] route=/api/reports/[id] GET status=200 report_id=${id}`);
    return NextResponse.json({ report });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/reports/[id] GET error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load report." },
      { status: 500 },
    );
  }
};

// ─── PATCH ────────────────────────────────────────────────────────────────

export const PATCH = async (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to update this report." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid report id." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validatePatchBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    if (Object.keys(validation.patch).length === 0) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: title, content, status, visibility, tags, icon, color.",
        },
        { status: 400 },
      );
    }

    const supabase = getCrmSupabaseAdmin();
    const visible = await checkVisibility(supabase, identity.email, id);
    if (visible.error) return visible.error;

    const { data: existingRow, error: existingError } = await supabase
      .from("advisorpilot_reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (existingError || !existingRow) {
      return NextResponse.json(
        { error: existingError?.message ?? "Report not found." },
        { status: existingError ? 400 : 404 },
      );
    }
    const previous = toReport(existingRow as ReportRow);

    const { data: updatedRow, error: updateError } = await supabase
      .from("advisorpilot_reports")
      .update(validation.patch)
      .eq("id", id)
      .select("*")
      .single();
    if (updateError || !updatedRow) {
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to update report." },
        { status: 400 },
      );
    }
    const updated = toReport(updatedRow as ReportRow);

    // Compute which user-visible fields actually changed (so activity_log
    // copy is meaningful and we don't log no-op patches).
    const changedFields = diffChangedFields(previous, updated, validation.patch);

    if (changedFields.length > 0) {
      let activityTitle = `Report updated: ${updated.title}`;
      if (changedFields.includes("status")) {
        if (updated.status === "published") activityTitle = `Report published: ${updated.title}`;
        else if (updated.status === "archived") activityTitle = `Report archived: ${updated.title}`;
      }
      await writeActivityLog(supabase, {
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        clientId: updated.clientId,
        type: "document",
        title: activityTitle,
        actorEmail: identity.email,
        metadata: {
          report_id: updated.id,
          action: "updated",
          changed_fields: changedFields,
          status_from: previous.status,
          status_to: updated.status,
          edited_by: "api",
        },
      });
    }

    console.info(
      `[crm:api] route=/api/reports/[id] PATCH status=200 report_id=${id} changed=${changedFields.join(",") || "none"}`,
    );
    return NextResponse.json({ report: updated, changedFields });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/reports/[id] PATCH error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update report." },
      { status: 500 },
    );
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────

export const DELETE = async (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to delete this report." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid report id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();
    const visible = await checkVisibility(supabase, identity.email, id);
    if (visible.error) return visible.error;

    // Fetch the row before delete so the activity log can include the
    // title + clientId.
    const { data: existingRow } = await supabase
      .from("advisorpilot_reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existingRow) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    const previous = toReport(existingRow as ReportRow);

    const { error: deleteError } = await supabase
      .from("advisorpilot_reports")
      .delete()
      .eq("id", id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    await writeActivityLog(supabase, {
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      clientId: previous.clientId,
      type: "document",
      title: `Report deleted: ${previous.title}`,
      actorEmail: identity.email,
      metadata: {
        report_id: id,
        action: "deleted",
        deleted_by: "api",
      },
    });

    console.info(`[crm:api] route=/api/reports/[id] DELETE status=200 report_id=${id}`);
    return NextResponse.json({ deleted: true, id });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/reports/[id] DELETE error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete report." },
      { status: 500 },
    );
  }
};

// ─── Shared helpers ───────────────────────────────────────────────────────

/**
 * Wrap reports_visible_to into a single helper that returns either a 4xx
 * response (caller should return it directly) or `{}` to mean "go ahead".
 * Avoids duplicating the same 6-line block in three handlers.
 */
async function checkVisibility(
  supabase: ReturnType<typeof getCrmSupabaseAdmin>,
  viewerEmail: string,
  reportId: string,
): Promise<{ error?: NextResponse }> {
  const vis = await supabase.rpc("reports_visible_to", {
    viewer_email: viewerEmail,
    report_id: reportId,
  });
  if (vis.error) {
    return {
      error: NextResponse.json({ error: vis.error.message }, { status: 400 }),
    };
  }
  if (vis.data !== true) {
    return {
      error: NextResponse.json({ error: "Report not found." }, { status: 404 }),
    };
  }
  return {};
}

interface PatchPayload {
  title?: string;
  content?: string;
  status?: ReportStatus;
  visibility?: Visibility;
  tags?: string[];
  icon?: string;
  color?: string | null;
  archived_at?: string | null;
}

interface PatchValidationOk {
  ok: true;
  patch: PatchPayload;
}

interface PatchValidationError {
  ok: false;
  error: string;
}

function validatePatchBody(body: unknown): PatchValidationOk | PatchValidationError {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body." };
  const b = body as Record<string, unknown>;
  const patch: PatchPayload = {};

  if (b.title !== undefined) {
    if (typeof b.title !== "string" || !b.title.trim()) {
      return { ok: false, error: "title must be a non-empty string when provided." };
    }
    if (b.title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
    }
    patch.title = b.title.trim();
  }
  if (b.content !== undefined) {
    if (typeof b.content !== "string") {
      return { ok: false, error: "content must be a string." };
    }
    if (b.content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, error: `content must be ${MAX_CONTENT_LENGTH} characters or fewer.` };
    }
    patch.content = b.content;
  }
  if (b.status !== undefined) {
    if (!isReportStatus(b.status)) {
      return { ok: false, error: "status must be draft|published|archived." };
    }
    patch.status = b.status;
    // archived_at is derived from status — mirrors manage_report.update.
    patch.archived_at = b.status === "archived" ? new Date().toISOString() : null;
  }
  if (b.visibility !== undefined) {
    if (
      typeof b.visibility !== "string" ||
      !VALID_VISIBILITY.includes(b.visibility as Visibility)
    ) {
      return {
        ok: false,
        error: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}.`,
      };
    }
    patch.visibility = b.visibility as Visibility;
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) {
      return { ok: false, error: "tags must be an array of strings." };
    }
    patch.tags = b.tags.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
  }
  if (b.icon !== undefined) {
    if (typeof b.icon !== "string" || !b.icon.trim()) {
      return { ok: false, error: "icon must be a non-empty string when provided." };
    }
    patch.icon = b.icon.trim();
  }
  if (b.color !== undefined) {
    if (b.color === null) {
      patch.color = null;
    } else if (typeof b.color !== "string") {
      return { ok: false, error: "color must be a string or null." };
    } else {
      patch.color = b.color.trim() || null;
    }
  }

  return { ok: true, patch };
}

/**
 * Compare the values that actually persisted vs the previous Report and
 * return the list of fields the advisor changed. We compare on the
 * normalized (camelCase) Report shape, not the raw row, so this matches
 * what the UI will see after a refetch.
 */
function diffChangedFields(
  previous: Report,
  updated: Report,
  patch: PatchPayload,
): string[] {
  const changed: string[] = [];
  if (patch.title !== undefined && previous.title !== updated.title) changed.push("title");
  if (patch.content !== undefined && previous.content !== updated.content) changed.push("content");
  if (patch.status !== undefined && previous.status !== updated.status) changed.push("status");
  if (patch.visibility !== undefined && previous.visibility !== updated.visibility) {
    changed.push("visibility");
  }
  if (patch.tags !== undefined && !sameTags(previous.tags, updated.tags)) changed.push("tags");
  if (patch.icon !== undefined && previous.icon !== updated.icon) changed.push("icon");
  if (patch.color !== undefined && previous.color !== updated.color) changed.push("color");
  return changed;
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((t, i) => t === sortedB[i]);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
