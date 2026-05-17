import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  toActivityEntry,
  type VisibleActivityRow,
} from "@/lib/crm/activity-adapter";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { ActivityType } from "@/lib/crm/types";

/**
 * GET /api/activity?clientId=&type=&since=&limit=
 *
 * Returns the activity timeline — UNION of advisorpilot_activity_log
 * (CRM-native) and advisorpilot_audit_events (existing audit trail), filtered
 * to the viewer's visibility, sorted newest-first.
 *
 * Query params (all optional):
 *   - clientId : restrict to entries for that client
 *   - type     : filter by ActivityType (applied client-side after the SQL
 *                union — audit events get categorized via the adapter map
 *                first, so filtering by 'analysis' picks up
 *                analysis.completed audit rows)
 *   - since    : ISO date/datetime — only entries occurred_at >= this
 *   - limit    : max rows to return (default 50, max 200)
 *
 * Visibility: delegates to public.list_visible_activity which calls
 * clients_visible_to() on every row's client_id. SAME function the RLS
 * policies use.
 *
 * Response shape (per docs/crm/20-technical-specs.md §2.3):
 *   { entries: ActivityEntry[], hasMore: boolean }
 *
 * `hasMore` is true when we returned exactly `limit` rows AND there might
 * be more behind it; consumers can paginate by passing a smaller `since`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
      return NextResponse.json(
        { error: "Sign in to load activity." },
        { status: 401 }
      );
    }

    const params = new URL(req.url).searchParams;

    const clientId = trimOrNull(params.get("clientId"));
    if (clientId !== null && !isUuid(clientId)) {
      return NextResponse.json(
        { error: "Invalid clientId." },
        { status: 400 }
      );
    }

    const typeFilter = trimOrNull(params.get("type"));

    const sinceRaw = trimOrNull(params.get("since"));
    const sinceIso = sinceRaw ? toIsoOrNull(sinceRaw) : null;
    if (sinceRaw && !sinceIso) {
      return NextResponse.json(
        { error: "Invalid `since` — expected an ISO date or datetime." },
        { status: 400 }
      );
    }

    const limitRaw = params.get("limit");
    const limit = clamp(
      limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT,
      1,
      MAX_LIMIT
    );

    // Fetch one extra row so we can infer hasMore without a count() query.
    const fetchLimit = limit + 1;

    const supabase = getCrmSupabaseAdmin();
    const startedAt = Date.now();
    const { data, error } = await supabase.rpc("list_visible_activity", {
      viewer_email: identity.email,
      target_client_id: clientId,
      since_ts: sinceIso,
      limit_n: fetchLimit,
    });
    const fetchMs = Date.now() - startedAt;

    if (error) {
      console.error("[crm:api] route=/api/activity rpc-error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rawRows = (data ?? []) as VisibleActivityRow[];
    const allEntries = rawRows.map(toActivityEntry);
    const filtered = typeFilter
      ? allEntries.filter((e) => e.type === typeFilter)
      : allEntries;

    const hasMore = filtered.length > limit;
    const trimmed = filtered.slice(0, limit);

    console.info(
      `[crm:api] route=/api/activity status=200 fetchMs=${fetchMs} rows=${rawRows.length} returned=${trimmed.length}`
    );

    return NextResponse.json({
      entries: trimmed,
      hasMore,
    });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/activity error", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load activity.",
      },
      { status: 500 }
    );
  }
};

// ─── POST ─────────────────────────────────────────────────────────────────

const VALID_ACTIVITY_TYPES: ActivityType[] = [
  "note",
  "meeting",
  "document",
  "email",
  "call",
  "task",
  "analysis",
  "system",
];

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;

/**
 * POST /api/activity
 *
 * Manual activity entry — used by the voice agent's Phase 4 `log_call` tool
 * and integrations that want to record an event the CRM didn't trigger
 * itself (e.g. "Email sent to client@example.com").
 *
 * Body: { clientId?, type, title, body?, metadata? }
 *
 * Side effect: just inserts into advisorpilot_activity_log. The mutation
 * itself doesn't write a SECOND audit-event row (that would loop with the
 * GET-side union).
 *
 * Visibility: when clientId is set, viewer must be able to see the client
 * (clients_visible_to). Returns 404 for not-visible to avoid leaking existence.
 *
 * Spec: docs/crm/20-technical-specs.md §2.3.
 */
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
      return NextResponse.json(
        { error: "Sign in to record an activity entry." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateActivityBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    // If clientId is set, verify the viewer can see that client.
    if (validation.clientId) {
      const visibleResult = await supabase.rpc("clients_visible_to", {
        viewer_email: identity.email,
        client_id: validation.clientId,
      });
      if (visibleResult.error) {
        console.error(
          "[crm:api] route=/api/activity POST visibility-rpc-error",
          visibleResult.error
        );
        return NextResponse.json(
          { error: visibleResult.error.message },
          { status: 400 }
        );
      }
      if (visibleResult.data !== true) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }
    }

    // writeActivityLog is best-effort; for the POST endpoint we want to
    // surface failures, so we insert directly here and check for errors.
    const { data: inserted, error: insertError } = await supabase
      .from("advisorpilot_activity_log")
      .insert({
        owner_email: identity.email,
        owner_user_id: identity.userId,
        client_id: validation.clientId,
        type: validation.type,
        title: validation.title,
        body: validation.body,
        actor_email: identity.email,
        metadata: validation.metadata,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      console.error("[crm:api] route=/api/activity POST insert-error", insertError);
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to record activity." },
        { status: 400 }
      );
    }

    const entry = toActivityEntry({
      id: inserted.id as string,
      source: "activity_log",
      client_id: inserted.client_id as string | null,
      owner_email: inserted.owner_email as string,
      type: inserted.type as string,
      title: inserted.title as string,
      body: inserted.body as string | null,
      actor_email: inserted.actor_email as string | null,
      metadata: inserted.metadata as Record<string, unknown> | null,
      occurred_at: inserted.occurred_at as string,
    });

    console.info(
      `[crm:api] route=/api/activity status=201 entry_id=${entry.id} type=${entry.type}`
    );

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/activity POST error", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to record activity.",
      },
      { status: 500 }
    );
  }
};

interface ActivityBodyValidation {
  ok: true;
  clientId: string | null;
  type: ActivityType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
}

interface ActivityBodyValidationError {
  ok: false;
  error: string;
}

function validateActivityBody(
  input: unknown
): ActivityBodyValidation | ActivityBodyValidationError {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid body." };
  }
  const b = input as Record<string, unknown>;

  if (typeof b.type !== "string" || !VALID_ACTIVITY_TYPES.includes(b.type as ActivityType)) {
    return {
      ok: false,
      error: `type must be one of: ${VALID_ACTIVITY_TYPES.join(", ")}.`,
    };
  }

  if (typeof b.title !== "string" || !b.title.trim()) {
    return { ok: false, error: "title is required." };
  }
  const title = b.title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }

  let clientId: string | null = null;
  if (b.clientId !== undefined && b.clientId !== null && b.clientId !== "") {
    if (typeof b.clientId !== "string" || !isUuid(b.clientId)) {
      return { ok: false, error: "clientId must be a UUID or null." };
    }
    clientId = b.clientId;
  }

  let body: string | null = null;
  if (typeof b.body === "string" && b.body.trim()) {
    body = b.body.trim();
    if (body.length > MAX_BODY_LENGTH) {
      return { ok: false, error: `body must be ${MAX_BODY_LENGTH} characters or fewer.` };
    }
  }

  let metadata: Record<string, unknown> = {};
  if (b.metadata !== undefined) {
    if (
      b.metadata === null ||
      typeof b.metadata !== "object" ||
      Array.isArray(b.metadata)
    ) {
      return { ok: false, error: "metadata must be an object." };
    }
    metadata = b.metadata as Record<string, unknown>;
  }

  return {
    ok: true,
    clientId,
    type: b.type as ActivityType,
    title,
    body,
    metadata,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toIsoOrNull(value: string): string | null {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
}
