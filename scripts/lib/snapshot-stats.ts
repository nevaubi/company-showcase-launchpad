// Snapshot statistics after each pass of the import lane (request of the lead, 25 Nov 2026; review int-code S1):
// the worker fills the statistics of published snapshots that have none, one snapshot per call
// (`source_compute_snapshot_stats(id, 20000)`, migration 0069), each call its own statement and transaction under
// PostgREST's statement timeout. The worker picks the snapshots itself (newest first, from a list it reads again
// every half hour), so a snapshot whose call fails is skipped for a day and cannot hold back the others, which
// `source_compute_missing_stats` (a fixed order, one statement for the batch) could.
//
// Until 0069 is applied the table and the function do not exist (PostgREST PGRST202 or PGRST205, Postgres 42883 or
// 42P01). The step is then a quiet no-op: said once per process, looked for again once an hour so that applying
// 0069 needs no restart, never a failure and never a reason to back off the import lane. A failure is recorded in
// the pass's row, never as a failed run of the lane, and backs off this step only, from a minute to an hour.
import { safeError } from "./official-worker-plan";

export const STATS_FUNCTION = "source_compute_snapshot_stats";
/** Distinct values counted at most per dimension: bounds one call well inside the 8 s statement timeout. */
export const STATS_MAX_VALUES = 20_000;
/** The longest the worker waits for one call (PostgREST cuts the statement at 8 s). */
export const STATS_TIMEOUT_MS = 30_000;
/** How long a missing function is taken as missing before it is looked for again. */
export const STATS_RECHECK_MS = 3_600_000;
/** A snapshot whose call failed is not tried again for this long. */
export const STATS_SKIP_MS = 86_400_000;
/** The list of snapshots without statistics is read again after this long. */
export const STATS_LIST_MS = 30 * 60_000;
/** Calls per pass at most, and the time a pass may start new calls in. */
export const STATS_PASS_CALLS = 10;
export const STATS_PASS_MS = 20_000;

type PgError = { code?: string; message?: string };
export type StatsRpc = (fn: string, args: Record<string, unknown>, signal: AbortSignal) => PromiseLike<{ data: unknown; error: PgError | null }>;
/** Published snapshots without computed statistics, newest first (bounded, paged selects as the service role). */
export type StatsList = () => PromiseLike<{ ids: string[] } | { error: PgError }>;

export type StatsFailure = { snapshot: string; error: string; skipped_until: string };
export type StatsOutcome =
  | { status: "computed"; snapshots: number; seconds: number; left: number; failed?: StatsFailure[] }
  | { status: "not_installed" }
  | { status: "deferred"; until: string; after_error: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; seconds: number; snapshots?: number; failed?: StatsFailure[] };

/** PostgREST PGRST202 or PGRST205 (no such function or table in its schema cache), Postgres 42883 or 42P01. */
export const functionMissing = (error: { code?: string } | null | undefined) =>
  error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42883" || error?.code === "42P01";

export function snapshotStatsStep(o: {
  rpc: StatsRpc;
  list: StatsList;
  log: (line: string) => void;
  now?: () => number;
  timeoutMs?: number;
}) {
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? STATS_TIMEOUT_MS;
  let missingAt: number | null = null;
  let said = false;
  let failures = 0;
  let retryAt = 0;
  let lastError = "";
  let queue: string[] = [];
  let listedAt: number | null = null;
  const skip = new Map<string, number>();

  const missing = (): StatsOutcome => {
    missingAt = now();
    if (!said) {
      said = true;
      o.log(`snapshot statistics skipped: ${STATS_FUNCTION} is not installed (migration 0069); looked for again hourly`);
    }
    return { status: "not_installed" };
  };
  const backOff = (error: string) => {
    failures++;
    lastError = error;
    retryAt = now() + Math.min(STATS_RECHECK_MS, 60_000 * 2 ** (failures - 1));
  };
  /** One snapshot, one call, bounded in time; the call is told to stop when the wait ends. */
  async function compute(id: string): Promise<{ ok: true } | { missing: true } | { error: string }> {
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        o.rpc(STATS_FUNCTION, { _snapshot_id: id, _max_values: STATS_MAX_VALUES }, stop.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            stop.abort();
            reject(new Error(`no answer in ${timeoutMs / 1000} s`));
          }, timeoutMs);
        }),
      ]);
      if (functionMissing(answer.error)) return { missing: true };
      if (answer.error) return { error: safeError(answer.error.message ?? `error ${answer.error.code ?? "without a code"}`) };
      return { ok: true };
    } catch (e) {
      return { error: safeError(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  return async function computeMissingStats(): Promise<StatsOutcome> {
    if (missingAt !== null && now() - missingAt < STATS_RECHECK_MS) return { status: "not_installed" };
    if (failures && now() < retryAt) return { status: "deferred", until: new Date(retryAt).toISOString(), after_error: lastError };
    const started = now();
    const seconds = () => Math.round((now() - started) / 100) / 10;
    if (listedAt === null || started - listedAt >= STATS_LIST_MS) {
      let listed: Awaited<ReturnType<StatsList>>;
      try {
        listed = await o.list();
      } catch (e) {
        listed = { error: { message: safeError(e) } };
      }
      if ("error" in listed) {
        if (functionMissing(listed.error)) return missing();
        const error = `list of snapshots without statistics: ${safeError(listed.error.message ?? listed.error.code ?? "no answer")}`;
        backOff(error);
        return { status: "failed", error, seconds: seconds() };
      }
      queue = [...listed.ids];
      listedAt = started;
    }
    missingAt = null;
    const failed: StatsFailure[] = [];
    let computed = 0;
    for (let calls = 0; calls < STATS_PASS_CALLS && queue.length && now() - started < STATS_PASS_MS; ) {
      const id = queue.shift()!;
      const until = skip.get(id);
      if (until !== undefined && now() < until) continue;
      skip.delete(id);
      calls++;
      const result = await compute(id);
      if ("missing" in result) return missing();
      if ("error" in result) {
        // this snapshot waits a day; the others go on at the next pass, after this step's back-off
        const skippedUntil = now() + STATS_SKIP_MS;
        skip.set(id, skippedUntil);
        failed.push({ snapshot: id, error: result.error, skipped_until: new Date(skippedUntil).toISOString() });
        backOff(result.error);
        break;
      }
      computed++;
    }
    if (!failed.length) failures = 0;
    if (failed.length && !computed) return { status: "failed", error: failed[0].error, seconds: seconds(), snapshots: 0, failed };
    return { status: "computed", snapshots: computed, seconds: seconds(), left: queue.length, ...(failed.length ? { failed } : {}) };
  };
}

/**
 * The `job_runs` row for a pass that ran no import child: only when the step computed something or failed, so a
 * quiet pass every 30 seconds leaves no row. A failure is recorded in the row (`stats`), and the row stays a
 * working run of the lane: one slow snapshot is not the lane failing, and it is skipped for a day.
 */
export function statsOnlyRow(outcome: StatsOutcome): { ok: boolean; items: number; detail: Record<string, unknown> } | null {
  if (outcome.status === "computed")
    return outcome.snapshots > 0 || outcome.failed?.length ? { ok: true, items: outcome.snapshots, detail: { step: "snapshot statistics", stats: outcome } } : null;
  if (outcome.status === "failed") return { ok: true, items: 0, detail: { step: "snapshot statistics", stats: outcome } };
  return null;
}
