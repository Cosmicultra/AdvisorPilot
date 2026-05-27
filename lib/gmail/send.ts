import { google } from "googleapis";
import { gmailSendNeedsGoogleReconnect } from "./errors";
import { getGmailAccessToken, GmailNotConnectedError } from "./oauth";
import {
  base64UrlEncode,
  buildMultipartEmailWithAttachments,
  buildSimpleMultipartEmail,
  type GmailMimeAttachment,
} from "./mime";

export type SendGmailResult =
  | { ok: true }
  | { ok: false; error: string; needsGoogleReconnect?: boolean };

export async function sendGmailMessage(params: {
  advisorEmail: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
  attachments?: GmailMimeAttachment[];
  accessTokenOverride?: string;
}): Promise<SendGmailResult> {
  try {
    const accessToken = await getGmailAccessToken(
      params.advisorEmail,
      params.accessTokenOverride
    );
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const rawMessage =
      params.attachments?.length
        ? buildMultipartEmailWithAttachments({
            from: params.advisorEmail,
            to: params.to,
            subject: params.subject,
            plainBody: params.plainBody,
            htmlBody: params.htmlBody,
            attachments: params.attachments,
          })
        : buildSimpleMultipartEmail({
            from: params.advisorEmail,
            to: params.to,
            subject: params.subject,
            plainBody: params.plainBody,
            htmlBody: params.htmlBody,
          });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: base64UrlEncode(rawMessage) },
    });

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof GmailNotConnectedError) {
      return {
        ok: false,
        error: err.message,
        needsGoogleReconnect: true,
      };
    }
    console.error("[gmail:send] failed:", err);
    const reconnect = gmailSendNeedsGoogleReconnect(err);
    const msg = err instanceof Error ? err.message : "Gmail send failed.";
    return {
      ok: false,
      error: reconnect
        ? "Gmail could not send. Reconnect Google and allow Gmail send access, then try again."
        : msg,
      needsGoogleReconnect: reconnect,
    };
  }
}
