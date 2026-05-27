/**
 * Outlook send uses the Microsoft OAuth access token from NextAuth (Azure AD).
 * When it expires or is revoked, advisors must go through Microsoft sign-in again
 * so a fresh token (and Mail.Send scope) are issued.
 *
 * Pass {@link MICROSOFT_OUTLOOK_SIGNIN_PARAMS} as the third argument to
 * `signIn("azure-ad", { callbackUrl }, …)` from `next-auth/react`.
 */
export const MICROSOFT_OUTLOOK_SIGNIN_PARAMS = {
  prompt: "consent" as const,
};

/** Prefer current URL so the advisor returns to the same step after OAuth. */
export function microsoftOutlookReconnectCallbackUrl(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
}

export const MICROSOFT_OUTLOOK_REAUTHORIZE_PARAMS = {
  prompt: "consent" as const,
};
