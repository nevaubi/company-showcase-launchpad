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
 *
 * One bad ticker never holds the rest (review R1). An answer about one symbol (a 4xx such as 404, a
 * body that does not parse) is charged to that ticker in `estimates-fail:<T>` (cursor = tries,
 * paused_reason = last error) and the run moves on; it is retried no sooner than 6 h later and given
 * up for 7 days after 3 tries. Only provider-wide trouble (429/5xx after retries, session, timeout,
 * network) sets the 30-minute cooldown, and the ticker that hit it goes last in the next batch: if
 * the provider answers the others and still fails that one, the failure is the ticker's.
 */

export const ESTIMATE_BATCH = 3;
export const ESTIMATE_SCAN = 60;
export const ESTIMATE_NONE_PREFIX = "estimates-none:";
export const ESTIMATE_NONE_TTL_MS = 30 * 86400_000;
export const ESTIMATE_MAX_AGE_MS = 7 * 86400_000;
export const ESTIMATE_FAIL_PREFIX = "estimates-fail:";
export const ESTIMATE_FAIL_LIMIT = 3;
export const ESTIMATE_FAIL_RETRY_MS = 6 * 3600_000;
export const ESTIMATE_GIVE_UP_MS = 7 * 86400_000;

export type EstimateErrorClass = "none" | "ticker" | "provider";

/**
 * What a fetchEstimates error says. "none": the provider has no coverage. "provider": the provider as
 * a whole failed (it already retried 429/5xx and session errors), or the request timed out or never
 * reached it. "ticker": anything else is about this one symbol (a 4xx other than 401/403/429, or data
 * normalizeEstimates cannot read).
 */
export function estimateErrorClass(e: unknown): EstimateErrorClass {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = (e as Error | null)?.message ?? String(e);
  if (/^No estimates for /.test(msg)) return "none";
  if (name === "TimeoutError" || name === "AbortError") return "provider";
  if (/^Estimates provider (unavailable|session failed)/.test(msg)) return "provider";
  if (/abort|timed? ?out|fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(msg)) return "provider";
  return "ticker";
}

export interface FailReceipt {
  tries: number;
  /** last failure (ISO) */
  at: string | null;
}

/** True while a failure receipt keeps the ticker out: a retry gap after a failure, a long rest after a give-up. */
export function failHolds(f: FailReceipt | undefined, nowMs: number): boolean {
  if (!f || !f.at) return false;
  const age = nowMs - Date.parse(f.at);
  return f.tries >= ESTIMATE_FAIL_LIMIT ? age < ESTIMATE_GIVE_UP_MS : age < ESTIMATE_FAIL_RETRY_MS;
}

/** Receipt row after one more failure, and whether this one gave the ticker up. */
export function chargeFailure(ticker: string, prev: FailReceipt | undefined, reason: string, nowMs: number): { row: { job: string; cursor: number; paused_reason: string; updated_at: string }; tries: number; gaveUp: boolean } {
  const tries = (prev?.tries ?? 0) + 1;
  const gaveUp = tries >= ESTIMATE_FAIL_LIMIT;
  const why = gaveUp ? `gave up for 7 days after ${tries} tries: ${reason}` : `try ${tries} of ${ESTIMATE_FAIL_LIMIT}: ${reason}`;
  return { row: { job: `${ESTIMATE_FAIL_PREFIX}${ticker}`, cursor: tries, paused_reason: why.slice(0, 200), updated_at: new Date(nowMs).toISOString() }, tries, gaveUp };
}

/** The ticker named in an `estimates-backoff` reason (`T: message`), if any. */
export const backoffTicker = (reason: string | null | undefined) => /^([A-Z0-9.-]+): /.exec(reason ?? "")?.[1] ?? null;

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
  /** failure receipts by ticker (candidates and stale rows) */
  failed?: Map<string, FailReceipt>;
  /** the ticker the last provider cooldown started on: fetched last this run */
  deferred?: string | null;
  nowMs: number;
  batch?: number;
}

export type EstimatePick = { ticker: string; kind: "missing"; nextCursor: number; /** position in the scan window */ scanIndex: number } | { ticker: string; kind: "stale" };

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
  const held = (t: string) => failHolds(i.failed?.get(t), i.nowMs);
  const missing: EstimatePick[] = [];
  i.candidates.forEach((t, k) => {
    if (i.have.has(t) || fresh(t) || held(t) || missing.some((m) => m.ticker === t)) return;
    missing.push({ ticker: t, kind: "missing", nextCursor: (i.start + k + 1) % total, scanIndex: k });
  });
  const stale = i.stale.filter((s) => !held(s.ticker));
  const old = stale.filter((s) => i.nowMs - Date.parse(s.fetchedAt) > ESTIMATE_MAX_AGE_MS);
  const reserve = old.length && missing.length ? 1 : 0;
  const batch: EstimatePick[] = missing.slice(0, size - reserve);
  for (const s of [...old, ...stale]) {
    if (batch.length >= size) break;
    if (!batch.some((b) => b.ticker === s.ticker)) batch.push({ ticker: s.ticker, kind: "stale" });
  }
  // Keep stale picks after the missing ones (fetch order = priority order).
  batch.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "missing" ? -1 : 1));
  // The ticker a cooldown started on goes last, so the others show whether the provider is up.
  if (i.deferred) {
    const d = batch.findIndex((b) => b.ticker === i.deferred);
    if (d >= 0 && batch.length > 1) batch.push(...batch.splice(d, 1));
  }
  const scanCursor = missing.length ? null : (i.start + i.candidates.length) % total;
  return { batch, scanCursor };
}

/**
 * The scan cursor after some missing picks were attempted (stored, "no estimates", or charged): it moves
 * past the leading run of attempted picks in scan order only, so a pick fetched out of order (deferred)
 * or not reached in time is never skipped. Null: nothing to move.
 */
export function scanCursorAfter(batch: readonly EstimatePick[], attempted: ReadonlySet<string>): number | null {
  const missing = batch.flatMap((b) => (b.kind === "missing" ? [b] : [])).sort((a, b) => a.scanIndex - b.scanIndex);
  let cursor: number | null = null;
  for (const m of missing) {
    if (!attempted.has(m.ticker)) break;
    cursor = m.nextCursor;
  }
  return cursor;
}
