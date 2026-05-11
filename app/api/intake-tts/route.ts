import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY in .env.local" }, { status: 500 });
    }

    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Missing text." }, { status: 400 });
    }

    const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    /** "sage" = calm, professional, neutral. Override per-deployment via OPENAI_TTS_VOICE. */
    const voice = process.env.OPENAI_TTS_VOICE || "sage";

    const speech = await openai.audio.speech.create({
      model,
      voice,
      input: text.slice(0, 4096),
      response_format: "mp3",
      ...(model.includes("gpt-4o-mini-tts")
        ? {
            instructions: [
              "You are a calm, professional human assistant in a financial advisor's office.",
              "Speak the way a real person speaks to a client across the table, not like an AI, not like a screen reader.",
              "Use natural conversational pacing: relaxed, never rushed, with short pauses between thoughts.",
              "Vary your rhythm and intonation across sentences; don't read each line with the same melody.",
              "Use contractions naturally (\"I'm\", \"we're\", \"you'll\") and let the sentence breathe.",
              "Stay warm but composed. You are helpful, not chipper or salesy.",
            ].join(" "),
          }
        : {}),
    });

    const buf = Buffer.from(await speech.arrayBuffer());
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("intake-tts", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Speech generation failed." },
      { status: 500 }
    );
  }
}
