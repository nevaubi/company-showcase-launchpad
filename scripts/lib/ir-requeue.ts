/** Files that make a finished company worth re-reading (same kinds the readers handle). */
export const REREAD_KINDS = ["press-release", "supplement", "presentation", "data", "other", "image"];
export const REREAD_WINDOW_DAYS = 30;

/**
 * Finished companies to re-read: any one new readable file (from any source — SEC job, IR site,
 * mirror import, owner staging) fetched after the last check and filed in the last 30 days.
 * Returns the tickers and the new high-water mark for `fetched_at`.
 */
export function rereadTickers(done: Iterable<string>, rows: { ticker: string; fetched_at: string; filed: string | null; kind: string }[], since: string, today = new Date()) {
  const finished = new Set(done);
  const cutoff = new Date(today.getTime() - REREAD_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  let last = since;
  const tickers = new Set<string>();
  for (const r of rows) {
    if (r.fetched_at > last) last = r.fetched_at;
    if (r.fetched_at <= since || !r.filed || r.filed < cutoff || !REREAD_KINDS.includes(r.kind)) continue;
    if (finished.has(r.ticker)) tickers.add(r.ticker);
  }
  return { tickers: [...tickers], last };
}
