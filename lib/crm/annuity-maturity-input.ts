/**
 * Portfolio UI helpers: detect missing annuity maturity dates and apply advisor input.
 */

import {
  accountKeyForHolding,
  isAnnuityContractHolding,
  maskContractNumberDisplay,
  normalizeAnnuityContractFromStorage,
  type AnnuityContractDetails,
} from "@/lib/annuity-contract-types";
import { parseContractDate } from "@/lib/crm/annuity-reminder-dates";
import type { UiHolding } from "@/lib/saved-review-normalize";

export function hasParsableMaturityDate(contract: AnnuityContractDetails | undefined): boolean {
  if (!contract?.maturityDate?.trim()) return false;
  return parseContractDate(contract.maturityDate) !== null;
}

export function holdingsForAccount(
  holdings: UiHolding[],
  accountNumber: string
): UiHolding[] {
  return holdings.filter((h) => accountKeyForHolding(h) === accountNumber);
}

/** Highest-value annuity holding in the account (primary contract row). */
export function primaryAnnuityHoldingInAccount(
  holdings: UiHolding[],
  accountNumber: string
): UiHolding | null {
  const inAccount = holdingsForAccount(holdings, accountNumber).filter(isAnnuityContractHolding);
  if (!inAccount.length) return null;
  return inAccount.reduce((best, h) => {
    const v = Number(h.value) || 0;
    const bestV = Number(best.value) || 0;
    return v >= bestV ? h : best;
  });
}

export function accountIsAnnuity(holdings: UiHolding[], accountNumber: string): boolean {
  return holdingsForAccount(holdings, accountNumber).some(isAnnuityContractHolding);
}

export function accountNeedsMaturityDateInput(
  holdings: UiHolding[],
  accountNumber: string
): boolean {
  if (!accountIsAnnuity(holdings, accountNumber)) return false;
  const primary = primaryAnnuityHoldingInAccount(holdings, accountNumber);
  if (!primary) return false;
  const contract = normalizeAnnuityContractFromStorage(primary.annuityContract);
  return !hasParsableMaturityDate(contract ?? undefined);
}

export type AnnuityMaturityReviewDetails = {
  carrierName: string;
  productName: string;
  contractNumberDisplay: string;
  currentValueFormatted: string;
  issueDate: string;
};

export function buildAnnuityMaturityReviewDetails(
  holding: UiHolding
): AnnuityMaturityReviewDetails | null {
  const contract = normalizeAnnuityContractFromStorage(holding.annuityContract);
  if (!contract) return null;
  const fromHolding = Number(holding.value);
  const value =
    Number.isFinite(fromHolding) && fromHolding > 0
      ? fromHolding
      : contract.currentValue;
  const currentValueFormatted =
    value != null && Number.isFinite(value) && value > 0
      ? `$${Math.round(value).toLocaleString("en-US")}`
      : "—";

  return {
    carrierName: contract.carrierName.trim() || "—",
    productName: contract.productName.trim() || "—",
    contractNumberDisplay: contract.contractNumber
      ? maskContractNumberDisplay(contract.contractNumber)
      : "—",
    currentValueFormatted,
    issueDate: contract.issueDate.trim() || "—",
  };
}

/** Set maturityDate on the primary annuity holding for this account (YYYY-MM-DD). */
export function applyMaturityDateToAccountHoldings(
  holdings: UiHolding[],
  accountNumber: string,
  maturityDateIso: string
): UiHolding[] {
  const primary = primaryAnnuityHoldingInAccount(holdings, accountNumber);
  if (!primary) return holdings;

  const match = (h: UiHolding) =>
    h === primary ||
    (accountKeyForHolding(h) === accountNumber &&
      isAnnuityContractHolding(h) &&
      normalizeAnnuityContractFromStorage(h.annuityContract)?.contractNumber ===
        normalizeAnnuityContractFromStorage(primary.annuityContract)?.contractNumber &&
      h.rawName === primary.rawName);

  return holdings.map((h) => {
    if (!match(h)) return h;
    const contract = normalizeAnnuityContractFromStorage(h.annuityContract);
    if (!contract) return h;
    return {
      ...h,
      annuityContract: {
        ...contract,
        maturityDate: maturityDateIso,
      },
    };
  });
}
