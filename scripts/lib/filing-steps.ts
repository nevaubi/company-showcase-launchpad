// Pure rules for the worker's per-filing steps (redline + supply refresh) and weekly supply intel.
export const MAX_ATTEMPTS = 5;
export const BATCH = 30;
/** Supply links are refreshed only for filings this recent; older backlog gets its redline only. */
export const SUPPLY_WINDOW_DAYS = 30;
export const INTEL_EVERY_MS = 7 * 86_400_000;
export const INTEL_COMPANIES = 20;

export interface NewFiling { accn: string; ticker: string; form: string; filed: string; report?: string | null; doc: string; discovered_at: string }

/** Failure receipts are job_state rows `filing-steps-fail:<accn>` (cursor = attempts). */
export const failKey = (accn: string) => `filing-steps-fail:${accn}`;
export function retryable(attempts: number): boolean { return attempts < MAX_ATTEMPTS; }

/** Epoch seconds cursor (fits job_state.cursor until 2038). */
export const toCursor = (iso: string) => Math.floor(Date.parse(iso) / 1000);
export const fromCursor = (c: number) => new Date(c * 1000).toISOString();

export function wantsSupply(f: { filed: string }, today = new Date().toISOString().slice(0, 10)): boolean {
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${f.filed}T00:00:00Z`) <= SUPPLY_WINDOW_DAYS * 86_400_000;
}

/**
 * Covered companies whose newest supply signal is oldest (never-signalled companies first). Ties go to
 * the higher dv20 rank (top 1,000 first, `rank` from src/lib/jobs/priority.ts), then alphabetical.
 */
export function oldestSignals(tickers: string[], newest: Map<string, string>, n = INTEL_COMPANIES, rank: Map<string, number> = new Map()): string[] {
  return [...tickers]
    .sort((a, b) => (newest.get(a) ?? "").localeCompare(newest.get(b) ?? "") || (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b))
    .slice(0, n);
}

/** One ticker's supply refresh per run, however many of its filings arrived. */
export function supplyTickers(done: NewFiling[], today?: string): string[] {
  return [...new Set(done.filter((f) => wantsSupply(f, today)).map((f) => f.ticker))];
}

// ---------- cursor precision (P1-8) ----------
/**
 * The cursor is (epoch second of discovered_at, last accession done in that second): job_state.cursor
 * is an integer, so it cannot hold milliseconds; the accession breaks ties, so any number of filings
 * sharing one second still make progress. Stored as `filing-steps.cursor` + row `filing-steps-accn`
 * (paused_reason `after:<accn>`).
 */
export interface StepCursor { sec: number; accn: string }
export const ACCN_KEY = "filing-steps-accn";
export const accnReason = (accn: string) => `after:${accn}`;
export const accnOf = (reason: string | null | undefined) => (reason?.startsWith("after:") ? reason.slice(6) : "");
export const secOf = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Filings strictly after the cursor in (second, accession) order. */
export function afterCursor<F extends { accn: string; discovered_at: string }>(rows: readonly F[], c: StepCursor): F[] {
  return rows
    .filter((r) => secOf(r.discovered_at) > c.sec || (secOf(r.discovered_at) === c.sec && r.accn > c.accn))
    .sort((a, b) => secOf(a.discovered_at) - secOf(b.discovered_at) || a.accn.localeCompare(b.accn));
}

/** Cursor after a filing is done (never moves backwards). */
export function nextCursor(prev: StepCursor, f: { accn: string; discovered_at: string }): StepCursor {
  const c = { sec: secOf(f.discovered_at), accn: f.accn };
  return c.sec > prev.sec || (c.sec === prev.sec && c.accn > prev.accn) ? c : prev;
}

/**
 * A page fetched in discovered_at order may cut its last second short; when it is full, drop that
 * second's rows (they are fetched whole by a second query) so every second in the batch is complete.
 */
export function completeSeconds<F extends { discovered_at: string }>(page: readonly F[], pageSize: number): { rows: F[]; partialSec: number | null } {
  if (page.length < pageSize || !page.length) return { rows: [...page], partialSec: null };
  const last = secOf(page[page.length - 1].discovered_at);
  return { rows: page.filter((r) => secOf(r.discovered_at) < last), partialSec: last };
}

// ---------- weekly supply intel marker (P0-7) ----------
export const INTEL_KEY = "supply-intel-weekly";
export const INTEL_MAX_RETRIES = 8;

export interface IntelResult {
  /** signal rows stored this run */
  stored: number;
  /** companies attempted */
  companies: number;
  /** stages that threw (their stored rows were kept) */
  failedStages: number;
  /** stages that found nothing to store, without an error */
  emptyStages: number;
  /** quota/config stop, if the run ended on one */
  stop: string | null;
}

/**
 * What the weekly marker becomes after a run. The marker's `updated_at` is "last good run": the next
 * run is due INTEL_EVERY_MS after it. It advances only when signals were stored, or when every stage
 * ran clean and simply found nothing. Otherwise the run is retried after 1 h, doubling to 24 h
 * (`cursor` = attempts, `paused_reason` = why); after INTEL_MAX_RETRIES the week is given up.
 */
export function intelMarker(result: IntelResult | null, prev: { cursor: number; paused_reason: string | null } | null, nowMs: number, why = "no result"): { action: "advance" | "retry" | "give-up"; cursor: number; paused_reason: string | null; updated_at: string } {
  const at = (ms: number) => new Date(ms).toISOString();
  if (result && (result.stored > 0 || (!result.stop && result.failedStages === 0 && result.companies > 0)))
    return { action: "advance", cursor: result.companies, paused_reason: null, updated_at: at(nowMs) };
  const attempts = (prev?.paused_reason?.startsWith("retry") ? prev.cursor : 0) + 1;
  const reason = result ? (result.stop ?? `${result.failedStages} stage(s) failed, nothing stored`) : why;
  if (attempts > INTEL_MAX_RETRIES) return { action: "give-up", cursor: 0, paused_reason: `gave up after ${attempts - 1} tries: ${reason}`.slice(0, 200), updated_at: at(nowMs) };
  const delay = Math.min(24 * 3600_000, 3600_000 * 2 ** (attempts - 1));
  // Due again `delay` from now: backdate the marker so `now - updated_at > INTEL_EVERY_MS` then holds.
  return { action: "retry", cursor: attempts, paused_reason: `retry ${attempts}: ${reason}`.slice(0, 200), updated_at: at(nowMs + delay - INTEL_EVERY_MS) };
}
