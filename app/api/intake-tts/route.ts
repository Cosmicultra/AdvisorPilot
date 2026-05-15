import { NextResponse } from "next/server";
import { tts } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATURAL_TTS_INSTRUCTIONS = [
  "You are a calm, professional human assistant in a financial advisor's office.",
  "Speak the way a real person speaks to a client across the table, not like an AI, not like a screen reader.",
  "Use natural conversational pacing: relaxed, never rushed, with short pauses between thoughts.",
  "Vary your rhythm and intonation across sentences; don't read each line with the same melody.",
  "Use contractions naturally (\"I'm\", \"we're\", \"you'll\") and let the sentence breathe.",
  "Stay warm but composed. You are helpful, not chipper or salesy.",
].join(" ");

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Missing text." }, { status: 400 });
    }

    const voice = process.env.OPENAI_TTS_VOICE || "sage";

    const audio = await tts({
      text: text.slice(0, 4096),
      voice,
      format: "mp3",
      instructions: NATURAL_TTS_INSTRUCTIONS,
    });

    return new NextResponse(new Uint8Array(audio), {
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
