import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  deleteConversation,
  getConversation,
  patchConversation,
} from "@/lib/chat/persistence";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";

/**
 * /api/chat/conversations/[id] — single-conversation endpoint.
 *
 *   GET     → ChatConversationDetail (header + messages[])
 *   PATCH   → rename (title) or archive/restore (isArchived)
 *   DELETE  → hard delete (drops messages via FK cascade)
 *
 * Visibility-gated via the same `chat_conversation_visible_to` predicate
 * the helpers use, so any sharing-model changes only need to touch the
 * SQL. Returns 404 for not-visible to avoid leaking row existence
 * (mirrors the report/note/task patterns).
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.16.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      return NextResponse.json(
        { error: "Sign in to load this chat." },
        { status: 401 },
      );
    }
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();
    const result = await getConversation(supabase, {
      conversationId: id,
      ownerEmail: identity.email,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.notFound ? 404 : 400 },
      );
    }
    return NextResponse.json({ conversation: result.conversation });
  } catch (err) {
    console.error("[chat:api] route=/api/chat/conversations/[id] GET error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load chat." },
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
      return NextResponse.json(
        { error: "Sign in to update this chat." },
        { status: 401 },
      );
    }
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    // Lightweight per-field validation; the helper applies the length
    // cap. Allow null to clear title (back to auto-title fallback).
    let title: string | null | undefined;
    if (b.title !== undefined) {
      if (b.title === null) title = null;
      else if (typeof b.title !== "string") {
        return NextResponse.json({ error: "title must be a string or null." }, { status: 400 });
      } else title = b.title;
    }
    let isArchived: boolean | undefined;
    if (b.isArchived !== undefined) {
      if (typeof b.isArchived !== "boolean") {
        return NextResponse.json(
          { error: "isArchived must be a boolean." },
          { status: 400 },
        );
      }
      isArchived = b.isArchived;
    }
    let isPinned: boolean | undefined;
    if (b.isPinned !== undefined) {
      if (typeof b.isPinned !== "boolean") {
        return NextResponse.json(
          { error: "isPinned must be a boolean." },
          { status: 400 },
        );
      }
      isPinned = b.isPinned;
    }

    const supabase = getCrmSupabaseAdmin();
    const result = await patchConversation(supabase, {
      conversationId: id,
      ownerEmail: identity.email,
      title,
      isArchived,
      isPinned,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.notFound ? 404 : 400 },
      );
    }
    return NextResponse.json({ conversation: result.conversation });
  } catch (err) {
    console.error("[chat:api] route=/api/chat/conversations/[id] PATCH error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update chat." },
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
      return NextResponse.json(
        { error: "Sign in to delete this chat." },
        { status: 401 },
      );
    }
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();
    const result = await deleteConversation(supabase, {
      conversationId: id,
      ownerEmail: identity.email,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.notFound ? 404 : 400 },
      );
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("[chat:api] route=/api/chat/conversations/[id] DELETE error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete chat." },
      { status: 500 },
    );
  }
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
