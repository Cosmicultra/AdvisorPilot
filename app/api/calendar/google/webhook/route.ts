import { NextResponse } from "next/server";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";
import { syncGoogleCalendarNextMeetings } from "@/lib/google-calendar/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function header(req: Request, key: string): string {
  return String(req.headers.get(key) || "").trim();
}

/**
 * Google Calendar push notification callback.
 *
 * Google sends POSTs with these headers:
 * - x-goog-channel-id
 * - x-goog-resource-id
 * - x-goog-resource-state  (e.g. "sync", "exists")
 * - x-goog-channel-token   (our secret token)
 *
 * We validate against the stored channel row, then run a lightweight sync.
 */
export const POST = async (req: Request) => {
  try {
    if (missingSupabaseServiceEnv()) {
      return NextResponse.json({ ok: true });
    }
    const supabaseAdmin = getSupabaseServiceAdmin()!;

    const channelId = header(req, "x-goog-channel-id");
    const resourceId = header(req, "x-goog-resource-id");
    const resourceState = header(req, "x-goog-resource-state");
    const channelToken = header(req, "x-goog-channel-token");

    if (!channelId || !resourceId || !channelToken) {
      return NextResponse.json({ ok: true });
    }

    const { data: row } = await supabaseAdmin
      .from("advisorpilot_google_calendar_channels")
      .select("advisor_email, calendar_id, channel_id, resource_id, channel_token")
      .eq("channel_id", channelId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ ok: true });
    }

    if (String(row.resource_id) !== resourceId) {
      return NextResponse.json({ ok: true });
    }
    if (String(row.channel_token) !== channelToken) {
      return NextResponse.json({ ok: true });
    }

    // Initial handshake notification; no need to sync yet.
    if (resourceState.toLowerCase() === "sync") {
      return NextResponse.json({ ok: true });
    }

    await syncGoogleCalendarNextMeetings({
      advisorEmail: String(row.advisor_email),
      calendarId: String(row.calendar_id || "primary"),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar:google] webhook error", err);
    // Always 200 so Google doesn't aggressively retry.
    return NextResponse.json({ ok: true });
  }
};

