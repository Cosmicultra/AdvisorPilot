"use client";

/**
 * Accounts card — expandable account rows with per-account holdings,
 * amounts, % of account, and allocation-sleeve row shading.
 */

import { useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { holdingAllocationSleeveMeta } from "@/lib/allocation-display";
import { maskAccountNumberDisplay } from "@/lib/mask-account-number";
import type { ClientDetail } from "@/lib/crm/types";
import type { UiHolding } from "@/lib/saved-review-normalize";
import { OverviewCard } from "./overview-card";

type AccountHoldingRow = {
  id: string;
  label: string;
  valueUsd: number;
  pctOfAccount: number;
  rowBg: string;
  sleeveColor: string;
};

type AccountGroup = {
  accountNumber: string;
  registrationType: string;
  totalValue: number;
  holdingCount: number;
  holdings: AccountHoldingRow[];
};

export function AccountsCard({ client }: { client: ClientDetail }) {
  const accounts = useMemo(() => buildAccountGroups(client), [client]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleAccount = useCallback((accountNumber: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(accountNumber)) next.delete(accountNumber);
      else next.add(accountNumber);
      return next;
    });
  }, []);

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
        {accounts.map((account) => {
          const isOpen = expanded.has(account.accountNumber);
          return (
            <li
              key={account.accountNumber}
              style={{ border: "1px solid var(--ap-border)" }}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f8fafc]"
                aria-expanded={isOpen}
                onClick={() => toggleAccount(account.accountNumber)}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <ChevronDown
                    className="mt-0.5 h-4 w-4 shrink-0 transition-transform"
                    style={{
                      color: "var(--ap-gray)",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[13px] font-medium"
                      style={{ color: "var(--ap-navy)" }}
                    >
                      {maskAccountNumberDisplay(account.accountNumber)}
                    </span>
                    <span
                      className="block text-[11.5px]"
                      style={{ color: "var(--ap-gray)" }}
                    >
                      {account.registrationType} · {account.holdingCount}{" "}
                      {account.holdingCount === 1 ? "position" : "positions"}
                    </span>
                  </div>
                </div>
                <span
                  className="shrink-0 font-mono text-[12.5px] font-semibold"
                  style={{
                    color: "var(--ap-navy)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatAccountTotal(account.totalValue)}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t" style={{ borderColor: "var(--ap-border)" }}>
                  <ul className="flex flex-col">
                    {account.holdings.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                        style={{
                          backgroundColor: row.rowBg,
                          borderLeft: `3px solid ${row.sleeveColor}`,
                        }}
                      >
                        <span
                          className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug"
                          style={{ color: "var(--ap-navy)" }}
                          title={row.label}
                        >
                          {row.label}
                        </span>
                        <span
                          className="shrink-0 text-right font-mono text-[11.5px] tabular-nums"
                          style={{ color: "var(--ap-gray)" }}
                        >
                          <span className="block font-semibold" style={{ color: "var(--ap-navy)" }}>
                            {formatHoldingAmount(row.valueUsd)}
                          </span>
                          <span>{row.pctOfAccount.toFixed(1)}% of account</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </OverviewCard>
  );
}

function buildAccountGroups(client: ClientDetail): AccountGroup[] {
  const map = new Map<
    string,
    { registrationType: string; holdings: UiHolding[]; totalValue: number }
  >();

  for (const h of client.holdings) {
    const acct = (h.accountNumber || "").trim();
    if (!acct) continue;
    const value = Number(h.value) || 0;
    const existing = map.get(acct);
    if (existing) {
      existing.totalValue += value;
      existing.holdings.push(h);
    } else {
      map.set(acct, {
        registrationType: humanizeRegistration(h.registrationType ?? null),
        holdings: [h],
        totalValue: value,
      });
    }
  }

  const groups: AccountGroup[] = [];
  for (const [accountNumber, row] of map) {
    const holdings = row.holdings
      .map((h, index) => {
        const valueUsd = Number(h.value) || 0;
        const sleeve = holdingAllocationSleeveMeta(h);
        return {
          id: `${accountNumber}-${index}-${h.rawName}`,
          label: holdingLabel(h),
          valueUsd,
          pctOfAccount: row.totalValue > 0 ? (valueUsd / row.totalValue) * 100 : 0,
          rowBg: sleeve.rowBg,
          sleeveColor: sleeve.color,
        };
      })
      .sort((a, b) => b.valueUsd - a.valueUsd);

    groups.push({
      accountNumber,
      registrationType: row.registrationType,
      totalValue: row.totalValue,
      holdingCount: row.holdings.length,
      holdings,
    });
  }

  return groups.sort((a, b) => b.totalValue - a.totalValue);
}

function holdingLabel(h: UiHolding): string {
  const name = h.enrichmentResolvedName?.trim() || h.rawName?.trim() || h.suggested?.trim();
  return name || "Unnamed position";
}

function humanizeRegistration(raw: string | null): string {
  if (!raw) return "Unknown registration";
  const cleaned = raw.replace(/_/g, " ").trim();
  if (!cleaned) return "Unknown registration";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatAccountTotal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}k`;
  }
  return `$${Math.round(value)}`;
}

function formatHoldingAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
