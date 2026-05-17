/**
 * `run_enrich_holdings` — refresh ticker/name/asset-class enrichment on a
 * client's holdings.
 *
 * What it does:
 *   1. Visibility-check the client; fetch holdings.
 *   2. Invoke `POST /api/enrich-holdings` in-process with the chat
 *      request's auth headers. Sends the full holdings array (no
 *      `enrichIndices`) so the route runs against every row.
 *   3. Persist the enriched holdings back to `clients.holdings` (unless
 *      `persist: false` is passed for a dry run).
 *   4. Return a per-holding diff summary the model can narrate (rows
 *      added/changed counts + a small sample of changed tickers).
 *
 * Why not return the full enriched array: a portfolio with 80 positions
 * × ~1.5KB per row = 120KB. The model only needs to know what changed
 * to narrate to the advisor; specific row diffs can be pulled via
 * `query_crm.path` afterward.
 *
 * Rate: the route includes a 350ms inter-holding delay (OpenFIGI rate
 * limits); for a 30-row portfolio that's ~10s. Single-call duration is
 * dominated by holdings count.
 *
 * Spec: docs/crm/70-orchestrator-tools.md §6.3.
 */

import { POST as enrichHoldingsHandler } from "@/app/api/enrich-holdings/route";
import { isUuid } from "./query-crm-helpers";
import { fetchVisibleClientSnapshot, invokeRouteHandler } from "./run-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const PARAMETERS = {
  type: "object" as const,
  properties: {
    clientId: {
      type: "string",
      description: "UUID of the client. REQUIRED.",
    },
    persist: {
      type: "boolean",
      description:
        "When true (default), the enriched holdings overwrite `clients.holdings`. Set false to dry-run and return the diff without writing.",
    },
  },
  required: ["clientId"],
};

export const runEnrichHoldingsTool: ChatTool = {
  name: "run_enrich_holdings",
  description:
    "Refresh ticker/name/asset-class enrichment on a client's full holdings list (`/api/enrich-holdings`). Useful when the advisor just uploaded fresh statements and the suggested fields look sparse, OR when they want to refresh enrichment after data went stale. ~0.3s per holding (rate-limited). Returns a SUMMARY of changes — not the full enriched array. Use `query_crm.path` with `holdings[N].enrichmentResolvedTicker` afterward to inspect specific rows.",
  parameters: PARAMETERS,
  handler: handleRunEnrich,
};

async function handleRunEnrich(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  if (!ctx.request) {
    return {
      error:
        "run_enrich_holdings requires the original chat-stream Request to thread auth through.",
    };
  }

  const clientId = typeof args.clientId === "string" ? args.clientId.trim() : "";
  if (!isUuid(clientId)) {
    return { error: "`clientId` is required (UUID)." };
  }
  const persist = args.persist !== false;

  try {
    const snapshot = await fetchVisibleClientSnapshot(ctx.supabase, ctx.advisorEmail, clientId);
    if (!snapshot) {
      return { result: { notFound: true } };
    }
    if (snapshot.holdings.length === 0) {
      return { error: "This client has no holdings to enrich." };
    }

    const invoke = await invokeRouteHandler<
      Record<string, unknown>,
      { holdings?: Array<Record<string, unknown>>; error?: string }
    >({
      ctx,
      handler: enrichHoldingsHandler,
      body: { holdings: snapshot.holdings },
      syntheticUrl: "internal://run_enrich_holdings",
    });

    if (invoke.errored || !invoke.body) {
      return {
        error:
          invoke.body?.error ?? `enrich-holdings failed (HTTP ${invoke.status}).`,
      };
    }
    const enriched = invoke.body.holdings ?? [];
    if (!Array.isArray(enriched) || enriched.length === 0) {
      return { error: "enrich-holdings returned no enriched payload." };
    }

    // Diff against the previous holdings — index-aligned because we sent
    // the full array (not selective).
    const diff = computeEnrichmentDiff(snapshot.holdings, enriched);

    // Persist (unless dry-run).
    let persisted = false;
    if (persist) {
      const { error: updateError } = await ctx.supabase
        .from("advisorpilot_clients")
        .update({ holdings: enriched })
        .eq("id", clientId);
      if (updateError) {
        return {
          error: `Enrichment ran but failed to persist: ${updateError.message}`,
        };
      }
      persisted = true;
    }

    return {
      result: {
        clientId,
        persisted,
        holdingCount: enriched.length,
        ...diff,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff helper
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichmentDiff {
  changedCount: number;
  tickerChangedCount: number;
  assetClassChangedCount: number;
  sampleChanges: Array<{
    index: number;
    before: { ticker: string; name: string; assetClass: string };
    after: { ticker: string; name: string; assetClass: string };
  }>;
}

function computeEnrichmentDiff(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
): EnrichmentDiff {
  const SAMPLE_CAP = 5;
  const changes: EnrichmentDiff["sampleChanges"] = [];
  let changedCount = 0;
  let tickerChangedCount = 0;
  let assetClassChangedCount = 0;

  const len = Math.min(before.length, after.length);
  for (let i = 0; i < len; i += 1) {
    const a = before[i] ?? {};
    const b = after[i] ?? {};
    const beforeView = projectHolding(a);
    const afterView = projectHolding(b);
    const tickerChanged = beforeView.ticker !== afterView.ticker;
    const assetClassChanged = beforeView.assetClass !== afterView.assetClass;
    const nameChanged = beforeView.name !== afterView.name;
    if (tickerChanged) tickerChangedCount += 1;
    if (assetClassChanged) assetClassChangedCount += 1;
    if (tickerChanged || assetClassChanged || nameChanged) {
      changedCount += 1;
      if (changes.length < SAMPLE_CAP) {
        changes.push({ index: i, before: beforeView, after: afterView });
      }
    }
  }

  return {
    changedCount,
    tickerChangedCount,
    assetClassChangedCount,
    sampleChanges: changes,
  };
}

function projectHolding(h: Record<string, unknown>): {
  ticker: string;
  name: string;
  assetClass: string;
} {
  return {
    ticker: String(h?.enrichmentResolvedTicker ?? h?.suggested ?? "").toUpperCase(),
    name: String(h?.enrichmentResolvedName ?? h?.rawName ?? h?.suggested ?? ""),
    assetClass: String(h?.enrichmentMappedAssetClass ?? h?.assetClass ?? ""),
  };
}
