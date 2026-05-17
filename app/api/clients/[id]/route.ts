import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { ClientStage } from "@/lib/crm/types";

const EDITABLE_STAGES: ClientStage[] = [
  "Review due",
  "Upcoming",
  "Stable",
  "At risk",
  "Onboarding",
  "Prospect",
];

/**
 * GET /api/clients/[id]
 *
 * Returns the full ClientDetail payload for a single client. The right-pane
 * Profile header + Overview tab read from this.
 *
 * Visibility: calls clients_visible_to(viewer_email, client_id) — the SAME
 * SQL function the RLS policies use. If the row exists but the viewer can't
 * see it, returns 404 (not 403) to avoid leaking row existence to non-owners.
 *
 * Aggregates included:
 *   - openTaskCount   : count of advisorpilot_tasks for this client where
 *                       status IN ('open', 'in_progress')
 *   - recentNoteCount : count of advisorpilot_notes for this client logged
 *                       in the last 30 days
 *
 * Both aggregates count rows the viewer can see — same visibility as the
 * client itself (Phase 6 will widen this when sharing UI lands).
 *
 * Spec: docs/crm/20-technical-specs.md §2.4.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_NOTE_WINDOW_DAYS = 30;

export const GET = async (
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
      return NextResponse.json(
        { error: "Sign in to load this client." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    if (!id || !isUuid(id)) {
      return NextResponse.json(
        { error: "Invalid client id." },
        { status: 400 }
      );
    }

    const supabase = getCrmSupabaseAdmin();
    const startedAt = Date.now();

    const visibleResult = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: id,
    });

    if (visibleResult.error) {
      console.error(
        `[crm:api] route=/api/clients/${id} visibility-rpc-error`,
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

    const [rowResult, taskCount, noteCount] = await Promise.all([
      supabase
        .from("advisorpilot_clients")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("advisorpilot_tasks")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id)
        .in("status", ["open", "in_progress"]),
      supabase
        .from("advisorpilot_notes")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id)
        .gte(
          "created_at",
          new Date(
            Date.now() - RECENT_NOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000
          ).toISOString()
        ),
    ]);

    const fetchMs = Date.now() - startedAt;

    if (rowResult.error) {
      console.error(
        `[crm:api] route=/api/clients/${id} row-fetch-error`,
        rowResult.error
      );
      return NextResponse.json(
        { error: rowResult.error.message },
        { status: 400 }
      );
    }

    if (!rowResult.data) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const detail = toClientDetail(rowResult.data as ClientRow, {
      openTaskCount: taskCount.count ?? 0,
      recentNoteCount: noteCount.count ?? 0,
    });

    console.info(
      `[crm:api] route=/api/clients/${id} status=200 fetchMs=${fetchMs}`
    );

    return NextResponse.json({ client: detail });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/clients/[id] error", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load client detail.",
      },
      { status: 500 }
    );
  }
};

// ─── PATCH ────────────────────────────────────────────────────────────────

/**
 * PATCH /api/clients/[id]
 *
 * Updates the CRM-only top-level columns on advisorpilot_clients. The intake
 * JSONB (firstName, lastName, dob, etc.) is owned by /api/client-database
 * — this route only touches the Phase-0 additive columns.
 *
 * Editable fields (all optional; only provided keys are updated):
 *   - stage           : ClientStage | null
 *   - tags            : string[]
 *   - location        : string | null
 *   - email           : string | null
 *   - phone           : string | null
 *   - nextMeetingAt   : ISO datetime string | null
 *   - reviewDueAt     : YYYY-MM-DD | null
 *   - ownerInitials   : string | null
 *   - householdLabel  : string | null
 *   - inceptionYear   : number (1900-2100) | null
 *   - ytdReturn       : number (decimal, e.g. 0.062 for 6.2%) | null
 *
 * Visibility + write gate:
 *   - clients_visible_to(viewer, id) must return true (404 otherwise)
 *   - viewer must be the creator (owner_email match) per RLS pattern.
 *     Phase 6 org-admin override is a follow-up.
 *
 * Returns the refreshed ClientDetail on success (with updated aggregates).
 *
 * Spec: docs/crm/20-technical-specs.md §2.4.
 */
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
      return NextResponse.json(
        { error: "Sign in to update this client." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid client id." }, { status: 400 });
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

    // Visibility gate first.
    const visibleResult = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: id,
    });
    if (visibleResult.error) {
      console.error(
        `[crm:api] route=/api/clients/${id} PATCH visibility-rpc-error`,
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

    // Ownership gate: only the creator can edit (Phase 6 org-admin override
    // will widen this once sharing UI lands).
    const { data: ownerRow, error: ownerErr } = await supabase
      .from("advisorpilot_clients")
      .select("owner_email")
      .eq("id", id)
      .maybeSingle();
    if (ownerErr || !ownerRow) {
      return NextResponse.json(
        { error: ownerErr?.message ?? "Client not found." },
        { status: ownerErr ? 400 : 404 }
      );
    }
    if (String(ownerRow.owner_email).toLowerCase() !== identity.email) {
      return NextResponse.json(
        { error: "Only the client's owner can edit these fields." },
        { status: 403 }
      );
    }

    if (Object.keys(validation.patch).length === 0) {
      // Nothing to update — just return the current detail (same shape as GET).
      return await respondWithDetail(supabase, id);
    }

    const startedAt = Date.now();
    const { error: updateErr } = await supabase
      .from("advisorpilot_clients")
      .update(validation.patch)
      .eq("id", id);

    if (updateErr) {
      console.error(`[crm:api] route=/api/clients/${id} PATCH update-error`, updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    const response = await respondWithDetail(supabase, id);
    console.info(
      `[crm:api] route=/api/clients/${id} PATCH status=200 fetchMs=${Date.now() - startedAt} fields=${Object.keys(validation.patch).join(",")}`
    );
    return response;
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/clients/[id] PATCH error", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to update client.",
      },
      { status: 500 }
    );
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Re-fetch the row + aggregates and return the ClientDetail-shaped response. */
async function respondWithDetail(
  supabase: ReturnType<typeof getCrmSupabaseAdmin>,
  id: string
) {
  const [rowResult, taskCount, noteCount] = await Promise.all([
    supabase.from("advisorpilot_clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("advisorpilot_tasks")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("advisorpilot_notes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .gte(
        "created_at",
        new Date(
          Date.now() - RECENT_NOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000
        ).toISOString()
      ),
  ]);
  if (rowResult.error || !rowResult.data) {
    return NextResponse.json(
      { error: rowResult.error?.message ?? "Client not found." },
      { status: rowResult.error ? 400 : 404 }
    );
  }
  const detail = toClientDetail(rowResult.data as ClientRow, {
    openTaskCount: taskCount.count ?? 0,
    recentNoteCount: noteCount.count ?? 0,
  });
  return NextResponse.json({ client: detail });
}

interface ClientPatch {
  stage?: string | null;
  tags?: string[];
  location?: string | null;
  email?: string | null;
  phone?: string | null;
  next_meeting_at?: string | null;
  review_due_at?: string | null;
  owner_initials?: string | null;
  household_label?: string | null;
  inception_year?: number | null;
  ytd_return?: number | null;
}

interface PatchValidationOk {
  ok: true;
  patch: ClientPatch;
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
  const patch: ClientPatch = {};

  if ("stage" in b) {
    if (b.stage === null) {
      patch.stage = null;
    } else if (typeof b.stage === "string" && EDITABLE_STAGES.includes(b.stage as ClientStage)) {
      patch.stage = b.stage;
    } else {
      return { ok: false, error: `stage must be one of: ${EDITABLE_STAGES.join(", ")}, or null.` };
    }
  }

  if ("tags" in b) {
    if (!Array.isArray(b.tags)) {
      return { ok: false, error: "tags must be an array of strings." };
    }
    patch.tags = b.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  }

  const stringResult = readNullableString(b, "location");
  if (stringResult === "invalid") return { ok: false, error: "location must be a string or null." };
  if (stringResult !== "missing") patch.location = stringResult;

  const emailResult = readNullableString(b, "email");
  if (emailResult === "invalid") return { ok: false, error: "email must be a string or null." };
  if (emailResult !== "missing") patch.email = emailResult;

  const phoneResult = readNullableString(b, "phone");
  if (phoneResult === "invalid") return { ok: false, error: "phone must be a string or null." };
  if (phoneResult !== "missing") patch.phone = phoneResult;

  const ownerInitialsResult = readNullableString(b, "ownerInitials");
  if (ownerInitialsResult === "invalid") return { ok: false, error: "ownerInitials must be a string or null." };
  if (ownerInitialsResult !== "missing") patch.owner_initials = ownerInitialsResult;

  const householdLabelResult = readNullableString(b, "householdLabel");
  if (householdLabelResult === "invalid") return { ok: false, error: "householdLabel must be a string or null." };
  if (householdLabelResult !== "missing") patch.household_label = householdLabelResult;

  if ("nextMeetingAt" in b) {
    if (b.nextMeetingAt === null) {
      patch.next_meeting_at = null;
    } else if (typeof b.nextMeetingAt === "string" && b.nextMeetingAt.trim()) {
      const parsed = Date.parse(b.nextMeetingAt);
      if (Number.isNaN(parsed)) {
        return { ok: false, error: "nextMeetingAt must be an ISO datetime or null." };
      }
      patch.next_meeting_at = new Date(parsed).toISOString();
    } else {
      patch.next_meeting_at = null;
    }
  }

  if ("reviewDueAt" in b) {
    if (b.reviewDueAt === null) {
      patch.review_due_at = null;
    } else if (typeof b.reviewDueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.reviewDueAt)) {
      patch.review_due_at = b.reviewDueAt;
    } else if (typeof b.reviewDueAt === "string" && !b.reviewDueAt.trim()) {
      patch.review_due_at = null;
    } else {
      return { ok: false, error: "reviewDueAt must be YYYY-MM-DD or null." };
    }
  }

  if ("inceptionYear" in b) {
    if (b.inceptionYear === null) {
      patch.inception_year = null;
    } else if (typeof b.inceptionYear === "number" && Number.isInteger(b.inceptionYear)) {
      if (b.inceptionYear < 1900 || b.inceptionYear > 2100) {
        return { ok: false, error: "inceptionYear must be between 1900 and 2100." };
      }
      patch.inception_year = b.inceptionYear;
    } else {
      return { ok: false, error: "inceptionYear must be an integer or null." };
    }
  }

  if ("ytdReturn" in b) {
    if (b.ytdReturn === null) {
      patch.ytd_return = null;
    } else if (typeof b.ytdReturn === "number" && Number.isFinite(b.ytdReturn)) {
      if (b.ytdReturn < -1 || b.ytdReturn > 5) {
        return { ok: false, error: "ytdReturn must be a decimal between -1 and 5." };
      }
      patch.ytd_return = b.ytdReturn;
    } else {
      return { ok: false, error: "ytdReturn must be a decimal number or null." };
    }
  }

  return { ok: true, patch };
}

/** Reads a nullable-string field from the request body.
 *  - 'missing' = key was not present in body (don't include in patch)
 *  - 'invalid' = key was present but value was not string|null
 *  - null      = explicit null OR empty string (clear the column)
 *  - string    = trimmed non-empty value
 */
function readNullableString(
  body: Record<string, unknown>,
  key: string
): "missing" | "invalid" | string | null {
  if (!(key in body)) return "missing";
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
