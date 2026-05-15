/**
 * PDF → JPEG-per-page rasterization for providers that don't accept native
 * PDF input (currently Grok).
 *
 * Uses `pdf-to-img` (a thin Node-friendly wrapper around pdfjs-dist that
 * handles the headless canvas setup). Output is PNG by default; we convert
 * to JPEG via sharp to control quality + size.
 *
 * No native binaries beyond what sharp already requires — fully Vercel
 * serverless compatible.
 */

import { Buffer } from "buffer";
import sharp from "sharp";

// Lazy-load pdf-to-img: the package has a top-level module init that
// confuses Next/Turbopack's static analysis at build time. Dynamic-importing
// inside the rasterize function keeps the route bundle clean while still
// allowing serverless execution.
async function loadPdfToImg() {
  const mod = (await import("pdf-to-img")) as unknown as {
    pdf: (
      bytes: Buffer | Uint8Array,
      opts?: { scale?: number }
    ) => AsyncIterable<Buffer>;
  };
  return mod.pdf;
}

export interface RasterizePdfOptions {
  /** Render scale relative to PDF's native DPI (72). 2.0 ≈ 144 dpi. */
  scale?: number;
  /** Max pages to rasterize. PDF will be truncated to this count if longer. */
  maxPages?: number;
  /** Max long-edge in pixels — pages downscaled if larger after rendering. */
  maxLongEdgePx?: number;
  /** Output JPEG quality 1–100. */
  jpegQuality?: number;
}

export interface RasterizedPage {
  /** 1-based page index in the source PDF. */
  pageNumber: number;
  jpeg: Buffer;
  width: number;
  height: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function defaultRasterizeOptions(): Required<RasterizePdfOptions> {
  return {
    scale: envNumber("LLM_GROK_RASTERIZE_DPI", 2.0),
    maxPages: envNumber("LLM_GROK_MAX_PAGES_PER_REQUEST", 20),
    maxLongEdgePx: envNumber("LLM_IMAGE_MAX_LONG_EDGE_PX", 2048),
    jpegQuality: envNumber("LLM_GROK_RASTERIZE_QUALITY", 80),
  };
}

/**
 * Render PDF pages → JPEG buffers.
 */
export async function rasterizePdfToJpegs(
  pdfBytes: Buffer,
  options: RasterizePdfOptions = {}
): Promise<RasterizedPage[]> {
  const opts = { ...defaultRasterizeOptions(), ...options };

  const pdfToImg = await loadPdfToImg();
  const document = await pdfToImg(pdfBytes, { scale: opts.scale });
  const results: RasterizedPage[] = [];

  let pageNumber = 0;
  for await (const pageBuffer of document) {
    pageNumber++;
    if (pageNumber > opts.maxPages) break;

    let pipeline = sharp(pageBuffer);
    const metadata = await pipeline.metadata();
    pipeline = pipeline.removeAlpha();
    if (
      metadata.width &&
      metadata.height &&
      Math.max(metadata.width, metadata.height) > opts.maxLongEdgePx
    ) {
      pipeline = pipeline.resize({
        width: metadata.width >= metadata.height ? opts.maxLongEdgePx : undefined,
        height: metadata.height > metadata.width ? opts.maxLongEdgePx : undefined,
        fit: "inside",
      });
    }
    const jpeg = await pipeline
      .jpeg({ quality: opts.jpegQuality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    results.push({
      pageNumber,
      jpeg: jpeg.data,
      width: jpeg.info.width,
      height: jpeg.info.height,
    });
  }

  return results;
}
