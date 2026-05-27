export function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function sanitizeHeader(value: string): string {
  return String(value || "").replace(/[\r\n]/g, " ").trim();
}

export type GmailMimeAttachment = {
  filename: string;
  contentType: string;
  /** Base64-encoded file bytes (same shape as Graph API / sendAdvisorEmail). */
  contentBytes: string;
};

function wrapBase64Body(base64: string): string {
  return base64.replace(/(.{76})/g, "$1\r\n");
}

export function buildMultipartEmailWithAttachments(params: {
  from?: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
  attachments: GmailMimeAttachment[];
}): string {
  const mixedBoundary = `ap_mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `ap_alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const to = sanitizeHeader(params.to);
  const subject = sanitizeHeader(params.subject);
  const from = params.from ? sanitizeHeader(params.from) : "";

  const messageParts: string[] = [
    ...(from ? [`From: ${from}`] : []),
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
  ];

  for (const attachment of params.attachments) {
    const filename = sanitizeHeader(attachment.filename);
    const contentType = sanitizeHeader(attachment.contentType || "application/octet-stream");
    const pdfBase64 = wrapBase64Body(attachment.contentBytes);

    messageParts.push(
      "",
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      pdfBase64,
      ""
    );
  }

  messageParts.push(`--${mixedBoundary}--`);
  return messageParts.join("\r\n");
}

export function buildSimpleMultipartEmail(params: {
  from?: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
}): string {
  const boundary = `ap_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const to = sanitizeHeader(params.to);
  const subject = sanitizeHeader(params.subject);
  const from = params.from ? sanitizeHeader(params.from) : "";

  return [
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
  ].join("\r\n");
}

export function plainParagraphsToHtml(paragraphs: string): string {
  const blocks = paragraphs
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!blocks.length) return "";
  return blocks
    .map(
      (p) =>
        `<p style="margin:0 0 12px 0;">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`
    )
    .join("");
}

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
