/**
 * `manage_client` — write tool for top-level CRM client metadata.
 *
 * Single operation in v1:
 *   - update (T3) — preview-then-confirm; updates the CRM-only top-level
 *                   columns (stage / tags / location / email / phone /
 *                   nextMeetingAt / reviewDueAt / ownerInitials /
 *                   householdLabel / inceptionYear / ytdReturn).
 *
 * Intentionally NO `create` — that's the intake wizard's job (10-question
 * flow + holdings upload). Nova doesn't have the surface for it.
 * Intentionally NO `delete` — too destructive; deleting a client cascades
 * to notes/tasks/reports. Force the advisor to do this through the UI
 * where the consequences are spelled out.
 *
 * Intake JSONB (firstName, lastName, dob, etc.), holdings, analysis, and
 * roth_worksheet are **immutable** through this tool — Nova writes only
 * the Phase-0 additive top-level columns. The full intake JSONB is owned
 * by `/api/client-database` and edited via the intake wizard.
 *
 * Visibility + ownership: same gate as `app/api/clients/[id]/route.ts`
 * PATCH — `clients_visible_to(viewer, id)` returns true AND the viewer is
 * the creator (`owner_email` match). The chat tool inherits this from the
 * API route by calling the same RPCs.
 *
 * Side effects: NO activity_log entry (matches the API route's behavior —
 * client metadata edits aren't shown in the timeline today, since they're
 * mostly system fields rather than touchpoints).
 *
 * Spec: docs/crm/70-orchestrator-tools.md §5.3.
 */

import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";
import type { ClientDetail, ClientStage } from "@/lib/crm/types";
import { diffShallow, withConfirmation } from "./confirmation";
import { isUuid } from "./query-crm-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const VALID_STAGES: ClientStage[] = [
  "Review due",
  "Upcoming",
  "Stable",
  "At risk",
  "Onboarding",
  "Prospect",
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// ─────────────────────────────────────────────────────────────────────────────
// Tool surface
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    operation: {
      type: "string",
      enum: ["update"],
      description:
        "Only `update` is supported. There is no `create` (use the intake wizard) and no `delete` (too destructive for chat — direct the advisor to the UI).",
    },
    clientId: {
      type: "string",
      description: "UUID of the client. REQUIRED.",
    },
    stage: {
      type: ["string", "null"],
      enum: ["Review due", "Upcoming", "Stable", "At risk", "Onboarding", "Prospect", null],
      description:
        "Persist a lifecycle stage. When null, the stage will be computed at read time. Setting this OVERRIDES the computed stage.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Free-form tag list. Replaces the existing list.",
    },
    location: {
      type: ["string", "null"],
      description: "Short freeform location string (e.g. 'Denver, CO'). Pass null to clear.",
    },
    email: {
      type: ["string", "null"],
      description:
        "Client's preferred email address (top-level — distinct from intake JSONB's spouse email). Pass null to clear.",
    },
    phone: {
      type: ["string", "null"],
      description: "Client's phone number. Pass null to clear.",
    },
    nextMeetingAt: {
      type: ["string", "null"],
      description: "ISO datetime (YYYY-MM-DDTHH:MM:SS or with timezone). Pass null to clear.",
    },
    reviewDueAt: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD). Pass null to clear.",
    },
    ownerInitials: {
      type: ["string", "null"],
      description:
        "Owner initials override (e.g. 'JD'). The Roster computes initials from owner_email when this is null.",
    },
    householdLabel: {
      type: ["string", "null"],
      description: "Household display label (e.g. 'Smith Household'). Pass null to clear.",
    },
    inceptionYear: {
      type: ["integer", "null"],
      minimum: 1900,
      maximum: 2100,
      description:
        "Year the advisor relationship began. Drives the 'Onboarding' stage computation when within the last 90 days.",
    },
    ytdReturn: {
      type: ["number", "null"],
      description:
        "Year-to-date return as a decimal (e.g. 0.062 for 6.2%). Pass null to clear. Validated to be between -1 and 5.",
    },
    _confirmed: {
      type: "boolean",
      description:
        "Set to true on the SECOND call after the advisor confirms the update preview. Omit on the first call to receive the preview.",
    },
  },
  required: ["operation", "clientId"],
};

export const manageClientTool: ChatTool = {
  name: "manage_client",
  description:
    "Write tool for top-level client metadata. Operation: `update` (T3, preview-then-confirm). Edits stage / tags / location / email / phone / nextMeetingAt / reviewDueAt / ownerInitials / householdLabel / inceptionYear / ytdReturn. Does NOT touch intake JSONB / holdings / analysis / roth_worksheet — those are owned by the intake wizard and analysis surfaces. No `create` (use the intake wizard) and no `delete` (too destructive — direct the advisor to the UI).",
  parameters: PARAMETERS,
  handler: handleManageClient,
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleManageClient(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const op = typeof args.operation === "string" ? args.operation : "";
  if (op !== "update") {
    return { error: `Unknown operation '${op}'. Allowed: update.` };
  }

  try {
    const v = validateUpdate(args);
    if (!v.ok) return { error: v.error };
    const { clientId, patch } = v;
    if (Object.keys(patch).length === 0) {
      return {
        error:
          "update needs at least one of: stage, tags, location, email, phone, nextMeetingAt, reviewDueAt, ownerInitials, householdLabel, inceptionYear, ytdReturn.",
      };
    }

    return await withConfirmation({
      args,
      action: "update_client",
      buildPreview: () => buildPreview(ctx, clientId, patch),
      execute: () => executeUpdate(ctx, clientId, patch),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

interface UpdatePatch {
  stage?: ClientStage | null;
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

interface UpdateValidationOk {
  ok: true;
  clientId: string;
  patch: UpdatePatch;
}
interface UpdateValidationError {
  ok: false;
  error: string;
}

function validateUpdate(args: Record<string, unknown>): UpdateValidationOk | UpdateValidationError {
  const clientId = typeof args.clientId === "string" ? args.clientId.trim() : "";
  if (!isUuid(clientId)) {
    return { ok: false, error: "update requires `clientId` (UUID)." };
  }
  const patch: UpdatePatch = {};

  if (args.stage !== undefined) {
    if (args.stage === null) patch.stage = null;
    else if (typeof args.stage !== "string" || !VALID_STAGES.includes(args.stage as ClientStage)) {
      return { ok: false, error: `\`stage\` must be one of ${VALID_STAGES.join(", ")} or null.` };
    } else {
      patch.stage = args.stage as ClientStage;
    }
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) return { ok: false, error: "`tags` must be an array of strings." };
    patch.tags = args.tags.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
  }
  for (const [paramKey, sqlKey] of [
    ["location", "location"],
    ["email", "email"],
    ["phone", "phone"],
    ["ownerInitials", "owner_initials"],
    ["householdLabel", "household_label"],
  ] as const) {
    if (args[paramKey] !== undefined) {
      if (args[paramKey] === null) patch[sqlKey] = null;
      else if (typeof args[paramKey] !== "string") {
        return { ok: false, error: `\`${paramKey}\` must be a string or null.` };
      } else {
        const trimmed = (args[paramKey] as string).trim();
        patch[sqlKey] = trimmed || null;
      }
    }
  }
  if (args.nextMeetingAt !== undefined) {
    if (args.nextMeetingAt === null) patch.next_meeting_at = null;
    else if (typeof args.nextMeetingAt !== "string" || !ISO_DATETIME_RE.test(args.nextMeetingAt)) {
      return { ok: false, error: "`nextMeetingAt` must be an ISO datetime (e.g. 2026-06-01T15:00:00) or null." };
    } else {
      patch.next_meeting_at = args.nextMeetingAt;
    }
  }
  if (args.reviewDueAt !== undefined) {
    if (args.reviewDueAt === null) patch.review_due_at = null;
    else if (typeof args.reviewDueAt !== "string" || !ISO_DATE_RE.test(args.reviewDueAt)) {
      return { ok: false, error: "`reviewDueAt` must be YYYY-MM-DD or null." };
    } else {
      patch.review_due_at = args.reviewDueAt;
    }
  }
  if (args.inceptionYear !== undefined) {
    if (args.inceptionYear === null) patch.inception_year = null;
    else if (typeof args.inceptionYear !== "number" || !Number.isInteger(args.inceptionYear)) {
      return { ok: false, error: "`inceptionYear` must be an integer or null." };
    } else if (args.inceptionYear < 1900 || args.inceptionYear > 2100) {
      return { ok: false, error: "`inceptionYear` must be between 1900 and 2100." };
    } else {
      patch.inception_year = args.inceptionYear;
    }
  }
  if (args.ytdReturn !== undefined) {
    if (args.ytdReturn === null) patch.ytd_return = null;
    else if (typeof args.ytdReturn !== "number" || !Number.isFinite(args.ytdReturn)) {
      return { ok: false, error: "`ytdReturn` must be a number or null." };
    } else if (args.ytdReturn < -1 || args.ytdReturn > 5) {
      return { ok: false, error: "`ytdReturn` must be between -1 and 5 (decimal, not percent)." };
    } else {
      patch.ytd_return = args.ytdReturn;
    }
  }
  return { ok: true, clientId, patch };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview + execute
// ─────────────────────────────────────────────────────────────────────────────

async function buildPreview(
  ctx: ChatToolContext,
  clientId: string,
  patch: UpdatePatch,
): Promise<{ clientId: string; clientName: string; diff: Record<string, { before: unknown; after: unknown }> } | { error: string }> {
  const visible = await fetchVisibleClient(ctx, clientId);
  if ("error" in visible) return visible;
  const previous = visible.client;

  // Map snake_case patch keys to camelCase on the ClientDetail shape for
  // diff display the model can narrate.
  const camelPatch: Record<string, unknown> = {};
  if ("stage" in patch) camelPatch.stage = patch.stage;
  if ("tags" in patch) camelPatch.tags = patch.tags;
  if ("location" in patch) camelPatch.location = patch.location;
  if ("email" in patch) camelPatch.email = patch.email;
  if ("phone" in patch) camelPatch.phone = patch.phone;
  if ("next_meeting_at" in patch) camelPatch.nextMeetingAt = patch.next_meeting_at;
  if ("review_due_at" in patch) camelPatch.reviewDueAt = patch.review_due_at;
  if ("owner_initials" in patch) camelPatch.ownerInitials = patch.owner_initials;
  if ("household_label" in patch) camelPatch.householdLabel = patch.household_label;
  if ("inception_year" in patch) camelPatch.inceptionYear = patch.inception_year;
  if ("ytd_return" in patch) camelPatch.ytdReturn = patch.ytd_return;

  const diff = diffShallow(previous as unknown as Record<string, unknown>, camelPatch);
  if (Object.keys(diff).length === 0) {
    return { error: "No-op update — the requested patch matches the current values." };
  }
  return {
    clientId,
    clientName: `${previous.firstName} ${previous.lastName}`.trim() || "(unnamed)",
    diff,
  };
}

async function executeUpdate(
  ctx: ChatToolContext,
  clientId: string,
  patch: UpdatePatch,
): Promise<{ client: ClientDetail } | { error: string }> {
  // Re-check visibility + ownership on the execute path — defense in depth.
  // The route enforces both: visible AND viewer === owner_email. We mirror
  // by fetching with a manual ownership check.
  const visible = await fetchVisibleClient(ctx, clientId);
  if ("error" in visible) return visible;
  if (visible.client.ownerEmail.toLowerCase() !== ctx.advisorEmail.toLowerCase()) {
    return {
      error:
        "Only the client's owner can edit top-level metadata via Nova. The advisor must use the UI for shared/organization-owned clients.",
    };
  }

  const { data: updatedRow, error: updateError } = await ctx.supabase
    .from("advisorpilot_clients")
    .update(patch)
    .eq("id", clientId)
    .select("*")
    .single();
  if (updateError || !updatedRow) {
    return { error: updateError?.message ?? "Failed to update client." };
  }

  const detail = toClientDetail(updatedRow as ClientRow, {
    // Aggregates aren't recomputed here — the chat caller doesn't surface them.
    openTaskCount: 0,
    recentNoteCount: 0,
  });
  return { client: detail };
}

async function fetchVisibleClient(
  ctx: ChatToolContext,
  clientId: string,
): Promise<{ client: ClientDetail } | { error: string }> {
  const vis = await ctx.supabase.rpc("clients_visible_to", {
    viewer_email: ctx.advisorEmail,
    client_id: clientId,
  });
  if (vis.error) return { error: `clients_visible_to failed: ${vis.error.message}` };
  if (vis.data !== true) return { error: "Client not found." };

  const { data, error } = await ctx.supabase
    .from("advisorpilot_clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { error: `client fetch failed: ${error.message}` };
  if (!data) return { error: "Client not found." };
  return {
    client: toClientDetail(data as ClientRow, { openTaskCount: 0, recentNoteCount: 0 }),
  };
}
