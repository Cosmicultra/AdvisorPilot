import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { listConversations } from "@/lib/chat/persistence";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";

/**
 * /api/chat/conversations — list endpoint.
 *
 *   GET → ChatConversationSummary[] for the authenticated advisor.
 *
 * v1 is owner-only (no sharing). Future sharing would expand the
 * `list_visible_chat_conversations` RPC, not this route.
 *
 * Filters (all optional query params):
 *   - includeArchived=1  → include soft-archived conversations
 *   - limit=N            → cap N (default 200)
 *   - offset=N           → offset into the visible set
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.16.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export const GET = async (req: Request) => {
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
        { error: "Sign in to load your chats." },
        { status: 401 },
      );
    }

    const params = new URL(req.url).searchParams;
    const includeArchived = parseBool(params.get("includeArchived"));
    const limit = clamp(numOr(params.get("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT);
    const offset = Math.max(0, numOr(params.get("offset"), 0));
    const search = trimOrNull(params.get("search"));

    const supabase = getCrmSupabaseAdmin();
    const result = await listConversations(supabase, {
      ownerEmail: identity.email,
      includeArchived,
      limit,
      offset,
      // Only forward search when present — listConversations dispatches
      // to the search RPC when the trimmed query is ≥3 chars.
      ...(search ? { search } : {}),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ conversations: result.conversations });
  } catch (err: unknown) {
    console.error("[chat:api] route=/api/chat/conversations GET error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load chats." },
      { status: 500 },
    );
  }
};

function numOr(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Number(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseBool(value: string | null): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}
