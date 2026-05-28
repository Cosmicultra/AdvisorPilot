import { google } from "googleapis";
import { loadGmailRefreshToken } from "@/lib/gmail/token-store";

export class GoogleNotConnectedError extends Error {
  readonly needsGoogleReconnect = true;
  constructor(message = "Google is not connected. Reconnect Google to enable calendar sync.") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export async function getGoogleAccessToken(advisorEmail: string): Promise<string> {
  const refreshToken = await loadGmailRefreshToken(advisorEmail);
  if (!refreshToken) {
    throw new GoogleNotConnectedError();
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
    throw new GoogleNotConnectedError("Could not refresh Google access token.");
  }
  return accessToken;
}

export async function getGoogleOauthClient(advisorEmail: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }
  const refreshToken = await loadGmailRefreshToken(advisorEmail);
  if (!refreshToken) throw new GoogleNotConnectedError();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

