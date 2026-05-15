import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { readFile } from "fs/promises";
import { join } from "path";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { getVoiceSettings } from "@/lib/voice/settings";
import { VOICE_NAV_TOOLS, resolveVoiceSelection } from "@/lib/voice/token-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY for voice agent token mint.");
  }
  if (_client) return _client;
  _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _client;
}

let _systemPromptCache: string | null = null;
async function loadSystemPrompt(): Promise<string> {
  if (_systemPromptCache) return _systemPromptCache;
  const path =
    process.env.LLM_VOICE_SYSTEM_PROMPT_PATH?.trim() ||
    "lib/voice/prompts/advisor.txt";
  const file = join(process.cwd(), path);
  const content = await readFile(file, "utf-8");
  _systemPromptCache = content;
  return content;
}

/**
 * Mint a Gemini Live ephemeral token bound to (model, voice, tools, system
 * instruction). The browser receives only the token name and connects
 * directly to Gemini Live via WSS; the API key never leaves the server.
 */
export async function POST(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { error: "Sign in to use the voice agent." },
      { status: 401 }
    );
  }

  try {
    const settings = await getVoiceSettings(identity.email);
    if (settings.voiceEnabled === false) {
      return NextResponse.json(
        { error: "Voice agent disabled in your account settings." },
        { status: 403 }
      );
    }

    const { model, voice } = resolveVoiceSelection(settings);
    const systemPrompt = await loadSystemPrompt();

    const client = getClient();
    const now = Date.now();

    // Cast — the SDK's authTokens.create types vary slightly across versions
    // but the runtime accepts the documented liveConnectConstraints shape.
    const token = await (client.authTokens as unknown as {
      create: (req: { config: Record<string, unknown> }) => Promise<{ name?: string }>;
    }).create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            },
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: VOICE_NAV_TOOLS,
            sessionResumption: {},
            contextWindowCompression:
              process.env.LLM_VOICE_CONTEXT_COMPRESSION === "false"
                ? undefined
                : { slidingWindow: {} },
          },
        },
      },
    });

    return NextResponse.json({
      token: token.name,
      model,
      voice,
      maxSessionMinutes: Number(process.env.LLM_VOICE_MAX_SESSION_MINUTES) || 15,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token mint failed.";
    console.error("[voice/token] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
