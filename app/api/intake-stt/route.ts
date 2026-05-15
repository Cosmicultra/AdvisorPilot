import { Buffer } from "buffer";
import { NextResponse } from "next/server";
import { stt } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcribe an audio blob from the Live Intake overlay.
 * The browser sends a `multipart/form-data` POST with an `audio` file (webm/ogg/mp3).
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
    }

    const arrayBuf = await audio.arrayBuffer();
    const text = await stt({
      audio: Buffer.from(arrayBuf),
      mime: audio.type || "audio/webm",
      language: "en",
    });

    return NextResponse.json({ text: String(text).trim() });
  } catch (e) {
    console.error("intake-stt error", e);
    const msg = e instanceof Error ? e.message : "Transcription failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
