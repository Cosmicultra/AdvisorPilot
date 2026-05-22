import { accountKeyForHolding, isAnnuityContractHolding } from "@/lib/annuity-contract-types";
import {
  detectFinancialInstitutionFromText,
  financialInstitutionFromHolding,
  normalizeFinancialInstitution,
} from "@/lib/crm/financial-institution";
import {
  externalAccountDisplayLabel,
  isExternalAccountNumber,
  isUnknownAccountNumber,
  unknownAccountDisplayLabel,
} from "@/lib/crm/move-account";
import { maskAccountNumberDisplay } from "@/lib/mask-account-number";
import type { UiHolding } from "@/lib/saved-review-normalize";

const HYPHENATED_PREFIX = /^((?:[A-Za-z][A-Za-z0-9]*|[A-Za-z0-9]*[A-Za-z]))-(.+)$/;

export type AccountNumberParts = {
  prefix: string;
  maskedSuffix: string;
};

/**
 * Split `BRK-****-5502` into prefix + remainder for header formatting.
 */
export function parseAccountNumberParts(accountNumber: string): AccountNumberParts | null {
  const s = String(accountNumber ?? "").trim();
  if (!s) return null;
  const m = s.match(HYPHENATED_PREFIX);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const maskedSuffix = m[2].trim();
  if (!maskedSuffix) return null;
  return { prefix, maskedSuffix };
}

/**
 * Primary account row label. Inserts institution between prefix and masked digits when known.
 * Example: BRK + Schwab → `BRK Schwab ****-5502`.
 */
export function formatAccountHeaderLabel(
  accountNumber: string,
  institution?: string | null
): string {
  if (isUnknownAccountNumber(accountNumber)) return unknownAccountDisplayLabel();
  if (isExternalAccountNumber(accountNumber)) {
    return externalAccountDisplayLabel(accountNumber);
  }

  const inst = normalizeFinancialInstitution(institution ?? "");
  const parts = parseAccountNumberParts(accountNumber);
  if (inst && parts) {
    return `${parts.prefix} ${inst} ${parts.maskedSuffix}`;
  }

  return maskAccountNumberDisplay(accountNumber) || accountNumber;
}

function inferInstitutionFromFileMetadata(
  holdings: UiHolding[]
): string | null {
  const byFile = new Map<number | string, UiHolding[]>();
  for (const h of holdings) {
    const idx = h.sourceFileIndex;
    const key = Number.isFinite(idx) ? Number(idx) : h.sourceFileName ?? "unknown";
    const list = byFile.get(key) ?? [];
    list.push(h);
    byFile.set(key, list);
  }

  for (const group of byFile.values()) {
    const fromRow = group
      .map((h) => financialInstitutionFromHolding(h))
      .find(Boolean);
    if (fromRow) return fromRow;

    const fileName = group.find((h) => h.sourceFileName)?.sourceFileName;
    const detected = detectFinancialInstitutionFromText(null, fileName);
    if (detected) return detected;
  }

  return detectFinancialInstitutionFromText(
    null,
    holdings.find((h) => h.sourceFileName)?.sourceFileName
  );
}

/**
 * Brokerage custodian label for an account group. Skips annuity-only accounts (carrier uses subtitle).
 */
export function brokerageFinancialInstitutionLabel(holdings: UiHolding[]): string | null {
  if (holdings.length === 0) return null;

  const hasBrokerage = holdings.some((h) => !isAnnuityContractHolding(h));
  if (!hasBrokerage) return null;

  let best: string | null = null;
  let bestValue = -1;

  for (const h of holdings) {
    if (isAnnuityContractHolding(h)) continue;
    const inst = financialInstitutionFromHolding(h);
    if (!inst) continue;
    const v = Number(h.value) || 0;
    if (v >= bestValue) {
      bestValue = v;
      best = inst;
    }
  }
  if (best) return best;

  return inferInstitutionFromFileMetadata(
    holdings.filter((h) => !isAnnuityContractHolding(h))
  );
}

/** Institution string for a single account key across a client's holdings. */
export function financialInstitutionForAccountKey(
  holdings: UiHolding[],
  accountKey: string
): string | null {
  const rows = holdings.filter((h) => accountKeyForHolding(h) === accountKey);
  return brokerageFinancialInstitutionLabel(rows);
}
