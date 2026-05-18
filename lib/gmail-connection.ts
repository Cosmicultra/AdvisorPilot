import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

type SessionWithAccessToken = {
  accessToken?: string;
};

type JwtWithRefresh = {
  refreshToken?: string;
  accessToken?: string;
};

/**
 * Gmail send uses Google OAuth (NextAuth). Email/password-only sign-in
 * has no Gmail token until the advisor completes Google OAuth with
 * gmail.send scope.
 */
export async function isGmailConnected(req?: Request): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if ((session as SessionWithAccessToken | null)?.accessToken) {
    return true;
  }

  if (!req || !process.env.NEXTAUTH_SECRET) {
    return false;
  }

  try {
    const token = (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    })) as JwtWithRefresh | null;
    return Boolean(token?.accessToken || token?.refreshToken);
  } catch {
    return false;
  }
}
