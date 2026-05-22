"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ADD_AS_NEW_RESOLUTION,
  type AccountMatchResult,
  type AccountRefreshResolution,
  UNLABELED_ACCOUNT_KEY,
} from "@/lib/crm/merge-account-holdings";
import {
  externalAccountDisplayLabel,
  isExternalAccountNumber,
  isUnknownAccountNumber,
  unknownAccountDisplayLabel,
} from "@/lib/crm/move-account";
import {
  financialInstitutionForAccountKey,
  formatAccountHeaderLabel,
} from "@/lib/crm/account-display";
import type { UiHolding } from "@/lib/saved-review-normalize";

function accountLabel(key: string, holdings: UiHolding[]): string {
  if (key === UNLABELED_ACCOUNT_KEY) return "No account on statement";
  if (isUnknownAccountNumber(key)) return unknownAccountDisplayLabel();
  if (isExternalAccountNumber(key)) return externalAccountDisplayLabel(key);
  return (
    formatAccountHeaderLabel(key, financialInstitutionForAccountKey(holdings, key)) ||
    key
  );
}

export function AccountRefreshMappingPanel({
  matchResults,
  existingAccountKeys,
  existingHoldings = [],
  initialResolutions,
  onConfirm,
  onCancel,
}: {
  matchResults: AccountMatchResult[];
  existingAccountKeys: string[];
  existingHoldings?: UiHolding[];
  initialResolutions: AccountRefreshResolution[];
  onConfirm: (resolutions: AccountRefreshResolution[]) => void;
  onCancel: () => void;
}) {
  const [resolutions, setResolutions] = useState<AccountRefreshResolution[]>(initialResolutions);

  const targetOptions = useMemo(() => {
    const opts = existingAccountKeys.map((key) => ({
      value: key,
      label: `Replace: ${accountLabel(key, existingHoldings)}`,
    }));
    opts.push({ value: ADD_AS_NEW_RESOLUTION, label: "Add as new account (keep existing)" });
    return opts;
  }, [existingAccountKeys, existingHoldings]);

  return (
    <div
      className="rounded-none border border-amber-200 bg-amber-50/90 p-5 md:p-6"
      role="region"
      aria-labelledby="account-refresh-mapping-title"
    >
      <h3
        id="account-refresh-mapping-title"
        className="font-serif text-xl font-semibold text-blue-950"
      >
        Confirm account mapping
      </h3>
      <p className="mt-2 text-sm text-slate-700">
        Match each account from the new statement to an existing account to replace, or add as new.
        Other accounts on this client are not changed.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-amber-200/80 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <th className="py-2 pr-3">From statement</th>
              <th className="py-2 pr-3">Positions</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {matchResults.map((row) => {
              const resolution = resolutions.find((r) => r.extractedKey === row.extractedKey);
              const target = resolution?.targetExistingKey ?? ADD_AS_NEW_RESOLUTION;
              return (
                <tr key={row.extractedKey} className="border-b border-amber-100/80">
                  <td className="py-3 pr-3 font-medium text-slate-900">
                    {accountLabel(row.extractedKey, row.extractedHoldings)}
                  </td>
                  <td className="py-3 pr-3 tabular-nums text-slate-600">
                    {row.extractedHoldings.length}
                  </td>
                  <td className="py-3">
                    <select
                      className="w-full max-w-md bg-white px-2 py-1.5 text-[13px] focus:outline-none"
                      style={{ border: "1px solid var(--ap-border, #cbd5e1)" }}
                      value={target}
                      onChange={(e) => {
                        const next = e.target.value;
                        setResolutions((prev) =>
                          prev.map((r) =>
                            r.extractedKey === row.extractedKey
                              ? { extractedKey: row.extractedKey, targetExistingKey: next }
                              : r
                          )
                        );
                      }}
                    >
                      {targetOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="rounded-none" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          className="rounded-none ap-cta-solid"
          onClick={() => onConfirm(resolutions)}
        >
          Apply and review holdings
        </Button>
      </div>
    </div>
  );
}
