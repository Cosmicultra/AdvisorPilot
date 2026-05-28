import { NextResponse } from "next/server";
import { google } from "googleapis";
import { randomUUID } from "crypto";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";
import { getGoogleOauthClient, GoogleNotConnectedError } from "@/lib/google/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status });
}

/**
 * Starts or renews a Google Calendar webhook watch for the signed-in advisor.
 * Requires the advisor to have connected Google with Calendar read scope.
 */
export const POST = async (req: Request) => {
  try {
    if (missingSupabaseServiceEnv()) {
      return jsonError("Missing Supabase environment variables.", 500);
    }
    const supabaseAdmin = getSupabaseServiceAdmin()!;

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return jsonError("Sign in to enable calendar sync.", 401);
    }

    const advisorEmail = normalizeEmail(identity.email);
    if (!advisorEmail) {
      return jsonError("Missing advisor email.", 400);
    }

    const origin = new URL(req.url).origin;
    const webhookUrl = `${origin}/api/calendar/google/webhook`;

    const oauth2Client = await getGoogleOauthClient(advisorEmail);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // If we already have a channel, stop it (best-effort) before creating a new one.
    const { data: existing } = await supabaseAdmin
      .from("advisorpilot_google_calendar_channels")
      .select("channel_id, resource_id")
      .eq("advisor_email", advisorEmail)
      .maybeSingle();

    if (existing?.channel_id && existing?.resource_id) {
      try {
        await calendar.channels.stop({
          requestBody: {
            id: existing.channel_id,
            resourceId: existing.resource_id,
          },
        });
      } catch {
        // ignore — channel may already be expired/stopped
      }
    }

    const channelId = randomUUID();
    const channelToken = randomUUID();

    // Watch primary calendar for event changes.
    const watchRes = await calendar.events.watch({
      calendarId: "primary",
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: channelToken,
      },
    });

    const resourceId = String(watchRes.data.resourceId || "").trim();
    const expirationMs = Number(watchRes.data.expiration || 0);
    const expiresAt = expirationMs ? new Date(expirationMs).toISOString() : null;

    if (!resourceId) {
      return jsonError(
        "Google Calendar did not return a resource id. Reconnect Google and try again.",
        502,
        { needsGoogleReconnect: true }
      );
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("advisorpilot_google_calendar_channels")
      .upsert(
        {
          advisor_email: advisorEmail,
          calendar_id: "primary",
          channel_id: channelId,
          resource_id: resourceId,
          channel_token: channelToken,
          expires_at: expiresAt,
        },
        { onConflict: "advisor_email" }
      );

    if (upsertErr) {
      return jsonError(upsertErr.message, 400);
    }

    return NextResponse.json({
      ok: true,
      message: "Google Calendar sync enabled.",
      expiresAt,
    });
  } catch (err: unknown) {
    if (err instanceof GoogleNotConnectedError) {
      return jsonError(err.message, 401, { needsGoogleReconnect: true });
    }

    const msg = err instanceof Error ? err.message : "Failed to enable calendar sync.";
    // Common insufficient-scope error: treat as reconnect needed.
    const lower = msg.toLowerCase();
    if (lower.includes("insufficient") || lower.includes("forbidden") || lower.includes("scope")) {
      return jsonError("Reconnect Google to grant Calendar access.", 401, { needsGoogleReconnect: true });
    }

    console.error("[calendar:google] watch/start error", err);
    return jsonError(msg, 500);
  }
};

