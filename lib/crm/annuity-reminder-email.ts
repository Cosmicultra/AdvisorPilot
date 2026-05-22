/**
 * Deterministic client emails for annuity reallocation / maturity reminders (no LLM).
 */

import {
  annuityIndexingStrategyDisplaysForHolding,
  isAnnuityContractHolding,
  normalizeAnnuityContractFromStorage,
} from "@/lib/annuity-contract-types";
import { formatClientEmailBody } from "@/lib/crm/dripper-email-greeting";
import type { UiHolding } from "@/lib/saved-review-normalize";

export type AnnuityReminderKind = "reallocation" | "maturity";

export interface AnnuityReminderEmailInput {
  clientFirstName: string;
  kind: AnnuityReminderKind;
  carrierName: string;
  holding: UiHolding;
}

export interface AnnuityReminderEmailContent {
  subject: string;
  plainBody: string;
}

export function formatAnnuityContractValueUsd(holding: UiHolding): string | null {
  const contract = normalizeAnnuityContractFromStorage(holding.annuityContract);
  const fromHolding = Number(holding.value);
  const value =
    Number.isFinite(fromHolding) && fromHolding > 0
      ? fromHolding
      : contract?.currentValue;
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function strategyNamesPhrase(holding: UiHolding): string {
  const displays = annuityIndexingStrategyDisplaysForHolding(holding);
  if (!displays.length) return "your current contract allocation";
  const names = displays.map((d) => d.strategyName).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function valueSentence(formatted: string | null): string {
  if (!formatted) return "";
  return `Your contract's current value is ${formatted}. `;
}

export function buildAnnuityReminderEmail(
  input: AnnuityReminderEmailInput
): AnnuityReminderEmailContent {
  const firstName = input.clientFirstName.trim() || "there";
  const carrier = input.carrierName.trim() || "your carrier";
  const value = formatAnnuityContractValueUsd(input.holding);
  const valuePart = valueSentence(value);
  const strategies = strategyNamesPhrase(input.holding);

  let body: string;
  let subject: string;

  if (input.kind === "reallocation") {
    subject = `Reallocation window coming up - ${carrier}`;
    body = [
      "We are coming up on your contract reallocation window in the next 30 days.",
      "Would you like to book a time on my calendar for a quick 15-20 minute call about your reallocation?",
      `${valuePart}You are currently invested in ${strategies}.`,
      "We can review whether those strategies are still the best options moving forward.",
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    subject = `Annuity maturity in 30 days - ${carrier}`;
    body = [
      `You are about 30 days from the maturity date on your annuity contract with ${carrier}.`,
      `${valuePart}Let's set up a time to review what our next strategy should be for reinvestment.`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    subject,
    plainBody: formatClientEmailBody(firstName, body),
  };
}

/** @deprecated Use isAnnuityContractHolding — kept for server runner imports. */
export function isAnnuityReminderHolding(h: UiHolding): boolean {
  return isAnnuityContractHolding(h);
}
