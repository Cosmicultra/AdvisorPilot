export type AllocationBuckets = {
  equity: number;
  fixedIncome: number;
  cash: number;
  other: number;
};

export function bucketValuesToPercents(buckets: AllocationBuckets, totalValue: number): AllocationBuckets {
  const tv = Number(totalValue) || 0;
  if (tv <= 0) {
    return { equity: 0, fixedIncome: 0, cash: 0, other: 0 };
  }

  const raw = {
    equity: (Number(buckets.equity) / tv) * 100,
    fixedIncome: (Number(buckets.fixedIncome) / tv) * 100,
    cash: (Number(buckets.cash) / tv) * 100,
    other: (Number(buckets.other) / tv) * 100,
  };

  const keys = ["equity", "fixedIncome", "cash", "other"] as const;
  const rounded = keys.map((k) => Math.round(raw[k]));
  let sum = rounded.reduce((a, b) => a + b, 0);
  const out: AllocationBuckets = {
    equity: rounded[0],
    fixedIncome: rounded[1],
    cash: rounded[2],
    other: rounded[3],
  };

  let guard = 0;
  while (sum !== 100 && guard++ < 200) {
    const frac = keys.map((k, i) => ({ k, d: raw[k] - rounded[i] }));
    frac.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const pick = frac[0];
    if (sum > 100) {
      out[pick.k]--;
      sum--;
    } else {
      out[pick.k]++;
      sum++;
    }
  }

  return out;
}

export function allocationForRiskModel(p: AllocationBuckets) {
  const half = Number(p.other || 0) * 0.5;
  const e = Number(p.equity) + half;
  const f = Number(p.fixedIncome) + half;
  const c = Number(p.cash);
  const s = e + f + c;
  if (s <= 0) return { equity: 0, fixedIncome: 0, cash: 0 };
  return {
    equity: (e / s) * 100,
    fixedIncome: (f / s) * 100,
    cash: (c / s) * 100,
  };
}
