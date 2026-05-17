import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import { toNote, type NoteRow } from "@/lib/crm/note-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { Note } from "@/lib/crm/types";

/**
 * /api/notes/[id] — single-note endpoint.
 *
 * PATCH    update body / tags / pinned. Author/clientId/source are
 *          immutable after creation.
 * DELETE   remove the note.
 *
 * Visibility: notes_visible_to gate before any read/write. Returns 404 for
 * not-visible to avoid leaking row existence.
 *
 * No activity-log entries on note edits (Phase 2 is intentionally quiet
 * about edits — only the original "Note logged" entry shows in the timeline).
 *
 * Spec: docs/crm/20-technical-specs.md §2.2.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_LENGTH = 20_000;

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
      return NextResponse.json({ error: "Sign in to update this note." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid note id." }, { status: 400 });
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

    const visibleResult = await supabase.rpc("notes_visible_to", {
      viewer_email: identity.email,
      note_id: id,
    });
    if (visibleResult.error) {
      console.error("[crm:api] route=/api/notes/[id] PATCH visibility-rpc-error", visibleResult.error);
      return NextResponse.json({ error: visibleResult.error.message }, { status: 400 });
    }
    if (visibleResult.data !== true) {
      return NextResponse.json({ error: "Note not found." }, { status: 404 });
    }

    const updatePayload: Record<string, unknown> = {};
    if ("body" in validation.patch) updatePayload.body = validation.patch.body;
    if ("tags" in validation.patch) updatePayload.tags = validation.patch.tags;
    if ("pinned" in validation.patch) updatePayload.pinned = validation.patch.pinned;

    if (Object.keys(updatePayload).length === 0) {
      // Nothing to update — fetch the row and return as-is.
      const { data: existing } = await supabase
        .from("advisorpilot_notes")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json({ error: "Note not found." }, { status: 404 });
      }
      return NextResponse.json({ note: toNote(existing as NoteRow) });
    }

    // Fetch the previous row so we can detect what actually changed for the
    // activity_log entry.
    const { data: previousRow } = await supabase
      .from("advisorpilot_notes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const previous = previousRow ? toNote(previousRow as NoteRow) : null;

    const { data: updatedRow, error: updateError } = await supabase
      .from("advisorpilot_notes")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !updatedRow) {
      console.error("[crm:api] route=/api/notes/[id] PATCH update-error", updateError);
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to update note." },
        { status: 400 }
      );
    }

    const updated = toNote(updatedRow as NoteRow);

    // Activity log: ONE entry per PATCH, with a specific title for pin-only
    // changes so the Timeline reads naturally. Body-edit + tag-edit (with
    // or without pin) collapse into "Note edited" with changed fields in
    // metadata.
    if (previous) {
      const changedFields = computeChangedFields(validation.patch, previous, updated);
      if (changedFields.length > 0) {
        let title = "Note edited";
        if (changedFields.length === 1 && changedFields[0] === "pinned") {
          title = updated.pinned ? "Note pinned" : "Note unpinned";
        }
        await writeActivityLog(supabase, {
          ownerEmail: identity.email,
          ownerUserId: identity.userId,
          clientId: updated.clientId,
          type: "note",
          title,
          actorEmail: identity.email,
          metadata: {
            note_id: updated.id,
            action: "updated",
            changed_fields: changedFields,
          },
        });
      }
    }

    console.info(`[crm:api] route=/api/notes/${id} status=200`);

    return NextResponse.json({ note: updated });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/notes/[id] PATCH error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update note." },
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
      return NextResponse.json({ error: "Sign in to delete this note." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid note id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    const visibleResult = await supabase.rpc("notes_visible_to", {
      viewer_email: identity.email,
      note_id: id,
    });
    if (visibleResult.error || visibleResult.data !== true) {
      return NextResponse.json({ error: "Note not found." }, { status: 404 });
    }

    // Fetch first so the activity-log entry can preserve a body snippet +
    // the parent client_id (needed because the row will be gone after delete).
    const { data: existingRow } = await supabase
      .from("advisorpilot_notes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const existing = existingRow ? toNote(existingRow as NoteRow) : null;

    const { error: deleteError } = await supabase
      .from("advisorpilot_notes")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[crm:api] route=/api/notes/[id] DELETE error", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    if (existing) {
      const preview =
        existing.body.length > 80 ? `${existing.body.slice(0, 77)}…` : existing.body;
      await writeActivityLog(supabase, {
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        clientId: existing.clientId,
        type: "note",
        title: "Note deleted",
        body: preview,
        actorEmail: identity.email,
        metadata: { note_id: id, action: "deleted" },
      });
    }

    console.info(`[crm:api] route=/api/notes/${id} status=200 method=DELETE`);

    return NextResponse.json({ id });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/notes/[id] DELETE error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete note." },
      { status: 500 }
    );
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────

interface NotePatch {
  body?: string;
  tags?: string[];
  pinned?: boolean;
}

interface PatchValidationOk {
  ok: true;
  patch: NotePatch;
}

interface PatchValidationError {
  ok: false;
  error: string;
}

function validatePatchBody(input: unknown): PatchValidationOk | PatchValidationError {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid body." };
  }
  const b = input as Record<string, unknown>;
  const patch: NotePatch = {};

  if (b.body !== undefined) {
    if (typeof b.body !== "string") {
      return { ok: false, error: "body must be a string." };
    }
    const trimmed = b.body.trim();
    if (!trimmed) return { ok: false, error: "body cannot be empty." };
    if (trimmed.length > MAX_BODY_LENGTH) {
      return { ok: false, error: `body must be ${MAX_BODY_LENGTH} characters or fewer.` };
    }
    patch.body = trimmed;
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) {
      return { ok: false, error: "tags must be an array of strings." };
    }
    patch.tags = b.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  }

  if (b.pinned !== undefined) {
    if (typeof b.pinned !== "boolean") {
      return { ok: false, error: "pinned must be a boolean." };
    }
    patch.pinned = b.pinned;
  }

  return { ok: true, patch };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Returns the camelCase keys of the fields the patch actually changed
 *  vs. the previous Note. The PATCH validator omits unchanged keys, but
 *  the API also accepts no-op writes (same value sent back) — this helper
 *  filters those out so the activity log doesn't fire spurious entries. */
function computeChangedFields(
  patch: NotePatch,
  previous: Note,
  updated: Note
): (keyof NotePatch)[] {
  const changed: (keyof NotePatch)[] = [];
  if (patch.body !== undefined && updated.body !== previous.body) changed.push("body");
  if (patch.tags !== undefined && !sameTags(updated.tags, previous.tags)) changed.push("tags");
  if (patch.pinned !== undefined && updated.pinned !== previous.pinned) changed.push("pinned");
  return changed;
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((tag, i) => tag === sortedB[i]);
}
