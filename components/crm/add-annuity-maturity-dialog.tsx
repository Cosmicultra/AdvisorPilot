"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { advisorFetch } from "@/lib/advisor-fetch";
import {
  applyMaturityDateToAccountHoldings,
  buildAnnuityMaturityReviewDetails,
  primaryAnnuityHoldingInAccount,
} from "@/lib/crm/annuity-maturity-input";
import type { ClientDetail } from "@/lib/crm/types";

export type AddAnnuityMaturityDialogProps = {
  open: boolean;
  client: ClientDetail;
  accountNumber: string;
  onClose(): void;
  onSaved(client: ClientDetail): void;
};

const inputClass =
  "w-full border bg-white px-2 py-1.5 text-[13px] focus:outline-none";

export function AddAnnuityMaturityDialog({
  open,
  client,
  accountNumber,
  onClose,
  onSaved,
}: AddAnnuityMaturityDialogProps) {
  const primaryHolding = useMemo(
    () => primaryAnnuityHoldingInAccount(client.holdings, accountNumber),
    [client.holdings, accountNumber]
  );
  const details = useMemo(
    () => (primaryHolding ? buildAnnuityMaturityReviewDetails(primaryHolding) : null),
    [primaryHolding]
  );

  const [maturityDate, setMaturityDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMaturityDate("");
    setSubmitting(false);
    setError(null);
  }, [open, accountNumber]);

  const handleSubmit = async () => {
    if (!maturityDate.trim()) {
      setError("Enter a maturity date.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const nextHoldings = applyMaturityDateToAccountHoldings(
        client.holdings,
        accountNumber,
        maturityDate
      );
      const res = await advisorFetch(`/api/clients/${client.id}/holdings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: nextHoldings,
          moveSummary: `Maturity date set for annuity account ${accountNumber}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to save maturity date."
        );
      }
      onSaved(json.client as ClientDetail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save maturity date.");
      setSubmitting(false);
    }
  };

  if (!open || !details) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close dialog"
        onClick={() => !submitting && onClose()}
      />
      <div
        className="relative z-10 w-full max-w-md bg-white shadow-lg"
        style={{ border: "1px solid var(--ap-border)" }}
        role="dialog"
        aria-labelledby="annuity-maturity-title"
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--ap-border)" }}
        >
          <h2
            id="annuity-maturity-title"
            className="text-[15px] font-semibold"
            style={{ color: "var(--ap-navy)" }}
          >
            Add maturity date
          </h2>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="p-1"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <p className="text-[12px]" style={{ color: "var(--ap-gray)" }}>
            This contract has no maturity date from the statement. Enter one so maturity
            reminder drips can run on schedule.
          </p>

          <dl className="grid grid-cols-1 gap-2 text-[12.5px]">
            <DetailRow label="Carrier" value={details.carrierName} />
            <DetailRow label="Contract / product" value={details.productName} />
            <DetailRow label="Contract #" value={details.contractNumberDisplay} />
            <DetailRow label="Current value" value={details.currentValueFormatted} />
            <DetailRow label="Issue date" value={details.issueDate} />
          </dl>

          <div>
            <label
              htmlFor="annuity-maturity-date"
              className="mb-1 block text-[12px] font-medium"
              style={{ color: "var(--ap-navy)" }}
            >
              Maturity date
            </label>
            <input
              id="annuity-maturity-date"
              type="date"
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
              className={inputClass}
              style={{ borderColor: "var(--ap-border)" }}
            />
          </div>

          {error ? (
            <p className="text-[12px] text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div
          className="flex justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--ap-border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
            style={{ color: "var(--ap-gray)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !maturityDate}
            className="px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "var(--ap-royal)",
              color: "#fff",
            }}
          >
            {submitting ? "Saving…" : "Save maturity date"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 font-medium" style={{ color: "var(--ap-gray)" }}>
        {label}
      </dt>
      <dd className="text-right font-medium" style={{ color: "var(--ap-navy)" }}>
        {value}
      </dd>
    </div>
  );
}
