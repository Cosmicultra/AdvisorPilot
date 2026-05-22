import { accountKeyForHolding } from "@/lib/annuity-contract-types";
import type { UiHolding } from "@/lib/saved-review-normalize";

/** Internal account key for holdings with unknown / off-books destination. */
export const UNKNOWN_ACCOUNT_NUMBER = "__ap_unknown_account__";

export const NOT_ON_LIST_VALUE = "__not_on_list__";

export function unknownAccountDisplayLabel(): string {
  return "Unknown account";
}

export function isUnknownAccountNumber(accountNumber: string): boolean {
  return accountNumber === UNKNOWN_ACCOUNT_NUMBER;
}

export function isExternalAccountNumber(accountNumber: string): boolean {
  return accountNumber.startsWith("EXTERNAL:");
}

/** User-entered off-books destination (custodian, rollover IRA elsewhere, etc.). */
export function externalAccountNumber(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return UNKNOWN_ACCOUNT_NUMBER;
  return `EXTERNAL:${trimmed.slice(0, 160)}`;
}

export function externalAccountDisplayLabel(accountNumber: string): string {
  if (isExternalAccountNumber(accountNumber)) {
    return accountNumber.slice("EXTERNAL:".length);
  }
  return accountNumber;
}

export function applyMoveFullAccount(
  holdings: UiHolding[],
  sourceAccountNumber: string,
  destinationAccountNumber: string
): UiHolding[] {
  return holdings.map((holding) => {
    const key = accountKeyForHolding(holding);
    if (!key || key !== sourceAccountNumber) return holding;
    return { ...holding, accountNumber: destinationAccountNumber };
  });
}

export function countHoldingsInAccount(
  holdings: UiHolding[],
  sourceAccountNumber: string
): number {
  return holdings.filter((h) => accountKeyForHolding(h) === sourceAccountNumber).length;
}
