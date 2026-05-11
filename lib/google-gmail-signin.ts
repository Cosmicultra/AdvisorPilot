/**
 * Gmail send uses the Google OAuth access token from NextAuth.
 * When it expires or is revoked, advisors must go through Google sign-in again
 * (optionally with consent) so a fresh token (and scopes) are issued.
 *
 * Pass {@link GOOGLE_GMAIL_REAUTHORIZE_PARAMS} as the third argument to
 * `signIn("google", { callbackUrl }, …)` from `next-auth/react`.
 */
export const GOOGLE_GMAIL_REAUTHORIZE_PARAMS = {
  prompt: "consent" as const,
  access_type: "offline" as const,
};

/** Prefer current URL so the advisor returns to the same step after OAuth. */
export function googleGmailReconnectCallbackUrl(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
}
