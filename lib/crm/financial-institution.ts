/**
 * Detect and normalize custodian / broker names from statement text or filenames.
 */

/** Canonical display names keyed by normalized search tokens (longest match wins). */
const CUSTODIAN_ALIASES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcharles\s+schwab\b/i, label: "Schwab" },
  { pattern: /\bschwab\b/i, label: "Schwab" },
  { pattern: /\bfidelity\s+investments?\b/i, label: "Fidelity" },
  { pattern: /\bfidelity\b/i, label: "Fidelity" },
  { pattern: /\bvanguard\b/i, label: "Vanguard" },
  { pattern: /\btd\s+ameritrade\b/i, label: "TD Ameritrade" },
  { pattern: /\bameritrade\b/i, label: "TD Ameritrade" },
  { pattern: /\bedward\s+jones\b/i, label: "Edward Jones" },
  { pattern: /\bmorgan\s+stanley\b/i, label: "Morgan Stanley" },
  { pattern: /\braymond\s+james\b/i, label: "Raymond James" },
  { pattern: /\blpl\s+financial\b/i, label: "LPL" },
  { pattern: /\blpl\b/i, label: "LPL" },
  { pattern: /\bpershing\b/i, label: "Pershing" },
  { pattern: /\binteractive\s+brokers?\b/i, label: "Interactive Brokers" },
  { pattern: /\betrade\b/i, label: "E*TRADE" },
  { pattern: /\be\s*\*\s*trade\b/i, label: "E*TRADE" },
  { pattern: /\bameriprise\b/i, label: "Ameriprise" },
  { pattern: /\bwells\s+fargo\s+advisors?\b/i, label: "Wells Fargo Advisors" },
  { pattern: /\bwells\s+fargo\b/i, label: "Wells Fargo" },
  { pattern: /\bbank\s+of\s+america\s+securities\b/i, label: "BofA Securities" },
  { pattern: /\bbofa\s+securities\b/i, label: "BofA Securities" },
  { pattern: /\bmerill\s+lynch\b/i, label: "Merrill" },
  { pattern: /\bmerrill\s+lynch\b/i, label: "Merrill" },
  { pattern: /\bubs\s+financial\b/i, label: "UBS" },
  { pattern: /\bubs\b/i, label: "UBS" },
  { pattern: /\bnational\s+financial\b/i, label: "National Financial" },
  { pattern: /\bally\s+invest\b/i, label: "Ally Invest" },
  { pattern: /\brobinhood\s+securities\b/i, label: "Robinhood" },
  { pattern: /\brobinhood\b/i, label: "Robinhood" },
];

const SCAN_TEXT_MAX_CHARS = 4_000;

export function normalizeFinancialInstitution(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 80) return null;
  return s.replace(/\s+/g, " ");
}

/**
 * Best-effort custodian name from embedded PDF text and/or upload filename.
 */
export function detectFinancialInstitutionFromText(
  text: string | null | undefined,
  fileName?: string | null
): string | null {
  const chunks: string[] = [];
  if (text?.trim()) {
    chunks.push(text.trim().slice(0, SCAN_TEXT_MAX_CHARS));
  }
  if (fileName?.trim()) {
    const base = fileName.replace(/\.[a-z0-9]+$/i, " ").replace(/[_\-]+/g, " ");
    chunks.push(base);
  }
  if (chunks.length === 0) return null;

  const haystack = chunks.join("\n");
  for (const { pattern, label } of CUSTODIAN_ALIASES) {
    if (pattern.test(haystack)) return label;
  }
  return null;
}

export function financialInstitutionFromHolding(
  h: { financialInstitution?: unknown }
): string | null {
  return normalizeFinancialInstitution(String(h.financialInstitution ?? ""));
}

/** Stamp institution on rows that lack it (same batch / file). */
export function stampFinancialInstitutionOnHoldings<T extends Record<string, unknown>>(
  holdings: T[],
  institution: string | null
): T[] {
  const label = normalizeFinancialInstitution(institution ?? "");
  if (!label) return holdings;
  return holdings.map((row) => {
    if (financialInstitutionFromHolding(row)) return row;
    return { ...row, financialInstitution: label };
  });
}
