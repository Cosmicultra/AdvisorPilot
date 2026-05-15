import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  getVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "@/lib/voice/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { error: "Sign in to view voice settings." },
      { status: 401 }
    );
  }
  const settings = await getVoiceSettings(identity.email);
  return NextResponse.json({ settings });
}

const BOOL_FIELDS = new Set([
  "voiceEnabled",
  "voiceShowCaptions",
  "voicePauseOnBlur",
  "voiceDisclosed",
  "voiceAuditToolCalls",
]);
const STRING_FIELDS = new Set(["voiceModel", "voiceName", "voiceHotkey"]);

function sanitize(body: Record<string, unknown>): Partial<VoiceSettings> {
  const out: Partial<VoiceSettings> = {};
  for (const [k, v] of Object.entries(body)) {
    if (BOOL_FIELDS.has(k)) {
      if (v === null) (out as Record<string, unknown>)[k] = null;
      else if (typeof v === "boolean") (out as Record<string, unknown>)[k] = v;
    } else if (STRING_FIELDS.has(k)) {
      if (v === null) (out as Record<string, unknown>)[k] = null;
      else if (typeof v === "string") {
        const trimmed = v.trim();
        (out as Record<string, unknown>)[k] = trimmed || null;
      }
    }
  }
  return out;
}

export async function POST(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { error: "Sign in to update voice settings." },
      { status: 401 }
    );
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const partial = sanitize(body);
    const settings = await saveVoiceSettings(
      identity.email,
      identity.userId ?? null,
      partial
    );
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed." },
      { status: 500 }
    );
  }
}
