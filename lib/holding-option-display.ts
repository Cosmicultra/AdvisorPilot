/**
 * Short label for the Matched holding dropdown — ticker-style symbol + share class only.
 * The underlying option string stays full-length for storage; this is display-only.
 */

const MANUAL_LABEL = "Manual ticker / CUSIP entry";

function looksLikeTicker(token: string): boolean {
  return /^[A-Z]{1,5}$/.test(token) || /^[A-Z]{1,5}[A-Z]?$/.test(token);
}

/** Pull a plausible ticker from the start of the string or from common patterns. */
function extractTicker(s: string): string | null {
  const upper = s.toUpperCase();
  const fm = upper.match(/\b([A-Z]{1,5})\b/);
  if (fm && looksLikeTicker(fm[1])) return fm[1];

  const m2 = s.match(/\(([A-Z]{1,5})\)/);
  if (m2 && looksLikeTicker(m2[1].toUpperCase())) return m2[1].toUpperCase();

  return null;
}

/** Heuristic: share class name often after an em dash, hyphen, or in parentheses. */
function extractShareClass(s: string): string | null {
  const paren = s.match(/\(([^)]+)\)\s*$/);
  if (paren) {
    const inner = paren[1].trim();
    if (/share|class|adm|inv|inst/i.test(inner) && inner.length <= 40) return inner;
  }

  const parts = s.split(/\s*[–—\-]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const cleaned = last.replace(/^[^\w]+/, "").trim();
    if (
      cleaned.length > 0 &&
      cleaned.length <= 48 &&
      /admiral|investor|institutional|class|\bI$|\bZ$/i.test(cleaned)
    ) {
      return cleaned;
    }
    const words = cleaned.split(/\s+/);
    if (words.length <= 6 && cleaned.length <= 48) return cleaned;
  }

  const classPhrase = s.match(
    /\b(Admiral|Investor|Institutional|Class\s+[A-Z]|[A-Z]\s+Shares?)\b/i
  );
  if (classPhrase) return classPhrase[0];

  return null;
}

export function formatMatchedHoldingOptionLabel(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/manual\s+ticker/i.test(s) || /cusip\s*entry/i.test(s)) return MANUAL_LABEL;
  if (/needs\s+advisor/i.test(s)) return "Needs advisor confirmation";

  const ticker = extractTicker(s);
  const share = extractShareClass(s);

  if (ticker && share) return `${ticker} — ${share}`;
  if (ticker) return ticker;
  if (share) return share;
  return s.length > 36 ? `${s.slice(0, 33)}...` : s;
}
