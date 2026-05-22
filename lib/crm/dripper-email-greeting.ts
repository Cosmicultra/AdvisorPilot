/**
 * Client email greeting helper — safe for browser bundles (no LLM / Node imports).
 */

/** Formal opening: Hi {name}, then blank line, then body (all client drip emails). */
export function formatClientEmailBody(firstName: string, rawBody: string): string {
  const name = firstName.trim() || "there";
  let rest = rawBody.trim();
  rest = rest.replace(/^(hi|hello|dear)\s+[^,\n]+,?\s*/i, "").trim();
  return `Hi ${name},\n\n${rest}`;
}
