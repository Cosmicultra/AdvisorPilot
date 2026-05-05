import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "../auth/[...nextauth]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeHeader(value: string) {
  return String(value || "").replace(/[\r\n]/g, " ").trim();
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildSimpleEmail(params: {
  from?: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
}) {
  const boundary = `ap_upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const to = sanitizeHeader(params.to);
  const subject = sanitizeHeader(params.subject);
  const from = params.from ? sanitizeHeader(params.from) : "";

  const head = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    params.plainBody || "",
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    params.htmlBody || "",
    "",
    `--${boundary}--`,
  ];

  return head.join("\r\n");
}

/**
 * Sends a simple Gmail message with the client upload link (no attachment).
 * Requires Google sign-in with gmail.send scope (same as Client Snapshot email).
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session as { accessToken?: string })?.accessToken;
    const senderEmail = session?.user?.email || "";

    if (!session || !accessToken) {
      return NextResponse.json(
        { error: "You must sign in with Google before sending email." },
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
      `${advisorName ? `${advisorName} — ` : ""}Upload your statement for AdvisorPilot`.trim();

    const plainBody = [
      `Hi ${clientFirstName},`,
      "",
      "Here is your secure link to upload your investment statement for your AdvisorPilot review:",
      uploadUrl,
      "",
      "Open the link on your phone or computer, choose your file, and upload. It only takes a minute.",
      "",
      advisorName ? `— ${advisorName}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.55;">
        <p style="margin:0 0 12px 0;">Hi ${escapeHtml(clientFirstName)},</p>
        <p style="margin:0 0 12px 0;">Here is your secure link to upload your investment statement for your AdvisorPilot review:</p>
        <p style="margin:0 0 12px 0;"><a href="${escapeHtml(uploadUrl)}" style="color:#0f766e;font-weight:600;">${escapeHtml(uploadUrl)}</a></p>
        <p style="margin:0 0 12px 0;">Open the link on your phone or computer, choose your file, and upload. It only takes a minute.</p>
        ${advisorName ? `<p style="margin:16px 0 0 0;">— ${escapeHtml(advisorName)}</p>` : ""}
      </div>
    `;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const rawMessage = buildSimpleEmail({
      from: senderEmail,
      to,
      subject,
      plainBody,
      htmlBody,
    });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: base64UrlEncode(rawMessage),
      },
    });

    return NextResponse.json({ ok: true, message: "Upload link email sent." });
  } catch (err: unknown) {
    console.error("EMAIL CLIENT UPLOAD LINK ERROR:", err);
    const msg = err instanceof Error ? err.message : "Failed to send email.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
