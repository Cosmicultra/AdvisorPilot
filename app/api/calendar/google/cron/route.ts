import { NextResponse } from "next/server";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";
import { syncGoogleCalendarNextMeetings } from "@/lib/google-calendar/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional polling fallback (NON-AI).
 * Call this from a scheduler (Vercel Cron, GitHub Actions, etc.).
 *
 * Protect with CALENDAR_CRON_SECRET.
 */
export const POST = async (req: Request) => {
  const secret = process.env.CALENDAR_CRON_SECRET?.trim() || "";
  const got = String(req.headers.get("x-cron-secret") || "").trim();
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (missingSupabaseServiceEnv()) {
    return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
  }
  const supabaseAdmin = getSupabaseServiceAdmin()!;

  const { data: channels, error } = await supabaseAdmin
    .from("advisorpilot_google_calendar_channels")
    .select("advisor_email, calendar_id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let okCount = 0;
  for (const row of channels || []) {
    const res = await syncGoogleCalendarNextMeetings({
      advisorEmail: String((row as any).advisor_email),
      calendarId: String((row as any).calendar_id || "primary"),
    });
    if (res.ok) okCount += 1;
  }

  return NextResponse.json({ ok: true, synced: okCount, total: (channels || []).length });
};

