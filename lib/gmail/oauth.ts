import { google } from "googleapis";
import { loadGmailRefreshToken } from "./token-store";

export class GmailNotConnectedError extends Error {
  readonly needsGoogleReconnect = true;
  constructor(message = "Gmail is not connected. Sign in with Google and allow Gmail send access.") {
    super(message);
    this.name = "GmailNotConnectedError";
  }
}

export async function getGmailAccessToken(
  advisorEmail: string,
  accessTokenOverride?: string
): Promise<string> {
  if (accessTokenOverride?.trim()) {
    return accessTokenOverride.trim();
  }

  const refreshToken = await loadGmailRefreshToken(advisorEmail);
  if (!refreshToken) {
    throw new GmailNotConnectedError();
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  const accessToken = credentials.access_token;
  if (!accessToken) {
    throw new GmailNotConnectedError("Could not refresh Gmail access token.");
  }
  return accessToken;
}
