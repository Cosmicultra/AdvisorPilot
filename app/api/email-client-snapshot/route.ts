import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { authOptions } from "../auth/[...nextauth]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

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

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function firstNameFromClientName(value: unknown) {
  return String(value || "there").trim().split(" ")[0] || "there";
}

function sentenceCase(value: string) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function getFirstSentences(value: unknown, count = 2) {
  return String(value || "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

async function getSavedEmailSignature(ownerEmail: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "";
  }

  const { data, error } = await supabaseAdmin
    .from("advisorpilot_advisor_profiles")
    .select("email_signature")
    .eq("owner_email", normalizeEmail(ownerEmail))
    .maybeSingle();

  if (error) {
    console.error("EMAIL SIGNATURE LOOKUP ERROR:", error);
    return "";
  }

  return String(data?.email_signature || "").trim();
}

function buildClientEmailBody(params: {
  firstName: string;
  synopsis: string;
  highlight: string;
  nextStep: string;
  signature: string;
}) {
  const synopsis =
    params.synopsis ||
    "The attached Client Snapshot provides a high-level overview of your current portfolio positioning and a few areas we can review together.";

  const highlight =
    params.highlight ||
    "your portfolio review includes a few key areas worth discussing together.";

  const nextStep =
    params.nextStep ||
    "walk through the report together and confirm the portfolio still fits your goals, timeline, and comfort level.";

  return [
    `Hi ${params.firstName},`,
    "",
    "Thank you again for taking the time to review everything with me.",
    "",
    "I wanted to send over your Client Snapshot and highlight a couple key points we discussed.",
    "",
    synopsis,
    "",
    `One thing that stood out is that ${sentenceCase(highlight)}`,
    "",
    `From here, the next step will be to ${sentenceCase(nextStep)}`,
    "",
    "Take a look at the report when you have a chance, and let me know what questions come up. We can walk through everything together and make sure it is aligned with what you want moving forward.",
    "",
    params.signature || "[Email signature]",
  ].join("\n");
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

    const firstName = firstNameFromClientName(body?.client?.name);

    const synopsisSentences = getFirstSentences(body?.analysis?.synopsis, 2);

    const portfolioHighlight =
      Array.isArray(body?.analysis?.portfolioHighlights) && body.analysis.portfolioHighlights.length
        ? String(body.analysis.portfolioHighlights[0])
        : "";

    const strategy =
      Array.isArray(body?.analysis?.strategies) && body.analysis.strategies.length
        ? String(body.analysis.strategies[0])
        : "review the portfolio together and confirm it aligns with your goals.";

    const savedSignature = await getSavedEmailSignature(senderEmail);
    const emailSignature =
      String(body?.emailSignature || "").trim() ||
      savedSignature ||
      "[Email signature]";

    const emailBody = buildClientEmailBody({
      firstName,
      synopsis: synopsisSentences,
      highlight: portfolioHighlight,
      nextStep: strategy,
      signature: emailSignature,
    });

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
