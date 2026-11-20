/**
 * Options job decisions (pure): tell "Cboe refused us" from "this stock has no listed options".
 *
 * Until 19 Nov the job read every HTTP 403 as "no options" and recorded ok=true, so a Cboe block
 * looked like 1,834 stocks without options while nothing was stored. Now:
 *
 *   stored   HTTP 200 with a chain that summarises
 *   none     HTTP 404, or HTTP 200 with an empty chain: the stock has no listed options
 *   blocked  HTTP 429 (always), or HTTP 403: Cboe answers 403 both for symbols it does not list and
 *            for a client it refuses. Two or more 403s with nothing stored are checked against SPY,
 *            which always has a chain: SPY refused too means a block, SPY answered means the 403s
 *            were unlisted symbols.
 *   error    anything else (timeout, 5xx, bad JSON): the unit failed
 *
 * A blocked slice holds the cursor, backs off (2 min, doubling to 60 min, persisted in
 * `options-backoff`) and records ok=false, so the owner sees it and no company loses its night.
 */

export type ChainResult =
  | { t: string; kind: "stored"; row: unknown }
  | { t: string; kind: "none"; status: number }
  | { t: string; kind: "blocked"; status: number }
  | { t: string; kind: "error"; message: string };

/** Classify one chain response before reading the body. */
export function chainStatus(status: number): "read" | "none" | "blocked" | "error" {
  if (status >= 200 && status < 300) return "read";
  if (status === 404) return "none";
  if (status === 403 || status === 429) return "blocked";
  return "error";
}

/** The symbol whose chain is always listed: probes whether a 403 means "refused". */
export const OPTIONS_PROBE = "SPY";

export interface SliceVerdict {
  outcome: "done" | "failed" | "blocked";
  /** a SPY probe is needed before deciding (only when `probe` was not supplied) */
  needsProbe: boolean;
  /** results as they should be recorded (403s become none once the probe answered) */
  results: ChainResult[];
  stored: number;
  blocked: number;
  failed: number;
}

/**
 * Decide the slice. `probeStatus` is the HTTP status of the SPY probe (0 = network error), or
 * undefined when no probe was made yet.
 */
export function judgeSlice(results: ChainResult[], probeStatus?: number): SliceVerdict {
  const stored = results.filter((r) => r.kind === "stored").length;
  const rate = results.filter((r) => r.kind === "blocked" && r.status === 429).length;
  const forbidden = results.filter((r) => r.kind === "blocked" && r.status === 403).length;
  const errors = results.filter((r) => r.kind === "error").length;
  const base = { stored, failed: errors };
  // Any 429: Cboe asked us to slow down. Store what came back, hold the slice and back off.
  if (rate > 0) return { ...base, outcome: "blocked", needsProbe: false, results, blocked: rate + forbidden };
  const suspicious = forbidden >= 2 && stored === 0;
  if (suspicious && probeStatus === undefined) return { ...base, outcome: "blocked", needsProbe: true, results, blocked: forbidden };
  const refused = suspicious && chainStatus(probeStatus ?? 200) !== "read";
  if (refused) return { ...base, outcome: "blocked", needsProbe: false, results, blocked: forbidden };
  // Cboe answers other symbols (stored ones, or the probe): a 403 means the symbol is not listed.
  const settled: ChainResult[] = results.map((r) => (r.kind === "blocked" ? { t: r.t, kind: "none", status: r.status } : r));
  const attempted = settled.length;
  const outcome = attempted > 0 && errors >= attempted ? "failed" : "done";
  return { ...base, outcome, needsProbe: false, results: settled, blocked: 0 };
}

export const OPTIONS_BACKOFF_KEY = "options-backoff";
export const BACKOFF_MIN_MS = 2 * 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;

/** Block streak from the backoff row's reason (`… [n=3]`), 0 when none. */
export function blockStreak(reason: string | null | undefined): number {
  const m = /\[n=(\d+)\]\s*$/.exec(reason ?? "");
  return m ? Number(m[1]) : 0;
}

/** Backoff row after the `streak`-th blocked slice in a row: 2 min, 4, 8 … capped at 60 min, ±20% jitter. */
export function backoffRow(streak: number, statuses: number[], nowMs: number, rand: () => number = Math.random) {
  const n = Math.max(1, streak);
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (n - 1));
  const jitter = 0.8 + 0.4 * Math.max(0, Math.min(1, rand()));
  const waitMs = Math.min(BACKOFF_MAX_MS, Math.round(base * jitter));
  const counts = [403, 429].map((s) => `${s} x${statuses.filter((x) => x === s).length}`).join(", ");
  return {
    job: OPTIONS_BACKOFF_KEY,
    cursor: Math.ceil((nowMs + waitMs) / 1000),
    paused_reason: `blocked: Cboe refused option chains (${counts}) [n=${n}]`,
    updated_at: new Date(nowMs).toISOString(),
    waitMs,
  };
}

/**
 * The options night a run belongs to (UTC date of its 22:00 start): runs from 22:00 to 05:59 UTC
 * share a night, so the rotation restarts at the top of the ranked list once per night.
 */
export function optionsNight(nowMs: number): number {
  const d = new Date(nowMs - 8 * 3600_000);
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
