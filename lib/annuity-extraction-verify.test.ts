import { describe, expect, it } from "vitest";
import {
  assertAnnuityContractsReconcile,
  extractPrintedAnnuityTotalsFromEmbeddedPdfText,
} from "@/lib/annuity-extraction-verify";

describe("annuity-extraction-verify", () => {
  it("parses contract value anchors from PDF text", () => {
    const totals = extractPrintedAnnuityTotalsFromEmbeddedPdfText(
      "Contract Value: $250,000.00\nAccumulation Value: $250,000.00"
    );
    expect(totals.length).toBeGreaterThan(0);
    expect(totals[0]).toBe(250_000);
  });

  it("passes when contract sum matches printed total", () => {
    expect(() =>
      assertAnnuityContractsReconcile({
        contracts: [{ currentValue: 250_000 }],
        embeddedPdfText: "Contract Value: $250,000.00",
      })
    ).not.toThrow();
  });

  it("throws when totals diverge", () => {
    expect(() =>
      assertAnnuityContractsReconcile({
        contracts: [{ currentValue: 100_000 }],
        embeddedPdfText: "Contract Value: $250,000.00",
      })
    ).toThrow();
  });

  it("allows single contract without anchors", () => {
    expect(() =>
      assertAnnuityContractsReconcile({
        contracts: [{ currentValue: 100_000 }],
        embeddedPdfText: null,
      })
    ).not.toThrow();
  });
});
