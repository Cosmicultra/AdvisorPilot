/**
 * `compute` — derived projections over a client's holdings.
 *
 * Three operations in v1:
 *   - allocation_summary  → buckets ($ + weight%) by asset class
 *   - holdings_breakdown  → top-N positions by value (default 5)
 *   - account_summary     → per-account totals grouped by accountNumber
 *
 * All three call the SAME pure helpers in `lib/crm/projections.ts` that
 * back the Overview tab's Allocation card, Holdings table, and Accounts
 * card. The advisor's chat answer mirrors the UI exactly — no drift.
 *
 * Visibility: each operation runs `clients_visible_to` on the client id
 * before fetching, mirroring `query_crm get:clients`. Returns
 * `{notFound: true}` (not 403) when the client exists but isn't visible
 * to the viewer — same pattern as the API routes.
 *
 * Operation-specific knobs:
 *   - holdings_breakdown.topN → number of positions to return (default 5,
 *     hard cap 50; >50 doesn't make sense for narrative answers)
 *
 * Spec: docs/crm/70-orchestrator-tools.md §4.
 */

import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";
import {
  buildAllocationSummary,
  buildHoldingsBreakdown,
  summarizeAccounts,
} from "@/lib/crm/projections";
import type { ClientDetail } from "@/lib/crm/types";
import { isUuid } from "./query-crm-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const MAX_TOP_N = 50;
const DEFAULT_TOP_N = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Tool surface
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    operation: {
      type: "string",
      enum: ["allocation_summary", "holdings_breakdown", "account_summary"],
      description:
        "allocation_summary = $ + weight% per asset-class bucket (Equity/Fixed/Cash/Annuity/Real Estate/Commodities/Mutual Fund/ETF/Other). holdings_breakdown = top-N positions by value with ticker/name/value/weight. account_summary = totals per accountNumber + registration type.",
    },
    clientId: {
      type: "string",
      description: "UUID of the client. REQUIRED.",
    },
    topN: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description:
        "For holdings_breakdown only: how many top positions to return. Default 5, hard cap 50. Ignored for the other operations.",
    },
  },
  required: ["operation", "clientId"],
};

export const computeTool: ChatTool = {
  name: "compute",
  description:
    "Derived projections over a client's holdings — allocation by asset class, top positions, and per-account summaries. Uses the SAME math as the UI's Overview cards so the numbers in the chat match what the advisor sees on the client's profile page. Visibility-gated.",
  parameters: PARAMETERS,
  handler: handleCompute,
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleCompute(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const op = typeof args.operation === "string" ? args.operation : "";
  if (
    op !== "allocation_summary" &&
    op !== "holdings_breakdown" &&
    op !== "account_summary"
  ) {
    return {
      error: `Unknown operation '${op}'. Allowed: allocation_summary | holdings_breakdown | account_summary.`,
    };
  }

  const clientId = typeof args.clientId === "string" ? args.clientId.trim() : "";
  if (!isUuid(clientId)) {
    return { error: "`clientId` is required (UUID)." };
  }

  try {
    const client = await fetchVisibleClient(ctx, clientId);
    if ("error" in client) return client;
    if (client.notFound) {
      return { result: { notFound: true } };
    }

    switch (op) {
      case "allocation_summary":
        return { result: buildAllocationSummary(client.detail) };
      case "holdings_breakdown": {
        const topN = resolveTopN(args.topN);
        return { result: buildHoldingsBreakdown(client.detail, topN) };
      }
      case "account_summary":
        return {
          result: {
            clientId: client.detail.id,
            accounts: summarizeAccounts(client.detail),
          },
        };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveTopN(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_TOP_N;
  const n = Math.floor(raw);
  if (n < 1) return DEFAULT_TOP_N;
  return Math.min(n, MAX_TOP_N);
}

type FetchResult =
  | { detail: ClientDetail; notFound: false }
  | { notFound: true; detail?: never }
  | { error: string };

async function fetchVisibleClient(
  ctx: ChatToolContext,
  clientId: string,
): Promise<FetchResult> {
  const vis = await ctx.supabase.rpc("clients_visible_to", {
    viewer_email: ctx.advisorEmail,
    client_id: clientId,
  });
  if (vis.error) return { error: `clients_visible_to failed: ${vis.error.message}` };
  if (vis.data !== true) return { notFound: true };

  const { data, error } = await ctx.supabase
    .from("advisorpilot_clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { error: `client fetch failed: ${error.message}` };
  if (!data) return { notFound: true };

  // No tasks/notes aggregate counts needed for projections — pass zeros.
  return {
    detail: toClientDetail(data as ClientRow, {
      openTaskCount: 0,
      recentNoteCount: 0,
    }),
    notFound: false,
  };
}
