import {
  isAnnuityContractHolding,
  normalizeAnnuityContractFromStorage,
} from "@/lib/annuity-contract-types";
import { upcomingAnnuityReminders, toDateKey } from "@/lib/crm/annuity-reminder-dates";
import type { AnnuityReminderKind } from "@/lib/crm/dripper-templates";
import type { UiHolding } from "@/lib/saved-review-normalize";

export type AnnuityReminderPreviewRow = {
  contractLabel: string;
  kind: AnnuityReminderKind;
  eventDate: string;
  remindDate: string;
};

export function buildAnnuityReminderPreview(
  holdings: UiHolding[],
  reminderKind: AnnuityReminderKind,
  limit = 6
): AnnuityReminderPreviewRow[] {
  const rows: AnnuityReminderPreviewRow[] = [];
  const today = new Date();

  for (const h of holdings) {
    if (!isAnnuityContractHolding(h)) continue;
    const contract = normalizeAnnuityContractFromStorage(h.annuityContract);
    if (!contract) continue;

    const label =
      [contract.carrierName, contract.productName].filter(Boolean).join(" — ") ||
      h.suggested ||
      h.rawName;

    const upcoming = upcomingAnnuityReminders(
      contract.issueDate,
      contract.maturityDate,
      today,
      {
        includeReallocation: reminderKind === "reallocation",
        includeMaturity: reminderKind === "maturity",
        limit: 3,
      }
    );

    for (const u of upcoming) {
      if (u.kind !== reminderKind) continue;
      rows.push({
        contractLabel: label,
        kind: u.kind,
        eventDate: toDateKey(u.eventDate),
        remindDate: toDateKey(u.remindDate),
      });
    }
  }

  return rows.sort((a, b) => a.remindDate.localeCompare(b.remindDate)).slice(0, limit);
}
