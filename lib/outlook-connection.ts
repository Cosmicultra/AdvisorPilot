import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

type SessionWithAccessToken = {
  accessToken?: string;
  authProvider?: string;
};

type JwtWithRefresh = {
  refreshToken?: string;
  accessToken?: string;
  authProvider?: string;
};

/**
 * Outlook send uses Microsoft OAuth (NextAuth Azure AD).
 * Email/password-only sign-in has no Outlook token until the advisor
 * completes Microsoft OAuth with Mail.Send scope.
 */
export async function isOutlookConnected(req?: Request): Promise<boolean> {
  const session = (await getServerSession(authOptions)) as SessionWithAccessToken | null;
  if (session?.authProvider === "azure-ad" && session.accessToken) {
    return true;
  }

  if (!req || !process.env.NEXTAUTH_SECRET) {
    return false;
  }

  try {
    const token = (await getToken({
      req: req as Parameters<typeof getToken>[0]["req"],
      secret: process.env.NEXTAUTH_SECRET,
    })) as JwtWithRefresh | null;
    if (token?.authProvider === "azure-ad") {
      return Boolean(token.accessToken || token.refreshToken);
    }
    return false;
  } catch {
    return false;
  }
}

export async function getNextAuthAuthProvider(req?: Request): Promise<string | null> {
  const session = (await getServerSession(authOptions)) as SessionWithAccessToken | null;
  if (session?.authProvider) return session.authProvider;

  if (!req || !process.env.NEXTAUTH_SECRET) return null;

  try {
    const token = (await getToken({
      req: req as Parameters<typeof getToken>[0]["req"],
      secret: process.env.NEXTAUTH_SECRET,
    })) as JwtWithRefresh | null;
    return token?.authProvider ?? null;
  } catch {
    return null;
  }
}
