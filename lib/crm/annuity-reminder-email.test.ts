import { describe, expect, it } from "vitest";
import { emptyFiaWorksheet } from "@/lib/fia-worksheet";
import type { UiHolding } from "@/lib/saved-review-normalize";
import {
  buildAnnuityReminderEmail,
  formatAnnuityContractValueUsd,
} from "./annuity-reminder-email";

function annuityHolding(overrides: Partial<UiHolding> = {}): UiHolding {
  return {
    rawName: "Athene — Allocation",
    suggested: "****7890",
    confidence: 90,
    assetClass: "Annuity",
    value: 425000,
    status: "matched",
    options: [],
    documentKind: "annuity",
    annuityContract: {
      contractNumber: "1234567890",
      carrierName: "Athene",
      qualifiedStatus: "qualified",
      productName: "Allocation",
      contractType: "fia",
      issueDate: "01/01/2024",
      maturityDate: "01/01/2029",
      currentValue: 425000,
      initialPremium: 400000,
      surrenderValue: 410000,
      indexingStrategies: [
        { name: "S&P 500 Point-to-Point" },
        { name: "Fixed Account" },
      ],
    },
    ...overrides,
  };
}

describe("annuity-reminder-email", () => {
  it("formatAnnuityContractValueUsd uses commas", () => {
    expect(formatAnnuityContractValueUsd(annuityHolding())).toBe("$425,000");
    expect(formatAnnuityContractValueUsd(annuityHolding({ value: 1234567 }))).toBe(
      "$1,234,567"
    );
  });

  it("reallocation email includes value and strategy names", () => {
    const { plainBody, subject } = buildAnnuityReminderEmail({
      clientFirstName: "Jane",
      kind: "reallocation",
      carrierName: "Athene",
      holding: annuityHolding(),
    });
    expect(subject).toBe("Reallocation window coming up - Athene");
    expect(subject).not.toMatch(/[^\x00-\x7F]/);
    expect(plainBody).toContain("Hi Jane,");
    expect(plainBody).toContain("$425,000");
    expect(plainBody).toContain("S&P 500 Point-to-Point");
  });

  it("maturity subject uses ASCII hyphen only", () => {
    const { subject } = buildAnnuityReminderEmail({
      clientFirstName: "Bob",
      kind: "maturity",
      carrierName: "Athene Annuity and Life Company",
      holding: annuityHolding(),
    });
    expect(subject).toBe("Annuity maturity in 30 days - Athene Annuity and Life Company");
    expect(subject).not.toMatch(/[^\x00-\x7F]/);
  });

  it("maturity email includes carrier and value", () => {
    const { plainBody } = buildAnnuityReminderEmail({
      clientFirstName: "Bob",
      kind: "maturity",
      carrierName: "Allianz",
      holding: annuityHolding({
        annuityContract: {
          ...annuityHolding().annuityContract!,
          carrierName: "Allianz",
        },
      }),
    });
    expect(plainBody).toContain("Allianz");
    expect(plainBody).toContain("$425,000");
    expect(plainBody).toContain("reinvestment");
  });

  it("MYGA without strategies uses allocation fallback", () => {
    const ws = emptyFiaWorksheet();
    ws.carrierName = "Carrier";
    const { plainBody } = buildAnnuityReminderEmail({
      clientFirstName: "Sam",
      kind: "reallocation",
      carrierName: "Carrier",
      holding: annuityHolding({
        value: 100000,
        annuityContract: {
          contractNumber: "1",
          carrierName: "Carrier",
          qualifiedStatus: "qualified",
          productName: "MYGA",
          contractType: "myga",
          issueDate: "2024-01-01",
          currentValue: 100000,
          initialPremium: 100000,
          surrenderValue: 98000,
          indexingStrategies: [],
        },
      }),
    });
    expect(plainBody).toContain("current contract allocation");
  });
});
