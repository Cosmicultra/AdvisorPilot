"use client";

/**
 * Accounts card â€” account selector, move-full-account flow, expandable rows.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AddAnnuityMaturityDialog } from "@/components/crm/add-annuity-maturity-dialog";
import { MoveFullAccountDialog } from "@/components/crm/move-full-account-dialog";
import { StatementRefreshDialog } from "@/components/crm/statement-refresh-dialog";
import { accountNeedsMaturityDateInput } from "@/lib/crm/annuity-maturity-input";
import {
  buildAccountGroups,
  type AccountGroup,
} from "@/lib/crm/account-groups";
import { formatAccountHeaderLabel } from "@/lib/crm/account-display";
import type { ClientDetail } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

export function AccountsCard({
  client,
  enableMoveAccount = false,
  onClientUpdated,
}: {
  client: ClientDetail;
  /** Portfolio tab only — shows account picker + Move full account. */
  enableMoveAccount?: boolean;
  onClientUpdated?: (client: ClientDetail) => void;
}) {
  const accounts = useMemo(() => buildAccountGroups(client), [client]);
  const [selectedAccountNumber, setSelectedAccountNumber] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [maturityAccountNumber, setMaturityAccountNumber] = useState<string | null>(null);
  const [refreshAccountKey, setRefreshAccountKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enableMoveAccount) return;
    if (accounts.length === 0) {
      setSelectedAccountNumber("");
      return;
    }
    setSelectedAccountNumber((prev) => {
      if (prev && accounts.some((a) => a.accountNumber === prev)) return prev;
      return accounts[0].accountNumber;
    });
  }, [accounts, enableMoveAccount]);

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
          ungrouped â€” confirm the upload to attach them.
        </p>
      </OverviewCard>
    );
  }

  return (
    <>
      <OverviewCard title="Accounts">
        {enableMoveAccount ? (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
            <label
              htmlFor="crm-account-select"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "var(--ap-gray)" }}
            >
              Account to move
            </label>
            <select
              id="crm-account-select"
              value={selectedAccountNumber}
              onChange={(e) => setSelectedAccountNumber(e.target.value)}
              className="w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none"
              style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
            >
              {accounts.map((account) => (
                <option key={account.accountNumber} value={account.accountNumber}>
                  {accountSelectLabel(account)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setMoveDialogOpen(true)}
            disabled={!selectedAccountNumber}
            className="shrink-0 px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            Move full account
          </button>
          </div>
        ) : null}

        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <AccountRow
              key={account.accountNumber}
              client={client}
              account={account}
              isOpen={expanded.has(account.accountNumber)}
              onToggle={() => toggleAccount(account.accountNumber)}
              showPortfolioActions={enableMoveAccount}
              onRequestMaturityDate={
                enableMoveAccount
                  ? () => setMaturityAccountNumber(account.accountNumber)
                  : undefined
              }
              onRequestStatementRefresh={
                enableMoveAccount
                  ? () => setRefreshAccountKey(account.accountNumber)
                  : undefined
              }
            />
          ))}
        </ul>
      </OverviewCard>

      {enableMoveAccount ? (
        <>
          <MoveFullAccountDialog
            open={moveDialogOpen}
            client={client}
            sourceAccountNumber={selectedAccountNumber}
            onClose={() => setMoveDialogOpen(false)}
            onSaved={(updated) => {
              onClientUpdated?.(updated);
              setMoveDialogOpen(false);
            }}
          />
          <AddAnnuityMaturityDialog
            open={maturityAccountNumber !== null}
            client={client}
            accountNumber={maturityAccountNumber ?? ""}
            onClose={() => setMaturityAccountNumber(null)}
            onSaved={(updated) => {
              onClientUpdated?.(updated);
              setMaturityAccountNumber(null);
            }}
          />
          <StatementRefreshDialog
            open={refreshAccountKey !== null}
            client={client}
            preferredAccountKey={refreshAccountKey ?? undefined}
            onClose={() => setRefreshAccountKey(null)}
            onSaved={(updated) => onClientUpdated?.(updated)}
          />
        </>
      ) : null}
    </>
  );
}

function AccountRow({
  client,
  account,
  isOpen,
  onToggle,
  showPortfolioActions,
  onRequestMaturityDate,
  onRequestStatementRefresh,
}: {
  client: ClientDetail;
  account: AccountGroup;
  isOpen: boolean;
  onToggle: () => void;
  showPortfolioActions?: boolean;
  onRequestMaturityDate?: () => void;
  onRequestStatementRefresh?: () => void;
}) {
  const showMaturityButton =
    showPortfolioActions &&
    accountNeedsMaturityDateInput(client.holdings, account.accountNumber);

  return (
    <li style={{ border: "1px solid var(--ap-border)" }}>
      <div className="flex w-full items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[#f8fafc]">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
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
              {formatAccountHeaderLabel(
                account.accountNumber,
                account.financialInstitutionLabel
              )}
            </span>
            {account.annuityTypeCarrierLabel ? (
              <span
                className="block truncate text-[12px] font-medium"
                style={{ color: "var(--ap-navy)" }}
              >
                {account.annuityTypeCarrierLabel}
              </span>
            ) : null}
            <span className="block text-[11.5px]" style={{ color: "var(--ap-gray)" }}>
              {account.registrationType} · {account.holdingCount}{" "}
              {account.holdingCount === 1 ? "position" : "positions"}
            </span>
          </div>
        </button>
        <span
          className="shrink-0 font-mono text-[12.5px] font-semibold"
          style={{
            color: "var(--ap-navy)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatAccountTotal(account.totalValue)}
        </span>
      </div>
      {showMaturityButton ? (
        <div className="px-3 pb-2.5 pl-9">
          <button
            type="button"
            onClick={() => onRequestMaturityDate?.()}
            className="px-2 py-1 text-[11px] font-semibold"
            style={{
              border: "1px solid var(--ap-royal)",
              backgroundColor: "rgba(15, 111, 222, 0.06)",
              color: "var(--ap-royal)",
            }}
          >
            Add maturity date
          </button>
        </div>
      ) : null}

      {isOpen ? (
        <div className="border-t" style={{ borderColor: "var(--ap-border)" }}>
          {showPortfolioActions ? (
            <div
              className="flex flex-col gap-2 border-b px-3 py-2"
              style={{ borderColor: "var(--ap-border)" }}
            >
              <button
                type="button"
                onClick={() => onRequestStatementRefresh?.()}
                className="text-left text-[12px] font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--ap-royal)" }}
              >
                Upload new statement for this account
              </button>
              <p className="text-[11px]" style={{ color: "var(--ap-gray)" }}>
                Other accounts on this client stay unchanged.
              </p>
            </div>
          ) : null}
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
                <div className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[12px] font-medium leading-snug"
                    style={{ color: "var(--ap-navy)" }}
                    title={row.label}
                  >
                    {row.label}
                  </span>
                  {row.indexingStrategies.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {row.indexingStrategies.map((strategy) => (
                        <li
                          key={`${row.id}-${strategy.strategyName}`}
                          className="text-[11px] leading-snug"
                          style={{ color: "var(--ap-gray)" }}
                        >
                          <span className="font-medium" style={{ color: "var(--ap-navy)" }}>
                            {strategy.strategyName}
                          </span>
                          <span className="text-[10.5px]"> — {strategy.ratesLabel}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
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
}

function accountSelectLabel(account: AccountGroup): string {
  const header = formatAccountHeaderLabel(
    account.accountNumber,
    account.financialInstitutionLabel
  );
  const value = formatAccountTotal(account.totalValue);
  if (account.annuityTypeCarrierLabel) {
    return `${header} · ${account.annuityTypeCarrierLabel} · ${value}`;
  }
  return `${header} · ${value}`;
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


