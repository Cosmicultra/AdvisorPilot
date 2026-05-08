import { describe, expect, it } from "vitest";
import { deriveHoldingStatus } from "./holding-status";

describe("deriveHoldingStatus", () => {
  it("forces review when model says review even if confidence is high", () => {
    expect(deriveHoldingStatus("review", 90)).toBe("review");
  });
  it("forces review when confidence is low", () => {
    expect(deriveHoldingStatus("matched", 50)).toBe("review");
  });
  it("returns matched when model is matched and confidence is adequate", () => {
    expect(deriveHoldingStatus("matched", 80)).toBe("matched");
  });
});
