"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ComparativeFeeAnalysisAccount,
  CurrentManagementState,
  FeeAnalysisWorksheetAccount,
  ProposedManagementState,
} from "@/lib/comparative-fee-analysis";
import type { FeeAnalysisAccountGroup } from "@/lib/fee-analysis";
import { registrationLabel } from "@/lib/holding-registration";

const CURRENT_OPTIONS: { value: CurrentManagementState; label: string }[] = [
  { value: "other_advisor", label: "Other advisor" },
  { value: "self_managed", label: "Self managed" },
  { value: "managed_by_me", label: "Managed by me" },
  { value: "unmanaged_employer", label: "Unmanaged / employer plan" },
  { value: "excluded", label: "Excluded" },
];

const PROPOSED_OPTIONS: { value: ProposedManagementState; label: string }[] = [
  { value: "keep_current", label: "Keep current" },
  { value: "transition_to_me", label: "Transition to me" },
  { value: "self_managed", label: "Self managed" },
  { value: "excluded", label: "Excluded" },
];

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPct(decimal: number) {
  return `${(decimal * 100).toFixed(3)}%`;
}

export function ComparativeFeeAccountCard({
  group,
  regHint,
  accountSettings,
  onChangeAccount,
  resultAccount,
  scenarioView,
  onScenarioViewChange,
}: {
  group: FeeAnalysisAccountGroup;
  regHint: string;
  accountSettings: FeeAnalysisWorksheetAccount;
  onChangeAccount: (patch: Partial<FeeAnalysisWorksheetAccount>) => void;
  resultAccount?: ComparativeFeeAnalysisAccount;
  scenarioView: "current" | "proposed";
  onScenarioViewChange: (view: "current" | "proposed") => void;
}) {
  const acctLabel = group.accountNumber ? `Account ${group.accountNumber}` : "Unlabeled account";
  const excluded = accountSettings.proposedManagement === "excluded";
  const showCurrentFee = accountSettings.currentManagement === "other_advisor";
  const showProposedFee = accountSettings.proposedManagement === "transition_to_me";

  const rows = resultAccount?.lines ?? group.fundRows.map((row) => ({
    ...row,
    expenseRatioAnnual: null as number | null,
    estimatedAnnualFeeDollars: 0,
  }));

  const slice = resultAccount
    ? scenarioView === "current"
      ? resultAccount.current
      : resultAccount.proposed
    : null;

  return (
    <div
      className={`space-y-3 rounded-none border p-4 ${
        excluded ? "border-slate-300 bg-slate-100/80" : "border-slate-200 bg-white shadow-sm"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-lg font-semibold text-slate-900">{acctLabel}</h3>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {regHint} · Account total {formatCurrency(group.totalAccountValue)}
        </span>
      </div>

      {excluded ? (
        <p className="text-xs font-medium text-slate-600">
          Excluded from proposed scenario rollups — still shown for household context.
        </p>
      ) : null}

      {accountSettings.currentManagement === "unmanaged_employer" ? (
        <p className="text-xs text-slate-600">
          Plan-level fees may apply; not modeled in this illustration.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Current management
          </label>
          <Select
            value={accountSettings.currentManagement}
            onValueChange={(v) =>
              onChangeAccount({ currentManagement: v as CurrentManagementState })
            }
          >
            <SelectTrigger className="mt-1 h-10 rounded-none bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Proposed management
          </label>
          <Select
            value={accountSettings.proposedManagement}
            onValueChange={(v) =>
              onChangeAccount({ proposedManagement: v as ProposedManagementState })
            }
          >
            <SelectTrigger className="mt-1 h-10 rounded-none bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPOSED_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {showCurrentFee ? (
          <div className="min-w-[140px] flex-1">
            <label className="text-xs font-semibold text-slate-700">Current advisor fee %</label>
            <Input
              className="mt-1 h-10 rounded-none bg-white"
              inputMode="decimal"
              value={accountSettings.currentAdvisorFeePctInput ?? ""}
              onChange={(e) =>
                onChangeAccount({ currentAdvisorFeePctInput: e.target.value })
              }
              placeholder="1.25"
            />
          </div>
        ) : null}
        {showProposedFee ? (
          <div className="min-w-[140px] flex-1">
            <label className="text-xs font-semibold text-slate-700">My proposed fee %</label>
            <Input
              className="mt-1 h-10 rounded-none bg-white"
              inputMode="decimal"
              value={accountSettings.proposedAdvisorFeePctInput ?? ""}
              onChange={(e) =>
                onChangeAccount({ proposedAdvisorFeePctInput: e.target.value })
              }
              placeholder="1"
            />
          </div>
        ) : null}
      </div>

      {resultAccount ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-600">View scenario:</span>
          <button
            type="button"
            className={`rounded-none border px-2 py-1 ${
              scenarioView === "current"
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-300 bg-white text-slate-700"
            }`}
            onClick={() => onScenarioViewChange("current")}
          >
            Current
          </button>
          <button
            type="button"
            className={`rounded-none border px-2 py-1 ${
              scenarioView === "proposed"
                ? "border-violet-700 bg-violet-800 text-white"
                : "border-slate-300 bg-white text-slate-700"
            }`}
            onClick={() => onScenarioViewChange("proposed")}
          >
            Proposed
          </button>
          {slice ? (
            <span className="text-slate-600">
              Fund fees {formatCurrency(slice.fundFeesDollars)} · Advisory{" "}
              {formatCurrency(slice.advisorFeesDollars)} · All-in{" "}
              {formatPct(slice.allInDragPctOfAccount)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-none border border-slate-200">
        <table className="min-w-[720px] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th className="px-3 py-3">Ticker</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Asset class</th>
              <th className="px-3 py-3 text-right">Value</th>
              {resultAccount ? (
                <>
                  <th className="px-3 py-3 text-right">Est. expense %</th>
                  <th className="px-3 py-3 text-right">Est. $ / yr</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={`${group.key}-${idx}`}
                className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60"
              >
                <td className="px-3 py-2 font-mono text-xs text-slate-900">{row.ticker || "—"}</td>
                <td className="px-3 py-2 text-slate-800">{row.suggested || row.rawName}</td>
                <td className="px-3 py-2 text-slate-600">{row.assetClass}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                  {formatCurrency(row.value)}
                </td>
                {resultAccount && "expenseRatioAnnual" in row ? (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                      {row.expenseRatioAnnual != null
                        ? formatPct(row.expenseRatioAnnual)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                      {formatCurrency(row.estimatedAnnualFeeDollars)}
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resultAccount?.lines.some((l) => l.lookupNote) ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          {resultAccount.lines.map((row, idx) =>
            row.lookupNote ? (
              <li key={`note-${group.key}-${idx}`}>
                <span className="font-mono">{row.ticker || row.rawName || "—"}</span>: {row.lookupNote}
              </li>
            ) : null
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function registrationHintForAccount(
  rollup: { dominantRegistration: string } | undefined
): string {
  if (!rollup) return "—";
  if (rollup.dominantRegistration === "mixed") return "Mixed registrations";
  return registrationLabel(rollup.dominantRegistration as Parameters<typeof registrationLabel>[0]);
}
