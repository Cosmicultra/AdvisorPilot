import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STT_MODEL = process.env.OPENAI_STT_MODEL || "whisper-1";

/**
 * Transcribe an audio blob from the Live Intake overlay.
 * The browser sends a `multipart/form-data` POST with an `audio` file (webm/ogg/mp3).
 */
export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const audio = form.get("audio");
    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
    }

    const filename =
      typeof (audio as File).name === "string" && (audio as File).name
        ? (audio as File).name
        : "speech.webm";

    const file = new File([audio], filename, {
      type: audio.type || "audio/webm",
    });

    const result = await openai.audio.transcriptions.create({
      file,
      model: STT_MODEL,
      language: "en",
    });

    const text = String(result.text ?? "").trim();
    return NextResponse.json({ text });
  } catch (e) {
    console.error("intake-stt error", e);
    const msg = e instanceof Error ? e.message : "Transcription failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
