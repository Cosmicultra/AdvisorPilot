"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { buildAccountGroups } from "@/lib/crm/account-groups";
import {
  NOT_ON_LIST_VALUE,
  UNKNOWN_ACCOUNT_NUMBER,
  applyMoveFullAccount,
  countHoldingsInAccount,
  externalAccountDisplayLabel,
  externalAccountNumber,
  isExternalAccountNumber,
  isUnknownAccountNumber,
  unknownAccountDisplayLabel,
} from "@/lib/crm/move-account";
import type { ClientDetail } from "@/lib/crm/types";
import { formatAccountHeaderLabel } from "@/lib/crm/account-display";

type Disposition = "transferred" | "closed" | null;

type WizardStep =
  | "disposition"
  | "transferred-target"
  | "transferred-external"
  | "closed-managed"
  | "closed-target";

export type MoveFullAccountDialogProps = {
  open: boolean;
  client: ClientDetail;
  sourceAccountNumber: string;
  onClose(): void;
  onSaved(client: ClientDetail): void;
};

const selectClass =
  "w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none";
const inputClass =
  "w-full bg-white px-2 py-1.5 text-[13px] focus:outline-none";

export function MoveFullAccountDialog({
  open,
  client,
  sourceAccountNumber,
  onClose,
  onSaved,
}: MoveFullAccountDialogProps) {
  const accounts = useMemo(() => buildAccountGroups(client), [client]);
  const sourceAccount = accounts.find((a) => a.accountNumber === sourceAccountNumber);
  const otherAccounts = useMemo(
    () => accounts.filter((a) => a.accountNumber !== sourceAccountNumber),
    [accounts, sourceAccountNumber]
  );

  const [step, setStep] = useState<WizardStep>("disposition");
  const [disposition, setDisposition] = useState<Disposition>(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [externalDestination, setExternalDestination] = useState("");
  const [externalUnknown, setExternalUnknown] = useState(false);
  const [closedManagedByAdvisor, setClosedManagedByAdvisor] = useState<boolean | null>(null);
  const [closedTarget, setClosedTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("disposition");
    setDisposition(null);
    setTransferTarget("");
    setExternalDestination("");
    setExternalUnknown(false);
    setClosedManagedByAdvisor(null);
    setClosedTarget("");
    setSubmitting(false);
    setError(null);
  }, [open, sourceAccountNumber]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const sourceLabel = accountOptionLabel(
    sourceAccountNumber,
    sourceAccount?.financialInstitutionLabel,
    sourceAccount?.annuityTypeCarrierLabel
  );

  const destinationAccountNumber = resolveDestination({
    disposition,
    transferTarget,
    externalDestination,
    externalUnknown,
    closedManagedByAdvisor,
    closedTarget,
  });

  const canSubmit =
    destinationAccountNumber !== null &&
    countHoldingsInAccount(client.holdings, sourceAccountNumber) > 0;

  const showConfirm =
    step === "transferred-external" ||
    (step === "transferred-target" &&
      transferTarget &&
      transferTarget !== NOT_ON_LIST_VALUE) ||
    (step === "closed-managed" && closedManagedByAdvisor === false) ||
    (step === "closed-target" && Boolean(closedTarget));

  const handleSubmit = async () => {
    if (!destinationAccountNumber || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const nextHoldings = applyMoveFullAccount(
        client.holdings,
        sourceAccountNumber,
        destinationAccountNumber
      );
      const movedCount = countHoldingsInAccount(client.holdings, sourceAccountNumber);
      const res = await advisorFetch(`/api/clients/${client.id}/holdings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: nextHoldings,
          moveSummary: `Moved ${movedCount} position(s) from ${sourceLabel} → ${accountOptionLabel(
            destinationAccountNumber,
            otherAccounts.find((a) => a.accountNumber === destinationAccountNumber)
              ?.financialInstitutionLabel,
            otherAccounts.find((a) => a.accountNumber === destinationAccountNumber)
              ?.annuityTypeCarrierLabel
          )}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Failed to move account.");
      }
      onSaved(json.client as ClientDetail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move account.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close dialog"
        onClick={() => !submitting && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-account-title"
        className="relative flex max-h-[min(90vh,640px)] w-full max-w-md flex-col"
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid var(--ap-border)",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.18)",
        }}
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--ap-border)" }}
        >
          <div>
            <p
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--ap-gray)" }}
            >
              Move full account
            </p>
            <h2
              id="move-account-title"
              className="font-display text-[15px] font-semibold"
              style={{ color: "var(--ap-navy)" }}
            >
              {sourceLabel}
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ap-gray)" }}>
              All positions in this account will be reassigned.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="shrink-0 p-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" style={{ color: "var(--ap-gray)" }} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {step === "disposition" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-[13px] font-medium" style={{ color: "var(--ap-navy)" }}>
                1. Was this account transferred or closed?
              </legend>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  name="disposition"
                  checked={disposition === "transferred"}
                  onChange={() => setDisposition("transferred")}
                  disabled={submitting}
                />
                <span style={{ color: "var(--ap-navy)" }}>Transferred</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  name="disposition"
                  checked={disposition === "closed"}
                  onChange={() => setDisposition("closed")}
                  disabled={submitting}
                />
                <span style={{ color: "var(--ap-navy)" }}>Closed</span>
              </label>
            </fieldset>
          ) : null}

          {step === "transferred-target" ? (
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium" style={{ color: "var(--ap-navy)" }}>
                2. Which account received the transfer?
              </label>
              <select
                value={transferTarget}
                onChange={(e) => setTransferTarget(e.target.value)}
                disabled={submitting}
                className={selectClass}
                style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
              >
                <option value="">Select an accountâ€¦</option>
                {otherAccounts.map((acct) => (
                  <option key={acct.accountNumber} value={acct.accountNumber}>
                    {accountOptionLabel(
                      acct.accountNumber,
                      acct.financialInstitutionLabel,
                      acct.annuityTypeCarrierLabel
                    )}
                  </option>
                ))}
                <option value={NOT_ON_LIST_VALUE}>Not on this list</option>
              </select>
            </div>
          ) : null}

          {step === "transferred-external" ? (
            <div className="flex flex-col gap-3">
              <label className="text-[13px] font-medium" style={{ color: "var(--ap-navy)" }}>
                Where did the account go?
              </label>
              <input
                type="text"
                value={externalDestination}
                onChange={(e) => {
                  setExternalDestination(e.target.value);
                  setExternalUnknown(false);
                }}
                disabled={submitting || externalUnknown}
                placeholder="e.g. Fidelity rollover IRA"
                className={inputClass}
                style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
              />
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={externalUnknown}
                  onChange={(e) => {
                    setExternalUnknown(e.target.checked);
                    if (e.target.checked) setExternalDestination("");
                  }}
                  disabled={submitting}
                />
                <span style={{ color: "var(--ap-navy)" }}>Unknown</span>
              </label>
            </div>
          ) : null}

          {step === "closed-managed" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-[13px] font-medium" style={{ color: "var(--ap-navy)" }}>
                2. Was it transferred to an account you manage for this client?
              </legend>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  name="closed-managed"
                  checked={closedManagedByAdvisor === true}
                  onChange={() => setClosedManagedByAdvisor(true)}
                  disabled={submitting}
                />
                <span style={{ color: "var(--ap-navy)" }}>Yes</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  name="closed-managed"
                  checked={closedManagedByAdvisor === false}
                  onChange={() => setClosedManagedByAdvisor(false)}
                  disabled={submitting}
                />
                <span style={{ color: "var(--ap-navy)" }}>No</span>
              </label>
            </fieldset>
          ) : null}

          {step === "closed-target" ? (
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium" style={{ color: "var(--ap-navy)" }}>
                3. Which account received the assets?
              </label>
              <select
                value={closedTarget}
                onChange={(e) => setClosedTarget(e.target.value)}
                disabled={submitting}
                className={selectClass}
                style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
              >
                <option value="">Select an accountâ€¦</option>
                {otherAccounts.map((acct) => (
                  <option key={acct.accountNumber} value={acct.accountNumber}>
                    {accountOptionLabel(
                      acct.accountNumber,
                      acct.financialInstitutionLabel,
                      acct.annuityTypeCarrierLabel
                    )}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-[12px] text-red-700">{error}</p> : null}
        </div>

        <footer
          className="flex items-center justify-between gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--ap-border)" }}
        >
          <button
            type="button"
            onClick={() => {
              if (step === "disposition") {
                onClose();
                return;
              }
              if (step === "transferred-external") {
                setStep("transferred-target");
                return;
              }
              if (step === "transferred-target") {
                setStep("disposition");
                return;
              }
              if (step === "closed-target") {
                setStep("closed-managed");
                return;
              }
              if (step === "closed-managed") {
                setStep("disposition");
              }
            }}
            disabled={submitting}
            className="px-3 py-1.5 text-[12.5px] font-medium"
            style={{ color: "var(--ap-gray)" }}
          >
            {step === "disposition" ? "Cancel" : "Back"}
          </button>

          {showConfirm ? (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !canSubmit}
              className="px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
            >
              {submitting ? "Movingâ€¦" : "Confirm move"}
            </button>
          ) : (
            <button
              type="button"
              disabled={
                submitting ||
                !canGoNext(step, disposition, transferTarget, closedManagedByAdvisor)
              }
              onClick={() =>
                setStep(
                  nextStep(step, disposition, transferTarget, closedManagedByAdvisor)
                )
              }
              className="px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
            >
              Continue
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function nextStep(
  step: WizardStep,
  disposition: Disposition,
  transferTarget: string,
  closedManagedByAdvisor: boolean | null
): WizardStep {
  if (step === "disposition") {
    if (disposition === "transferred") return "transferred-target";
    if (disposition === "closed") return "closed-managed";
  }
  if (step === "transferred-target" && transferTarget === NOT_ON_LIST_VALUE) {
    return "transferred-external";
  }
  if (step === "closed-managed" && closedManagedByAdvisor === true) {
    return "closed-target";
  }
  return step;
}

function canGoNext(
  step: WizardStep,
  disposition: Disposition,
  transferTarget: string,
  closedManagedByAdvisor: boolean | null
): boolean {
  if (step === "disposition") {
    return disposition === "transferred" || disposition === "closed";
  }
  if (step === "transferred-target") {
    return Boolean(transferTarget);
  }
  if (step === "closed-managed") {
    return closedManagedByAdvisor === true || closedManagedByAdvisor === false;
  }
  return false;
}

function resolveDestination(input: {
  disposition: Disposition;
  transferTarget: string;
  externalDestination: string;
  externalUnknown: boolean;
  closedManagedByAdvisor: boolean | null;
  closedTarget: string;
}): string | null {
  const {
    disposition,
    transferTarget,
    externalDestination,
    externalUnknown,
    closedManagedByAdvisor,
    closedTarget,
  } = input;

  if (disposition === "transferred") {
    if (!transferTarget) return null;
    if (transferTarget === NOT_ON_LIST_VALUE) {
      if (externalUnknown) return UNKNOWN_ACCOUNT_NUMBER;
      if (!externalDestination.trim()) return null;
      return externalAccountNumber(externalDestination);
    }
    return transferTarget;
  }

  if (disposition === "closed") {
    if (closedManagedByAdvisor === false) return UNKNOWN_ACCOUNT_NUMBER;
    if (closedManagedByAdvisor === true && closedTarget) return closedTarget;
    return null;
  }

  return null;
}

function accountOptionLabel(
  accountNumber: string,
  financialInstitutionLabel: string | null | undefined,
  annuityLabel?: string | null
): string {
  const header = formatAccountHeaderLabel(accountNumber, financialInstitutionLabel);
  if (annuityLabel) return `${header} · ${annuityLabel}`;
  return header;
}

