/**
 * Money fields: store digit strings only; format with commas for display.
 */

/** Canonical stored value: digits with optional "." and up to 2 fraction digits. */
export function parseMoneyInputRaw(input: string): string {
  const cleaned = String(input ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return "";

  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;

  const whole = cleaned.slice(0, dot);
  const fraction = cleaned
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2);

  if (cleaned.endsWith(".") && fraction.length === 0) {
    return `${whole}.`;
  }
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** Insert thousands separators without Number() so partial typing stays stable. */
function formatWholeDigits(whole: string): string {
  if (!whole) return "";
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Comma-grouped display for controlled inputs (no "$" — prefix is separate). */
export function formatMoneyInputDisplay(stored: string): string {
  const raw = parseMoneyInputRaw(stored);
  if (!raw) return "";

  if (raw.endsWith(".")) {
    const whole = raw.slice(0, -1);
    return whole ? `${formatWholeDigits(whole)}.` : ".";
  }

  const dot = raw.indexOf(".");
  if (dot === -1) return formatWholeDigits(raw);

  const whole = raw.slice(0, dot);
  const fraction = raw.slice(dot + 1);
  return fraction.length > 0 ? `${formatWholeDigits(whole)}.${fraction}` : formatWholeDigits(whole);
}

/** @deprecated Use parseMoneyInputRaw */
export function sanitizeMoneyDigits(raw: string): string {
  return parseMoneyInputRaw(raw);
}

/** @deprecated Use parseMoneyInputRaw */
export function formatMoneyInputFromTyping(raw: string): string {
  return parseMoneyInputRaw(raw);
}

export function countMoneyDigitsBefore(display: string, cursor: number): number {
  let count = 0;
  const end = Math.min(cursor, display.length);
  for (let i = 0; i < end; i++) {
    if (display[i] >= "0" && display[i] <= "9") count++;
  }
  return count;
}

export function moneyCursorAfterDigits(display: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    if (display[i] >= "0" && display[i] <= "9") {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return display.length;
}
