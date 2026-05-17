/**
 * `run_analysis` — refresh the AI portfolio analysis for a client.
 *
 * What it does:
 *   1. Visibility-check the client.
 *   2. Fetch intake + holdings + total_value from the row.
 *   3. Compute allocation buckets via the shared `lib/crm/projections.ts`
 *      helper (same math as the Overview card).
 *   4. Invoke `POST /api/generate-analysis` in-process with the chat
 *      request's auth headers.
 *   5. Persist the returned analysis JSON back to `advisorpilot_clients.analysis`.
 *   6. Return a summary the model can narrate (synopsis snippet + counts
 *      of red flags / recommendations / talking points) plus a flag
 *      indicating that the persisted analysis was updated.
 *
 * Doesn't return the FULL analysis to the model in the tool result — that
 * would balloon the prompt with ~10-30KB per call. Instead the model gets
 * a small summary and can use `query_crm.path` (PR 4b) to pull specific
 * subfields when it wants to narrate a specific recommendation.
 *
 * Spec: docs/crm/70-orchestrator-tools.md §6.1.
 */

import { POST as generateAnalysisHandler } from "@/app/api/generate-analysis/route";
import { buildAllocationSummary } from "@/lib/crm/projections";
import { toClientDetail, type ClientRow } from "@/lib/crm/clients-mapper";
import { isUuid } from "./query-crm-helpers";
import { fetchVisibleClientSnapshot, invokeRouteHandler } from "./run-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const PARAMETERS = {
  type: "object" as const,
  properties: {
    clientId: {
      type: "string",
      description: "UUID of the client. REQUIRED. The analysis runs against this client's persisted intake + holdings.",
    },
    persist: {
      type: "boolean",
      description:
        "When true (default), the new analysis is written back to `clients.analysis` so future `query_crm` calls and the Overview card see it. Set false to do a dry-run that returns the summary without persisting.",
    },
  },
  required: ["clientId"],
};

export const runAnalysisTool: ChatTool = {
  name: "run_analysis",
  description:
    "Refresh the AI portfolio analysis for a client (`/api/generate-analysis`). Reads the client's persisted intake + holdings, runs market research + JSON synthesis (~30–60s), and persists the result. Returns a SUMMARY (synopsis snippet + red-flag/recommendation counts) — not the full analysis JSON. To narrate a specific recommendation, use `query_crm.path` with `analysis.recommendations` after this completes.",
  parameters: PARAMETERS,
  handler: handleRunAnalysis,
};

async function handleRunAnalysis(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  if (!ctx.request) {
    return {
      error:
        "run_analysis requires the original chat-stream Request to thread auth through; this tool can't run from a context that's missing it.",
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
      return {
        error:
          "This client has no holdings on file — analysis requires a portfolio. Use the intake / statement-upload flow to add holdings first.",
      };
    }

    // Build allocation via the shared projection helper (matches the UI).
    // toClientDetail is the canonical mapper from row → typed shape; we use
    // it here purely for the holdings + intake normalization the projection
    // expects.
    const detail = toClientDetail(snapshot as unknown as ClientRow, {
      openTaskCount: 0,
      recentNoteCount: 0,
    });
    const allocation = buildAllocationSummary(detail);

    // 1. Invoke the route handler in-process.
    const invoke = await invokeRouteHandler<
      Record<string, unknown>,
      { analysis?: Record<string, unknown>; error?: string }
    >({
      ctx,
      handler: generateAnalysisHandler,
      body: {
        client: snapshot.intake,
        holdings: snapshot.holdings,
        allocation: allocation.buckets,
        totalValue: snapshot.totalValue,
      },
      syntheticUrl: "internal://run_analysis",
    });

    if (invoke.errored) {
      return {
        error:
          invoke.body?.error ??
          `generate-analysis failed (HTTP ${invoke.status}).`,
      };
    }

    const analysis = (invoke.body?.analysis ?? invoke.body) as Record<
      string,
      unknown
    > | null;
    if (!analysis || typeof analysis !== "object") {
      return { error: "generate-analysis returned no analysis payload." };
    }

    // 2. Persist (unless dry-run).
    let persisted = false;
    if (persist) {
      const { error: updateError } = await ctx.supabase
        .from("advisorpilot_clients")
        .update({ analysis })
        .eq("id", clientId);
      if (updateError) {
        return {
          error: `Analysis generated but failed to persist: ${updateError.message}`,
        };
      }
      persisted = true;
    }

    // 3. Build the model-facing summary. Counts only; the model can use
    //    `query_crm.path` if it needs specific items.
    const summary = summarizeAnalysis(analysis);

    return {
      result: {
        clientId,
        persisted,
        summary,
        previousAnalysis: snapshot.analysis
          ? summarizeAnalysis(snapshot.analysis)
          : null,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

interface AnalysisSummary {
  synopsisSnippet: string;
  redFlagCount: number;
  recommendationCount: number;
  talkingPointCount: number;
  overlapInsightCount: number;
  hasObjectionHandling: boolean;
}

function summarizeAnalysis(analysis: Record<string, unknown>): AnalysisSummary {
  const synopsis = typeof analysis.synopsis === "string" ? analysis.synopsis : "";
  return {
    synopsisSnippet: synopsis.length > 300 ? `${synopsis.slice(0, 297)}…` : synopsis,
    redFlagCount: lengthOf(analysis.redFlags),
    recommendationCount: lengthOf(analysis.recommendations),
    talkingPointCount: lengthOf(analysis.talkingPoints),
    overlapInsightCount: lengthOf(analysis.overlapInsights),
    hasObjectionHandling:
      Array.isArray(analysis.objectionHandling) && analysis.objectionHandling.length > 0,
  };
}

function lengthOf(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}
