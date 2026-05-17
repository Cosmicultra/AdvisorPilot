import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  bumpLastContactedAt,
  writeActivityLog,
} from "@/lib/crm/activity-writer";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import { isNoteSource, toNote, type NoteRow } from "@/lib/crm/note-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { Note } from "@/lib/crm/types";

/**
 * /api/notes — collection endpoint.
 *
 * GET    list visible notes (filter by clientId / pinned / paginate)
 * POST   create a note. clientId is REQUIRED (notes are always client-scoped).
 *        Side effects:
 *          1. activity_log entry (type='note')
 *          2. clients.last_contacted_at = now() (touchpoint)
 *
 * Visibility on read: list_visible_notes SQL function.
 * Visibility on write: viewer must be able to see the parent client
 * (clients_visible_to). Returns 404 for not-visible to avoid leaking existence.
 *
 * Spec: docs/crm/20-technical-specs.md §2.2.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_BODY_LENGTH = 20_000;

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
      return NextResponse.json({ error: "Sign in to load notes." }, { status: 401 });
    }

    const params = new URL(req.url).searchParams;
    const clientId = trimOrNull(params.get("clientId"));
    if (clientId !== null && !isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid clientId." }, { status: 400 });
    }

    let pinnedFilter: boolean | null = null;
    const pinnedRaw = trimOrNull(params.get("pinned"));
    if (pinnedRaw === "true") pinnedFilter = true;
    else if (pinnedRaw === "false") pinnedFilter = false;
    else if (pinnedRaw !== null) {
      return NextResponse.json(
        { error: "pinned must be 'true' or 'false'." },
        { status: 400 }
      );
    }

    const limit = clamp(numOr(params.get("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT);
    const offset = Math.max(0, numOr(params.get("offset"), 0));

    const supabase = getCrmSupabaseAdmin();
    const startedAt = Date.now();
    const { data, error } = await supabase.rpc("list_visible_notes", {
      viewer_email: identity.email,
    });
    const fetchMs = Date.now() - startedAt;

    if (error) {
      console.error("[crm:api] route=/api/notes rpc-error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const all = ((data ?? []) as NoteRow[]).map(toNote);
    const filtered = all.filter((n) => {
      if (clientId && n.clientId !== clientId) return false;
      if (pinnedFilter !== null && n.pinned !== pinnedFilter) return false;
      return true;
    });
    // Sort: pinned first, then most recent.
    const sorted = [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    const paged = sorted.slice(offset, offset + limit);

    console.info(
      `[crm:api] route=/api/notes status=200 fetchMs=${fetchMs} rows=${all.length} returned=${paged.length}`
    );

    return NextResponse.json({
      notes: paged,
      total: filtered.length,
      hasMore: offset + paged.length < filtered.length,
    });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/notes GET error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load notes." },
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
      return NextResponse.json({ error: "Sign in to log a note." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateNewNoteBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    // Visibility gate on the parent client.
    const visibleResult = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: validation.clientId,
    });
    if (visibleResult.error) {
      console.error("[crm:api] route=/api/notes POST visibility-rpc-error", visibleResult.error);
      return NextResponse.json({ error: visibleResult.error.message }, { status: 400 });
    }
    if (visibleResult.data !== true) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    // Inherit org_id from the client; fall back to advisor's personal org.
    const { data: clientRow } = await supabase
      .from("advisorpilot_clients")
      .select("org_id")
      .eq("id", validation.clientId)
      .maybeSingle();
    let orgId = (clientRow?.org_id as string | undefined) ?? null;
    if (!orgId) {
      orgId = await ensurePersonalOrg(identity.email);
    }

    const insertPayload = {
      owner_email: identity.email,
      owner_user_id: identity.userId,
      client_id: validation.clientId,
      org_id: orgId,
      visibility: "private",
      author_email: identity.email,
      body: validation.body,
      tags: validation.tags,
      pinned: validation.pinned,
      source: validation.source,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("advisorpilot_notes")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !inserted) {
      console.error("[crm:api] route=/api/notes POST insert-error", insertError);
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create note." },
        { status: 400 }
      );
    }

    const note = toNote(inserted as NoteRow);

    // Side effects: activity log + last_contacted_at bump (best-effort).
    await Promise.all([
      writeActivityLog(supabase, {
        ownerEmail: identity.email,
        ownerUserId: identity.userId,
        clientId: note.clientId,
        type: "note",
        title: "Note logged",
        body: note.body.length > 280 ? `${note.body.slice(0, 277)}…` : note.body,
        actorEmail: identity.email,
        metadata: {
          note_id: note.id,
          pinned: note.pinned,
          source: note.source,
        },
      }),
      bumpLastContactedAt(supabase, note.clientId),
    ]);

    console.info(`[crm:api] route=/api/notes status=201 note_id=${note.id}`);

    return NextResponse.json({ note }, { status: 201 });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/notes POST error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create note." },
      { status: 500 }
    );
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────

interface NewNoteValidation {
  ok: true;
  clientId: string;
  body: string;
  tags: string[];
  pinned: boolean;
  source: Note["source"];
}

interface NewNoteValidationError {
  ok: false;
  error: string;
}

function validateNewNoteBody(input: unknown): NewNoteValidation | NewNoteValidationError {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid body." };
  }
  const b = input as Record<string, unknown>;

  if (typeof b.clientId !== "string" || !isUuid(b.clientId)) {
    return { ok: false, error: "clientId is required (UUID)." };
  }

  if (typeof b.body !== "string") {
    return { ok: false, error: "body is required." };
  }
  const noteBody = b.body.trim();
  if (!noteBody) {
    return { ok: false, error: "body cannot be empty." };
  }
  if (noteBody.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `body must be ${MAX_BODY_LENGTH} characters or fewer.` };
  }

  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  const pinned = b.pinned === true;

  let source: Note["source"] = "manual";
  if (b.source !== undefined && b.source !== null) {
    if (!isNoteSource(b.source)) {
      return { ok: false, error: "source must be manual|voice_agent|meeting_recap." };
    }
    source = b.source;
  }

  return { ok: true, clientId: b.clientId, body: noteBody, tags, pinned, source };
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
