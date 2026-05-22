import { describe, expect, it } from "vitest";

// Heuristic-only tests (no LLM) — import internal scoring via public API on embedded text path.
// We test by calling detectStatementDocumentKind with a mock attachment.

import type { Attachment } from "@/lib/llm/types";
import { detectStatementDocumentKind } from "@/lib/statement-document-kind";

function attachmentWithText(text: string): Attachment {
  return {
    kind: "pdf",
    bytes: Buffer.from(""),
    mime: "application/pdf",
    fileName: "test.pdf",
    hasTextLayer: true,
    textLayer: {
      fullText: text,
      clippedText: text,
      multiAccountHint: "",
      accountCount: 1,
    },
  };
}

describe("detectStatementDocumentKind heuristics", () => {
  it("classifies annuity carrier statements", async () => {
    const text = `
      Contract Number: 123456789
      Contract Value: $250,000.00
      Accumulation Value: $250,000.00
      Surrender Value: $235,000.00
      Income Base: $300,000.00
      Cap Rate: 9.25%
      Participation Rate: 100%
      Fixed Indexed Annuity
    `;
    const result = await detectStatementDocumentKind({
      attachment: attachmentWithText(text),
    });
    expect(result.documentKind).toBe("annuity");
    expect(result.method).toBe("heuristic");
  });

  it("classifies Schwab-style brokerage statements", async () => {
    const text = `
      Account Number: ****1234
      Ending Account Value: $350,000.00
      Positions
      CUSIP 037833100 AAPL Market Value $50,000.00
      Ticker VTI Shares 100 Mkt Val $25,000.00
    `;
    const result = await detectStatementDocumentKind({
      attachment: attachmentWithText(text),
    });
    expect(result.documentKind).toBe("brokerage");
    expect(result.method).toBe("heuristic");
  });

  it("defaults to brokerage when text is empty", async () => {
    const result = await detectStatementDocumentKind({
      attachment: {
        kind: "image",
        bytes: Buffer.from(""),
        mime: "image/jpeg",
        fileName: "scan.jpg",
        hasTextLayer: false,
      },
    });
    expect(result.documentKind).toBe("brokerage");
  });
});
