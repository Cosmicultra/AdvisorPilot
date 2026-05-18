import { describe, expect, it } from "vitest";
import {
  countMoneyDigitsBefore,
  formatMoneyInputDisplay,
  formatMoneyInputFromTyping,
  moneyCursorAfterDigits,
  parseMoneyInputRaw,
} from "./money-input";

describe("money-input", () => {
  it("parses and stores digits only", () => {
    expect(parseMoneyInputRaw("$185,432.50")).toBe("185432.50");
    expect(parseMoneyInputRaw("12.3456")).toBe("12.34");
    expect(formatMoneyInputFromTyping("$1,850")).toBe("1850");
  });

  it("formats with correct comma placement", () => {
    expect(formatMoneyInputDisplay("1850")).toBe("1,850");
    expect(formatMoneyInputDisplay("18500")).toBe("18,500");
    expect(formatMoneyInputDisplay("185000")).toBe("185,000");
    expect(formatMoneyInputDisplay("1850000")).toBe("1,850,000");
    expect(formatMoneyInputDisplay("185432.50")).toBe("185,432.50");
    expect(formatMoneyInputDisplay("185,000")).toBe("185,000");
  });

  it("preserves trailing decimal while typing", () => {
    expect(formatMoneyInputDisplay("185000.")).toBe("185,000.");
  });

  it("maps cursor position across comma formatting", () => {
    const display = "185,000";
    const digitsBefore = countMoneyDigitsBefore(display, 4);
    expect(digitsBefore).toBe(3);
    expect(moneyCursorAfterDigits(display, digitsBefore)).toBe(3);
    expect(moneyCursorAfterDigits("1,850", 2)).toBe(3);
    expect(moneyCursorAfterDigits("1,850", 4)).toBe(5);
  });
});
