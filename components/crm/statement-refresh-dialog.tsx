"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, Trash2, X } from "lucide-react";
import { AccountRefreshMappingPanel } from "@/components/account-refresh-mapping-panel";
import { advisorFetch } from "@/lib/advisor-fetch";
import {
  financialInstitutionForAccountKey,
  formatAccountHeaderLabel,
} from "@/lib/crm/account-display";
import {
  groupHoldingsByAccountKey,
  UNLABELED_ACCOUNT_KEY,
  type AccountMatchResult,
  type AccountRefreshResolution,
} from "@/lib/crm/merge-account-holdings";
import {
  applyAccountRefreshResolutions,
  planAccountRefreshMerge,
  runStatementExtract,
} from "@/lib/crm/statement-refresh-flow";
import type { ClientDetail } from "@/lib/crm/types";
import {
  newStatementUploadId,
  type StatementUploadQueueItem,
} from "@/lib/statement-upload-queue";
import type { UiHolding } from "@/lib/saved-review-normalize";

type DialogPhase = "upload" | "mapping" | "success";

const EXTRACT_PROGRESS_MESSAGES = [
  "Uploading statement…",
  "Reading pages…",
  "Extracting holdings…",
  "Matching accounts…",
];

export type StatementRefreshDialogProps = {
  open: boolean;
  client: ClientDetail;
  /** Account row that opened the dialog — used as merge hint only. */
  preferredAccountKey?: string;
  onClose(): void;
  onSaved(client: ClientDetail): void;
};

const inputClass =
  "mt-1 w-full bg-white px-2 py-1.5 font-mono text-[13px] focus:outline-none";

export function StatementRefreshDialog({
  open,
  client,
  preferredAccountKey,
  onClose,
  onSaved,
}: StatementRefreshDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("upload");
  const [queue, setQueue] = useState<StatementUploadQueueItem[]>([]);
  const [fileInputRevision, setFileInputRevision] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [extractProgressIndex, setExtractProgressIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [priorHoldings, setPriorHoldings] = useState<UiHolding[]>([]);
  const [extractedHoldings, setExtractedHoldings] = useState<UiHolding[]>([]);
  const [matchResults, setMatchResults] = useState<AccountMatchResult[]>([]);
  const [initialResolutions, setInitialResolutions] = useState<AccountRefreshResolution[]>(
    []
  );
  const [mergedHoldings, setMergedHoldings] = useState<UiHolding[] | null>(null);

  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const accountHintLabel = useMemo(() => {
    if (!preferredAccountKey) return null;
    return formatAccountHeaderLabel(
      preferredAccountKey,
      financialInstitutionForAccountKey(client.holdings, preferredAccountKey)
    );
  }, [preferredAccountKey, client.holdings]);

  const existingAccountKeys = useMemo(
    () =>
      [...groupHoldingsByAccountKey(client.holdings).keys()].filter(
        (k) => k !== UNLABELED_ACCOUNT_KEY
      ),
    [client.holdings]
  );

  const resetState = useCallback(() => {
    setPhase("upload");
    setQueue([]);
    setFileInputRevision((r) => r + 1);
    setExtracting(false);
    setExtractProgressIndex(0);
    setError(null);
    setSubmitting(false);
    setPriorHoldings([]);
    setExtractedHoldings([]);
    setMatchResults([]);
    setInitialResolutions([]);
    setMergedHoldings(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetState();
  }, [open, client.id, preferredAccountKey, resetState]);

  useEffect(() => {
    if (!extracting) {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      return;
    }
    progressTimerRef.current = setInterval(() => {
      setExtractProgressIndex((i) => (i + 1) % EXTRACT_PROGRESS_MESSAGES.length);
    }, 2200);
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [extracting]);

  const appendFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: StatementUploadQueueItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i);
      if (file) next.push({ id: newStatementUploadId(), file, holdingsPages: "" });
    }
    if (next.length) setQueue((prev) => [...prev, ...next]);
  };

  const setHoldingsPages = (id: string, value: string) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, holdingsPages: value } : item))
    );
  };

  const removeFile = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleExtract = async () => {
    if (queue.length === 0) {
      setError("Please upload at least one PDF, screenshot, or photo first.");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const prior = client.holdings;
      const extracted = await runStatementExtract({
        files: queue.map((item) => item.file),
        pageHints: queue.map((item) => item.holdingsPages.trim()),
        intakeClient: client.client,
        demoMode: false,
      });

      if (prior.length === 0) {
        setMergedHoldings(extracted);
        await persistHoldings(extracted);
        return;
      }

      const plan = planAccountRefreshMerge(prior, extracted, {
        preferredExistingKey: preferredAccountKey,
      });

      if (plan.needsConfirmation) {
        setPriorHoldings(prior);
        setExtractedHoldings(extracted);
        setMatchResults(plan.matchResults);
        setInitialResolutions(plan.initialResolutions);
        setPhase("mapping");
        return;
      }

      const merged = plan.mergedHoldings ?? extracted;
      setMergedHoldings(merged);
      await persistHoldings(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Statement analysis failed.");
    } finally {
      setExtracting(false);
    }
  };

  const handleMappingConfirm = async (resolutions: AccountRefreshResolution[]) => {
    const merged = applyAccountRefreshResolutions(
      priorHoldings,
      extractedHoldings,
      resolutions
    );
    setMergedHoldings(merged);
    setError(null);
    try {
      await persistHoldings(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save holdings.");
    }
  };

  const persistHoldings = async (holdings: UiHolding[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await advisorFetch(`/api/clients/${client.id}/holdings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings,
          clearAnalysis: true,
          moveSummary: "Statement refresh from CRM portfolio",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to save holdings."
        );
      }
      onSaved(json.client as ClientDetail);
      setPhase("success");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (extracting || submitting) return;
    onClose();
  };

  if (!open) return null;

  const confirmHref = `/app/intake?clientId=${encodeURIComponent(client.id)}&step=confirm`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close dialog"
        onClick={handleClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="statement-refresh-title"
        className="relative flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col"
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid var(--ap-border)",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.18)",
        }}
      >
        <header
          className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--ap-border)" }}
        >
          <div>
            <p
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--ap-gray)" }}
            >
              Statement refresh
            </p>
            <h2
              id="statement-refresh-title"
              className="font-display text-[15px] font-semibold"
              style={{ color: "var(--ap-navy)" }}
            >
              {phase === "success" ? "Holdings updated" : "Upload new statement"}
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ap-gray)" }}>
              {phase === "success"
                ? "Review and confirm holdings, then run analysis when ready."
                : accountHintLabel
                  ? `Refreshing ${accountHintLabel}. Other accounts on this client stay unchanged.`
                  : "Queue one or more statements. Other accounts stay unchanged after mapping."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={extracting || submitting}
            className="shrink-0 p-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" style={{ color: "var(--ap-gray)" }} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {phase === "upload" ? (
            <div className="flex flex-col gap-4">
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--ap-gray)" }}>
                Add PDFs or images for the accounts you want to update. You can upload several
                statements in one batch before extracting.
              </p>

              <label
                className="flex cursor-pointer flex-col gap-2 border border-dashed px-4 py-4 transition-colors hover:bg-[#f8fafc]"
                style={{ borderColor: "var(--ap-border)" }}
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
                  <FileText className="h-4 w-4 shrink-0" style={{ color: "var(--ap-royal)" }} />
                  Choose files
                </span>
                <span className="text-[11.5px]" style={{ color: "var(--ap-gray)" }}>
                  PDF, JPG, PNG — multi-select supported
                </span>
                <input
                  key={`stmt-refresh-${fileInputRevision}`}
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    appendFiles(e.currentTarget.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {queue.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[12px] font-semibold" style={{ color: "var(--ap-navy)" }}>
                    Queued files ({queue.length})
                  </p>
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--ap-gray)" }}>
                    Optional: pages with holdings (1-based), e.g.{" "}
                    <code className="bg-[#f1f5f9] px-1 font-mono text-[10.5px]">1-2</code>,{" "}
                    <code className="bg-[#f1f5f9] px-1 font-mono text-[10.5px]">1,3,9</code>.
                    Leave blank to send the whole PDF.
                  </p>
                  <ul className="flex flex-col gap-2">
                    {queue.map((item, idx) => (
                      <li
                        key={item.id}
                        className="flex flex-col gap-2 border px-3 py-2 sm:flex-row sm:items-end"
                        style={{ borderColor: "var(--ap-border)" }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--ap-gray)" }}>
                            File {idx + 1}
                          </p>
                          <p className="truncate text-[12.5px] font-medium" style={{ color: "var(--ap-navy)" }} title={item.file.name}>
                            {item.file.name}
                          </p>
                        </div>
                        <div className="min-w-0 flex-[1.4]">
                          <label
                            htmlFor={`holdings-pages-${item.id}`}
                            className="text-[10px] font-semibold uppercase tracking-wide"
                            style={{ color: "var(--ap-gray)" }}
                          >
                            Pages with holdings
                          </label>
                          <input
                            id={`holdings-pages-${item.id}`}
                            type="text"
                            className={inputClass}
                            style={{ border: "1px solid var(--ap-border)" }}
                            placeholder="e.g. 1-2 · 1,3,9"
                            value={item.holdingsPages}
                            onChange={(e) => setHoldingsPages(item.id, e.target.value)}
                            autoComplete="off"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(item.id)}
                          disabled={extracting}
                          className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-[11.5px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {extracting ? (
                <p className="text-[12px] font-medium" style={{ color: "var(--ap-navy)" }} aria-live="polite">
                  {EXTRACT_PROGRESS_MESSAGES[extractProgressIndex]}
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "mapping" ? (
            <AccountRefreshMappingPanel
              matchResults={matchResults}
              existingAccountKeys={existingAccountKeys}
              existingHoldings={priorHoldings}
              initialResolutions={initialResolutions}
              onConfirm={(resolutions) => void handleMappingConfirm(resolutions)}
              onCancel={() => {
                setPhase("upload");
                setPriorHoldings([]);
                setExtractedHoldings([]);
                setMatchResults([]);
                setInitialResolutions([]);
              }}
            />
          ) : null}

          {phase === "success" ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px]" style={{ color: "var(--ap-navy)" }}>
                Merged holdings are saved. Accounts you did not refresh are unchanged.
                {mergedHoldings ? (
                  <span className="mt-1 block text-[12px]" style={{ color: "var(--ap-gray)" }}>
                    {mergedHoldings.length} position(s) on file — confirm tickers and asset classes
                    before running deep analysis.
                  </span>
                ) : null}
              </p>
              <Link
                href={confirmHref}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold"
                style={{
                  backgroundColor: "var(--ap-royal)",
                  color: "#FFFFFF",
                }}
                onClick={() => onClose()}
              >
                Continue to Confirm Holdings
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-[12px] text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {phase === "upload" ? (
          <footer
            className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3"
            style={{ borderColor: "var(--ap-border)" }}
          >
            <button
              type="button"
              onClick={handleClose}
              disabled={extracting || submitting}
              className="px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
              style={{ color: "var(--ap-gray)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleExtract()}
              disabled={extracting || submitting || queue.length === 0}
              className="px-4 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: "var(--ap-royal)",
                color: "#FFFFFF",
              }}
            >
              {extracting ? EXTRACT_PROGRESS_MESSAGES[extractProgressIndex] : "Extract holdings"}
            </button>
          </footer>
        ) : null}

        {phase === "success" ? (
          <footer
            className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3"
            style={{ borderColor: "var(--ap-border)" }}
          >
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-[12.5px] font-medium"
              style={{ color: "var(--ap-gray)" }}
            >
              Stay on Portfolio
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

