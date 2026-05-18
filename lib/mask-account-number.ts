/** Alphanumeric custodian prefix before hyphenated account digits (BRK, IRA, 401K, …). */
const HYPHENATED_PREFIX = /^((?:[A-Za-z][A-Za-z0-9]*|[A-Za-z0-9]*[A-Za-z]))-(.+)$/;

/**
 * Mask custodian account numbers for UI/storage: keep type prefix (BRK, IRA, 401K, …),
 * hide digits except the last four.
 */
export function maskAccountNumberDisplay(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const digits = s.replace(/\D/g, "");
  if (!digits.length) return s;

  const last4 = digits.slice(-4);

  if (/\*{2,}/.test(s) && digits.length <= 4) {
    const hyphenated = s.match(/^((?:[A-Za-z][A-Za-z0-9]*|[A-Za-z0-9]*[A-Za-z]))-\*+/);
    if (hyphenated) return `${hyphenated[1]}-****-${last4}`;
    const spaced = s.match(/^(.+?)\s+\*+/);
    if (spaced) return `${spaced[1].trim()} ****${last4}`;
    return `****${last4}`;
  }

  if (digits.length <= 4) {
    const hyphenated = s.match(/^((?:[A-Za-z][A-Za-z0-9]*|[A-Za-z0-9]*[A-Za-z]))-([\d*\-]+)$/);
    if (hyphenated) return `${hyphenated[1]}-${last4}`;
    const spaced = s.match(/^(.+?)\s+([\d*\-]+)$/);
    if (spaced) return `${spaced[1].trim()} ${last4}`;
    return last4;
  }

  const hyphenated = s.match(HYPHENATED_PREFIX);
  if (hyphenated) {
    return `${hyphenated[1]}-****-${last4}`;
  }

  const spaced = s.match(/^(.+?)\s+(\d[\d\s\-]*)$/);
  if (spaced) {
    return `${spaced[1].trim()} ****${last4}`;
  }

  return `****${last4}`;
}
