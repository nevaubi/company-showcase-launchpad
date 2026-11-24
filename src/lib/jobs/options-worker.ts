/**
 * Options through the Render worker when Cboe refuses the app server (pure).
 *
 * Since 19 Nov 2026 every scheduled `options` run answers "blocked: Cboe refused option chains", so
 * `options_daily` stopped. The worker loop takes the night's snapshot instead, as a side job
 * (`scripts/options-snapshot.ts --night`), when the app-side job cannot:
 *
 *   window     a weekday evening's night: 22:00 UTC (Mon-Fri) to 08:00 UTC the next morning, while
 *              the night number (`optionsNight`, shared with the app job) stays the same; Cboe's
 *              delayed chains then still show the closed session
 *   who runs   the worker, when the app job is blocked (its `options-backoff` holds a retry time
 *              or a block streak of 2 or more recorded tonight), or when 90 minutes into the night
 *              fewer than 20 rows were stored tonight (the app job is not collecting at all).
 *              Otherwise the app job is working and the worker leaves the night to it.
 *   where      `options-worker` row: cursor = next position in the night's ranked list,
 *              paused_reason = `night:<n>` while running, `night:<n> done` when the list is through,
 *              `night:<n> blocked until <iso> [n=<k>]` when Cboe refused the worker too. A new night
 *              starts at 0. Names stored tonight (by either side) are skipped, so the two never
 *              fetch the same chain twice even if the app job recovers mid-night.
 *   stop       when the list is through, when Cboe refuses the worker (own back-off, 2 min doubling
 *              to 60 min, never touching the app job's row), or when the step's time limit ends
 *              (the cursor is saved after every chunk, so the next loop pass resumes).
 *   pace       about 20 requests a minute (one start every 3 s), Cboe's tolerated rate.
 */
import { blockStreak, optionsNight } from "./options-run";
import type { StateRow } from "./watchdog";

export const WORKER_KEY = "options-worker";
export const WORKER_GAP_MS = 3000;
/** Names per saved step: the cursor and the skip list are refreshed this often. */
export const WORKER_CHUNK = 20;
const TAKEOVER_AFTER_MIN = 90;
const TAKEOVER_BELOW_ROWS = 20;

/** Start of the options night (22:00 UTC of its evening) for a night number. */
export function nightStartMs(night: number): number {
  const y = Math.floor(night / 10_000);
  const m = Math.floor((night % 10_000) / 100);
  const d = night % 100;
  return Date.UTC(y, m - 1, d, 22);
}

/** Whether `nowMs` is inside a weekday night the worker may collect in. */
export function inWorkerWindow(nowMs: number): boolean {
  const night = optionsNight(nowMs);
  const start = nightStartMs(night);
  const evening = new Date(start).getUTCDay();
  return evening >= 1 && evening <= 5 && nowMs >= start;
}

export interface WorkerState {
  night: number;
  cursor: number;
  status: "running" | "done" | "blocked";
  /** epoch ms the worker's own block ends */
  until: number | null;
  streak: number;
}

export function parseWorker(row: StateRow | null | undefined): WorkerState | null {
  const m = /^night:(\d{8})(?: (done|blocked until (\S+)))?/.exec(row?.paused_reason ?? "");
  if (!m) return null;
  const blocked = m[2]?.startsWith("blocked") ?? false;
  return {
    night: Number(m[1]),
    cursor: Math.max(0, Number(row?.cursor ?? 0)),
    status: m[2] === "done" ? "done" : blocked ? "blocked" : "running",
    until: blocked ? Date.parse(m[3]) : null,
    streak: blocked ? blockStreak(row?.paused_reason) : 0,
  };
}

export interface WorkerPlanInput {
  nowMs: number;
  /** the app job's `options-backoff` row */
  backoff: StateRow | null | undefined;
  /** the worker's own `options-worker` row */
  worker: StateRow | null | undefined;
  /** options_daily rows fetched since tonight's start, by anyone */
  storedTonight: number;
  /** names in the night's ranked list */
  total: number;
}

export type WorkerPlan = { run: true; night: number; start: number; why: string } | { run: false; night: number; why: string };

export function workerPlan(i: WorkerPlanInput): WorkerPlan {
  const night = optionsNight(i.nowMs);
  if (!inWorkerWindow(i.nowMs)) return { run: false, night, why: "outside the options night" };
  const w = parseWorker(i.worker);
  const mine = w && w.night === night ? w : null;
  if (mine?.status === "done") return { run: false, night, why: "tonight's list is through" };
  if (mine?.status === "blocked" && mine.until != null && mine.until > i.nowMs) return { run: false, night, why: `Cboe refused the worker; retry at ${new Date(mine.until).toISOString()}` };
  const start = mine ? Math.min(mine.cursor, i.total) : 0;
  if (start >= i.total) return { run: false, night, why: "tonight's list is through" };
  const nightStart = nightStartMs(night);
  const b = i.backoff;
  const backoffTonight = !!b?.updated_at && Date.parse(b.updated_at) >= nightStart;
  const appBlocked = ((b?.cursor ?? 0) * 1000 > i.nowMs && !!b?.paused_reason) || (backoffTonight && blockStreak(b?.paused_reason) >= 2);
  if (appBlocked) return { run: true, night, start, why: `the app job is blocked (${(b?.paused_reason ?? "").slice(0, 80)})` };
  if (i.nowMs - nightStart >= TAKEOVER_AFTER_MIN * 60_000 && i.storedTonight < TAKEOVER_BELOW_ROWS)
    return { run: true, night, start, why: `${i.storedTonight} rows stored ${Math.round((i.nowMs - nightStart) / 60_000)} min into the night` };
  // A worker pass already under way tonight keeps going (the skip list keeps it off the app job's names).
  if (mine?.status === "running" && mine.cursor > 0) return { run: true, night, start, why: "resuming tonight's pass" };
  return { run: false, night, why: "the app job is collecting" };
}

/** Row after a stored chunk: the next position, or done when the list is through. */
export function workerProgress(night: number, next: number, total: number, nowMs: number): StateRow {
  return { job: WORKER_KEY, cursor: Math.min(next, total), paused_reason: next >= total ? `night:${night} done` : `night:${night}`, updated_at: new Date(nowMs).toISOString() };
}

/** Row when Cboe refused the worker: hold the position, back off 2 min doubling to 60 min. */
export function workerBlocked(night: number, at: number, prev: WorkerState | null, nowMs: number, statuses: number[]): StateRow {
  const n = (prev && prev.night === night && prev.status === "blocked" ? prev.streak : 0) + 1;
  const waitMs = Math.min(60 * 60_000, 2 * 60_000 * 2 ** (n - 1));
  const counts = [403, 429].map((s) => `${s} x${statuses.filter((x) => x === s).length}`).join(", ");
  return { job: WORKER_KEY, cursor: at, paused_reason: `night:${night} blocked until ${new Date(nowMs + waitMs).toISOString()} Cboe refused the worker (${counts}) [n=${n}]`, updated_at: new Date(nowMs).toISOString() };
}

/** The names of a chunk still to fetch: not stored tonight by either side. */
export const toFetch = (chunk: readonly string[], storedTonight: ReadonlySet<string>) => chunk.filter((t) => !storedTonight.has(t));
