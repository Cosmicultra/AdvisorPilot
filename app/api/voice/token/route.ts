import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { getVoiceSettings } from "@/lib/voice/settings";
import { VOICE_NAV_TOOLS, resolveVoiceSelection } from "@/lib/voice/token-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Mint the configuration the browser needs to open a Gemini Live session.
 *
 * Follows the Athena desktop agent pattern (apiKey + config + tools sent
 * to the client, which then calls `new GoogleGenAI({apiKey}).live.connect`).
 * The Google-docs alternative is ephemeral tokens via authTokens.create —
 * still preview as of this writing and not universally enabled per-key.
 *
 * Security posture: the API key is only returned to authenticated advisors
 * over HTTPS. For higher-security deployments, swap this for a server-side
 * WSS relay or migrate to ephemeral tokens once GA. Vertex AI Live needs a
 * different flow entirely (OAuth + service-account token).
 */
export async function POST(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { error: "Sign in to use the voice agent." },
      { status: 401 }
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Voice agent not configured: GEMINI_API_KEY missing." },
      { status: 500 }
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

    return NextResponse.json({
      apiKey: process.env.GEMINI_API_KEY,
      model,
      voice,
      systemPrompt,
      tools: VOICE_NAV_TOOLS,
      maxSessionMinutes: Number(process.env.LLM_VOICE_MAX_SESSION_MINUTES) || 15,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Voice config mint failed.";
    console.error("[voice/token] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
