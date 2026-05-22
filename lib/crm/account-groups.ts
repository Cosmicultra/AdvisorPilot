import {
  annuityAccountTypeCarrierLabel,
  annuityIndexingStrategyDisplaysForHolding,
  accountKeyForHolding,
  isAnnuityContractHolding,
  normalizeAnnuityContractFromStorage,
  type AnnuityIndexingStrategyDisplay,
} from "@/lib/annuity-contract-types";
import { brokerageFinancialInstitutionLabel } from "@/lib/crm/account-display";
import { holdingAllocationSleeveMeta } from "@/lib/allocation-display";
import type { ClientDetail } from "@/lib/crm/types";
import type { UiHolding } from "@/lib/saved-review-normalize";

export type AccountHoldingRow = {
  id: string;
  label: string;
  valueUsd: number;
  pctOfAccount: number;
  rowBg: string;
  sleeveColor: string;
  indexingStrategies: AnnuityIndexingStrategyDisplay[];
};

export type AccountGroup = {
  accountNumber: string;
  /** Brokerage custodian when known (e.g. Schwab); null for annuity-only accounts. */
  financialInstitutionLabel: string | null;
  annuityTypeCarrierLabel: string | null;
  registrationType: string;
  totalValue: number;
  holdingCount: number;
  holdings: AccountHoldingRow[];
};

export function buildAccountGroups(client: ClientDetail): AccountGroup[] {
  const map = new Map<
    string,
    { registrationType: string; holdings: UiHolding[]; totalValue: number }
  >();

  for (const h of client.holdings) {
    const acct = accountKeyForHolding(h);
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
          label: accountHoldingLabel(h),
          valueUsd,
          pctOfAccount: row.totalValue > 0 ? (valueUsd / row.totalValue) * 100 : 0,
          rowBg: sleeve.rowBg,
          sleeveColor: sleeve.color,
          indexingStrategies: isAnnuityContractHolding(h)
            ? annuityIndexingStrategyDisplaysForHolding(h)
            : [],
        };
      })
      .sort((a, b) => b.valueUsd - a.valueUsd);

    groups.push({
      accountNumber,
      financialInstitutionLabel: brokerageFinancialInstitutionLabel(row.holdings),
      annuityTypeCarrierLabel: annuityAccountTypeCarrierLabel(row.holdings),
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

function accountHoldingLabel(h: UiHolding): string {
  if (isAnnuityContractHolding(h)) {
    const product = normalizeAnnuityContractFromStorage(h.annuityContract)?.productName?.trim();
    if (product) return product;
  }
  return holdingLabel(h);
}

function humanizeRegistration(raw: string | null): string {
  if (!raw) return "Unknown registration";
  const cleaned = raw.replace(/_/g, " ").trim();
  if (!cleaned) return "Unknown registration";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
