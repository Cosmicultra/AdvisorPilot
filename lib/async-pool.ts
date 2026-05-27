/**
 * Run async tasks with a concurrency cap (used by enrich-holdings and
 * analyze-statement securities-master resolution).
 */

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export function readConcurrencyEnv(
  name: string,
  defaultValue: number,
  max = 10
): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return defaultValue;
  return Math.max(1, Math.min(max, Number(raw)));
}
