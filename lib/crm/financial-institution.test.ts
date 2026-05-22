import { describe, expect, it } from "vitest";
import {
  detectFinancialInstitutionFromText,
  stampFinancialInstitutionOnHoldings,
} from "./financial-institution";

describe("detectFinancialInstitutionFromText", () => {
  it("detects Schwab from PDF header text", () => {
    const text =
      "CHARLES SCHWAB & CO INC Account Summary Ending Account Value $1,234,567.89";
    expect(detectFinancialInstitutionFromText(text)).toBe("Schwab");
  });

  it("detects Fidelity from filename", () => {
    expect(detectFinancialInstitutionFromText(null, "fidelity_ira_statement_2024.pdf")).toBe(
      "Fidelity"
    );
  });

  it("returns null when no known custodian", () => {
    expect(detectFinancialInstitutionFromText("Generic Holdings Report", "report.pdf")).toBeNull();
  });
});

describe("stampFinancialInstitutionOnHoldings", () => {
  it("fills missing rows only", () => {
    const out = stampFinancialInstitutionOnHoldings(
      [
        { rawName: "A", financialInstitution: "Vanguard" },
        { rawName: "B" },
      ],
      "Schwab"
    );
    expect(out[0]?.financialInstitution).toBe("Vanguard");
    expect(out[1]?.financialInstitution).toBe("Schwab");
  });
});
