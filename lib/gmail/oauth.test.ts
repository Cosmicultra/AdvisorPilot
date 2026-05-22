import { describe, expect, it, vi } from "vitest";

vi.mock("./token-store", () => ({
  loadGmailRefreshToken: vi.fn(async () => null),
}));

describe("gmail oauth", () => {
  it("getGmailAccessToken throws GmailNotConnectedError when no token", async () => {
    const { getGmailAccessToken, GmailNotConnectedError } = await import("./oauth");
    await expect(getGmailAccessToken("advisor@example.com")).rejects.toBeInstanceOf(
      GmailNotConnectedError
    );
  });

  it("getGmailAccessToken returns override without DB", async () => {
    const { getGmailAccessToken } = await import("./oauth");
    const token = await getGmailAccessToken("advisor@example.com", "session-token");
    expect(token).toBe("session-token");
  });
});
