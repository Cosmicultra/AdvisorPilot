/**
 * `run_fee_analysis` — comparative illustrative fee analysis for a client.
 *
 * Uses persisted `fee_analysis_worksheet` when present; otherwise legacy
 * single-fee synthesis (all accounts → other_advisor / transition_to_me).
 */

import { POST as feeAnalysisHandler } from "@/app/api/fee-analysis/route";
import {
  buildComparativeFeeApiAccounts,
  mergeWorksheetAccounts,
  myAdvisoryFeeAnnualFromWorksheet,
  normalizeFeeAnalysisWorksheet,
} from "@/lib/comparative-fee-analysis";
import { groupFeeAnalysisFundRowsByAccount } from "@/lib/fee-analysis";
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
    advisorFeeAnnual: {
      type: "number",
      minimum: 0,
      maximum: 0.2,
      description:
        "Optional override for my advisory fee as DECIMAL (0.01 = 1%). Used when no persisted worksheet exists.",
    },
  },
  required: ["clientId"],
};

export const runFeeAnalysisTool: ChatTool = {
  name: "run_fee_analysis",
  description:
    "Run illustrative comparative fee analysis: current vs proposed management scenarios (`/api/fee-analysis`). Uses saved per-account management assumptions when present; otherwise defaults all fund accounts to other-advisor → transition-to-me at 1%. Read-only — returns fund expense estimates, per-account slices, household rollups, and coverage metrics. ~10-30s.",
  parameters: PARAMETERS,
  handler: handleRunFeeAnalysis,
};

async function handleRunFeeAnalysis(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  if (!ctx.request) {
    return {
      error:
        "run_fee_analysis requires the original chat-stream Request to thread auth through.",
    };
  }

  const clientId = typeof args.clientId === "string" ? args.clientId.trim() : "";
  if (!isUuid(clientId)) {
    return { error: "`clientId` is required (UUID)." };
  }

  const feeOverride =
    typeof args.advisorFeeAnnual === "number" && Number.isFinite(args.advisorFeeAnnual)
      ? args.advisorFeeAnnual
      : null;
  if (feeOverride != null && (feeOverride < 0 || feeOverride > 0.2)) {
    return {
      error: "`advisorFeeAnnual` must be between 0 and 0.2 (i.e. 0% to 20%).",
    };
  }

  try {
    const snapshot = await fetchVisibleClientSnapshot(ctx.supabase, ctx.advisorEmail, clientId);
    if (!snapshot) {
      return { result: { notFound: true } };
    }
    if (snapshot.holdings.length === 0) {
      return {
        error:
          "This client has no holdings — fee analysis needs at least one ETF/mutual-fund position.",
      };
    }

    const groups = groupFeeAnalysisFundRowsByAccount(
      snapshot.holdings as Parameters<typeof groupFeeAnalysisFundRowsByAccount>[0]
    );
    if (groups.length === 0) {
      return {
        error:
          "No ETF or mutual fund holdings classified — fee analysis needs fund wrappers on confirmed holdings.",
      };
    }

    const totalValue =
      snapshot.totalValue > 0
        ? snapshot.totalValue
        : groups.reduce((s, g) => s + g.totalAccountValue, 0);

    let body: Record<string, unknown>;

    if (snapshot.feeAnalysisWorksheet) {
      let ws = normalizeFeeAnalysisWorksheet(snapshot.feeAnalysisWorksheet);
      if (feeOverride != null) {
        ws = { ...ws, myAdvisoryFeePctInput: String(feeOverride * 100) };
      }
      ws = mergeWorksheetAccounts(ws, groups.map((g) => ({ key: g.key })));
      body = {
        schemaVersion: 2,
        totalValue,
        myAdvisoryFeeAnnual: myAdvisoryFeeAnnualFromWorksheet(ws),
        accounts: buildComparativeFeeApiAccounts(groups, ws),
      };
    } else {
      const myFee = feeOverride ?? 0.01;
      body = {
        totalValue,
        advisorFeeAnnual: myFee,
        accounts: groups,
      };
    }

    const invoke = await invokeRouteHandler<
      Record<string, unknown>,
      Record<string, unknown> & { error?: string }
    >({
      ctx,
      handler: feeAnalysisHandler,
      body,
      syntheticUrl: "internal://run_fee_analysis",
    });

    if (invoke.errored || !invoke.body) {
      return {
        error: invoke.body?.error ?? `fee-analysis failed (HTTP ${invoke.status}).`,
      };
    }

    return { result: { clientId, ...invoke.body } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
