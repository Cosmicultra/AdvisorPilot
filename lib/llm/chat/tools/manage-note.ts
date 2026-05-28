/**
 * `manage_note` — compound write tool for client-scoped notes.
 *
 * Three operations:
 *   - create (T2)  — no confirmation; inserts a note
 *   - update (T3)  — preview-then-confirm; updates body/tags/pinned
 *   - delete (T4)  — preview-then-confirm; removes a single note
 *
 * Side effects mirror `app/api/notes/route.ts` POST and
 * `app/api/notes/[id]/route.ts` PATCH/DELETE exactly:
 *
 *   create  → activity_log "Note logged" + bumpLastContactedAt(clientId)
 *   update  → activity_log "Note edited" / "Note pinned" / "Note unpinned"
 *   delete  → activity_log "Note deleted" (with a body preview)
 *
 * Visibility is enforced via the same RPCs:
 *   - create  → clients_visible_to(viewer, clientId)  (parent client must be visible)
 *   - update  → notes_visible_to(viewer, noteId)
 *   - delete  → notes_visible_to(viewer, noteId)
 *
 * Spec: docs/crm/70-orchestrator-tools.md §5.1.
 */

import {
  bumpLastContactedAt,
  writeActivityLog,
} from "@/lib/crm/activity-writer";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import { isNoteSource, toNote, type NoteRow } from "@/lib/crm/note-mapper";
import type { Note } from "@/lib/crm/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffShallow, withConfirmation } from "./confirmation";
import { isUuid } from "./query-crm-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const MAX_BODY_LENGTH = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Tool surface
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    operation: {
      type: "string",
      enum: ["create", "update", "delete"],
      description:
        "create = log a new note on a client (no confirmation needed). update = change body / tags / pinned on an existing note (preview-then-confirm). delete = remove a note (preview-then-confirm).",
    },
    clientId: {
      type: "string",
      description:
        "UUID of the parent client. REQUIRED for create. Ignored for update/delete (the noteId implies the client).",
    },
    noteId: {
      type: "string",
      description: "UUID of the note. REQUIRED for update and delete.",
    },
    body: {
      type: "string",
      description:
        "Note body text. REQUIRED for create; optional for update (omit to leave unchanged). Max 20,000 characters.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "Array of free-form tag strings. Optional. Replaces the existing tag list when provided on update.",
    },
    pinned: {
      type: "boolean",
      description:
        "Whether the note is pinned to the top of the client's notes list. Defaults to false on create.",
    },
    source: {
      type: "string",
      enum: ["manual", "voice_agent", "meeting_recap"],
      description:
        "Where the note came from. Defaults to 'manual'. Almost always omit — only set when transcribing a voice agent or meeting recap.",
    },
    _confirmed: {
      type: "boolean",
      description:
        "Set to true on the SECOND call after the advisor confirms an update or delete preview. Omit (or false) on the first call to receive the preview.",
    },
  },
  required: ["operation"],
};

export const manageNoteTool: ChatTool = {
  name: "manage_note",
  description:
    "Write tool for client-scoped notes. Operations: `create` (T2, no confirmation), `update` (T3, preview-then-confirm), `delete` (T4, preview-then-confirm). Visibility (private / shared / organization) is enforced server-side. Side effects: every successful create/update/delete writes a corresponding activity-log entry that shows in the client's Activity tab; create also bumps the client's last_contacted_at touchpoint.",
  parameters: PARAMETERS,
  handler: handleManageNote,
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler — dispatches by operation
// ─────────────────────────────────────────────────────────────────────────────

async function handleManageNote(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const op = typeof args.operation === "string" ? args.operation : "";
  if (op !== "create" && op !== "update" && op !== "delete") {
    return { error: `Unknown operation '${op}'. Allowed: create | update | delete.` };
  }

  try {
    if (op === "create") return await handleCreate(args, ctx);
    if (op === "update") return await handleUpdate(args, ctx);
    return await handleDelete(args, ctx);
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

  // Visibility gate on the parent client.
  const vis = await ctx.supabase.rpc("clients_visible_to", {
    viewer_email: ctx.advisorEmail,
    client_id: v.clientId,
  });
  if (vis.error) return { error: `clients_visible_to failed: ${vis.error.message}` };
  if (vis.data !== true) return { error: "Client not found." };

  // Inherit org_id from the client; fall back to advisor's personal org.
  const { data: clientRow } = await ctx.supabase
    .from("advisorpilot_clients")
    .select("org_id")
    .eq("id", v.clientId)
    .maybeSingle();
  let orgId = (clientRow?.org_id as string | undefined) ?? null;
  if (!orgId) {
    orgId = await ensurePersonalOrg(ctx.advisorEmail);
  }

  const { data: inserted, error: insertError } = await ctx.supabase
    .from("advisorpilot_notes")
    .insert({
      owner_email: ctx.advisorEmail,
      // Tool context doesn't carry the supabase user id — null is acceptable
      // (matches what the route handler does for Google-auth users).
      owner_user_id: null,
      client_id: v.clientId,
      org_id: orgId,
      visibility: "private",
      author_email: ctx.advisorEmail,
      body: v.body,
      tags: v.tags,
      pinned: v.pinned,
      source: v.source,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    return { error: insertError?.message ?? "Failed to create note." };
  }
  const note = toNote(inserted as NoteRow);

  // Side effects — best-effort, mirror the API route.
  await Promise.all([
    writeActivityLog(ctx.supabase, {
      ownerEmail: ctx.advisorEmail,
      ownerUserId: null,
      clientId: note.clientId,
      type: "note",
      title: "Note logged",
      body: note.body.length > 280 ? `${note.body.slice(0, 277)}…` : note.body,
      actorEmail: ctx.advisorEmail,
      metadata: {
        note_id: note.id,
        pinned: note.pinned,
        source: note.source,
        created_by: "chat_tool",
      },
    }),
    bumpLastContactedAt(ctx.supabase, note.clientId),
  ]);

  return {
    result: {
      success: true,
      action: "create_note",
      note,
    },
  };
}

interface CreateValidationOk {
  ok: true;
  clientId: string;
  body: string;
  tags: string[];
  pinned: boolean;
  source: Note["source"];
}
interface CreateValidationError {
  ok: false;
  error: string;
}

function validateCreate(args: Record<string, unknown>): CreateValidationOk | CreateValidationError {
  const clientId = typeof args.clientId === "string" ? args.clientId.trim() : "";
  if (!isUuid(clientId)) {
    return { ok: false, error: "create requires `clientId` (UUID)." };
  }
  if (typeof args.body !== "string") {
    return { ok: false, error: "create requires `body` (string)." };
  }
  const body = args.body.trim();
  if (!body) return { ok: false, error: "`body` cannot be empty." };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `\`body\` must be ${MAX_BODY_LENGTH} characters or fewer.` };
  }
  const tags = Array.isArray(args.tags)
    ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  const pinned = args.pinned === true;
  let source: Note["source"] = "manual";
  if (args.source !== undefined && args.source !== null) {
    if (!isNoteSource(args.source)) {
      return { ok: false, error: "`source` must be manual|voice_agent|meeting_recap." };
    }
    source = args.source as Note["source"];
  }
  return { ok: true, clientId, body, tags, pinned, source };
}

// ─────────────────────────────────────────────────────────────────────────────
// update (T3) — preview then confirm
// ─────────────────────────────────────────────────────────────────────────────

async function handleUpdate(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const v = validateUpdate(args);
  if (!v.ok) return { error: v.error };
  const { noteId, patch } = v;

  if (Object.keys(patch).length === 0) {
    return { error: "update needs at least one of: body, tags, pinned." };
  }

  return withConfirmation({
    args,
    action: "update_note",
    buildPreview: () => buildUpdatePreview(ctx, noteId, patch),
    execute: () => executeUpdate(ctx, noteId, patch),
  });
}

interface UpdateValidationOk {
  ok: true;
  noteId: string;
  patch: Partial<Pick<Note, "body" | "tags" | "pinned">>;
}
interface UpdateValidationError {
  ok: false;
  error: string;
}

function validateUpdate(args: Record<string, unknown>): UpdateValidationOk | UpdateValidationError {
  const noteId = typeof args.noteId === "string" ? args.noteId.trim() : "";
  if (!isUuid(noteId)) {
    return { ok: false, error: "update requires `noteId` (UUID)." };
  }
  const patch: UpdateValidationOk["patch"] = {};
  if (args.body !== undefined) {
    if (typeof args.body !== "string") {
      return { ok: false, error: "`body` must be a string." };
    }
    const trimmed = args.body.trim();
    if (!trimmed) return { ok: false, error: "`body` cannot be empty." };
    if (trimmed.length > MAX_BODY_LENGTH) {
      return { ok: false, error: `\`body\` must be ${MAX_BODY_LENGTH} characters or fewer.` };
    }
    patch.body = trimmed;
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) {
      return { ok: false, error: "`tags` must be an array of strings." };
    }
    patch.tags = args.tags.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
  }
  if (args.pinned !== undefined) {
    if (typeof args.pinned !== "boolean") {
      return { ok: false, error: "`pinned` must be a boolean." };
    }
    patch.pinned = args.pinned;
  }
  return { ok: true, noteId, patch };
}

async function buildUpdatePreview(
  ctx: ChatToolContext,
  noteId: string,
  patch: Partial<Pick<Note, "body" | "tags" | "pinned">>,
): Promise<{ noteId: string; diff: Record<string, { before: unknown; after: unknown }> } | { error: string }> {
  const previous = await fetchVisibleNote(ctx, noteId);
  if ("error" in previous) return previous;

  const diff = diffShallow(previous.note as unknown as Record<string, unknown>, patch);
  if (Object.keys(diff).length === 0) {
    return { error: "No-op update — the requested patch matches the current values." };
  }
  return { noteId, diff };
}

async function executeUpdate(
  ctx: ChatToolContext,
  noteId: string,
  patch: Partial<Pick<Note, "body" | "tags" | "pinned">>,
): Promise<{ note: Note; changedFields: string[] } | { error: string }> {
  const visible = await fetchVisibleNote(ctx, noteId);
  if ("error" in visible) return visible;
  const previous = visible.note;

  const { data: updatedRow, error: updateError } = await ctx.supabase
    .from("advisorpilot_notes")
    .update(patch)
    .eq("id", noteId)
    .select("*")
    .single();
  if (updateError || !updatedRow) {
    return { error: updateError?.message ?? "Failed to update note." };
  }
  const updated = toNote(updatedRow as NoteRow);

  const changedFields: string[] = [];
  if (patch.body !== undefined && updated.body !== previous.body) changedFields.push("body");
  if (patch.tags !== undefined && !sameTags(updated.tags, previous.tags)) changedFields.push("tags");
  if (patch.pinned !== undefined && updated.pinned !== previous.pinned) changedFields.push("pinned");

  if (changedFields.length > 0) {
    let title = "Note edited";
    if (changedFields.length === 1 && changedFields[0] === "pinned") {
      title = updated.pinned ? "Note pinned" : "Note unpinned";
    }
    await writeActivityLog(ctx.supabase, {
      ownerEmail: ctx.advisorEmail,
      ownerUserId: null,
      clientId: updated.clientId,
      type: "note",
      title,
      actorEmail: ctx.advisorEmail,
      metadata: {
        note_id: updated.id,
        action: "updated",
        changed_fields: changedFields,
        edited_by: "chat_tool",
      },
    });
  }

  return { note: updated, changedFields };
}

// ─────────────────────────────────────────────────────────────────────────────
// delete (T4) — preview then confirm
// ─────────────────────────────────────────────────────────────────────────────

async function handleDelete(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const noteId = typeof args.noteId === "string" ? args.noteId.trim() : "";
  if (!isUuid(noteId)) {
    return { error: "delete requires `noteId` (UUID)." };
  }

  return withConfirmation({
    args,
    action: "delete_note",
    buildPreview: async () => {
      const visible = await fetchVisibleNote(ctx, noteId);
      if ("error" in visible) return visible;
      const n = visible.note;
      return {
        noteId,
        snapshot: {
          clientId: n.clientId,
          body: n.body.length > 200 ? `${n.body.slice(0, 197)}…` : n.body,
          tags: n.tags,
          pinned: n.pinned,
          createdAt: n.createdAt,
        },
      };
    },
    execute: async () => {
      const visible = await fetchVisibleNote(ctx, noteId);
      if ("error" in visible) return visible;
      const n = visible.note;

      const { error: deleteError } = await ctx.supabase
        .from("advisorpilot_notes")
        .delete()
        .eq("id", noteId);
      if (deleteError) return { error: deleteError.message };

      const preview = n.body.length > 80 ? `${n.body.slice(0, 77)}…` : n.body;
      await writeActivityLog(ctx.supabase, {
        ownerEmail: ctx.advisorEmail,
        ownerUserId: null,
        clientId: n.clientId,
        type: "note",
        title: "Note deleted",
        body: preview,
        actorEmail: ctx.advisorEmail,
        metadata: { note_id: noteId, action: "deleted", deleted_by: "chat_tool" },
      });

      return { noteId, deleted: true };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchVisibleNote(
  ctx: ChatToolContext,
  noteId: string,
): Promise<{ note: Note } | { error: string }> {
  const vis = await ctx.supabase.rpc("notes_visible_to", {
    viewer_email: ctx.advisorEmail,
    note_id: noteId,
  });
  if (vis.error) return { error: `notes_visible_to failed: ${vis.error.message}` };
  if (vis.data !== true) return { error: "Note not found." };

  const { data, error } = await ctx.supabase
    .from("advisorpilot_notes")
    .select("*")
    .eq("id", noteId)
    .maybeSingle();
  if (error) return { error: `note fetch failed: ${error.message}` };
  if (!data) return { error: "Note not found." };
  return { note: toNote(data as NoteRow) };
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((t, i) => t === sortedB[i]);
}

// Used by test mocks via `SupabaseClient` shape narrowing.
export type _ManageNoteSupabase = SupabaseClient;
