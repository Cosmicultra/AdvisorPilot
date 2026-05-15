/**
 * Image transcoding for providers with restrictive format support.
 *
 * Grok accepts JPG/PNG only — HEIC/WEBP/GIF must be converted before send.
 * Sharp handles HEIC natively when built against libvips with HEIF; if a
 * deployment lacks HEIF support, the call throws and the caller surfaces a
 * user-facing error.
 */

import { Buffer } from "buffer";
import sharp from "sharp";

export interface TranscodeOptions {
  /** Target format. Defaults to JPEG. */
  format?: "jpeg" | "png";
  /** JPEG quality (1–100). Ignored for PNG. */
  jpegQuality?: number;
  /** If set, downscale the long edge to this many pixels. */
  maxLongEdgePx?: number;
}

export interface TranscodeResult {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Convert any sharp-readable image (HEIC, WEBP, GIF, AVIF, ...) to JPEG/PNG.
 * Always strips alpha (Grok rejects RGBA in some cases).
 */
export async function transcodeImage(
  bytes: Buffer,
  options: TranscodeOptions = {}
): Promise<TranscodeResult> {
  const format = options.format ?? "jpeg";
  const quality = options.jpegQuality ?? envNumber("LLM_GROK_RASTERIZE_QUALITY", 80);
  const maxLongEdge = options.maxLongEdgePx ?? envNumber("LLM_IMAGE_MAX_LONG_EDGE_PX", 2048);

  let pipeline = sharp(bytes);
  const metadata = await pipeline.metadata();
  pipeline = pipeline.removeAlpha();

  if (
    metadata.width &&
    metadata.height &&
    Math.max(metadata.width, metadata.height) > maxLongEdge
  ) {
    pipeline = pipeline.resize({
      width: metadata.width >= metadata.height ? maxLongEdge : undefined,
      height: metadata.height > metadata.width ? maxLongEdge : undefined,
      fit: "inside",
    });
  }

  const formatted = format === "png"
    ? pipeline.png({ compressionLevel: 9 })
    : pipeline.jpeg({ quality, mozjpeg: true });

  const out = await formatted.toBuffer({ resolveWithObject: true });
  return {
    bytes: out.data,
    mime: format === "png" ? "image/png" : "image/jpeg",
    width: out.info.width,
    height: out.info.height,
  };
}

/** True for formats Grok can't accept natively. */
export function needsTranscodeForGrok(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg" || m === "image/png") return false;
  return m.startsWith("image/");
}
