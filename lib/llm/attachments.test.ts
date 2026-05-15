/**
 * Unit tests for the intake-layer normalization. Two suites:
 *
 *   1. `normalizeAttachment` integration — magic-byte sniff, size cap,
 *      format rejection. Uses raw bytes, no pdf-lib round-trip.
 *   2. `buildTextLayerContext` — text-layer shaping (multi-account hint,
 *      clipping). Fed canned text so it doesn't depend on a real PDF reader.
 *
 * pdf-parse's behavior on synthetic pdf-lib output is too fragile to rely on
 * in unit tests; we exercise that integration manually + via the eval suite.
 */

import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { enforceUploadSize, normalizeAttachment } from "./attachments";
import { LlmAttachmentError } from "./types";
import {
  buildTextLayerContext,
  collectAccountNumbers,
  countEndingValues,
} from "./pdf-text-context";

/** 1×1 transparent PNG (below the 520px short-edge preflight threshold). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// ─── enforceUploadSize ────────────────────────────────────────────────────────

describe("enforceUploadSize", () => {
  it("accepts files under the cap", () => {
    expect(() => enforceUploadSize(1024, "small.pdf")).not.toThrow();
  });

  it("rejects files over the cap with an LlmAttachmentError", () => {
    const overcap = 26 * 1024 * 1024;
    expect(() => enforceUploadSize(overcap, "huge.pdf")).toThrowError(LlmAttachmentError);
  });

  it("honors LLM_MAX_UPLOAD_BYTES env override", () => {
    const original = process.env.LLM_MAX_UPLOAD_BYTES;
    try {
      process.env.LLM_MAX_UPLOAD_BYTES = "2048";
      expect(() => enforceUploadSize(1024, "ok.pdf")).not.toThrow();
      expect(() => enforceUploadSize(4096, "too-big.pdf")).toThrowError(LlmAttachmentError);
    } finally {
      if (original === undefined) delete process.env.LLM_MAX_UPLOAD_BYTES;
      else process.env.LLM_MAX_UPLOAD_BYTES = original;
    }
  });
});

// ─── normalizeAttachment — magic-byte sniff ───────────────────────────────────

describe("normalizeAttachment — magic-byte sniff", () => {
  it("rejects HTML mislabeled as PDF", async () => {
    const html = Buffer.from(
      "<!doctype html><html><body>not a pdf</body></html>",
      "utf8"
    );
    await expect(
      normalizeAttachment({ bytes: html, mime: "application/pdf", fileName: "fake.pdf" })
    ).rejects.toThrow(LlmAttachmentError);
  });

  it("rejects unknown binary formats", async () => {
    const blob = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    await expect(
      normalizeAttachment({ bytes: blob, mime: "application/zip", fileName: "weird.zip" })
    ).rejects.toThrow(LlmAttachmentError);
  });

  it("rejects PNG that's below the dimension preflight threshold", async () => {
    await expect(
      normalizeAttachment({ bytes: PNG_1PX, mime: "image/png", fileName: "tiny.png" })
    ).rejects.toThrow(/too low quality/i);
  });

  it("rejects truncated bytes", async () => {
    await expect(
      normalizeAttachment({ bytes: Buffer.from("ab"), mime: "application/pdf", fileName: "x.pdf" })
    ).rejects.toThrow(LlmAttachmentError);
  });

  it("rejects oversized uploads before any other work", async () => {
    const original = process.env.LLM_MAX_UPLOAD_BYTES;
    try {
      process.env.LLM_MAX_UPLOAD_BYTES = "2048";
      const oversized = Buffer.alloc(4096, 0);
      await expect(
        normalizeAttachment({ bytes: oversized, mime: "application/pdf", fileName: "big.pdf" })
      ).rejects.toThrow(LlmAttachmentError);
    } finally {
      if (original === undefined) delete process.env.LLM_MAX_UPLOAD_BYTES;
      else process.env.LLM_MAX_UPLOAD_BYTES = original;
    }
  });

});

// ─── buildTextLayerContext / collectAccountNumbers ────────────────────────────

describe("collectAccountNumbers", () => {
  it("finds unique account numbers in any order", () => {
    const text = `
Account Number: ****1111
Some stuff here
Account Number: ****2222
Other stuff
Account Number: ****1111
`;
    expect(collectAccountNumbers(text)).toEqual(["****1111", "****2222"]);
  });

  it("returns empty when no account numbers are present", () => {
    expect(collectAccountNumbers("nothing here")).toEqual([]);
  });

  it("is case-insensitive on the label", () => {
    expect(collectAccountNumbers("account number: 9999")).toEqual(["9999"]);
  });
});

describe("countEndingValues", () => {
  it("counts printed ending-account totals", () => {
    const text = "Ending Account Value: $12,345.67\nlater\nEnding Account Value: $1.00";
    expect(countEndingValues(text)).toBe(2);
  });

  it("requires the dollar formatting", () => {
    expect(countEndingValues("Ending Account Value: maybe")).toBe(0);
  });
});

describe("buildTextLayerContext", () => {
  it("emits the multi-account hint when 2+ Account Numbers are present", () => {
    const text =
      "Account Number: ****1111\nMkt Val $100.00\nAccount Number: ****2222\nMkt Val $200.00";
    const ctx = buildTextLayerContext(text, false);
    expect(ctx.accountCount).toBe(2);
    expect(ctx.multiAccountHint).toContain("MULTI-ACCOUNT DOCUMENT");
    expect(ctx.multiAccountHint).toContain("****1111");
    expect(ctx.multiAccountHint).toContain("****2222");
  });

  it("emits no multi-account hint for single-account text", () => {
    const text = "Account Number: ****1111\nMkt Val $100.00";
    const ctx = buildTextLayerContext(text, false);
    expect(ctx.accountCount).toBe(1);
    expect(ctx.multiAccountHint).toBe("");
  });

  it("clips long text head + tail when not physically sliced", () => {
    const big = "X".repeat(200_000);
    const ctx = buildTextLayerContext(big, false);
    expect(ctx.clippedText.length).toBeLessThan(big.length);
    expect(ctx.clippedText).toContain("omitted");
  });

  it("does NOT clip when the PDF was physically sliced upstream", () => {
    const big = "X".repeat(200_000);
    const ctx = buildTextLayerContext(big, true);
    expect(ctx.clippedText.length).toBe(big.length);
  });
});
