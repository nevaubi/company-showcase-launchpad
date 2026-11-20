/**
 * Which analyst estimates the `estimates` job fetches next (pure).
 *
 * Before: the stalest stored rows (older than 12 h) took every slot, so the job re-refreshed its 219
 * stored rows forever and never reached the other covered companies. Now:
 *   1. covered companies with no stored estimates, in priority order (top 1,000 by dv20 first; the
 *      scan walks a window of `ESTIMATE_SCAN` tickers from the `estimates-new` cursor);
 *   2. then the stalest stored rows;
 *   3. one slot is kept for a stored row older than `ESTIMATE_MAX_AGE_MS`, so stored estimates never
 *      age without bound while new coverage fills.
 * Companies the provider has no estimates for carry a receipt (`estimates-none:<T>`) and are skipped
 * for 30 days.
 */

export const ESTIMATE_BATCH = 3;
export const ESTIMATE_SCAN = 60;
export const ESTIMATE_NONE_PREFIX = "estimates-none:";
export const ESTIMATE_NONE_TTL_MS = 30 * 86400_000;
export const ESTIMATE_MAX_AGE_MS = 7 * 86400_000;

export interface EstimatesInput {
  /** scan window in priority order, starting at `start` */
  candidates: string[];
  /** index of candidates[0] in the full ranked list */
  start: number;
  /** size of the full ranked list */
  total: number;
  /** candidates that already have a stored row */
  have: Set<string>;
  /** candidates with a "no estimates" receipt → receipt time */
  none: Map<string, string | null>;
  /** stored rows older than 12 h, oldest first */
  stale: { ticker: string; fetchedAt: string }[];
  nowMs: number;
  batch?: number;
}

export type EstimatePick = { ticker: string; kind: "missing"; nextCursor: number } | { ticker: string; kind: "stale" };

export interface EstimatesPlan {
  batch: EstimatePick[];
  /** cursor to write before fetching (the window held nothing missing), or null */
  scanCursor: number | null;
}

export function pickEstimates(i: EstimatesInput): EstimatesPlan {
  const size = i.batch ?? ESTIMATE_BATCH;
  const total = Math.max(1, i.total);
  const fresh = (t: string) => {
    const at = i.none.get(t);
    return at != null && i.nowMs - Date.parse(at) < ESTIMATE_NONE_TTL_MS;
  };
  const missing: EstimatePick[] = [];
  i.candidates.forEach((t, k) => {
    if (i.have.has(t) || fresh(t) || missing.some((m) => m.ticker === t)) return;
    missing.push({ ticker: t, kind: "missing", nextCursor: (i.start + k + 1) % total });
  });
  const old = i.stale.filter((s) => i.nowMs - Date.parse(s.fetchedAt) > ESTIMATE_MAX_AGE_MS);
  const reserve = old.length && missing.length ? 1 : 0;
  const batch: EstimatePick[] = missing.slice(0, size - reserve);
  for (const s of [...old, ...i.stale]) {
    if (batch.length >= size) break;
    if (!batch.some((b) => b.ticker === s.ticker)) batch.push({ ticker: s.ticker, kind: "stale" });
  }
  // Keep stale picks after the missing ones (fetch order = priority order).
  batch.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "missing" ? -1 : 1));
  const scanCursor = missing.length ? null : (i.start + i.candidates.length) % total;
  return { batch, scanCursor };
}
