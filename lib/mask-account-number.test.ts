import { describe, expect, it } from "vitest";
import { maskAccountNumberDisplay } from "./mask-account-number";

describe("maskAccountNumberDisplay", () => {
  it("masks Schwab-style prefixed account numbers", () => {
    expect(maskAccountNumberDisplay("BRK-9914-5502")).toBe("BRK-****-5502");
    expect(maskAccountNumberDisplay("IRA-4827-1945")).toBe("IRA-****-1945");
    expect(maskAccountNumberDisplay("401K-2281-7710")).toBe("401K-****-7710");
  });

  it("masks bare numeric ids", () => {
    expect(maskAccountNumberDisplay("1234567890")).toBe("****7890");
  });

  it("keeps short ids when four or fewer digits", () => {
    expect(maskAccountNumberDisplay("5502")).toBe("5502");
    expect(maskAccountNumberDisplay("BRK-5502")).toBe("BRK-5502");
  });

  it("normalizes already-masked values idempotently", () => {
    expect(maskAccountNumberDisplay("****023")).toBe("****023");
    expect(maskAccountNumberDisplay("BRK-****-5502")).toBe("BRK-****-5502");
  });

  it("preserves word labels before digits", () => {
    expect(maskAccountNumberDisplay("Brokerage Account 1234567890")).toBe("Brokerage Account ****7890");
    expect(maskAccountNumberDisplay("Roth IRA 9876543210")).toBe("Roth IRA ****3210");
  });

  it("returns empty and non-numeric labels unchanged", () => {
    expect(maskAccountNumberDisplay("")).toBe("");
    expect(maskAccountNumberDisplay("Same statement (no explicit account)")).toBe(
      "Same statement (no explicit account)"
    );
  });
});
