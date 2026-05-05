import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { authOptions } from "../auth/[...nextauth]/route";
import { clientDisplayName, clientFirstNameSalutation } from "@/lib/intake-config";

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

function clean(value: unknown) {
  return String(value || "").trim();
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ensureUrl(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
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

function paragraphsToHtml(lines: string[]) {
  return lines
    .map((line) => {
      if (!line.trim()) return "<br />";
      return `<p style="margin:0 0 12px 0;">${escapeHtml(line)}</p>`;
    })
    .join("");
}

function buildPlainSignature(profile: any, fallbackSignature = "", calendarLinkFallback = "") {
  const calendarRaw = clean(profile?.calendar_link) || clean(calendarLinkFallback);
  const calendarUrl = calendarRaw ? ensureUrl(calendarRaw) : "";

  const savedBlock = clean(profile?.email_signature);
  if (savedBlock) {
    // Plain text cannot embed clickable text links.
    // Include the URL so clients can auto-link it.
    if (calendarUrl) {
      const lines = savedBlock.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (/book( a time)? on my calendar\.?$/i.test(trimmed)) {
          return `Book a time on my calendar: ${calendarUrl}`;
        }
        return line;
      });
      if (!lines.some((l) => /Book a time on my calendar:/i.test(l))) {
        lines.push(`Book a time on my calendar: ${calendarUrl}`);
      }
      return lines.join("\n").trim();
    }
    return savedBlock;
  }

  const lines = [
    clean(profile?.advisor_name),
    clean(profile?.advisor_title),
    clean(profile?.advisor_license),
    calendarUrl ? `Book a time on my calendar: ${calendarUrl}` : "",
    clean(profile?.office_address),
    profile?.office_phone ? `Office: ${clean(profile.office_phone)}` : "",
    profile?.cell_phone ? `Cell: ${clean(profile.cell_phone)}` : "",
    clean(profile?.website),
  ].filter(Boolean);

  if (lines.length) return lines.join("\n");

  return clean(fallbackSignature);
}

function buildHtmlSignature(profile: any, fallbackSignature = "", calendarLinkFallback = "") {
  const savedBlock = clean(profile?.email_signature);
  if (savedBlock) {
    const calendarRaw = clean(profile?.calendar_link) || clean(calendarLinkFallback);
    const calendarUrl = calendarRaw ? ensureUrl(calendarRaw) : "";
    const lines = savedBlock.split(/\r?\n/);
    const renderedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<br />";

      // If the user included the calendar placeholder text (with optional punctuation),
      // render it as a clickable link using the saved calendar_link.
      if (calendarUrl && /book( a time)? on my calendar\.?$/i.test(trimmed)) {
        return `<a href="${escapeHtml(calendarUrl)}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`;
      }

      return escapeHtml(line);
    });

    // If we have a calendar link but the signature block didn't include the placeholder line,
    // append the clickable link anyway so it always appears in the HTML signature.
    if (calendarUrl && !renderedLines.some((l) => l.includes('href="'))) {
      renderedLines.push(`<a href="${escapeHtml(calendarUrl)}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`);
    }

    return renderedLines.join("<br />");
  }

  if (!profile) {
    return escapeHtml(fallbackSignature || "[Email signature]").replace(/\n/g, "<br />");
  }

  const parts: string[] = [];

  if (profile.advisor_name) {
    parts.push(`<strong>${escapeHtml(profile.advisor_name)}</strong>`);
  }

  if (profile.advisor_title) {
    parts.push(escapeHtml(profile.advisor_title));
  }

  if (profile.advisor_license) {
    parts.push(escapeHtml(profile.advisor_license));
  }

  if (profile.calendar_link) {
    parts.push(`<a href="${escapeHtml(ensureUrl(profile.calendar_link))}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`);
  } else if (clean(calendarLinkFallback)) {
    parts.push(`<a href="${escapeHtml(ensureUrl(calendarLinkFallback))}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`);
  }

  if (profile.office_address) {
    parts.push(escapeHtml(profile.office_address));
  }

  if (profile.office_phone) {
    parts.push(`Office: ${escapeHtml(profile.office_phone)}`);
  }

  if (profile.cell_phone) {
    parts.push(`Cell: ${escapeHtml(profile.cell_phone)}`);
  }

  if (profile.website) {
    const websiteUrl = ensureUrl(profile.website);
    parts.push(`<a href="${escapeHtml(websiteUrl)}" style="color:#0f766e;text-decoration:underline;">${escapeHtml(profile.website)}</a>`);
  }

  if (!parts.length) {
    return escapeHtml(fallbackSignature || "[Email signature]").replace(/\n/g, "<br />");
  }

  return parts.join("<br />");
}

async function getAdvisorProfile(ownerEmail: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("advisorpilot_advisor_profiles")
    .select("*")
    .eq("owner_email", normalizeEmail(ownerEmail))
    .maybeSingle();

  if (error) {
    console.error("EMAIL SIGNATURE LOOKUP ERROR:", error);
    return null;
  }

  return data || null;
}

function buildClientEmailBodies(params: {
  firstName: string;
  synopsis: string;
  highlight: string;
  nextStep: string;
  plainSignature: string;
  htmlSignature: string;
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

  const plainLines = [
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
    params.plainSignature || "[Email signature]",
  ];

  const htmlIntro = [
    `Hi ${params.firstName},`,
    "Thank you again for taking the time to review everything with me.",
    "I wanted to send over your Client Snapshot and highlight a couple key points we discussed.",
    synopsis,
    `One thing that stood out is that ${sentenceCase(highlight)}`,
    `From here, the next step will be to ${sentenceCase(nextStep)}`,
    "Take a look at the report when you have a chance, and let me know what questions come up. We can walk through everything together and make sure it is aligned with what you want moving forward.",
  ];

  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.55;">
      ${paragraphsToHtml(htmlIntro)}
      <div style="margin-top:18px;">
        ${params.htmlSignature || "[Email signature]"}
      </div>
    </div>
  `;

  return {
    plainText: plainLines.join("\n"),
    html: htmlBody,
  };
}

function buildFollowUpClientEmailBodies(params: {
  firstName: string;
  synopsis: string;
  highlight: string;
  nextStep: string;
  plainSignature: string;
  htmlSignature: string;
}) {
  const synopsis =
    params.synopsis ||
    "The attached Client Snapshot reflects your saved holdings with an updated analysis as of today.";

  const highlight =
    params.highlight ||
    "your portfolio review includes a few key areas worth discussing together.";

  const nextStep =
    params.nextStep ||
    "walk through the report together and confirm the portfolio still fits your goals, timeline, and comfort level.";

  const closing =
    "I haven't heard back from you since our meeting. In case my email got buried, here is an up-to-date look at your analysis report as of today. Book a time on my calendar and let's review.";

  const plainLines = [
    `Hi ${params.firstName},`,
    "",
    "Thank you again for taking the time to meet with me.",
    "",
    "I am sending an updated Client Snapshot based on the holdings we have on file, with today's refreshed analysis.",
    "",
    synopsis,
    "",
    `One thing that stood out is that ${sentenceCase(highlight)}`,
    "",
    `From here, the next step will be to ${sentenceCase(nextStep)}`,
    "",
    closing,
    "",
    params.plainSignature || "[Email signature]",
  ];

  const htmlIntro = [
    `Hi ${params.firstName},`,
    "Thank you again for taking the time to meet with me.",
    "I am sending an updated Client Snapshot based on the holdings we have on file, with today's refreshed analysis.",
    synopsis,
    `One thing that stood out is that ${sentenceCase(highlight)}`,
    `From here, the next step will be to ${sentenceCase(nextStep)}`,
    closing,
  ];

  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.55;">
      ${paragraphsToHtml(htmlIntro)}
      <div style="margin-top:18px;">
        ${params.htmlSignature || "[Email signature]"}
      </div>
    </div>
  `;

  return {
    plainText: plainLines.join("\n"),
    html: htmlBody,
  };
}

function buildEmailWithAttachment(params: {
  from?: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
  pdfBytes: Buffer;
  filename: string;
}) {
  const mixedBoundary = `advisorpilot_mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `advisorpilot_alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const to = sanitizeHeader(params.to);
  const subject = sanitizeHeader(params.subject);
  const from = sanitizeHeader(params.from || "");
  const pdfBase64 = params.pdfBytes.toString("base64").replace(/(.{76})/g, "$1\r\n");

  const messageParts = [
    from ? `From: ${from}` : "",
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    params.plainBody || "",
    "",
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    params.htmlBody || "",
    "",
    `--${altBoundary}--`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: application/pdf; name="${params.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${params.filename}"`,
    "",
    pdfBase64,
    "",
    `--${mixedBoundary}--`,
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

    const emailVariant = body?.emailVariant === "follow_up" ? "follow_up" : "standard";

    const defaultSubject =
      emailVariant === "follow_up"
        ? "Following-up Financial Review - Have Not Heard Back"
        : `Next Steps from Our Portfolio Review - ${clientDisplayName(body?.client || {}) || "Client"}`;

    const subject = body?.subject || defaultSubject;

    const firstName = clientFirstNameSalutation(body?.client || {});
    const synopsisSentences = getFirstSentences(body?.analysis?.synopsis, 2);

    const portfolioHighlight =
      Array.isArray(body?.analysis?.portfolioHighlights) && body.analysis.portfolioHighlights.length
        ? String(body.analysis.portfolioHighlights[0])
        : "";

    const strategy =
      Array.isArray(body?.analysis?.strategies) && body.analysis.strategies.length
        ? String(body.analysis.strategies[0])
        : "review the portfolio together and confirm it aligns with your goals.";

    const advisorProfile = await getAdvisorProfile(senderEmail);
    const plainSignature = buildPlainSignature(advisorProfile, body?.emailSignature, body?.calendarLink);
    const htmlSignature = buildHtmlSignature(advisorProfile, body?.emailSignature, body?.calendarLink);

    const emailBodies =
      emailVariant === "follow_up"
        ? buildFollowUpClientEmailBodies({
            firstName,
            synopsis: synopsisSentences,
            highlight: portfolioHighlight,
            nextStep: strategy,
            plainSignature,
            htmlSignature,
          })
        : buildClientEmailBodies({
            firstName,
            synopsis: synopsisSentences,
            highlight: portfolioHighlight,
            nextStep: strategy,
            plainSignature,
            htmlSignature,
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
      plainBody: emailBodies.plainText,
      htmlBody: emailBodies.html,
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
      message:
        emailVariant === "follow_up"
          ? "Follow-up email with an updated Client Snapshot was sent successfully."
          : "Client Snapshot email sent successfully.",
      plainTextBody: emailBodies.plainText,
    });
  } catch (err: any) {
    console.error("EMAIL CLIENT SNAPSHOT ERROR:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to send Client Snapshot email." },
      { status: 500 }
    );
  }
}
