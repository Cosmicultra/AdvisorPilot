/**
 * Mailto target for marketing CTAs (Request access, Talk to sales).
 * Set `NEXT_PUBLIC_CONTACT_EMAIL` in `.env.local` to override the default.
 */
export const MARKETING_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "hello@advisorpilot.com";
