/** Comparative fee analysis palette — slate current, violet proposed, navy accent. */
export const FEE_VISUAL_COLORS = {
  current: "#475569",
  currentLight: "#f1f5f9",
  proposed: "#5b21b6",
  proposedLight: "#ede9fe",
  savings: "#166534",
  savingsLight: "#d1fae5",
  increase: "#b45309",
  increaseLight: "#fef3c7",
  navy: "#0c1929",
  muted: "#64748b",
  coverage: "#0f6fde",
  coverageLight: "#cce4ff",
} as const;

const moneyFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Full USD for detail labels (e.g. $768,700). */
export function formatFeeMoneyFull(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return moneyFull.format(Math.round(n));
}

/** Compact USD for chart headlines (e.g. $9.56M, $172.7K). */
export function formatFeeMoneyCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${moneyFull.format(Math.round(abs))}`;
}

/** Signed compact delta with explicit + prefix when positive. */
export function formatFeeDeltaCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${formatFeeMoneyCompact(n)}`;
  if (n < 0) return `-${formatFeeMoneyCompact(Math.abs(n))}`;
  return formatFeeMoneyCompact(0);
}

/** Blended drag change in percentage points (e.g. 0.183 pts). */
export function formatFeeDragPts(decimalFraction: number, signed = false): string {
  if (!Number.isFinite(decimalFraction)) return "—";
  const pts = decimalFraction * 100;
  const rounded = Math.round(pts * 1000) / 1000;
  const text = `${Math.abs(rounded).toFixed(3)} pts`;
  if (!signed || rounded === 0) return text;
  return rounded > 0 ? `+${text}` : `-${text}`;
}

/** Whole-number percent (e.g. 94%). */
export function formatFeePctWhole(decimalFraction: number): string {
  if (!Number.isFinite(decimalFraction)) return "—";
  return `${Math.round(decimalFraction * 100)}%`;
}
