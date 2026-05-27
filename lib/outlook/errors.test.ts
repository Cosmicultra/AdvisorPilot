import { describe, expect, it } from "vitest";
import { outlookSendNeedsReconnect } from "./errors";

describe("outlookSendNeedsReconnect", () => {
  it("returns true for 401 status", () => {
    expect(outlookSendNeedsReconnect({ status: 401, message: "Unauthorized" })).toBe(true);
  });

  it("returns true for InvalidAuthenticationToken body", () => {
    expect(
      outlookSendNeedsReconnect({
        body: { error: { code: "InvalidAuthenticationToken", message: "Access token expired" } },
      })
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(outlookSendNeedsReconnect(new Error("Network timeout"))).toBe(false);
  });
});
