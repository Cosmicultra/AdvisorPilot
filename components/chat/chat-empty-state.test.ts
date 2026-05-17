/**
 * Tests for the pure `suggestedPrompts` helper that drives the chat
 * empty-state copy. The component itself is exercised in the chat
 * widget end-to-end; this file pins the prompt-selection contract.
 */

import { describe, expect, it } from "vitest";
import { suggestedPrompts } from "./chat-empty-state";

describe("suggestedPrompts (PR 23)", () => {
  it("returns advisor-wide prompts when no client is in focus", () => {
    const prompts = suggestedPrompts(null);
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(prompts.length).toBeLessThanOrEqual(6);
    // Spot-check a few signature prompts so a wording tweak that
    // breaks the contract surfaces here.
    expect(prompts.some((p) => /AUM.*by stage/i.test(p))).toBe(true);
    expect(prompts.some((p) => /overdue for review/i.test(p))).toBe(true);
  });

  it("interpolates the client name into client-scoped prompts", () => {
    const prompts = suggestedPrompts("Jane Doe");
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    for (const p of prompts) {
      expect(p).toContain("Jane Doe");
    }
  });

  it("does NOT include client-scoped wording when there is no client", () => {
    const prompts = suggestedPrompts(null);
    for (const p of prompts) {
      // None of the advisor-wide prompts should reference a specific
      // client name template variable.
      expect(p).not.toMatch(/<client>|\{client\}|\$\{/);
    }
  });
});
