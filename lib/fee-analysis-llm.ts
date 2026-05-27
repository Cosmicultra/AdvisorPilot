/**
 * Server-only: LLM expense-ratio lookup for fee / comparative fee analysis.
 * Import only from API routes — never from client components.
 */

import { complete, resolveAdvisorLlmSelection } from "@/lib/llm";
import type { UniqueFundForLookup } from "@/lib/fee-analysis";

export type ExpenseRatioLookupResult = {
  ratioByTicker: Map<string, { expenseRatioAnnual: number | null; note: string }>;
  disclaimer: string;
  provider: string;
  model: string;
};

function parseExpenseRatioLookupJson(parsed: {
  byTicker?: unknown;
  disclaimer?: unknown;
}): Map<string, { expenseRatioAnnual: number | null; note: string }> {
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
  return ratioByTicker;
}

/**
 * LLM pass: estimate annual expense ratios for unique ETF/MF tickers.
 * All scenario math stays in lib/comparative-fee-analysis.ts.
 */
export async function lookupExpenseRatiosByTicker(args: {
  uniqueFunds: UniqueFundForLookup[];
  synopsisSnippet?: string;
  request: Request;
  advisorEmail?: string | null;
}): Promise<ExpenseRatioLookupResult> {
  const { uniqueFunds, synopsisSnippet = "", request, advisorEmail } = args;

  if (uniqueFunds.length === 0) {
    return {
      ratioByTicker: new Map(),
      disclaimer:
        "No tickers were available on the fund rows; add symbols on Confirm Holdings to estimate fund expense drag.",
      provider: "none",
      model: "",
    };
  }

  const selection = await resolveAdvisorLlmSelection(advisorEmail);
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

  const result = await complete<{ byTicker?: unknown; disclaimer?: unknown }>(
    {
      pass: "fee-analysis",
      user: jsonPrompt,
      jsonSchema: { type: "object" },
    },
    { request, selection }
  );

  const parsed = result.json ?? {};
  const ratioByTicker = parseExpenseRatioLookupJson(parsed);
  const disclaimer =
    typeof parsed.disclaimer === "string" && parsed.disclaimer.trim()
      ? parsed.disclaimer.trim()
      : "Illustrative estimates only; confirm expense ratios and advisor fees on official documents.";

  return {
    ratioByTicker,
    disclaimer,
    provider: result.context.provider,
    model: result.context.model,
  };
}
