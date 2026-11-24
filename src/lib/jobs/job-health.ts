/**
 * Job health without the database function (pure).
 *
 * `job_health(hours)` (migration 0066) is not applied in production, so the watchdog and the
 * freshness page compute the same rows from `job_runs` read at request time. `healthFromRuns`
 * follows the function's definition row for row:
 *
 *   window      started_at > now - hours (hours clamped to 1..336); `vendor-backfill` excluded
 *   runs        rows in the window
 *   unfinished  rows with no finished_at
 *   failed      rows with ok = false
 *   last_ok     newest started_at with ok = true
 *   last_run    newest started_at
 *   fail_streak over finished rows only, newest first: how many come before the newest ok row
 *               (all finished rows when none is ok); unfinished rows neither break nor extend it
 *
 * Two additions the function does not have (its rows simply lack them):
 *   - run classes (`runClass`): a failed row whose provider answered "no data for this company"
 *     is `empty`, and a row a time budget cut short is `cut`. Neither counts as failed, and both
 *     break a failure streak like an ok row, because the source answered. `empty` and `cut` count them.
 *   - read limits: a job whose rows could not be read is listed in `unread`, and one whose read hit
 *     the page limit is `partial` (counts are over the newest rows read; last run and streak stay
 *     right while the streak is shorter than the page). The rules never call an unread job silent.
 */
import { budgetCut } from "./slice";
import type { JobHealthRow } from "./watchdog";

export interface RunRow {
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  /** detail->>error, when the read projected it */
  error?: string | null;
  /** detail->>skipped */
  skipped?: string | boolean | null;
  /** detail->>outcome (slice outcome: done, cut, failed) */
  outcome?: string | null;
}

export type RunClass = "ok" | "running" | "failed" | "empty" | "cut";

/** The vendor's "we have nothing for this company yet" and "no identifier to match on" answers. */
const EMPTY_RE = /"code"\s*:\s*"not_found"|"status"\s*:\s*404|does not have this data|has no company for these|no matching company was found|no website, domain or linkedin page to match on/i;

/** What a finished run tells about its job. */
export function runClass(r: Pick<RunRow, "finished_at" | "ok" | "error" | "outcome">): RunClass {
  if (r.finished_at == null) return "running";
  if (r.ok) return "ok";
  if (r.outcome === "cut") return "cut";
  const e = r.error ?? "";
  if (EMPTY_RE.test(e)) return "empty";
  if (budgetCut(e)) return "cut";
  return "failed";
}

export interface HealthRow extends JobHealthRow {
  /** failed rows whose provider had no data (not counted in failed) */
  empty?: number;
  /** rows cut short by their time budget (not counted in failed) */
  cut?: number;
  /** the read hit its page limit: counts are over the newest rows read */
  partial?: boolean;
}

export const EXCLUDED_JOBS = new Set(["vendor-backfill"]);
const clampHours = (h: number) => Math.min(Math.max(Math.trunc(h), 1), 336);

export interface HealthOptions {
  /** apply run classes (default true); false gives exactly the function's counts */
  classes?: boolean;
  /** jobs read with the page limit hit */
  partial?: ReadonlySet<string>;
  /** read these excluded jobs anyway (default none, like the function) */
  include?: ReadonlySet<string>;
}

export function healthFromRuns(rows: readonly RunRow[], nowMs: number, hours = 24, opts: HealthOptions = {}): HealthRow[] {
  const since = nowMs - clampHours(hours) * 3600_000;
  const classes = opts.classes !== false;
  const by = new Map<string, RunRow[]>();
  for (const r of rows) {
    if (EXCLUDED_JOBS.has(r.job) && !opts.include?.has(r.job)) continue;
    if (!(Date.parse(r.started_at) > since)) continue;
    let list = by.get(r.job);
    if (!list) by.set(r.job, (list = []));
    list.push(r);
  }
  const out: HealthRow[] = [];
  for (const [job, list] of by) {
    list.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    let unfinished = 0;
    let failed = 0;
    let empty = 0;
    let cut = 0;
    let lastOk: string | null = null;
    let streak: number | null = null;
    let finished = 0;
    for (const r of list) {
      const cls = classes ? runClass(r) : r.finished_at == null ? "running" : r.ok ? "ok" : "failed";
      if (r.finished_at == null) unfinished++;
      if (cls === "empty") empty++;
      else if (cls === "cut") cut++;
      else if (r.ok === false) failed++;
      if (r.ok === true && lastOk == null) lastOk = r.started_at;
      if (r.finished_at == null) continue;
      // An ok row ends the streak; so does a source that answered (empty) or a budget cut.
      if (streak == null && (cls === "ok" || cls === "empty" || cls === "cut")) streak = finished;
      finished++;
    }
    const row: HealthRow = {
      job,
      runs: list.length,
      unfinished,
      failed,
      last_ok: lastOk,
      last_run: list[0].started_at,
      fail_streak: streak ?? finished,
    };
    if (classes && (empty || cut)) Object.assign(row, { empty, cut });
    if (opts.partial?.has(job)) row.partial = true;
    out.push(row);
  }
  return out.sort((a, b) => a.job.localeCompare(b.job));
}

/** PostgREST / Postgres "this function does not exist" (migration not applied). */
export function missingFunction(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "PGRST202" || err.code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(err.message ?? "");
}
