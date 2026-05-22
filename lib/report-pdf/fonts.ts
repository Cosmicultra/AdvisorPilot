import fs from "fs/promises";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

export type ReportPdfFonts = {
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
  serifItalic: PDFFont;
  mono: PDFFont;
  monoMedium: PDFFont;
};

async function readFontFile(filename: string): Promise<Uint8Array> {
  const fontPath = path.join(process.cwd(), "public", "fonts", filename);
  const buf = await fs.readFile(fontPath);
  return new Uint8Array(buf);
}

/**
 * Embed Playfair Display + IBM Plex for portfolio snapshot / deep dive PDFs.
 * Requires `public/fonts/*.ttf` (OFL) and `@pdf-lib/fontkit`.
 */
export async function embedReportPdfFonts(pdfDoc: PDFDocument): Promise<ReportPdfFonts> {
  pdfDoc.registerFontkit(fontkit);

  const [
    sansBytes,
    sansBoldBytes,
    serifBytes,
    serifItalicBytes,
    monoBytes,
    monoMediumBytes,
  ] = await Promise.all([
    readFontFile("IBMPlexSans-Regular.ttf"),
    readFontFile("IBMPlexSans-SemiBold.ttf"),
    readFontFile("PlayfairDisplay-Regular.ttf"),
    readFontFile("PlayfairDisplay-Italic.ttf"),
    readFontFile("IBMPlexMono-Regular.ttf"),
    readFontFile("IBMPlexMono-Medium.ttf"),
  ]);

  const [sans, sansBold, serif, serifItalic, mono, monoMedium] = await Promise.all([
    pdfDoc.embedFont(sansBytes),
    pdfDoc.embedFont(sansBoldBytes),
    pdfDoc.embedFont(serifBytes),
    pdfDoc.embedFont(serifItalicBytes),
    pdfDoc.embedFont(monoBytes),
    pdfDoc.embedFont(monoMediumBytes),
  ]);

  return { sans, sansBold, serif, serifItalic, mono, monoMedium };
}
