// mapWithLimit — run fn over items with at most `limit` in flight at once,
// returning results in INPUT ORDER regardless of completion order.
//
// WHY THIS EXISTS (E13, 2026-09-05). The per-claim judge wave in reviewFlow.ts
// used `Promise.all(rows.map(...))` — unbounded. With a handful of sources
// that is fine; with many sources per claim it opens hundreds of parallel
// DeepSeek calls at once (rate-limit 429s, cost spikes, latency). Everywhere
// the engine fans out independent model calls, the fan-out must be bounded.
//
// Order preservation is load-bearing: callers here collect answers into a
// per-row map and persist usage per call; a result array shuffled by network
// timing would make output non-deterministic for identical input.
//
// A thrown rejection propagates (matching Promise.all). Every current caller
// passes a function that already degrades its own failures into a value.

export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
