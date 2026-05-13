import { describe, expect, it } from "vitest";
import { hasUsablePdfTextLayer } from "./extract-pdf-text-layer";

describe("hasUsablePdfTextLayer", () => {
  it("rejects empty or whitespace", () => {
    expect(hasUsablePdfTextLayer(null)).toBe(false);
    expect(hasUsablePdfTextLayer("")).toBe(false);
    expect(hasUsablePdfTextLayer("   \n\t ")).toBe(false);
  });

  it("rejects trivial / image-PDF noise", () => {
    expect(hasUsablePdfTextLayer("\n\n\n")).toBe(false);
  });

  it("accepts substantial broker-style text", () => {
    const blob =
      "SCHWAB ACCOUNT ... HOLDINGS ABC123 ENDING VALUE $5,900,491.78 WBA PLTR MARKET VALUE $1,234.56 " +
      "x".repeat(40);
    expect(hasUsablePdfTextLayer(blob)).toBe(true);
  });

  it("rejects short snippets without both letters and digits/$", () => {
    expect(hasUsablePdfTextLayer("hello".repeat(20))).toBe(false);
    expect(hasUsablePdfTextLayer("1234567890".repeat(20))).toBe(false);
  });
});
