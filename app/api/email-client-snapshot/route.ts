import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "../auth/[...nextauth]/route";

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

function buildEmailWithAttachment(params: {
  from?: string;
  to: string;
  subject: string;
  body: string;
  pdfBytes: Buffer;
  filename: string;
}) {
  const boundary = `advisorpilot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const to = sanitizeHeader(params.to);
  const subject = sanitizeHeader(params.subject);
  const from = sanitizeHeader(params.from || "");
  const pdfBase64 = params.pdfBytes.toString("base64").replace(/(.{76})/g, "$1\r\n");

  const messageParts = [
    from ? `From: ${from}` : "",
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    params.body || "",
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${params.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${params.filename}"`,
    "",
    pdfBase64,
    "",
    `--${boundary}--`,
  ];

  return messageParts.join("\r\n");
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session as any)?.accessToken;
    const senderEmail = session?.user?.email || "";

    if (!session || !accessToken) {
      return NextResponse.json(
        { error: "You must sign in with Google before sending email." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const to = body?.to;

    if (!to) {
      return NextResponse.json(
        { error: "Missing recipient email address." },
        { status: 400 }
      );
    }

    const subject =
      body?.subject ||
      `Next Steps from Our Portfolio Review - ${body?.client?.name || "Client"}`;

    const clientName = body?.client?.name || "Client";
    const firstName = String(clientName).trim().split(" ")[0] || "there";

    const synopsis = String(body?.analysis?.synopsis || "").trim();
    const synopsisSentences = synopsis
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");

    const strategy =
      Array.isArray(body?.analysis?.strategies) && body.analysis.strategies.length
        ? String(body.analysis.strategies[0])
        : "review your portfolio together and confirm it aligns with your goals.";

    const emailSignature = body?.emailSignature || "[Email signature]";

    const emailBody = [
      `Hi ${firstName},`,
      "",
      "Thank you again for taking the time to review your portfolio with me.",
      "",
      "I wanted to send over your Client Snapshot and briefly highlight a couple key takeaways from our conversation.",
      "",
      synopsisSentences || "The attached Client Snapshot provides a high-level overview of your current portfolio positioning and areas we may want to review together.",
      "",
      `Next step: ${strategy.charAt(0).toLowerCase() + strategy.slice(1)}`,
      "",
      "The full breakdown is included in the attached Client Snapshot.",
      "",
      "Please take a look when you have a chance and let me know if any questions come up.",
      "",
      emailSignature,
    ].join("\n");

    const origin = new URL(req.url).origin;

    const pdfResponse = await fetch(`${origin}/api/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        mode: "client",
      }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      return NextResponse.json(
        { error: `Failed to generate Client Snapshot PDF: ${errorText}` },
        { status: 500 }
      );
    }

    const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: accessToken,
    });

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client,
    });

    const rawMessage = buildEmailWithAttachment({
      from: senderEmail,
      to,
      subject,
      body: emailBody,
      pdfBytes,
      filename: "Client_Snapshot.pdf",
    });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: base64UrlEncode(rawMessage),
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Client Snapshot email sent successfully.",
    });
  } catch (err: any) {
    console.error("EMAIL CLIENT SNAPSHOT ERROR:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to send Client Snapshot email." },
      { status: 500 }
    );
  }
}
