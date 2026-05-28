/**
 * `manage_report` — compound write tool for markdown reports.
 *
 * v1 operations (this slice):
 *   - create (T2) — no confirmation; inserts a new report row
 *   - update (T3) — preview-then-confirm; updates title / content / metadata
 *   - delete (T4) — preview-then-confirm; removes a single report
 *
 * DEFERRED to subsequent slices (each spec'd in
 * docs/crm/70-orchestrator-tools.md §7.1):
 *   - list / get        — already covered by `query_crm.list:reports` + `get:reports`
 *   - duplicate         — separate slice; needs version-history table for proper provenance
 *   - get_lines / insert_lines / replace_lines / delete_lines
 *                       — line-level editing; needs a numbered-content helper
 *   - list_versions / restore_version
 *                       — needs `advisorpilot_report_versions` table
 *   - embed_image       — needs image generation + storage path conventions
 *
 * Side effects:
 *   - create / update / delete each write to activity_log so the report
 *     surfaces on the client's Activity tab (when client_id is set).
 *   - create with `clientId` does NOT bump last_contacted_at (reports
 *     aren't a client touchpoint the way notes are).
 *
 * Visibility:
 *   - create  → if clientId is provided, clients_visible_to gate
 *   - update / delete → reports_visible_to gate
 *
 * Spec: docs/crm/70-orchestrator-tools.md §7.1 (scoped to v1 subset).
 */

import { writeActivityLog } from "@/lib/crm/activity-writer";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import {
  isReportSource,
  isReportStatus,
  toReport,
  type ReportRow,
} from "@/lib/crm/report-mapper";
import {
  deleteLines as deleteLinesPure,
  getLines as getLinesPure,
  insertLines as insertLinesPure,
  replaceLines as replaceLinesPure,
} from "@/lib/crm/report-line-ops";
import type { Report, ReportSource, ReportStatus, Visibility } from "@/lib/crm/types";
import { diffShallow, withConfirmation } from "./confirmation";
import { isUuid } from "./query-crm-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const MAX_TITLE_LENGTH = 250;
/** 200 KB cap on markdown body — bounds prompt cost for round-trips. */
const MAX_CONTENT_LENGTH = 200_000;

const VALID_VISIBILITY: Visibility[] = ["private", "shared", "organization"];

// ─────────────────────────────────────────────────────────────────────────────
// Tool surface
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    operation: {
      type: "string",
      enum: [
        "create",
        "update",
        "delete",
        "get_lines",
        "insert_lines",
        "replace_lines",
        "delete_lines",
        "list_versions",
        "restore_version",
      ],
      description:
        "create = new markdown report (no confirmation). update = change title/content/metadata (preview-then-confirm). delete = remove a report (preview-then-confirm). get_lines = read a numbered slice of the body (read-only). insert_lines = insert content at a line (T3 preview). replace_lines = swap a range (T3 preview). delete_lines = remove a range (T3 preview). list_versions = enumerate history. restore_version = roll back to a snapshot (T3 preview). For LISTING reports use `query_crm.list:reports`; for READING a single report use `query_crm.get:reports`.",
    },
    reportId: {
      type: "string",
      description: "UUID of the report. REQUIRED for update and delete.",
    },
    clientId: {
      type: "string",
      description:
        "UUID of the parent client. Optional on create — pass null/omit for a standalone report unlinked from any specific client. Cannot be changed after create.",
    },
    title: {
      type: "string",
      description:
        "Report title. REQUIRED for create. Max 250 chars. The advisor sees this in the Reports list + browser tab.",
    },
    content: {
      type: "string",
      description:
        "Markdown body. REQUIRED for create. Max 200,000 chars (~50 single-spaced pages). Supports CommonMark + GFM + the project's fenced-block extensions (`chart:chartjs` / `chart:echarts` / `mermaid`). The model can paste output from `generate_report_content` here (PR follow-up).",
    },
    status: {
      type: "string",
      enum: ["draft", "published", "archived"],
      description:
        "Defaults to 'draft' on create. 'published' makes the report visible in the main Reports list as final. 'archived' hides it from the main list (the advisor opts-in to see archived).",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Free-form tag list. Replaces the existing list on update.",
    },
    visibility: {
      type: "string",
      enum: ["private", "shared", "organization"],
      description: "Defaults to 'private' on create. Future sharing UI lets the advisor escalate.",
    },
    icon: {
      type: "string",
      description: "Emoji icon for the report (e.g. '📈', '📊'). Defaults to 📄 on create.",
    },
    color: {
      type: "string",
      description: "Accent color (hex or token). Optional — the renderer falls back to a theme default.",
    },
    source: {
      type: "string",
      enum: ["ai_generated", "advisor_authored", "imported"],
      description:
        "Where the report came from. Defaults to 'ai_generated' (most chat-created reports). Use 'advisor_authored' if the model is just persisting verbatim text the advisor dictated.",
    },
    _confirmed: {
      type: "boolean",
      description:
        "Set true on the SECOND call after the advisor confirms an update or delete preview. Omit on the first call to receive the preview.",
    },
    // ── Line-level params (PR 17) ─────────────────────────────────────────
    startLine: {
      type: "number",
      description:
        "1-indexed line number where a range op begins (inclusive). Used by get_lines / replace_lines / delete_lines.",
    },
    endLine: {
      type: "number",
      description:
        "1-indexed line number where a range op ends (inclusive). Used by get_lines / replace_lines / delete_lines.",
    },
    atLine: {
      type: "number",
      description:
        "1-indexed line number used by insert_lines: the new content is inserted BEFORE this line. Pass `(currentLineCount + 1)` to append.",
    },
    lineContent: {
      type: "string",
      description:
        "Replacement / inserted markdown body used by insert_lines + replace_lines. May contain multiple lines (`\\n`-separated).",
    },
    // ── Version-history params (PR 17) ────────────────────────────────────
    versionId: {
      type: "string",
      description: "UUID of a version row to restore (from list_versions output). Used by restore_version.",
    },
  },
  required: ["operation"],
};

export const manageReportTool: ChatTool = {
  name: "manage_report",
  description:
    "Write tool for markdown reports. v1 operations: `create` (T2), `update` (T3, preview-then-confirm), `delete` (T4, preview-then-confirm). For listing or reading reports use `query_crm.list:reports` / `query_crm.get:reports` instead — that's the read surface. Reports are visibility-gated (private/shared/organization) and link to an optional client_id so they surface on the client's Activity tab. The model should typically draft the markdown FIRST (via thinking) and then `create` once the advisor approves the outline.",
  parameters: PARAMETERS,
  handler: handleManageReport,
};

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function handleManageReport(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const op = typeof args.operation === "string" ? args.operation : "";
  const allowed = [
    "create",
    "update",
    "delete",
    "get_lines",
    "insert_lines",
    "replace_lines",
    "delete_lines",
    "list_versions",
    "restore_version",
  ];
  if (!allowed.includes(op)) {
    return {
      error: `Unknown operation '${op}'. Allowed: ${allowed.join(" | ")}.`,
    };
  }

  try {
    switch (op) {
      case "create":
        return await handleCreate(args, ctx);
      case "update":
        return await handleUpdate(args, ctx);
      case "delete":
        return await handleDelete(args, ctx);
      case "get_lines":
        return await handleGetLines(args, ctx);
      case "insert_lines":
        return await handleInsertLines(args, ctx);
      case "replace_lines":
        return await handleReplaceLines(args, ctx);
      case "delete_lines":
        return await handleDeleteLines(args, ctx);
      case "list_versions":
        return await handleListVersions(args, ctx);
      case "restore_version":
        return await handleRestoreVersion(args, ctx);
      default:
        return { error: `Unhandled op '${op}'.` };
    }
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
  // otherwise the advisor's personal org. Same flow as notes/tasks.
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

  const insertPayload: Record<string, unknown> = {
    owner_email: ctx.advisorEmail,
    owner_user_id: null,
    client_id: v.clientId,
    org_id: orgId,
    visibility: v.visibility,
    title: v.title,
    content: v.content,
    status: v.status,
    tags: v.tags,
    icon: v.icon,
    source: v.source,
    generated_in_conversation_id: ctx.conversationId,
  };
  if (v.color !== undefined) insertPayload.color = v.color;

  const { data: inserted, error: insertError } = await ctx.supabase
    .from("advisorpilot_reports")
    .insert(insertPayload)
    .select("*")
    .single();
  if (insertError || !inserted) {
    return { error: insertError?.message ?? "Failed to create report." };
  }
  const report = toReport(inserted as ReportRow);

  // Side effect: activity_log entry so the Activity tab surfaces report creation.
  // Best-effort — does NOT block on failure.
  await writeActivityLog(ctx.supabase, {
    ownerEmail: ctx.advisorEmail,
    ownerUserId: null,
    clientId: report.clientId,
    type: "document",
    title: `Report created: ${report.title}`,
    actorEmail: ctx.advisorEmail,
    metadata: {
      report_id: report.id,
      action: "created",
      status: report.status,
      source: report.source,
      created_by: "chat_tool",
    },
  });

  return { result: { success: true, action: "create_report", report } };
}

interface CreateValidationOk {
  ok: true;
  clientId: string | null;
  title: string;
  content: string;
  status: ReportStatus;
  visibility: Visibility;
  tags: string[];
  icon: string;
  color: string | undefined;
  source: ReportSource;
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
      return { ok: false, error: "`clientId` must be a UUID or null/omitted for standalone reports." };
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
  if (typeof args.content !== "string" || !args.content.trim()) {
    return { ok: false, error: "create requires `content` (markdown body)." };
  }
  const content = args.content;
  if (content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: `\`content\` must be ${MAX_CONTENT_LENGTH} characters or fewer.` };
  }

  let status: ReportStatus = "draft";
  if (args.status !== undefined) {
    if (!isReportStatus(args.status)) {
      return { ok: false, error: "`status` must be draft|published|archived." };
    }
    status = args.status;
  }

  let visibility: Visibility = "private";
  if (args.visibility !== undefined) {
    if (typeof args.visibility !== "string" || !VALID_VISIBILITY.includes(args.visibility as Visibility)) {
      return { ok: false, error: `\`visibility\` must be one of ${VALID_VISIBILITY.join(", ")}.` };
    }
    visibility = args.visibility as Visibility;
  }

  const tags = Array.isArray(args.tags)
    ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  const icon = typeof args.icon === "string" && args.icon.trim() ? args.icon.trim() : "📄";

  let color: string | undefined;
  if (args.color !== undefined && args.color !== null) {
    if (typeof args.color !== "string") {
      return { ok: false, error: "`color` must be a string or null." };
    }
    color = args.color.trim() || undefined;
  }

  let source: ReportSource = "ai_generated";
  if (args.source !== undefined) {
    if (!isReportSource(args.source)) {
      return { ok: false, error: "`source` must be ai_generated|advisor_authored|imported." };
    }
    source = args.source;
  }

  return {
    ok: true,
    clientId,
    title,
    content,
    status,
    visibility,
    tags,
    icon,
    color,
    source,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// update (T3) — preview then confirm
// ─────────────────────────────────────────────────────────────────────────────

interface UpdatePatch {
  title?: string;
  content?: string;
  status?: ReportStatus;
  tags?: string[];
  visibility?: Visibility;
  icon?: string;
  color?: string | null;
  archived_at?: string | null;
}

async function handleUpdate(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const v = validateUpdate(args);
  if (!v.ok) return { error: v.error };
  const { reportId, patch } = v;
  if (Object.keys(patch).length === 0) {
    return {
      error:
        "update needs at least one of: title, content, status, tags, visibility, icon, color.",
    };
  }

  return withConfirmation({
    args,
    action: "update_report",
    buildPreview: () => buildUpdatePreview(ctx, reportId, patch),
    execute: () => executeUpdate(ctx, reportId, patch),
  });
}

interface UpdateValidationOk {
  ok: true;
  reportId: string;
  patch: UpdatePatch;
}
interface UpdateValidationError {
  ok: false;
  error: string;
}

function validateUpdate(args: Record<string, unknown>): UpdateValidationOk | UpdateValidationError {
  const reportId = typeof args.reportId === "string" ? args.reportId.trim() : "";
  if (!isUuid(reportId)) {
    return { ok: false, error: "update requires `reportId` (UUID)." };
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
  if (args.content !== undefined) {
    if (typeof args.content !== "string") {
      return { ok: false, error: "`content` must be a string." };
    }
    if (args.content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, error: `\`content\` must be ${MAX_CONTENT_LENGTH} characters or fewer.` };
    }
    patch.content = args.content;
  }
  if (args.status !== undefined) {
    if (!isReportStatus(args.status)) {
      return { ok: false, error: "`status` must be draft|published|archived." };
    }
    patch.status = args.status;
    // Setting status=archived bumps archived_at so the indexed
    // partial index works correctly. Reverting to draft/published clears it.
    if (args.status === "archived") {
      patch.archived_at = new Date().toISOString();
    } else {
      patch.archived_at = null;
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
  if (args.visibility !== undefined) {
    if (typeof args.visibility !== "string" || !VALID_VISIBILITY.includes(args.visibility as Visibility)) {
      return { ok: false, error: `\`visibility\` must be one of ${VALID_VISIBILITY.join(", ")}.` };
    }
    patch.visibility = args.visibility as Visibility;
  }
  if (args.icon !== undefined) {
    if (typeof args.icon !== "string" || !args.icon.trim()) {
      return { ok: false, error: "`icon` must be a non-empty string when provided." };
    }
    patch.icon = args.icon.trim();
  }
  if (args.color !== undefined) {
    if (args.color === null) patch.color = null;
    else if (typeof args.color !== "string") {
      return { ok: false, error: "`color` must be a string or null." };
    } else {
      patch.color = args.color.trim() || null;
    }
  }
  return { ok: true, reportId, patch };
}

async function buildUpdatePreview(
  ctx: ChatToolContext,
  reportId: string,
  patch: UpdatePatch,
): Promise<{
  reportId: string;
  reportTitle: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  contentLengthChange?: { before: number; after: number };
} | { error: string }> {
  const visible = await fetchVisibleReport(ctx, reportId);
  if ("error" in visible) return visible;
  const previous = visible.report;

  // For diff display, treat `content` specially — it's a markdown blob and
  // showing the full before/after in a chat narration is noisy. Surface a
  // length delta instead so the model can say "I'll change the content
  // from ~1,200 chars to ~1,600 chars" without dumping both versions.
  const diffPatch: Record<string, unknown> = {};
  let contentLengthChange: { before: number; after: number } | undefined;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "content" && typeof v === "string") {
      if (v !== previous.content) {
        contentLengthChange = {
          before: previous.content.length,
          after: v.length,
        };
      }
      continue;
    }
    if (k === "archived_at") continue; // derived from status; don't surface separately
    diffPatch[k] = v;
  }

  const diff = diffShallow(previous as unknown as Record<string, unknown>, diffPatch);
  if (Object.keys(diff).length === 0 && !contentLengthChange) {
    return { error: "No-op update — the requested patch matches the current values." };
  }
  return {
    reportId,
    reportTitle: previous.title,
    diff,
    ...(contentLengthChange ? { contentLengthChange } : {}),
  };
}

async function executeUpdate(
  ctx: ChatToolContext,
  reportId: string,
  patch: UpdatePatch,
): Promise<{ report: Report; changedFields: string[] } | { error: string }> {
  const visible = await fetchVisibleReport(ctx, reportId);
  if ("error" in visible) return visible;
  const previous = visible.report;

  const { data: updatedRow, error: updateError } = await ctx.supabase
    .from("advisorpilot_reports")
    .update(patch)
    .eq("id", reportId)
    .select("*")
    .single();
  if (updateError || !updatedRow) {
    return { error: updateError?.message ?? "Failed to update report." };
  }
  const updated = toReport(updatedRow as ReportRow);

  // Compute changed fields against the camel-cased Report shape for the
  // activity-log metadata.
  const changedFields: string[] = [];
  if (patch.title !== undefined && updated.title !== previous.title) changedFields.push("title");
  if (patch.content !== undefined && updated.content !== previous.content) changedFields.push("content");
  if (patch.status !== undefined && updated.status !== previous.status) changedFields.push("status");
  if (patch.tags !== undefined && !sameTags(updated.tags, previous.tags)) changedFields.push("tags");
  if (patch.visibility !== undefined && updated.visibility !== previous.visibility) changedFields.push("visibility");
  if (patch.icon !== undefined && updated.icon !== previous.icon) changedFields.push("icon");
  if (patch.color !== undefined && updated.color !== previous.color) changedFields.push("color");

  if (changedFields.length > 0) {
    // Specific titles for status transitions so the timeline reads cleanly.
    let activityTitle = `Report updated: ${updated.title}`;
    if (changedFields.includes("status")) {
      if (updated.status === "published") activityTitle = `Report published: ${updated.title}`;
      else if (updated.status === "archived") activityTitle = `Report archived: ${updated.title}`;
    }
    await writeActivityLog(ctx.supabase, {
      ownerEmail: ctx.advisorEmail,
      ownerUserId: null,
      clientId: updated.clientId,
      type: "document",
      title: activityTitle,
      actorEmail: ctx.advisorEmail,
      metadata: {
        report_id: updated.id,
        action: "updated",
        changed_fields: changedFields,
        status_from: previous.status,
        status_to: updated.status,
        edited_by: "chat_tool",
      },
    });
  }

  return { report: updated, changedFields };
}

// ─────────────────────────────────────────────────────────────────────────────
// delete (T4) — preview then confirm
// ─────────────────────────────────────────────────────────────────────────────

async function handleDelete(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = typeof args.reportId === "string" ? args.reportId.trim() : "";
  if (!isUuid(reportId)) {
    return { error: "delete requires `reportId` (UUID)." };
  }

  return withConfirmation({
    args,
    action: "delete_report",
    buildPreview: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const r = visible.report;
      return {
        reportId,
        snapshot: {
          title: r.title,
          status: r.status,
          clientId: r.clientId,
          contentLength: r.content.length,
          tags: r.tags,
          createdAt: r.createdAt,
        },
        warning:
          "This permanently removes the report. Consider `update` with `status: 'archived'` if the advisor might want to recover it later.",
      };
    },
    execute: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const r = visible.report;

      const { error: deleteError } = await ctx.supabase
        .from("advisorpilot_reports")
        .delete()
        .eq("id", reportId);
      if (deleteError) return { error: deleteError.message };

      await writeActivityLog(ctx.supabase, {
        ownerEmail: ctx.advisorEmail,
        ownerUserId: null,
        clientId: r.clientId,
        type: "document",
        title: `Report deleted: ${r.title}`,
        actorEmail: ctx.advisorEmail,
        metadata: { report_id: reportId, action: "deleted", deleted_by: "chat_tool" },
      });

      return { reportId, deleted: true };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchVisibleReport(
  ctx: ChatToolContext,
  reportId: string,
): Promise<{ report: Report } | { error: string }> {
  const vis = await ctx.supabase.rpc("reports_visible_to", {
    viewer_email: ctx.advisorEmail,
    report_id: reportId,
  });
  if (vis.error) return { error: `reports_visible_to failed: ${vis.error.message}` };
  if (vis.data !== true) return { error: "Report not found." };

  const { data, error } = await ctx.supabase
    .from("advisorpilot_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error) return { error: `report fetch failed: ${error.message}` };
  if (!data) return { error: "Report not found." };
  return { report: toReport(data as ReportRow) };
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((t, i) => t === sortedB[i]);
}

// ═════════════════════════════════════════════════════════════════════════════
// PR 17 — Line-level operations + version history
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `get_lines` — READ-only numbered slice of the report body. Returns
 * `{ lines: [{ line, text }, ...], totalLines }` so the model can
 * reason about absolute line numbers ("the typo is on line 14") before
 * issuing an insert / replace / delete.
 */
async function handleGetLines(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = pickUuid(args.reportId);
  if (!reportId) return { error: "get_lines requires `reportId` (UUID)." };
  const visible = await fetchVisibleReport(ctx, reportId);
  if ("error" in visible) return { error: visible.error };

  const startLine = pickInt(args.startLine);
  const endLine = pickInt(args.endLine);
  const lines = getLinesPure(
    visible.report.content,
    startLine ?? undefined,
    endLine ?? undefined,
  );
  const totalLines = visible.report.content.split(/\r\n|\r|\n/).length;
  return {
    result: {
      reportId,
      totalLines,
      lines,
    },
  };
}

/**
 * `insert_lines` — preview-then-confirm insert at a specified line.
 * Preview surfaces the lineDiff (inserted lines + their position +
 * resulting totalLines). Confirmed call applies via UPDATE; the snapshot
 * trigger writes the prior version to advisorpilot_report_versions.
 */
async function handleInsertLines(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = pickUuid(args.reportId);
  if (!reportId) return { error: "insert_lines requires `reportId` (UUID)." };
  const atLine = pickInt(args.atLine);
  const lineContent = typeof args.lineContent === "string" ? args.lineContent : null;
  if (!atLine || lineContent === null) {
    return { error: "insert_lines requires `atLine` (number) and `lineContent` (string)." };
  }

  return withConfirmation({
    args,
    action: "insert_lines",
    buildPreview: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const out = insertLinesPure(visible.report.content, atLine, lineContent);
      if (!out.ok) return { error: out.error };
      return {
        reportId,
        reportTitle: visible.report.title,
        insertedAtLine: out.insertedAtLine,
        insertedLineCount: out.insertedLineCount,
        nextTotalLines: out.content.split(/\r\n|\r|\n/).length,
      };
    },
    execute: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const out = insertLinesPure(visible.report.content, atLine, lineContent);
      if (!out.ok) return { error: out.error };
      const persisted = await writeContentAndLog(ctx, visible.report, out.content, {
        action: "insert_lines",
        meta: {
          inserted_at_line: out.insertedAtLine,
          inserted_line_count: out.insertedLineCount,
        },
      });
      if ("error" in persisted) return persisted;
      return {
        reportId,
        insertedAtLine: out.insertedAtLine,
        insertedLineCount: out.insertedLineCount,
        report: persisted.report,
      };
    },
  });
}

async function handleReplaceLines(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = pickUuid(args.reportId);
  if (!reportId) return { error: "replace_lines requires `reportId` (UUID)." };
  const startLine = pickInt(args.startLine);
  const endLine = pickInt(args.endLine);
  const lineContent = typeof args.lineContent === "string" ? args.lineContent : null;
  if (!startLine || !endLine || lineContent === null) {
    return {
      error: "replace_lines requires `startLine` + `endLine` (numbers) and `lineContent` (string).",
    };
  }
  return withConfirmation({
    args,
    action: "replace_lines",
    buildPreview: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const out = replaceLinesPure(visible.report.content, startLine, endLine, lineContent);
      if (!out.ok) return { error: out.error };
      return {
        reportId,
        reportTitle: visible.report.title,
        range: { startLine, endLine },
        removedLineCount: out.removedLineCount,
        insertedLineCount: out.insertedLineCount,
        nextTotalLines: out.content.split(/\r\n|\r|\n/).length,
      };
    },
    execute: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const out = replaceLinesPure(visible.report.content, startLine, endLine, lineContent);
      if (!out.ok) return { error: out.error };
      const persisted = await writeContentAndLog(ctx, visible.report, out.content, {
        action: "replace_lines",
        meta: {
          range: { start_line: startLine, end_line: endLine },
          removed_line_count: out.removedLineCount,
          inserted_line_count: out.insertedLineCount,
        },
      });
      if ("error" in persisted) return persisted;
      return {
        reportId,
        removedLineCount: out.removedLineCount,
        insertedLineCount: out.insertedLineCount,
        report: persisted.report,
      };
    },
  });
}

async function handleDeleteLines(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = pickUuid(args.reportId);
  if (!reportId) return { error: "delete_lines requires `reportId` (UUID)." };
  const startLine = pickInt(args.startLine);
  const endLine = pickInt(args.endLine);
  if (!startLine || !endLine) {
    return { error: "delete_lines requires `startLine` + `endLine` (numbers)." };
  }
  return withConfirmation({
    args,
    action: "delete_lines",
    buildPreview: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const out = deleteLinesPure(visible.report.content, startLine, endLine);
      if (!out.ok) return { error: out.error };
      return {
        reportId,
        reportTitle: visible.report.title,
        range: { startLine, endLine },
        removedLineCount: out.removedLineCount,
        nextTotalLines: out.content.split(/\r\n|\r|\n/).length,
      };
    },
    execute: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const out = deleteLinesPure(visible.report.content, startLine, endLine);
      if (!out.ok) return { error: out.error };
      const persisted = await writeContentAndLog(ctx, visible.report, out.content, {
        action: "delete_lines",
        meta: {
          range: { start_line: startLine, end_line: endLine },
          removed_line_count: out.removedLineCount,
        },
      });
      if ("error" in persisted) return persisted;
      return {
        reportId,
        removedLineCount: out.removedLineCount,
        report: persisted.report,
      };
    },
  });
}

// ─── Version history ──────────────────────────────────────────────────────

interface VersionRow {
  id: string;
  report_id: string;
  version_number: number;
  title: string;
  content: string;
  status: string | null;
  visibility: string | null;
  tags: unknown;
  icon: string | null;
  color: string | null;
  edited_by_email: string | null;
  edited_at: string;
}

async function handleListVersions(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = pickUuid(args.reportId);
  if (!reportId) return { error: "list_versions requires `reportId` (UUID)." };
  const visible = await fetchVisibleReport(ctx, reportId);
  if ("error" in visible) return { error: visible.error };

  const { data, error } = await ctx.supabase
    .from("advisorpilot_report_versions")
    .select(
      "id, version_number, title, edited_by_email, edited_at, content",
    )
    .eq("report_id", reportId)
    .order("version_number", { ascending: false });
  if (error) return { error: `versions fetch failed: ${error.message}` };
  const rows = (data ?? []) as Array<
    Pick<VersionRow, "id" | "version_number" | "title" | "edited_by_email" | "edited_at"> & {
      content: string;
    }
  >;
  return {
    result: {
      reportId,
      currentVersion: rows.length + 1, // the next snapshot will be N+1
      versions: rows.map((r) => ({
        versionId: r.id,
        versionNumber: r.version_number,
        title: r.title,
        editedByEmail: r.edited_by_email,
        editedAt: r.edited_at,
        contentLength: r.content.length,
      })),
    },
  };
}

async function handleRestoreVersion(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const reportId = pickUuid(args.reportId);
  const versionId = pickUuid(args.versionId);
  if (!reportId || !versionId) {
    return { error: "restore_version requires `reportId` + `versionId` (UUIDs)." };
  }

  return withConfirmation({
    args,
    action: "restore_version",
    buildPreview: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const { data, error } = await ctx.supabase
        .from("advisorpilot_report_versions")
        .select("id, version_number, title, content, edited_at")
        .eq("report_id", reportId)
        .eq("id", versionId)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { error: "Version not found." };
      const target = data as VersionRow;
      return {
        reportId,
        reportTitle: visible.report.title,
        restoreTo: {
          versionNumber: target.version_number,
          title: target.title,
          editedAt: target.edited_at,
          contentLength: (target.content ?? "").length,
        },
        currentContentLength: visible.report.content.length,
        warning:
          "Restoring snapshots the CURRENT content as a new version first (no data is lost), then overwrites the live row.",
      };
    },
    execute: async () => {
      const visible = await fetchVisibleReport(ctx, reportId);
      if ("error" in visible) return visible;
      const { data, error } = await ctx.supabase
        .from("advisorpilot_report_versions")
        .select("title, content, status, visibility, tags, icon, color, version_number")
        .eq("report_id", reportId)
        .eq("id", versionId)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { error: "Version not found." };
      const target = data as Pick<
        VersionRow,
        "title" | "content" | "status" | "visibility" | "tags" | "icon" | "color" | "version_number"
      >;
      const persisted = await writeFullSnapshotAndLog(ctx, visible.report, target, {
        action: "restore_version",
        meta: { restored_version_number: target.version_number },
      });
      if ("error" in persisted) return persisted;
      return {
        reportId,
        restoredVersionNumber: target.version_number,
        report: persisted.report,
      };
    },
  });
}

// ─── Persistence helpers shared by line ops + restore ────────────────────

/**
 * Persist a content-only edit to the report and write the
 * activity_log entry. The DB trigger handles version-history capture
 * automatically.
 */
async function writeContentAndLog(
  ctx: ChatToolContext,
  previous: Report,
  nextContent: string,
  log: { action: string; meta: Record<string, unknown> },
): Promise<{ report: Report } | { error: string }> {
  const { data, error } = await ctx.supabase
    .from("advisorpilot_reports")
    .update({ content: nextContent })
    .eq("id", previous.id)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Update failed." };
  const next = toReport(data as ReportRow);
  await writeActivityLog(ctx.supabase, {
    ownerEmail: ctx.advisorEmail,
    ownerUserId: null,
    clientId: next.clientId,
    type: "document",
    title: `Report edited: ${next.title}`,
    actorEmail: ctx.advisorEmail,
    metadata: {
      report_id: next.id,
      ...log.meta,
      action: log.action,
      edited_by: "chat_tool",
      content_length_before: previous.content.length,
      content_length_after: next.content.length,
    },
  });
  return { report: next };
}

/**
 * Restore a full snapshot — copies title + content + status + visibility +
 * tags + icon + color back onto the live row. The snapshot trigger
 * captures the PRIOR live state as a new version first, so no data is
 * lost (the restore is itself reversible by restoring the immediately-
 * prior version).
 */
async function writeFullSnapshotAndLog(
  ctx: ChatToolContext,
  previous: Report,
  snapshot: {
    title: string;
    content: string;
    status: string | null;
    visibility: string | null;
    tags: unknown;
    icon: string | null;
    color: string | null;
    version_number: number;
  },
  log: { action: string; meta: Record<string, unknown> },
): Promise<{ report: Report } | { error: string }> {
  const patch: Record<string, unknown> = {
    title: snapshot.title,
    content: snapshot.content,
  };
  if (snapshot.status !== null) patch.status = snapshot.status;
  if (snapshot.visibility !== null) patch.visibility = snapshot.visibility;
  if (snapshot.tags !== null) patch.tags = snapshot.tags;
  if (snapshot.icon !== null) patch.icon = snapshot.icon;
  if (snapshot.color !== null) patch.color = snapshot.color;
  // Mirror archived_at logic from manage_report.update — keep the
  // partial index honest.
  if (snapshot.status !== null) {
    patch.archived_at =
      snapshot.status === "archived" ? new Date().toISOString() : null;
  }
  const { data, error } = await ctx.supabase
    .from("advisorpilot_reports")
    .update(patch)
    .eq("id", previous.id)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Restore failed." };
  const next = toReport(data as ReportRow);
  await writeActivityLog(ctx.supabase, {
    ownerEmail: ctx.advisorEmail,
    ownerUserId: null,
    clientId: next.clientId,
    type: "document",
    title: `Report restored to version ${snapshot.version_number}: ${next.title}`,
    actorEmail: ctx.advisorEmail,
    metadata: {
      report_id: next.id,
      ...log.meta,
      action: log.action,
      edited_by: "chat_tool",
    },
  });
  return { report: next };
}

// ─── Local arg helpers ────────────────────────────────────────────────────

function pickUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isUuid(trimmed) ? trimmed : null;
}

function pickInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value;
}
