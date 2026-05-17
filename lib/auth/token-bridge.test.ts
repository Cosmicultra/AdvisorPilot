/**
 * Tests for the pure helpers backing the cross-tab token bridge.
 *
 * The runtime pieces (`mountTokenResponder`, `requestTokenFromOtherTabs`)
 * require sessionStorage + BroadcastChannel + MessageEvent, none of
 * which exist in this repo's node-environment Vitest setup, and the
 * project doesn't ship a DOM test renderer. We verify the contracts
 * those helpers depend on — message-shape guards and id generation —
 * here, and the end-to-end behavior is verified by hand in the browser
 * (print tab against the running app).
 *
 * If we ever pull in jsdom for component-level tests, this file can be
 * expanded to cover the full request → respond → write-to-storage cycle
 * the way the bridge documentation describes.
 */

import { describe, it, expect } from "vitest";
import {
  generateRequestId,
  isRequestMessage,
  isResponseMessage,
} from "./token-bridge";

describe("isRequestMessage", () => {
  it("accepts a well-formed request_token message", () => {
    expect(isRequestMessage({ type: "request_token", requestId: "abc-123" })).toBe(true);
  });

  it("rejects messages with the wrong type tag", () => {
    expect(isRequestMessage({ type: "token_response", requestId: "x" })).toBe(false);
    expect(isRequestMessage({ type: "something_else", requestId: "x" })).toBe(false);
  });

  it("rejects messages missing the requestId field — a responder without an id has no way to route the reply", () => {
    expect(isRequestMessage({ type: "request_token" })).toBe(false);
  });

  it("rejects messages whose requestId is not a string (defense against tampering / version drift)", () => {
    expect(isRequestMessage({ type: "request_token", requestId: 42 })).toBe(false);
    expect(isRequestMessage({ type: "request_token", requestId: null })).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isRequestMessage(null)).toBe(false);
    expect(isRequestMessage(undefined)).toBe(false);
    expect(isRequestMessage("request_token")).toBe(false);
    expect(isRequestMessage(42)).toBe(false);
  });
});

describe("isResponseMessage", () => {
  it("accepts a well-formed token_response message with a refresh token", () => {
    expect(
      isResponseMessage({
        type: "token_response",
        requestId: "abc",
        accessToken: "at",
        refreshToken: "rt",
      }),
    ).toBe(true);
  });

  it("accepts a token_response message with a null refresh token (Google-auth users don't have one)", () => {
    expect(
      isResponseMessage({
        type: "token_response",
        requestId: "abc",
        accessToken: "at",
        refreshToken: null,
      }),
    ).toBe(true);
  });

  it("rejects messages missing the access token — we never store half-set token pairs", () => {
    expect(
      isResponseMessage({ type: "token_response", requestId: "abc", refreshToken: "rt" }),
    ).toBe(false);
  });

  it("rejects messages with a non-string access token", () => {
    expect(
      isResponseMessage({
        type: "token_response",
        requestId: "abc",
        accessToken: 42,
        refreshToken: null,
      }),
    ).toBe(false);
  });

  it("rejects messages with the wrong type tag (a stray request_token can't mascarade as a response)", () => {
    expect(
      isResponseMessage({
        type: "request_token",
        requestId: "abc",
        accessToken: "at",
      }),
    ).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isResponseMessage(null)).toBe(false);
    expect(isResponseMessage(undefined)).toBe(false);
    expect(isResponseMessage("hello")).toBe(false);
  });
});

describe("generateRequestId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateRequestId()).toBe("string");
    expect(generateRequestId().length).toBeGreaterThan(0);
  });

  it("returns a distinct value on consecutive calls — otherwise concurrent print tabs could cross-talk", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(generateRequestId());
    }
    expect(seen.size).toBe(50);
  });
});
