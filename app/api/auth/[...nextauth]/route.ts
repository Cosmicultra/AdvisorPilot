import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { persistGmailRefreshToken } from "@/lib/gmail/token-store";
import { persistOutlookRefreshToken } from "@/lib/outlook/token-store";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID || "",
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET || "",
      tenantId: process.env.AZURE_AD_TENANT_ID || "common",
      authorization: {
        params: {
          scope: "openid profile email offline_access Mail.Send",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }

      if (account?.refresh_token) {
        token.refreshToken = account.refresh_token;
      }

      if (account?.provider) {
        token.authProvider = account.provider;
      }

      if (account?.refresh_token) {
        const email =
          (typeof user?.email === "string" ? user.email : null) ||
          (typeof token.email === "string" ? token.email : null);
        if (email) {
          if (account.provider === "google") {
            void persistGmailRefreshToken(email, account.refresh_token);
          } else if (account.provider === "azure-ad") {
            void persistOutlookRefreshToken(email, account.refresh_token);
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        accessToken: token.accessToken,
        authProvider: token.authProvider,
      };
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
