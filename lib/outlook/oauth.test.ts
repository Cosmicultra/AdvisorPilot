import { describe, expect, it, vi } from "vitest";

vi.mock("./token-store", () => ({
  loadOutlookRefreshToken: vi.fn(async () => null),
}));

describe("outlook oauth", () => {
  it("getOutlookAccessToken throws OutlookNotConnectedError when no token", async () => {
    const { getOutlookAccessToken, OutlookNotConnectedError } = await import("./oauth");
    await expect(getOutlookAccessToken("advisor@example.com")).rejects.toBeInstanceOf(
      OutlookNotConnectedError
    );
  });

  it("getOutlookAccessToken returns override without DB", async () => {
    const { getOutlookAccessToken } = await import("./oauth");
    const token = await getOutlookAccessToken("advisor@example.com", "session-token");
    expect(token).toBe("session-token");
  });
});
