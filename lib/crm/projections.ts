/**
 * Shared CRM projections — pure data transforms over `ClientDetail.holdings`.
 *
 * These three helpers produce the same numbers the UI shows on the Overview
 * tab (Allocation card, Holdings table, Accounts card) AND that the voice
 * agent and chat orchestrator return when the advisor asks "what's John's
 * allocation?". Same math everywhere = no drift between surfaces.
 *
 * ─── Why this lives in lib/crm/ (not lib/voice/) ─────────────────────────────
 *
 * The voice agent's `lib/voice/page-helpers.ts` shipped these helpers first
 * (against a slightly different `ReviewLike` shape). When the chat
 * orchestrator landed it needed the same math against `ClientDetail`. Rather
 * than duplicate or fork, this file is the canonical location going forward:
 *
 *   - The chat tool `compute` uses these directly (see lib/llm/chat/tools/compute.ts).
 *   - The voice agent will switch to these in a follow-up refactor (no
 *     behavior change — the voice agent's existing helpers produce the same
 *     numbers; the switch is just deduplication).
 *   - The UI's Allocation card and Accounts card already use the same
 *     classify/summarize functions inlined; a Phase-3 cleanup will route
 *     them through here too.
 *
 * Pure functions — no IO, no `Date.now()` reads in the body. Easy to unit-test.
 *
 * Design rationale: docs/crm/70-orchestrator-tools.md §4.
 */

import type { ClientDetail } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Output shapes — surfaced verbatim to the model via the `compute` tool
// ─────────────────────────────────────────────────────────────────────────────

export interface AllocationBucket {
  /** Bucket label, e.g. "Equity", "Fixed", "Cash". */
  name: string;
  valueUsd: number;
  /** Bucket value / total value × 100. 0 when total is 0. */
  weightPct: number;
}

export interface AllocationSummary {
  clientId: string;
  totalValue: number;
  /** Sorted by valueUsd descending. */
  buckets: AllocationBucket[];
}

export interface HoldingPosition {
  /** Uppercase ticker (preferred: enrichmentResolvedTicker → suggested fallback). */
  ticker: string;
  /** Human-readable name (preferred: enrichmentResolvedName → rawName fallback). */
  name: string;
  /** Raw asset-class string from the holding (not bucketed). */
  assetClass: string;
  valueUsd: number;
  weightPct: number;
}

export interface HoldingsBreakdown {
  clientId: string;
  totalValue: number;
  holdingCount: number;
  /** Top N positions by value, descending. Default N = 5. */
  topPositions: HoldingPosition[];
}

export interface AccountSummary {
  /** Last-4-style account number (or full, if that's all we have). */
  accountNumber: string;
  /** Human-friendly registration type ("Ira", "Joint", "Roth ira", etc.). */
  registrationType: string;
  totalValue: number;
  holdingCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocation summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bucket the client's holdings into broad asset classes for the Allocation
 * card on the Overview tab. Same `classifyAssetClass` table as the voice
 * agent's existing helper — equity / fixed / cash / annuity / real estate /
 * commodities / mutual fund / etf, with verbatim passthrough for unknowns.
 */
export function buildAllocationSummary(client: ClientDetail): AllocationSummary {
  const holdings = client.holdings ?? [];
  const totalValue = sumHoldingsValue(holdings);

  const bucketMap = new Map<string, number>();
  for (const h of holdings) {
    const bucket = classifyAssetClass(h?.assetClass);
    const v = Number(h?.value) || 0;
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + v);
  }

  const buckets: AllocationBucket[] = [...bucketMap.entries()]
    .map(([name, valueUsd]) => ({
      name,
      valueUsd,
      weightPct: totalValue > 0 ? (valueUsd / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd);

  return { clientId: client.id, totalValue, buckets };
}

// ─────────────────────────────────────────────────────────────────────────────
// Holdings breakdown — top N positions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-N positions by dollar value, with weight % of the total portfolio.
 * Default `topN` is 5 (matches what the Overview card surfaces).
 */
export function buildHoldingsBreakdown(
  client: ClientDetail,
  topN = 5,
): HoldingsBreakdown {
  const holdings = client.holdings ?? [];
  const totalValue = sumHoldingsValue(holdings);

  const sorted = [...holdings].sort(
    (a, b) => (Number(b?.value) || 0) - (Number(a?.value) || 0),
  );
  const topPositions: HoldingPosition[] = sorted.slice(0, Math.max(1, topN)).map((h) => {
    const value = Number(h?.value) || 0;
    return {
      ticker: ((h?.enrichmentResolvedTicker || h?.suggested || "") as string).toUpperCase(),
      name: (h?.enrichmentResolvedName || h?.rawName || h?.suggested || "") as string,
      assetClass: (h?.assetClass as string) || "Unknown",
      valueUsd: value,
      weightPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    };
  });

  return {
    clientId: client.id,
    totalValue,
    holdingCount: holdings.length,
    topPositions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Account summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group holdings by accountNumber + registrationType. Returns one entry per
 * distinct accountNumber, sorted by totalValue descending. Matches the math
 * the Accounts card on the Overview tab uses.
 *
 * Holdings without an accountNumber are SKIPPED entirely — they don't get
 * a synthetic "Unknown" bucket here because the Accounts card likewise
 * elides them (the advisor shouldn't see ghost accounts in the chat that
 * don't exist in the UI).
 */
export function summarizeAccounts(client: ClientDetail): AccountSummary[] {
  const map = new Map<string, AccountSummary>();
  for (const h of client.holdings ?? []) {
    const acct = String(h?.accountNumber ?? "").trim();
    if (!acct) continue;
    const value = Number(h?.value) || 0;
    const existing = map.get(acct);
    if (existing) {
      existing.totalValue += value;
      existing.holdingCount += 1;
    } else {
      map.set(acct, {
        accountNumber: acct,
        registrationType: humanizeRegistration(
          (h?.registrationType as string | null | undefined) ?? null,
        ),
        totalValue: value,
        holdingCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalValue - a.totalValue);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal classifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asset-class bucketing for `buildAllocationSummary`. Same table the voice
 * agent has used since v1. Unknown raw strings pass through verbatim so the
 * advisor sees what the holding actually said (instead of a generic
 * "Other").
 */
function classifyAssetClass(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "Other";
  if (s.includes("stock") || s.includes("equity")) return "Equity";
  if (s.includes("bond") || s.includes("fixed") || s.includes("treasury")) return "Fixed";
  if (s.includes("cash") || s.includes("money market")) return "Cash";
  if (s.includes("annuity") || s.includes("fia") || s.includes("myga") || s.includes("spia")) return "Annuity";
  if (s.includes("real estate") || s.includes("reit")) return "Real Estate";
  if (s.includes("commod")) return "Commodities";
  if (s.includes("mutual fund")) return "Mutual Fund";
  if (s.includes("etf")) return "ETF";
  return raw ?? "Other";
}

/** Sentence-case the underscored registration type for display. */
function humanizeRegistration(raw: string | null): string {
  if (!raw) return "Unknown registration";
  const cleaned = raw.replace(/_/g, " ").trim();
  if (!cleaned) return "Unknown registration";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function sumHoldingsValue(holdings: ClientDetail["holdings"] | null | undefined): number {
  if (!Array.isArray(holdings)) return 0;
  let total = 0;
  for (const h of holdings) {
    const n = Number(h?.value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}
