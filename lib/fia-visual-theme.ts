/** FIA calculator comparison palette — brand blues (logo / report accent), red market exposure. */

export const FIA_VISUAL_COLORS = {

  /** Primary brand blue (#2563c4). */

  fiaContract: "#2563c4",

  /** Light fill for FIA cards and up-zone segments (#dbeafe). */

  fiaContractLight: "#dbeafe",

  sp500: "#dc2626",

  sp500Light: "#fecaca",

  protection: "#2563c4",

  protectionLight: "#dbeafe",

  cap: "#4a7fc1",

  capLight: "#e8f4fd",

  rmd: "#64748b",

  rider: "#2563c4",

  navy: "#0b1540",

  /** Readable on light blue fills. */

  onBrandLight: "#0b1540",

  muted: "#64748b",

  downZone: "#2563c4",

  upZone: "#2563c4",

  upZoneLight: "#e8f4fd",

} as const;



const moneyFull = new Intl.NumberFormat("en-US", {

  style: "currency",

  currency: "USD",

  maximumFractionDigits: 0,

});



/** Full USD for detail labels (e.g. $768,700). */

export function formatFiaMoneyFull(n: number): string {

  if (!Number.isFinite(n)) return "—";

  return moneyFull.format(Math.round(n));

}



/** Compact USD for chart headlines (e.g. $9.56M, $172.7K). */

export function formatFiaMoneyCompact(n: number): string {

  if (!Number.isFinite(n)) return "—";

  const abs = Math.abs(n);

  const sign = n < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;

  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;

  return `${sign}${moneyFull.format(Math.round(abs))}`;

}



/** Signed compact delta with explicit + prefix when positive. */

export function formatFiaDeltaCompact(n: number): string {

  if (!Number.isFinite(n)) return "—";

  if (n > 0) return `+${formatFiaMoneyCompact(n)}`;

  if (n < 0) return `-${formatFiaMoneyCompact(Math.abs(n))}`;

  return formatFiaMoneyCompact(0);

}



/** Percent with one decimal, signed when requested. */

export function formatFiaPct(n: number, signed = false): string {

  if (!Number.isFinite(n)) return "—";

  const rounded = Math.round(n * 10) / 10;

  if (signed && rounded > 0) return `+${rounded}%`;

  if (signed && rounded < 0) return `${rounded}%`;

  return `${rounded}%`;

}

