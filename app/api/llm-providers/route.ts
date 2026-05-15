import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns which providers have API keys configured server-side. The UI uses
 * this to disable un-configured providers in the Settings drawer. We never
 * echo the keys themselves.
 */
export async function GET() {
  const providers: { id: LlmProvider; configured: boolean }[] = [
    { id: "openai", configured: Boolean(process.env.OPENAI_API_KEY?.trim()) },
    { id: "gemini", configured: Boolean(process.env.GEMINI_API_KEY?.trim()) },
    { id: "grok", configured: Boolean(process.env.XAI_API_KEY?.trim()) },
  ];
  return NextResponse.json({ providers });
}
