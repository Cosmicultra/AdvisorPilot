import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as null | { accessToken?: string },
  token: null as null | { accessToken?: string; refreshToken?: string },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mocks.session),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(async () => mocks.token),
}));

vi.mock("@/app/api/auth/[...nextauth]/route", () => ({
  authOptions: {},
}));

describe("isGmailConnected", () => {
  beforeEach(() => {
    mocks.session = null;
    mocks.token = null;
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  it("returns true when session has accessToken", async () => {
    mocks.session = { accessToken: "at" };
    const { isGmailConnected } = await import("./gmail-connection");
    await expect(isGmailConnected()).resolves.toBe(true);
  });

  it("returns true when JWT has refreshToken", async () => {
    mocks.token = { refreshToken: "rt" };
    const { isGmailConnected } = await import("./gmail-connection");
    await expect(isGmailConnected(new Request("https://app.test"))).resolves.toBe(true);
  });

  it("returns false when neither token is present", async () => {
    const { isGmailConnected } = await import("./gmail-connection");
    await expect(isGmailConnected(new Request("https://app.test"))).resolves.toBe(false);
  });
});
