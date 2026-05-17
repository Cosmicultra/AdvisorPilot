/**
 * `run_fee_analysis` — estimate fund expense ratios for a client's portfolio.
 *
 * What it does:
 *   1. Visibility-check the client; fetch holdings.
 *   2. Group holdings by account (mirrors the UI's Accounts card grouping).
 *   3. Invoke `POST /api/fee-analysis` in-process with the chat request's
 *      auth headers + advisor fee rate.
 *   4. Return the full `FeeAnalysisApiResponse` shape to the model.
 *
 * Read-only — does NOT persist anything. The fee analysis is an
 * illustrative estimate that the advisor uses to discuss client costs;
 * the route handler writes its own audit trail.
 *
 * Spec: docs/crm/70-orchestrator-tools.md §6.2.
 */

import { POST as feeAnalysisHandler } from "@/app/api/fee-analysis/route";
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
        "The advisor's annual fee as a DECIMAL (e.g. 0.01 = 100bps). Default 0.01 (1.00%, a common round-trip).",
    },
  },
  required: ["clientId"],
};

export const runFeeAnalysisTool: ChatTool = {
  name: "run_fee_analysis",
  description:
    "Estimate annual fund expense ratios for a client's portfolio + roll them up with the advisor's fee for an all-in cost view (`/api/fee-analysis`). Read-only — doesn't persist. Returns per-fund expense ratios + per-account totals + a portfolio-level cost summary. ~10-30s. Useful when the advisor wants to discuss 'what is John paying in fees?' or compare against benchmarks.",
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

  const advisorFeeAnnual =
    typeof args.advisorFeeAnnual === "number" && Number.isFinite(args.advisorFeeAnnual)
      ? args.advisorFeeAnnual
      : 0.01;
  if (advisorFeeAnnual < 0 || advisorFeeAnnual > 0.2) {
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

    // Group holdings by account into the route's expected payload shape.
    const accounts = buildAccountsPayload(snapshot.holdings);
    if (accounts.length === 0) {
      return {
        error:
          "No fund rows with values to analyze — every holding either has no value or is missing a ticker.",
      };
    }

    const totalValue = accounts.reduce(
      (sum, a) => sum + a.totalAccountValue,
      0,
    );

    const invoke = await invokeRouteHandler<
      Record<string, unknown>,
      Record<string, unknown> & { error?: string }
    >({
      ctx,
      handler: feeAnalysisHandler,
      body: { accounts, totalValue, advisorFeeAnnual },
      syntheticUrl: "internal://run_fee_analysis",
    });

    if (invoke.errored || !invoke.body) {
      return {
        error: invoke.body?.error ?? `fee-analysis failed (HTTP ${invoke.status}).`,
      };
    }

    return { result: { clientId, advisorFeeAnnual, ...invoke.body } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the accounts payload the route expects (one entry per accountNumber)
// ─────────────────────────────────────────────────────────────────────────────

interface AccountPayload {
  key: string;
  accountNumber: string;
  totalAccountValue: number;
  fundRows: Array<{
    ticker: string;
    value: number;
    assetClass: string;
    suggested: string;
    rawName: string;
    accountNumber: string;
  }>;
}

function buildAccountsPayload(
  holdings: Array<Record<string, unknown>>,
): AccountPayload[] {
  const byAccount = new Map<string, AccountPayload>();

  for (const h of holdings) {
    const value = Number(h?.value);
    if (!Number.isFinite(value) || value <= 0) continue;

    const accountNumber = String(h?.accountNumber ?? "").trim() || "unassigned";
    const ticker = String(
      h?.enrichmentResolvedTicker ?? h?.suggested ?? "",
    ).trim().toUpperCase();
    const fundRow = {
      ticker,
      value,
      assetClass: String(h?.assetClass ?? ""),
      suggested: String(h?.suggested ?? ""),
      rawName: String(h?.rawName ?? ""),
      accountNumber,
    };

    const existing = byAccount.get(accountNumber);
    if (existing) {
      existing.totalAccountValue += value;
      existing.fundRows.push(fundRow);
    } else {
      byAccount.set(accountNumber, {
        key: accountNumber,
        accountNumber,
        totalAccountValue: value,
        fundRows: [fundRow],
      });
    }
  }

  // Drop accounts with no rows (defensive — shouldn't happen given the
  // above structure but keeps the route's payload clean).
  return [...byAccount.values()].filter((a) => a.fundRows.length > 0);
}
