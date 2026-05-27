/** McKinsey-inspired Roth intake chart palette — AdvisorPilot brand blues + Roth PDF. */

export const ROTH_VISUAL_COLORS = {

  stay: "#163765",

  stayLight: "#d3dff0",

  /** Roth conversion path — brand accent blue. */

  roth: "#2563c4",

  rothLight: "#dbeafe",

  heirs: "#4f7cac",

  income: "#2563c4",

  taxes: "#b91c1c",

  taxesLight: "#fecaca",

  accent: "#2563c4",

  navy: "#0b1540",

  /** Readable on light blue fills. */

  onBrandLight: "#0b1540",

  muted: "#64748b",

  convertZone: "#2563c4",

  convertZoneLight: "#dbeafe",

  stopLine: "#163765",

  avoidZone: "#fca5a5",

  avoidZoneLight: "#fef2f2",

} as const;



const moneyFull = new Intl.NumberFormat("en-US", {

  style: "currency",

  currency: "USD",

  maximumFractionDigits: 0,

});



/** Full USD for detail labels (e.g. $768,700). */

export function formatRothMoneyFull(n: number): string {

  if (!Number.isFinite(n)) return "—";

  return moneyFull.format(Math.round(n));

}



/** Compact USD for chart headlines (e.g. $9.56M, $172.7K). */

export function formatRothMoneyCompact(n: number): string {

  if (!Number.isFinite(n)) return "—";

  const abs = Math.abs(n);

  const sign = n < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;

  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;

  return `${sign}${moneyFull.format(Math.round(abs))}`;

}



/** Signed compact delta with explicit + prefix when positive. */

export function formatRothDeltaCompact(n: number): string {

  if (!Number.isFinite(n)) return "—";

  if (n > 0) return `+${formatRothMoneyCompact(n)}`;

  if (n < 0) return `-${formatRothMoneyCompact(Math.abs(n))}`;

  return formatRothMoneyCompact(0);

}



/** Percent with one decimal, signed when requested. */

export function formatRothPct(n: number, signed = false): string {

  if (!Number.isFinite(n)) return "—";

  const rounded = Math.round(n * 10) / 10;

  if (signed && rounded > 0) return `+${rounded}%`;

  if (signed && rounded < 0) return `${rounded}%`;

  return `${rounded}%`;

}



/** Effective rate display (e.g. 32.6%). */

export function formatEffectiveRate(n: number): string {

  if (!Number.isFinite(n)) return "—";

  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;

}

