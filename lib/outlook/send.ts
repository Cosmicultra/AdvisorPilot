import { outlookSendNeedsReconnect } from "./errors";
import { getOutlookAccessToken, OutlookNotConnectedError } from "./oauth";

export type OutlookAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
};

export type SendOutlookResult =
  | { ok: true }
  | { ok: false; error: string; needsOutlookReconnect?: boolean };

export async function sendOutlookMessage(params: {
  advisorEmail: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
  attachments?: OutlookAttachment[];
  accessTokenOverride?: string;
}): Promise<SendOutlookResult> {
  try {
    const accessToken = await getOutlookAccessToken(params.advisorEmail, params.accessTokenOverride);

    const message: Record<string, unknown> = {
      subject: params.subject,
      body: {
        contentType: "HTML",
        content: params.htmlBody || params.plainBody.replace(/\n/g, "<br />"),
      },
      toRecipients: [{ emailAddress: { address: params.to } }],
    };

    if (params.attachments?.length) {
      message.attachments = params.attachments.map((attachment) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: attachment.contentType,
        contentBytes: attachment.contentBytes,
      }));
    }

    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (!res.ok) {
      const body = await res.text();
      const err = { status: res.status, message: body, body: tryParseJson(body) };
      const reconnect = outlookSendNeedsReconnect(err);
      return {
        ok: false,
        error: reconnect
          ? "Outlook could not send. Reconnect Microsoft and allow Mail.Send access, then try again."
          : body || "Outlook send failed.",
        needsOutlookReconnect: reconnect,
      };
    }

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof OutlookNotConnectedError) {
      return {
        ok: false,
        error: err.message,
        needsOutlookReconnect: true,
      };
    }
    console.error("[outlook:send] failed:", err);
    const reconnect = outlookSendNeedsReconnect(err);
    const msg = err instanceof Error ? err.message : "Outlook send failed.";
    return {
      ok: false,
      error: reconnect
        ? "Outlook could not send. Reconnect Microsoft and allow Mail.Send access, then try again."
        : msg,
      needsOutlookReconnect: reconnect,
    };
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
