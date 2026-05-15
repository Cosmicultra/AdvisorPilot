/**
 * Document & image intake layer.
 *
 * The single normalization point between "raw bytes arriving from upload
 * routes / queues" and "provider adapter sees a normalized Attachment."
 *
 * Responsibilities (§7 of docs/multi-provider-llm-plan.md):
 *
 *   1. Magic-byte MIME sniff → canonical MIME (rejects HTML-mislabeled-as-PDF).
 *   2. Hard size cap (LLM_MAX_UPLOAD_BYTES, default 25 MB).
 *   3. Existing structural preflight: corrupt PDF detection + image dimension
 *      / short-edge check.
 *   4. PDFs: page slicing by advisor hint (before any model work), text-layer
 *      extraction, multi-account hint pre-computation.
 *   5. Returns an `Attachment` shaped per `lib/llm/types.ts`. Provider
 *      adapters consume this and decide their own wire format
 *      (inline base64, Files API, rasterize for Grok in later PRs).
 *
 * Note: this layer intentionally does NOT call any provider SDK. It runs in
 * Node.js routes only; pure CPU/IO work.
 */

import { Buffer } from "buffer";
import { isLikelyPdf, tryExtractPdfText } from "../extract-pdf-text-layer";
import {
  assertStatementFileReadable,
  readRasterImageDimensions,
} from "../statement-input-quality";
import { expandHoldingsPageSpec, slicePdfBytesToPages } from "../holdings-page-spec";
import { buildTextLayerContext } from "./pdf-text-context";
import type { Attachment } from "./types";
import { LlmAttachmentError } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function maxUploadBytes(): number {
  const raw = process.env.LLM_MAX_UPLOAD_BYTES?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1024) return Math.floor(n);
  }
  return DEFAULT_MAX_UPLOAD_BYTES;
}

const SUPPORTED_PDF_MIMES = ["application/pdf"] as const;
const SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Magic-byte MIME sniff
// ─────────────────────────────────────────────────────────────────────────────

interface SniffedMime {
  /** Canonical MIME (after sniff). */
  mime: string;
  /** Resolved attachment kind. */
  kind: "pdf" | "image";
}

/**
 * Sniff the leading bytes to determine actual file type. Falls back to the
 * supplied MIME when the magic isn't conclusive (e.g. heic/webp aren't sniffed
 * here yet; the supplied MIME is trusted for those after a basic shape check).
 */
function sniffMime(bytes: Buffer, fallbackMime: string, fileName: string): SniffedMime {
  if (bytes.length < 8) {
    throw new LlmAttachmentError("Uploaded file is empty or truncated.");
  }

  // PDF: starts with "%PDF-"
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { mime: "application/pdf", kind: "pdf" };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", kind: "image" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
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
    return { mime: "image/png", kind: "image" };
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mime: "image/gif", kind: "image" };
  }

  // WEBP: "RIFF....WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", kind: "image" };
  }

  // HEIC / HEIF: "ftyp" box at offset 4 with major brand "heic"/"heix"/"mif1"/"msf1"
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = bytes.slice(8, 12).toString("ascii");
    if (brand === "heic" || brand === "heix" || brand === "mif1" || brand === "msf1" || brand === "heim" || brand === "heis") {
      return { mime: "image/heic", kind: "image" };
    }
  }

  // Fallback: if the caller insists on a supported MIME and the file looks
  // plausibly binary (no HTML tag at start), trust them. Otherwise reject.
  const fb = (fallbackMime || "").toLowerCase().trim();
  const firstChars = bytes.slice(0, Math.min(64, bytes.length)).toString("utf8").toLowerCase();
  const looksLikeHtmlOrText =
    firstChars.startsWith("<!doctype") ||
    firstChars.startsWith("<html") ||
    firstChars.startsWith("<?xml") ||
    firstChars.includes("<head");

  if (looksLikeHtmlOrText) {
    throw new LlmAttachmentError(
      `Unsupported file format for "${fileName || "uploaded file"}" — looks like HTML or text, not a PDF or image.`
    );
  }

  if (fb === "application/pdf" || isLikelyPdf(fb, fileName)) {
    return { mime: "application/pdf", kind: "pdf" };
  }
  if (fb.startsWith("image/")) {
    // Map common aliases.
    if (fb.includes("jpg") || fb.includes("jpeg")) return { mime: "image/jpeg", kind: "image" };
    if (fb.includes("png")) return { mime: "image/png", kind: "image" };
    if (fb.includes("heic") || fb.includes("heif")) return { mime: "image/heic", kind: "image" };
    if (fb.includes("webp")) return { mime: "image/webp", kind: "image" };
    if (fb.includes("gif")) return { mime: "image/gif", kind: "image" };
    return { mime: fb, kind: "image" };
  }

  throw new LlmAttachmentError(
    `Unsupported file format for "${fileName || "uploaded file"}" — must be PDF, JPEG, PNG, WEBP, HEIC, or GIF.`
  );
}

function isAllowedMime(mime: string): boolean {
  return (
    SUPPORTED_PDF_MIMES.includes(mime as (typeof SUPPORTED_PDF_MIMES)[number]) ||
    SUPPORTED_IMAGE_MIMES.includes(mime as (typeof SUPPORTED_IMAGE_MIMES)[number])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Size enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforce the per-file size cap on any upload route. Throws an
 * `LlmAttachmentError` with a user-friendly message. Routes should catch and
 * return 413.
 */
export function enforceUploadSize(byteLength: number, fileName?: string): void {
  const cap = maxUploadBytes();
  if (byteLength > cap) {
    const mb = (cap / (1024 * 1024)).toFixed(0);
    throw new LlmAttachmentError(
      `"${fileName || "uploaded file"}" exceeds the ${mb} MB upload limit. Try a smaller file or split it.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalize
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizeAttachmentInput {
  bytes: Buffer;
  /** Raw MIME from upload (may be wrong; sniffer overrides when conclusive). */
  mime: string;
  fileName: string;
  /** Advisor's holdings-page hint, e.g. "1-3,5-6". */
  pageHint?: string;
}

/**
 * Normalize a raw upload into the cross-provider `Attachment` shape.
 *
 * Throws `LlmAttachmentError` for unsupported types, oversized files, and
 * structural defects (corrupt PDF, image too small).
 */
export async function normalizeAttachment(
  input: NormalizeAttachmentInput
): Promise<Attachment> {
  const { bytes, fileName } = input;

  enforceUploadSize(bytes.length, fileName);

  const sniffed = sniffMime(bytes, input.mime, fileName);
  if (!isAllowedMime(sniffed.mime)) {
    throw new LlmAttachmentError(
      `Unsupported file format "${sniffed.mime}" for "${fileName}".`
    );
  }

  // Existing structural preflight (corrupt PDF, image too small / unreadable).
  // assertStatementFileReadable operates on PDF + image MIMEs only.
  await assertStatementFileReadable({ bytes, mimeType: sniffed.mime, fileName });

  if (sniffed.kind === "image") {
    const dims = readRasterImageDimensions(bytes);
    return {
      kind: "image",
      bytes,
      mime: sniffed.mime,
      fileName,
      imageDimensions: dims ?? undefined,
    };
  }

  // PDF path
  let workBytes = bytes;
  const pageHint = input.pageHint?.trim();
  let pdfPhysicallySliced = false;
  if (pageHint) {
    const expanded = expandHoldingsPageSpec(pageHint);
    if (expanded.length > 0) {
      const sliced = await slicePdfBytesToPages(bytes, expanded);
      if (sliced && sliced.length > 0) {
        workBytes = sliced;
        pdfPhysicallySliced = true;
      }
    }
  }

  const embeddedPdfText = await tryExtractPdfText(workBytes);
  const textLayer = embeddedPdfText
    ? buildTextLayerContext(embeddedPdfText, pdfPhysicallySliced)
    : undefined;

  return {
    kind: "pdf",
    bytes: workBytes,
    mime: sniffed.mime,
    fileName,
    pageHint,
    pdfPhysicallySliced,
    hasTextLayer: Boolean(textLayer),
    textLayer,
  };
}

