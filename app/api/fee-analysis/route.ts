import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import {
  buildComparativeFeeAnalysisResponse,
  isCurrentManagementState,
  isProposedManagementState,
  synthesizeLegacyAccounts,
  type ParsedAccountForComparative,
} from "@/lib/comparative-fee-analysis";
import { lookupExpenseRatiosByTicker } from "@/lib/fee-analysis-llm";
import type { FeeAnalysisFundRow, UniqueFundForLookup } from "@/lib/fee-analysis";

export const runtime = "nodejs";

type FundRowIn = {
  ticker?: unknown;
  value?: unknown;
  assetClass?: unknown;
  suggested?: unknown;
  rawName?: unknown;
  accountNumber?: unknown;
};

type AccountIn = {
  key?: unknown;
  accountNumber?: unknown;
  totalAccountValue?: unknown;
  fundRows?: unknown;
  currentManagement?: unknown;
  proposedManagement?: unknown;
  currentAdvisorFeeAnnual?: unknown;
  proposedAdvisorFeeAnnual?: unknown;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clipSynopsis(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.length > 900 ? `${s.slice(0, 897)}…` : s;
}

function parseFeeRate(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 0.2) return null;
  return n;
}

function parseFundRows(fundRowsRaw: unknown[]): FeeAnalysisFundRow[] {
  const fundRows: FeeAnalysisFundRow[] = [];
  for (const r of fundRowsRaw) {
    if (!r || typeof r !== "object") continue;
    const row = r as FundRowIn;
    fundRows.push({
      ticker: String(row.ticker ?? "").trim().toUpperCase(),
      value: num(row.value),
      assetClass: String(row.assetClass ?? ""),
      suggested: String(row.suggested ?? ""),
      rawName: String(row.rawName ?? ""),
      accountNumber: String(row.accountNumber ?? "").trim(),
    });
  }
  return fundRows;
}

function accountHasManagementFields(rec: AccountIn): boolean {
  return (
    isCurrentManagementState(rec.currentManagement) &&
    isProposedManagementState(rec.proposedManagement)
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const demoMode = Boolean(body?.demoMode);
    const identity = await resolveAdvisorIdentity(req);
    if (!demoMode && !identity) {
      return NextResponse.json({ error: "Sign in to run fee analysis." }, { status: 401 });
    }

    const totalValue = num(body?.totalValue);
    if (totalValue <= 0) {
      return NextResponse.json({ error: "totalValue must be a positive number." }, { status: 400 });
    }

    const myAdvisoryFeeAnnualRaw = body?.myAdvisoryFeeAnnual ?? body?.advisorFeeAnnual;
    const myAdvisoryFeeAnnual = num(myAdvisoryFeeAnnualRaw);
    if (myAdvisoryFeeAnnual < 0 || myAdvisoryFeeAnnual > 0.2) {
      return NextResponse.json(
        { error: "myAdvisoryFeeAnnual must be between 0 and 0.2 (20%)." },
        { status: 400 }
      );
    }

    const accountsRaw = Array.isArray(body?.accounts) ? (body!.accounts as unknown[]) : [];
    const parsedAccounts: Array<{
      key: string;
      accountNumber: string;
      totalAccountValue: number;
      fundRows: FeeAnalysisFundRow[];
      currentManagement?: unknown;
      proposedManagement?: unknown;
      currentAdvisorFeeAnnual?: unknown;
      proposedAdvisorFeeAnnual?: unknown;
    }> = [];

    for (const a of accountsRaw) {
      if (!a || typeof a !== "object") continue;
      const rec = a as AccountIn;
      const fundRows = parseFundRows(Array.isArray(rec.fundRows) ? rec.fundRows : []);
      if (fundRows.length === 0) continue;
      parsedAccounts.push({
        key: String(rec.key ?? ""),
        accountNumber: String(rec.accountNumber ?? "").trim(),
        totalAccountValue: num(rec.totalAccountValue),
        fundRows,
        currentManagement: rec.currentManagement,
        proposedManagement: rec.proposedManagement,
        currentAdvisorFeeAnnual: rec.currentAdvisorFeeAnnual,
        proposedAdvisorFeeAnnual: rec.proposedAdvisorFeeAnnual,
      });
    }

    if (parsedAccounts.length === 0) {
      return NextResponse.json(
        { error: "No ETF or mutual fund holdings were sent for fee analysis." },
        { status: 400 }
      );
    }

    const usesComparative =
      parsedAccounts.some((a) => accountHasManagementFields(a as AccountIn)) ||
      Boolean(body?.schemaVersion === 2);

    let accounts: ParsedAccountForComparative[];

    if (usesComparative) {
      accounts = [];
      for (const a of parsedAccounts) {
        if (!isCurrentManagementState(a.currentManagement)) {
          return NextResponse.json(
            { error: `Invalid currentManagement on account ${a.key || a.accountNumber}.` },
            { status: 400 }
          );
        }
        if (!isProposedManagementState(a.proposedManagement)) {
          return NextResponse.json(
            { error: `Invalid proposedManagement on account ${a.key || a.accountNumber}.` },
            { status: 400 }
          );
        }
        const currentFee = parseFeeRate(a.currentAdvisorFeeAnnual);
        const proposedFee = parseFeeRate(a.proposedAdvisorFeeAnnual);
        if (a.currentManagement === "other_advisor" && currentFee == null) {
          return NextResponse.json(
            {
              error: `currentAdvisorFeeAnnual required when current management is other_advisor (account ${a.accountNumber || a.key}).`,
            },
            { status: 400 }
          );
        }
        if (a.proposedManagement === "transition_to_me" && proposedFee == null) {
          // Allow portfolio default myAdvisoryFeeAnnual
          if (myAdvisoryFeeAnnual <= 0) {
            return NextResponse.json(
              {
                error: `proposedAdvisorFeeAnnual or myAdvisoryFeeAnnual required for transition_to_me (account ${a.accountNumber || a.key}).`,
              },
              { status: 400 }
            );
          }
        }
        accounts.push({
          key: a.key,
          accountNumber: a.accountNumber,
          totalAccountValue: a.totalAccountValue,
          fundRows: a.fundRows,
          currentManagement: a.currentManagement,
          proposedManagement: a.proposedManagement,
          currentAdvisorFeeAnnual: currentFee,
          proposedAdvisorFeeAnnual: proposedFee,
        });
      }
    } else {
      const legacyFee = num(body?.advisorFeeAnnual);
      if (legacyFee < 0 || legacyFee > 0.2) {
        return NextResponse.json(
          { error: "advisorFeeAnnual must be between 0 and 0.2 (20%)." },
          { status: 400 }
        );
      }
      accounts = synthesizeLegacyAccounts(parsedAccounts, legacyFee > 0 ? legacyFee : myAdvisoryFeeAnnual);
    }

    const uniqueByTicker = new Map<string, UniqueFundForLookup>();
    for (const acct of accounts) {
      for (const row of acct.fundRows) {
        const t = row.ticker.trim().toUpperCase();
        if (!t) continue;
        if (!uniqueByTicker.has(t)) {
          uniqueByTicker.set(t, {
            ticker: t,
            label: row.suggested || row.rawName || t,
            assetClass: row.assetClass,
          });
        }
      }
    }

    const uniqueFunds = [...uniqueByTicker.values()];
    const synopsisSnippet = clipSynopsis(body?.portfolioSynopsisSnippet);

    const lookup = await lookupExpenseRatiosByTicker({
      uniqueFunds,
      synopsisSnippet,
      request: req,
      advisorEmail: identity?.email,
    });

    const rowsMissingTicker = accounts.reduce(
      (n, a) => n + a.fundRows.filter((r) => !r.ticker.trim()).length,
      0
    );

    const payload = buildComparativeFeeAnalysisResponse({
      portfolioValue: totalValue,
      myAdvisoryFeeAnnual,
      accounts,
      ratioByTicker: lookup.ratioByTicker,
      disclaimer: lookup.disclaimer,
      uniqueTickerCount: uniqueFunds.length,
      rowsMissingTicker,
    });

    await writeAuditEvent({
      ownerEmail: identity?.email ?? "unauthenticated.demo",
      ownerUserId: identity?.userId ?? null,
      actorEmail: identity?.email ?? null,
      action: "fee_analysis.completed",
      entityType: "fee_analysis",
      entityId: null,
      metadata: {
        demoMode,
        schemaVersion: 2,
        totalValue,
        uniqueTickerCount: uniqueFunds.length,
        provider: lookup.provider,
        model: lookup.model,
        rowsMissingTicker,
        proposedCoveragePct: payload.coverage.proposedCoveragePct,
        unauthenticated: !identity,
      },
    });

    return NextResponse.json(payload);
  } catch (err: unknown) {
    console.error("FEE ANALYSIS:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fee analysis failed." },
      { status: 500 }
    );
  }
}
