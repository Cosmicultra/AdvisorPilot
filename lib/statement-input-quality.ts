import { PDFDocument } from "pdf-lib";

/** User-visible message when pixels/resolution are insufficient or format is unreadable. */
export const STATEMENT_FILE_TOO_LOW_QUALITY =
  "This file is too low quality to read. Upload a clearer scan or an electronic PDF exported from your custodian.";

export const STATEMENT_PDF_CORRUPT_OR_UNSUPPORTED =
  "This PDF could not be opened. Export the statement again from your custodian.";

/** Minimum shorter edge for raster uploads (photos/screenshots). */
const MIN_IMAGE_SHORT_EDGE_PX = 520;

export function readRasterImageDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;

  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = bytes.readUInt16BE(offset + 5);
        const width = bytes.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segLen = bytes.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }

  return null;
}

/**
 * Fast structural checks before calling the model: corrupt PDFs, tiny/unreadable raster images.
 */
export async function assertStatementFileReadable(params: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<void> {
  const { bytes, mimeType } = params;
  if (!bytes?.length) {
    throw new Error(STATEMENT_FILE_TOO_LOW_QUALITY);
  }

  const m = mimeType.toLowerCase();

  if (m.includes("pdf")) {
    try {
      await PDFDocument.load(bytes, { ignoreEncryption: false });
    } catch {
      throw new Error(STATEMENT_PDF_CORRUPT_OR_UNSUPPORTED);
    }
    return;
  }

  if (m.includes("image")) {
    const dims = readRasterImageDimensions(bytes);
    if (!dims) {
      throw new Error(STATEMENT_FILE_TOO_LOW_QUALITY);
    }
    const shortEdge = Math.min(dims.width, dims.height);
    if (shortEdge < MIN_IMAGE_SHORT_EDGE_PX) {
      throw new Error(STATEMENT_FILE_TOO_LOW_QUALITY);
    }
  }
}
