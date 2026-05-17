import { describe, expect, it } from "vitest";
import {
  closeOpenFences,
  CUSTOM_BLOCK_LANGUAGES,
  detectOpenFence,
  hasIncompleteCodeBlock,
  isCustomBlockLanguage,
  splitAtIncompleteFence,
} from "./fence-tokenizer";

/**
 * Fence-tokenizer tests.
 *
 *   1. detectOpenFence returns null for clean markdown
 *   2. detectOpenFence captures the language of an open fence
 *   3. detectOpenFence ignores already-closed pairs
 *   4. Mixed: one closed pair + a new unclosed fence
 *   5. closeOpenFences is a no-op when complete
 *   6. closeOpenFences synthesizes the closing fence
 *   7. splitAtIncompleteFence carves the safe prefix off
 *   8. splitAtIncompleteFence returns full input + null when complete
 *   9. isCustomBlockLanguage gates correctly
 *  10. Edge: fence at very beginning, fence at very end with no content
 *  11. Edge: fence with no language tag (just ```)
 */

describe("detectOpenFence", () => {
  it("returns null when there are no fences", () => {
    expect(detectOpenFence("Just some prose.\nNo code blocks here.")).toBeNull();
  });

  it("returns null when every fence is closed", () => {
    const md = "Before\n\n```js\nconsole.log(1);\n```\n\nAfter.";
    expect(detectOpenFence(md)).toBeNull();
  });

  it("returns the open language tag when a fence is unclosed", () => {
    const md = "Intro\n\n```chart:chartjs\n{\"type\":\"bar\"";
    expect(detectOpenFence(md)).toBe("chart:chartjs");
  });

  it("returns '' when the open fence has no language tag", () => {
    const md = "Intro\n\n```\nsome content";
    expect(detectOpenFence(md)).toBe("");
  });

  it("tracks closed + reopen pattern correctly", () => {
    const md = "```js\nconsole.log(1);\n```\n\nMid-text\n\n```chart:chartjs\n{";
    expect(detectOpenFence(md)).toBe("chart:chartjs");
  });

  it("ignores fence-looking text mid-line (only line-leading ``` count)", () => {
    const md = "Hello `inline` and even something like  ```not a fence``` here.";
    expect(detectOpenFence(md)).toBeNull();
  });
});

describe("hasIncompleteCodeBlock", () => {
  it("delegates to detectOpenFence", () => {
    expect(hasIncompleteCodeBlock("plain text")).toBe(false);
    expect(hasIncompleteCodeBlock("```\nhi")).toBe(true);
  });
});

describe("closeOpenFences", () => {
  it("leaves complete markdown untouched", () => {
    const md = "Before\n```js\nx\n```\nAfter";
    expect(closeOpenFences(md)).toBe(md);
  });

  it("appends a closing fence when one is missing (with newline guard)", () => {
    expect(closeOpenFences("```js\nx")).toBe("```js\nx\n```");
    expect(closeOpenFences("```js\nx\n")).toBe("```js\nx\n```");
  });
});

describe("splitAtIncompleteFence", () => {
  it("returns the full input + null when nothing's pending", () => {
    const md = "Hello world.\n\n```js\nx\n```\nDone.";
    expect(splitAtIncompleteFence(md)).toEqual({ complete: md, inFlight: null });
  });

  it("splits at the line that opened the unfinished fence", () => {
    const md = "Header\n\nBefore the chart\n```chart:chartjs\n{\"type\":\"bar\"";
    const out = splitAtIncompleteFence(md);
    expect(out.inFlight).toBe("chart:chartjs");
    expect(out.complete).toBe("Header\n\nBefore the chart");
  });

  it("works when the open fence is the very first line", () => {
    const md = "```chart:chartjs\n{\"type\":";
    const out = splitAtIncompleteFence(md);
    expect(out.complete).toBe("");
    expect(out.inFlight).toBe("chart:chartjs");
  });

  it("handles a complete fence followed by an in-flight one", () => {
    const md =
      "Intro\n\n```js\nconsole.log(1);\n```\n\nAfter\n\n```chart:chartjs\n{";
    const out = splitAtIncompleteFence(md);
    expect(out.inFlight).toBe("chart:chartjs");
    expect(out.complete).toBe(
      "Intro\n\n```js\nconsole.log(1);\n```\n\nAfter\n",
    );
  });
});

describe("isCustomBlockLanguage", () => {
  it("accepts shipped custom languages", () => {
    expect(isCustomBlockLanguage("chart:chartjs")).toBe(true);
    expect(isCustomBlockLanguage("mermaid")).toBe(true);
    expect(isCustomBlockLanguage("chart:echarts")).toBe(true);
  });

  it("rejects unknown languages (incl. close calls)", () => {
    expect(isCustomBlockLanguage("chart:plotly")).toBe(false);
    expect(isCustomBlockLanguage("typescript")).toBe(false);
    expect(isCustomBlockLanguage("")).toBe(false);
  });

  it("exports the registry array publicly", () => {
    expect(CUSTOM_BLOCK_LANGUAGES).toContain("chart:chartjs");
    expect(CUSTOM_BLOCK_LANGUAGES).toContain("mermaid");
    expect(CUSTOM_BLOCK_LANGUAGES).toContain("chart:echarts");
  });
});
