/**
 * Accounts card — lists distinct account numbers from the client's
 * holdings, with the per-account total value and registration type.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body).
 */

import type { ClientDetail } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

interface AccountSummary {
  accountNumber: string;
  registrationType: string;
  totalValue: number;
  holdingCount: number;
}

export function AccountsCard({ client }: { client: ClientDetail }) {
  const accounts = summarizeAccounts(client);

  if (accounts.length === 0) {
    return (
      <OverviewCard title="Accounts">
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          No accounts identified yet. Holdings without account numbers stay
          ungrouped — confirm the upload to attach them.
        </p>
      </OverviewCard>
    );
  }

  return (
    <OverviewCard title="Accounts">
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <li
            key={account.accountNumber}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--ap-navy)" }}
              >
                {account.accountNumber}
              </span>
              <span
                className="text-[11.5px]"
                style={{ color: "var(--ap-gray)" }}
              >
                {account.registrationType} · {account.holdingCount}{" "}
                {account.holdingCount === 1 ? "position" : "positions"}
              </span>
            </div>
            <span
              className="flex-shrink-0 font-mono text-[12.5px] font-semibold"
              style={{
                color: "var(--ap-navy)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCurrency(account.totalValue)}
            </span>
          </li>
        ))}
      </ul>
    </OverviewCard>
  );
}

function summarizeAccounts(client: ClientDetail): AccountSummary[] {
  const map = new Map<string, AccountSummary>();
  for (const h of client.holdings) {
    const acct = (h.accountNumber || "").trim();
    if (!acct) continue;
    const existing = map.get(acct);
    const value = Number(h.value) || 0;
    if (existing) {
      existing.totalValue += value;
      existing.holdingCount += 1;
    } else {
      map.set(acct, {
        accountNumber: acct,
        registrationType: humanizeRegistration(h.registrationType ?? null),
        totalValue: value,
        holdingCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalValue - a.totalValue);
}

function humanizeRegistration(raw: string | null): string {
  if (!raw) return "Unknown registration";
  // Most registration types are already friendly enough (e.g. "ira", "joint").
  // Sentence-case for display.
  const cleaned = raw.replace(/_/g, " ").trim();
  if (!cleaned) return "Unknown registration";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}k`;
  }
  return `$${Math.round(value)}`;
}
