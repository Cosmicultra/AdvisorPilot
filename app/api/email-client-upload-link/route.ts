import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { escapeHtml } from "@/lib/gmail/mime";
import {
  advisorEmailReconnectFlags,
  resolveInteractiveEmailProvider,
  sendAdvisorEmail,
} from "@/lib/advisor-email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a simple email with the client upload link (no attachment).
 * Requires Google or Microsoft sign-in with send-mail scope.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session as { accessToken?: string })?.accessToken;
    const senderEmail = session?.user?.email || "";

    if (!session || !senderEmail) {
      return NextResponse.json(
        {
          error: "You must sign in with Google or Microsoft before sending email.",
          needsGoogleReconnect: true,
          needsOutlookReconnect: true,
        },
        { status: 401 }
      );
    }

    const { provider, accessTokenOverride } = await resolveInteractiveEmailProvider(
      senderEmail,
      req,
      accessToken
    );

    if (!provider) {
      return NextResponse.json(
        {
          error: "No email provider connected. Sign in with Google or Microsoft first.",
          needsGoogleReconnect: true,
          needsOutlookReconnect: true,
        },
        { status: 401 }
      );
    }

    const body = await req.json();
    const to = String(body?.to || "").trim();
    const uploadUrl = String(body?.uploadUrl || "").trim();
    const clientFirstName = String(body?.clientFirstName || "there").trim() || "there";
    const advisorName = String(body?.advisorName || "").trim();

    if (!to) {
      return NextResponse.json({ error: "Missing recipient email address." }, { status: 400 });
    }
    if (!uploadUrl || !/^https?:\/\//i.test(uploadUrl)) {
      return NextResponse.json({ error: "Missing or invalid uploadUrl." }, { status: 400 });
    }

    const subject =
      String(body?.subject || "").trim() ||
      `${advisorName ? `${advisorName}: ` : ""}Upload your statement for AdvisorPilot`.trim();

    const plainBody = [
      `Hi ${clientFirstName},`,
      "",
      "Here is your secure link to confirm your profile answers and upload your investment statement(s) for your AdvisorPilot review:",
      uploadUrl,
      "",
      "Open the link on your phone or computer, review the questions your advisor saved for you, attach your file(s), then send them back in one step.",
      "",
      advisorName ? advisorName : "",
    ]
      .filter(Boolean)
      .join("\n");

    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.55;">
        <p style="margin:0 0 12px 0;">Hi ${escapeHtml(clientFirstName)},</p>
        <p style="margin:0 0 12px 0;">Here is your secure link to confirm your profile answers and upload your investment statement(s) for your AdvisorPilot review:</p>
        <p style="margin:0 0 12px 0;"><a href="${escapeHtml(uploadUrl)}" style="color:#0f766e;font-weight:600;">${escapeHtml(uploadUrl)}</a></p>
        <p style="margin:0 0 12px 0;">Open the link on your phone or computer, review the questions your advisor saved for you, attach your file(s), then send them back in one step.</p>
        ${advisorName ? `<p style="margin:16px 0 0 0;">${escapeHtml(advisorName)}</p>` : ""}
      </div>
    `;

    const sendResult = await sendAdvisorEmail({
      advisorEmail: senderEmail,
      to,
      subject,
      plainBody,
      htmlBody,
      provider,
      accessTokenOverride,
    });

    if (!sendResult.ok) {
      return NextResponse.json(
        { error: sendResult.error, ...advisorEmailReconnectFlags(sendResult) },
        {
          status:
            sendResult.needsGoogleReconnect || sendResult.needsOutlookReconnect ? 401 : 502,
        }
      );
    }

    return NextResponse.json({ ok: true, message: "Upload link email sent." });
  } catch (err: unknown) {
    console.error("EMAIL CLIENT UPLOAD LINK ERROR:", err);
    const msg = err instanceof Error ? err.message : "Failed to send email.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
