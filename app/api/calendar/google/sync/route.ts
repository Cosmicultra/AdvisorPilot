import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { syncGoogleCalendarNextMeetings } from "@/lib/google-calendar/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual “sync now” endpoint (useful for dev + troubleshooting).
 */
export const POST = async (req: Request) => {
  try {
    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to sync calendar." }, { status: 401 });
    }

    const result = await syncGoogleCalendarNextMeetings({
      advisorEmail: identity.email,
      calendarId: "primary",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message || "Sync failed." }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[calendar:google] sync error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed." }, { status: 500 });
  }
};

