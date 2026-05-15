import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { getVoiceSettings } from "@/lib/voice/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuditBody {
  tool?: unknown;
  argsHash?: unknown;
  resultHash?: unknown;
  success?: unknown;
  error?: unknown;
}

export async function POST(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 }
    );
  }

  // Audit logging is opt-in per voice settings. If the advisor hasn't
  // enabled it, silently accept and discard.
  const settings = await getVoiceSettings(identity.email);
  if (settings.voiceAuditToolCalls !== true) {
    return NextResponse.json({ ok: true, recorded: false });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase not configured." },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as AuditBody;
  const tool = typeof body.tool === "string" ? body.tool.slice(0, 100) : "";
  if (!tool) {
    return NextResponse.json({ error: "tool is required." }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    await supabase.from("advisorpilot_voice_audit_log").insert({
      advisor_email: identity.email.toLowerCase(),
      advisor_user_id: identity.userId ?? null,
      tool,
      args_hash: typeof body.argsHash === "string" ? body.argsHash : null,
      result_hash: typeof body.resultHash === "string" ? body.resultHash : null,
      success: body.success !== false,
      error: typeof body.error === "string" ? body.error.slice(0, 500) : null,
    });
    return NextResponse.json({ ok: true, recorded: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Insert failed." },
      { status: 500 }
    );
  }
}
