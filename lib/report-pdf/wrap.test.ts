import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { wrapLinesToWidth } from "./wrap";

async function helvetica() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

describe("wrapLinesToWidth", () => {
  it("wraps at word boundaries for normal prose", async () => {
    const font = await helvetica();
    const lines = wrapLinesToWidth(
      "The portfolio may experience larger swings than expected during market pullbacks.",
      font,
      10,
      200,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line).not.toMatch(/\s$/);
      expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(200 + 0.01);
    }
    const rejoined = lines.join(" ");
    expect(rejoined).toContain("portfolio");
    expect(rejoined).toContain("pullbacks");
  });

  it("does not split mid-word when a token exceeds max width", async () => {
    const font = await helvetica();
    const longToken = "Supercalifragilisticexpialidocious";
    const lines = wrapLinesToWidth(longToken, font, 10, 50);
    expect(lines).toEqual([longToken]);
    expect(lines[0]).toBe(longToken);
  });

  it("keeps oversized token on its own line after wrapping prior words", async () => {
    const font = await helvetica();
    const lines = wrapLinesToWidth("short Supercalifragilisticexpialidocious tail", font, 10, 80);
    const joined = lines.join("|");
    expect(joined).toContain("Supercalifragilisticexpialidocious");
    expect(lines.some((l) => l === "Supercalifragilisticexpialidocious")).toBe(true);
  });

  it("returns single empty line for empty input", async () => {
    const font = await helvetica();
    expect(wrapLinesToWidth("", font, 10, 200)).toEqual([""]);
  });
});
