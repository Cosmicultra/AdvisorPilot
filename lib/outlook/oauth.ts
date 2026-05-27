import { loadOutlookRefreshToken } from "./token-store";

export class OutlookNotConnectedError extends Error {
  readonly needsOutlookReconnect = true;
  constructor(message = "Outlook is not connected. Sign in with Microsoft and allow Mail.Send access.") {
    super(message);
    this.name = "OutlookNotConnectedError";
  }
}

function getMicrosoftTokenEndpoint(): string {
  const tenant = process.env.AZURE_AD_TENANT_ID?.trim() || "common";
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

export async function getOutlookAccessToken(
  advisorEmail: string,
  accessTokenOverride?: string
): Promise<string> {
  if (accessTokenOverride?.trim()) {
    return accessTokenOverride.trim();
  }

  const refreshToken = await loadOutlookRefreshToken(advisorEmail);
  if (!refreshToken) {
    throw new OutlookNotConnectedError();
  }

  const clientId = process.env.AZURE_AD_CLIENT_ID?.trim();
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing AZURE_AD_CLIENT_ID or AZURE_AD_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "openid profile email offline_access Mail.Send",
  });

  const res = await fetch(getMicrosoftTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || "Could not refresh Outlook access token.";
    throw new OutlookNotConnectedError(detail);
  }

  return data.access_token;
}
