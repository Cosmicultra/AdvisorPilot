import OpenAI from "openai";
import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import type { FeeAnalysisApiResponse } from "@/lib/fee-analysis";
import { feeAnalysisJsonModel, logOpenAiPass } from "@/lib/openai-route-models";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const demoMode = Boolean(body?.demoMode);
    const identity = await resolveAdvisorIdentity(req);
    if (!demoMode && !identity) {
      return NextResponse.json({ error: "Sign in to run fee analysis." }, { status: 401 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY in .env.local" }, { status: 500 });
    }

    const totalValue = num(body?.totalValue);
    if (totalValue <= 0) {
      return NextResponse.json({ error: "totalValue must be a positive number." }, { status: 400 });
    }

    const advisorFeeAnnual = num(body?.advisorFeeAnnual);
    if (advisorFeeAnnual < 0 || advisorFeeAnnual > 0.2) {
      return NextResponse.json(
        { error: "advisorFeeAnnual must be between 0 and 0.2 (20%)." },
        { status: 400 }
      );
    }

    const accountsRaw = Array.isArray(body?.accounts) ? (body!.accounts as unknown[]) : [];
    const accounts: {
      key: string;
      accountNumber: string;
      totalAccountValue: number;
      fundRows: {
        ticker: string;
        value: number;
        assetClass: string;
        suggested: string;
        rawName: string;
        accountNumber: string;
      }[];
    }[] = [];

    for (const a of accountsRaw) {
      if (!a || typeof a !== "object") continue;
      const rec = a as AccountIn;
      const fundRowsRaw = Array.isArray(rec.fundRows) ? rec.fundRows : [];
      const fundRows: {
        ticker: string;
        value: number;
        assetClass: string;
        suggested: string;
        rawName: string;
        accountNumber: string;
      }[] = [];
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
      if (fundRows.length === 0) continue;
      accounts.push({
        key: String(rec.key ?? ""),
        accountNumber: String(rec.accountNumber ?? "").trim(),
        totalAccountValue: num(rec.totalAccountValue),
        fundRows,
      });
    }

    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "No ETF or mutual fund holdings were sent for fee analysis." },
        { status: 400 }
      );
    }

    const uniqueByTicker = new Map<string, { ticker: string; label: string; assetClass: string }>();
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

    const model = feeAnalysisJsonModel();
    let parsed: { byTicker?: unknown; disclaimer?: unknown };

    if (uniqueFunds.length === 0) {
      parsed = {
        byTicker: [],
        disclaimer:
          "No tickers were available on the fund rows; add symbols on Confirm Holdings to estimate fund expense drag.",
      };
    } else {
      const jsonPrompt = `You are AdvisorPilot supporting licensed financial advisors.

Task: provide best-effort **annual expense ratio** (gross expense ratio as a decimal fraction of assets per year) for each **US-listed ETF or mutual fund ticker** below. Use widely published figures for the primary share class associated with that ticker symbol. If the ticker is ambiguous, pick the most common retail share class and say so briefly.

This is **not** legal or tax advice. Numbers are **illustrative estimates** for discussion — the advisor must verify against the current prospectus, factsheet, or sponsor data.

Return ONLY valid JSON. No markdown. No code fences.

Unique tickers (deduped):
${JSON.stringify(uniqueFunds, null, 2)}

Optional one-line portfolio context (from an existing in-app analysis; may be empty):
${synopsisSnippet ? JSON.stringify(synopsisSnippet) : "\"\""}

JSON shape (exact keys):
{
  "byTicker": [
    {
      "ticker": "VOO",
      "expenseRatioAnnual": 0.0003,
      "note": "one short clause: source confidence or share-class caveat"
    }
  ],
  "disclaimer": "One sentence: estimates only; confirm on official documents."
}

Rules:
- "expenseRatioAnnual" is a decimal (e.g. 0.03 means 3% per year, 0.00035 means 0.035% per year). Typical index funds are well below 0.01.
- Include **one object per input ticker** when you can supply a ratio; if truly unknown, use null for expenseRatioAnnual and explain in note.
- Ticker keys must match the input list (same spelling/case as provided).
- Do not fabricate precise ratios if uncertain — prefer null with an honest note.
`;

      logOpenAiPass("fee-analysis", "json", model);

      const jsonResponse = await openai.responses.create({
        model,
        input: jsonPrompt,
        text: {
          format: {
            type: "json_object",
          },
        },
      });

      parsed = JSON.parse(jsonResponse.output_text || "{}") as {
        byTicker?: unknown;
        disclaimer?: unknown;
      };
    }

    const ratioByTicker = new Map<string, { expenseRatioAnnual: number | null; note: string }>();
    const byTickerArr = Array.isArray(parsed.byTicker) ? parsed.byTicker : [];
    for (const item of byTickerArr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const ticker = String(o.ticker ?? "").trim().toUpperCase();
      if (!ticker) continue;
      const erRaw = o.expenseRatioAnnual;
      let expenseRatioAnnual: number | null = null;
      if (erRaw === null) expenseRatioAnnual = null;
      else {
        const n = Number(erRaw);
        if (Number.isFinite(n) && n >= 0 && n <= 0.2) expenseRatioAnnual = n;
        else expenseRatioAnnual = null;
      }
      ratioByTicker.set(ticker, {
        expenseRatioAnnual,
        note: String(o.note ?? "").trim(),
      });
    }

    const accountResults = accounts.map((acct) => {
      const lines = acct.fundRows.map((row) => {
        const t = row.ticker.trim().toUpperCase();
        const hit = t ? ratioByTicker.get(t) : undefined;
        const expenseRatioAnnual = hit?.expenseRatioAnnual ?? null;
        const estimatedAnnualFeeDollars =
          expenseRatioAnnual != null && row.value > 0 ? row.value * expenseRatioAnnual : 0;
        const lookupNote = !t
          ? "No ticker on file — add a symbol on Confirm Holdings to estimate fund fees."
          : !hit
            ? "Model did not return an estimate for this ticker."
            : hit.note ||
              (expenseRatioAnnual == null ? "Expense ratio unavailable — verify on prospectus." : undefined);
        return {
          ...row,
          expenseRatioAnnual,
          estimatedAnnualFeeDollars,
          lookupNote,
        };
      });
      const fundFeesInAccount = lines.reduce((s, l) => s + l.estimatedAnnualFeeDollars, 0);
      const fundExpensePctOfAccount =
        acct.totalAccountValue > 0 ? fundFeesInAccount / acct.totalAccountValue : 0;
      const advisorDollarsOnAccount = acct.totalAccountValue * advisorFeeAnnual;
      const allInDragOnAccount =
        acct.totalAccountValue > 0 ? (fundFeesInAccount + advisorDollarsOnAccount) / acct.totalAccountValue : 0;
      return {
        key: acct.key,
        accountNumber: acct.accountNumber,
        totalAccountValue: acct.totalAccountValue,
        lines,
        fundFeesInAccount,
        fundExpensePctOfAccount,
        advisorDollarsOnAccount,
        allInDragOnAccount,
      };
    });

    const totalFundFees = accountResults.reduce((s, a) => s + a.fundFeesInAccount, 0);
    const advisorFeeDollarsPortfolio = totalValue * advisorFeeAnnual;
    const weightedFundExpensePctOfPortfolio = totalFundFees / totalValue;
    const allInIllustrativeDragPctAnnual =
      (totalFundFees + advisorFeeDollarsPortfolio) / totalValue;

    const rowsMissingTicker = accounts.reduce((n, a) => n + a.fundRows.filter((r) => !r.ticker.trim()).length, 0);

    await writeAuditEvent({
      ownerEmail: identity?.email ?? "unauthenticated.demo",
      ownerUserId: identity?.userId ?? null,
      actorEmail: identity?.email ?? null,
      action: "fee_analysis.completed",
      entityType: "fee_analysis",
      entityId: null,
      metadata: {
        demoMode,
        totalValue,
        uniqueTickerCount: uniqueFunds.length,
        model,
        rowsMissingTicker,
        unauthenticated: !identity,
      },
    });

    const payload: FeeAnalysisApiResponse = {
      disclaimer:
        typeof parsed.disclaimer === "string" && parsed.disclaimer.trim()
          ? parsed.disclaimer.trim()
          : "Illustrative estimates only; confirm expense ratios and advisor fees on official documents.",
      portfolioValue: totalValue,
      advisorFeeAnnual,
      advisorFeeDollarsPortfolio,
      totalEstimatedFundFeesDollars: totalFundFees,
      weightedFundExpensePctOfPortfolio,
      allInIllustrativeDragPctAnnual,
      accounts: accountResults,
      uniqueTickerCount: uniqueFunds.length,
      rowsMissingTicker,
    };

    return NextResponse.json(payload);
  } catch (err: unknown) {
    console.error("FEE ANALYSIS:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fee analysis failed." },
      { status: 500 }
    );
  }
}
