"use client";

import { useCallback, useMemo, useState } from "react";
import { BrainCircuit, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { advisorFetch } from "@/lib/advisor-fetch";
import {
  buildComparativeFeeApiAccounts,
  defaultProposedForCurrent,
  mergeWorksheetAccounts,
  myAdvisoryFeeAnnualFromWorksheet,
  type ComparativeFeeAnalysisResponse,
  type FeeAnalysisWorksheet,
  type FeeAnalysisWorksheetAccount,
} from "@/lib/comparative-fee-analysis";
import {
  groupFeeAnalysisFundRowsByAccount,
  type FeeAnalysisHoldingLike,
} from "@/lib/fee-analysis";
import { rollupAccounts } from "@/lib/holding-registration";
import {
  ComparativeFeeAccountCard,
  registrationHintForAccount,
} from "@/components/workflow/comparative-fee-account-card";
import { ComparativeFeeSummaryCards } from "@/components/workflow/comparative-fee-summary";

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export type ComparativeFeeAnalysisProps = {
  holdings: FeeAnalysisHoldingLike[];
  totalValue: number;
  demoMode: boolean;
  portfolioSynopsisSnippet?: string;
  worksheet: FeeAnalysisWorksheet;
  onWorksheetChange: (ws: FeeAnalysisWorksheet) => void;
  onEmailSessionExpired?: () => void;
  onBack: () => void;
  onSave: () => void;
  onNext: () => void;
  WorkflowStepFooter: React.ComponentType<{
    onBack: () => void;
    onSave: () => void;
    onNext: () => void;
    rightExtra?: React.ReactNode;
  }>;
};

export function ComparativeFeeAnalysis({
  holdings,
  totalValue,
  demoMode,
  portfolioSynopsisSnippet,
  worksheet,
  onWorksheetChange,
  onEmailSessionExpired,
  onBack,
  onSave,
  onNext,
  WorkflowStepFooter,
}: ComparativeFeeAnalysisProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComparativeFeeAnalysisResponse | null>(
    () => worksheet.lastResult ?? null
  );
  const [scenarioViews, setScenarioViews] = useState<Record<string, "current" | "proposed">>({});

  const groups = useMemo(() => groupFeeAnalysisFundRowsByAccount(holdings), [holdings]);
  const accountRollups = useMemo(() => rollupAccounts(holdings), [holdings]);

  const mergedWorksheet = useMemo(
    () =>
      mergeWorksheetAccounts(worksheet, groups.map((g) => ({ key: g.key }))),
    [worksheet, groups]
  );

  const myFeePctDisplay = useMemo(() => {
    if (typeof worksheet.myAdvisoryFeePctInput === "string") return worksheet.myAdvisoryFeePctInput;
    return String((worksheet.myAdvisoryFeeAnnual ?? 0.01) * 100);
  }, [worksheet]);

  const patchWorksheet = useCallback(
    (patch: Partial<FeeAnalysisWorksheet>) => {
      onWorksheetChange({ ...mergedWorksheet, ...patch });
    },
    [mergedWorksheet, onWorksheetChange]
  );

  const patchAccount = useCallback(
    (key: string, patch: Partial<FeeAnalysisWorksheetAccount>) => {
      const prev = mergedWorksheet.accounts[key];
      if (!prev) return;
      const next: FeeAnalysisWorksheetAccount = { ...prev, ...patch };
      if (patch.currentManagement && !patch.proposedManagement) {
        next.proposedManagement = defaultProposedForCurrent(patch.currentManagement);
      }
      onWorksheetChange({
        ...mergedWorksheet,
        accounts: { ...mergedWorksheet.accounts, [key]: next },
      });
    },
    [mergedWorksheet, onWorksheetChange]
  );

  const runAnalysis = useCallback(async () => {
    setError(null);
    if (groups.length === 0) {
      setError("No ETF or mutual fund positions are classified on the confirmed holdings.");
      return;
    }
    if (totalValue <= 0) {
      setError("Total portfolio value must be greater than zero.");
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const accounts = buildComparativeFeeApiAccounts(groups, mergedWorksheet);
      const res = await advisorFetch("/api/fee-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 2,
          demoMode,
          totalValue,
          myAdvisoryFeeAnnual: myAdvisoryFeeAnnualFromWorksheet(mergedWorksheet),
          accounts,
          portfolioSynopsisSnippet: portfolioSynopsisSnippet || undefined,
        }),
        onEmailSessionExpired,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<ComparativeFeeAnalysisResponse>;
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Comparative fee analysis failed.");
      }
      const payload = data as ComparativeFeeAnalysisResponse;
      setResult(payload);
      onWorksheetChange({
        ...mergedWorksheet,
        lastResult: payload,
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Comparative fee analysis failed.");
    } finally {
      setBusy(false);
    }
  }, [
    groups,
    totalValue,
    demoMode,
    mergedWorksheet,
    portfolioSynopsisSnippet,
    onEmailSessionExpired,
    onWorksheetChange,
  ]);

  const resultByKey = useMemo(() => {
    const m = new Map<string, ComparativeFeeAnalysisResponse["accounts"][0]>();
    for (const a of result?.accounts ?? []) m.set(a.key, a);
    return m;
  }, [result]);

  return (
    <Card className="rounded-none ap-glass border-0">
      <CardContent className="space-y-8 p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none border-violet-200 bg-violet-50">
              <Percent className="h-6 w-6 text-violet-900" />
            </div>
            <div>
              <h2 className="font-serif text-3xl font-bold">Comparative Fee Analysis</h2>
              <p className="text-sm text-slate-500">
                Illustrative annual cost comparison across current and proposed management assumptions.
                Fund expense estimates use a dedicated model pass; advisory fees follow your per-account
                inputs only where management applies.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-none border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Illustrative only</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900">
            Expense ratios are model estimates, not prospectus data. Advisory fees are advisor-entered
            assumptions. Confirm every figure on official documents before client-facing use.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:max-w-2xl md:grid-cols-2">
          <div>
            <label className="text-sm font-semibold text-slate-700">
              My advisory fee (% default for managed / transition accounts)
            </label>
            <Input
              className="mt-2 h-12 rounded-none bg-white"
              inputMode="decimal"
              value={myFeePctDisplay}
              onChange={(e) =>
                patchWorksheet({ myAdvisoryFeePctInput: e.target.value })
              }
              placeholder="1"
            />
            <p className="mt-1 text-xs text-slate-500">
              Applied only to accounts marked Managed by me or Transition to me unless you override per
              account. Not applied to the full portfolio automatically.
            </p>
          </div>
          <div className="flex flex-col justify-end text-sm text-slate-600">
            <span>
              Total portfolio (all holdings):{" "}
              <span className="font-semibold text-slate-900">{formatCurrency(totalValue)}</span>
            </span>
          </div>
        </div>

        {error ? (
          <div className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {groups.length === 0 ? (
          <div className="rounded-none border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            No holdings are classified as ETF or mutual fund. Refine asset classes on Confirm Holdings
            to include fund wrappers here.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((grp) => {
              const settings = mergedWorksheet.accounts[grp.key]!;
              const rollup = accountRollups.find((r) => r.key === grp.key);
              return (
                <ComparativeFeeAccountCard
                  key={grp.key}
                  group={grp}
                  regHint={registrationHintForAccount(rollup)}
                  accountSettings={settings}
                  onChangeAccount={(patch) => patchAccount(grp.key, patch)}
                  resultAccount={resultByKey.get(grp.key)}
                  scenarioView={scenarioViews[grp.key] ?? "proposed"}
                  onScenarioViewChange={(view) =>
                    setScenarioViews((prev) => ({ ...prev, [grp.key]: view }))
                  }
                />
              );
            })}
          </div>
        )}

        {result ? <ComparativeFeeSummaryCards result={result} /> : null}

        <WorkflowStepFooter
          onBack={onBack}
          onSave={onSave}
          onNext={onNext}
          rightExtra={
            <Button
              variant="outline"
              className="h-12 rounded-none border-violet-300 bg-violet-50/90 touch-manipulation hover:bg-violet-100/90"
              disabled={busy || groups.length === 0 || totalValue <= 0}
              onClick={() => void runAnalysis()}
            >
              <BrainCircuit className="mr-2 h-4 w-4" />
              {busy ? "Running…" : "Run"}
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
