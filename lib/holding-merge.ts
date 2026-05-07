function holdingKey(holding: Record<string, unknown>) {
  const symbol = String(holding.normalizedSymbol || holding.suggested || holding.rawName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const value = Math.round(Number(holding.value || 0));
  return `${symbol}:${value}`;
}

export function flagLikelyDuplicateHoldings<T extends Record<string, unknown>>(holdings: T[]): Array<T & {
  duplicateKey?: string;
  duplicateOfIndex?: number;
}> {
  const seen = new Map<string, number>();

  return holdings.map((holding, index) => {
    const key = holdingKey(holding);
    if (!key || key === ":0") return holding;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      return holding;
    }
    return {
      ...holding,
      duplicateKey: key,
      duplicateOfIndex: first,
    };
  });
}
