// Reading helpers behind the member-tape server function, kept apart from it so they can be tested
// without a database: paging that survives any row cap, and a cache that shares one read.

export interface Page<T> {
  rows: T[];
  /** Total rows the query matches, when the server reports it. */
  total: number | null;
}

/**
 * Read every row through `page(from, to)`. The next page starts after the rows actually returned, so a
 * server that caps a page below `size` only costs more round trips; reading stops at the reported total
 * or at the first empty page. A read that ends short of the reported total throws instead of passing for
 * a whole one.
 */
export async function readAllPages<T>(page: (from: number, to: number) => Promise<Page<T>>, size = 1000, max = 50_000): Promise<T[]> {
  const all: T[] = [];
  let total: number | null = null;
  while (all.length < max) {
    const p = await page(all.length, all.length + size - 1);
    if (total == null && p.total != null) total = p.total;
    all.push(...p.rows);
    if (!p.rows.length) break;
    if (total != null && all.length >= total) break;
  }
  if (total != null && all.length < Math.min(total, max)) throw new Error(`partial read: ${all.length} of ${total} rows`);
  return all;
}

/**
 * Keep the result of `load` for `ttlMs`. Calls that arrive while a read is in flight share it, and a
 * failed read is not kept, so the next call tries again.
 */
export function singleFlight<T>(ttlMs: number, load: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let kept: { at: number; v: T } | null = null;
  let flying: Promise<T> | null = null;
  return () => {
    if (kept && now() - kept.at < ttlMs) return Promise.resolve(kept.v);
    if (!flying) {
      flying = load().then(
        (v) => {
          kept = { at: now(), v };
          flying = null;
          return v;
        },
        (e: unknown) => {
          flying = null;
          throw e;
        },
      );
    }
    return flying;
  };
}
