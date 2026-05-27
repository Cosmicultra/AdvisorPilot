import { loadGmailRefreshToken } from "@/lib/gmail/token-store";
import { sendGmailMessage } from "@/lib/gmail/send";
import { loadOutlookRefreshToken } from "@/lib/outlook/token-store";
import { sendOutlookMessage, type OutlookAttachment } from "@/lib/outlook/send";
import { getNextAuthAuthProvider } from "@/lib/outlook-connection";
import { isGmailConnected } from "@/lib/gmail-connection";
import { isOutlookConnected } from "@/lib/outlook-connection";

export type AdvisorEmailProvider = "gmail" | "outlook";

export type AdvisorEmailAttachment = {
  filename: string;
  contentType: string;
  contentBytes: string;
};

export type SendAdvisorEmailResult =
  | { ok: true; provider: AdvisorEmailProvider }
  | {
      ok: false;
      error: string;
      provider?: AdvisorEmailProvider | null;
      needsGoogleReconnect?: boolean;
      needsOutlookReconnect?: boolean;
    };

export async function resolveEmailProviderForAdvisor(
  advisorEmail: string,
  options?: { authProvider?: string | null; prefer?: AdvisorEmailProvider | null }
): Promise<AdvisorEmailProvider | null> {
  const prefer = options?.prefer ?? null;
  const authProvider = options?.authProvider ?? null;

  const [gmailToken, outlookToken] = await Promise.all([
    loadGmailRefreshToken(advisorEmail),
    loadOutlookRefreshToken(advisorEmail),
  ]);
  const hasGmail = Boolean(gmailToken?.trim());
  const hasOutlook = Boolean(outlookToken?.trim());

  if (authProvider === "azure-ad" && hasOutlook) return "outlook";
  if (authProvider === "google" && hasGmail) return "gmail";
  if (prefer === "outlook" && hasOutlook) return "outlook";
  if (prefer === "gmail" && hasGmail) return "gmail";
  if (hasGmail) return "gmail";
  if (hasOutlook) return "outlook";
  return null;
}

export async function resolveInteractiveEmailProvider(
  advisorEmail: string,
  req?: Request,
  accessToken?: string | null
): Promise<{ provider: AdvisorEmailProvider | null; accessTokenOverride?: string }> {
  const authProvider = req ? await getNextAuthAuthProvider(req) : null;

  if (authProvider === "azure-ad") {
    const connected = await isOutlookConnected(req);
    if (connected && accessToken) {
      return { provider: "outlook", accessTokenOverride: accessToken };
    }
  }

  if (authProvider === "google") {
    const connected = await isGmailConnected(req);
    if (connected && accessToken) {
      return { provider: "gmail", accessTokenOverride: accessToken };
    }
  }

  const provider = await resolveEmailProviderForAdvisor(advisorEmail, { authProvider });
  return { provider: provider ?? null };
}

export async function sendAdvisorEmail(params: {
  advisorEmail: string;
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
  provider?: AdvisorEmailProvider | null;
  attachments?: AdvisorEmailAttachment[];
  accessTokenOverride?: string;
}): Promise<SendAdvisorEmailResult> {
  const provider =
    params.provider ?? (await resolveEmailProviderForAdvisor(params.advisorEmail));

  if (!provider) {
    return {
      ok: false,
      error:
        "No email provider connected. Sign in with Google for Gmail or Microsoft for Outlook, then try again.",
      provider: null,
    };
  }

  if (provider === "gmail") {
    const sendResult = await sendGmailMessage({
      advisorEmail: params.advisorEmail,
      to: params.to,
      subject: params.subject,
      plainBody: params.plainBody,
      htmlBody: params.htmlBody,
      accessTokenOverride: params.accessTokenOverride,
    });
    if (!sendResult.ok) {
      return {
        ok: false,
        error: sendResult.error,
        provider: "gmail",
        needsGoogleReconnect: sendResult.needsGoogleReconnect,
      };
    }
    return { ok: true, provider: "gmail" };
  }

  const outlookAttachments: OutlookAttachment[] | undefined = params.attachments?.map((attachment) => ({
    name: attachment.filename,
    contentType: attachment.contentType,
    contentBytes: attachment.contentBytes,
  }));

  const sendResult = await sendOutlookMessage({
    advisorEmail: params.advisorEmail,
    to: params.to,
    subject: params.subject,
    plainBody: params.plainBody,
    htmlBody: params.htmlBody,
    attachments: outlookAttachments,
    accessTokenOverride: params.accessTokenOverride,
  });

  if (!sendResult.ok) {
    return {
      ok: false,
      error: sendResult.error,
      provider: "outlook",
      needsOutlookReconnect: sendResult.needsOutlookReconnect,
    };
  }

  return { ok: true, provider: "outlook" };
}

export function advisorEmailReconnectFlags(result: SendAdvisorEmailResult): {
  needsGoogleReconnect?: boolean;
  needsOutlookReconnect?: boolean;
} {
  if (result.ok) return {};
  return {
    needsGoogleReconnect: result.needsGoogleReconnect,
    needsOutlookReconnect: result.needsOutlookReconnect,
  };
}
