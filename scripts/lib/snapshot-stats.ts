// Snapshot statistics after each pass of the import lane (request of the lead, 25 Nov 2026): the worker
// asks the database to fill the statistics of up to ten published snapshots that have none yet
// (`source_compute_missing_stats(10, 100000)`, migration 0069). Every count in that function is bounded
// (one index probe per distinct value, at most 100,000 per dimension), and this step bounds the wait.
//
// Until 0069 is applied the function does not exist (PostgREST PGRST202, Postgres 42883). The step is then
// a quiet no-op: said once per process, looked for again once an hour so that applying 0069 needs no
// restart, never a failure and never a reason to back off the import lane. A real error backs off this
// step only, from a minute to an hour.
import { safeError } from "./official-worker-plan";

export const STATS_FUNCTION = "source_compute_missing_stats";
export const STATS_ARGS = { _max_snapshots: 10, _max_values: 100_000 } as const;
/** The longest the worker waits for one call (the scripts client itself gives up after 150 s). */
export const STATS_TIMEOUT_MS = 120_000;
/** How long a missing function is taken as missing before it is looked for again. */
export const STATS_RECHECK_MS = 3_600_000;

export type StatsRpc = (
  fn: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

export type StatsOutcome =
  | { status: "computed"; snapshots: number; seconds: number }
  | { status: "not_installed" }
  | { status: "deferred"; until: string; after_error: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; seconds: number };

/** PostgREST PGRST202 (no such function in its schema cache) or Postgres 42883 (undefined function). */
export const functionMissing = (error: { code?: string } | null | undefined) =>
  error?.code === "PGRST202" || error?.code === "42883";

export function snapshotStatsStep(o: {
  rpc: StatsRpc;
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
  return async function computeMissingStats(): Promise<StatsOutcome> {
    if (missingAt !== null && now() - missingAt < STATS_RECHECK_MS) return { status: "not_installed" };
    if (failures && now() < retryAt) return { status: "deferred", until: new Date(retryAt).toISOString(), after_error: lastError };
    const started = now();
    const seconds = () => Math.round((now() - started) / 100) / 10;
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: string): StatsOutcome => {
      failures++;
      lastError = error;
      retryAt = now() + Math.min(STATS_RECHECK_MS, 60_000 * 2 ** (failures - 1));
      return { status: "failed", error, seconds: seconds() };
    };
    let answer: Awaited<ReturnType<StatsRpc>>;
    try {
      answer = await Promise.race([
        o.rpc(STATS_FUNCTION, { ...STATS_ARGS }, stop.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            stop.abort();
            reject(new Error(`no answer in ${timeoutMs / 1000} s`));
          }, timeoutMs);
        }),
      ]);
    } catch (e) {
      return fail(safeError(e));
    } finally {
      clearTimeout(timer);
    }
    if (functionMissing(answer.error)) {
      missingAt = now();
      if (!said) {
        said = true;
        o.log(`snapshot statistics skipped: ${STATS_FUNCTION} is not installed (migration 0069); looked for again hourly`);
      }
      return { status: "not_installed" };
    }
    missingAt = null;
    if (answer.error) return fail(safeError(answer.error.message ?? `error ${answer.error.code ?? "without a code"}`));
    failures = 0;
    const n = Number(answer.data);
    return { status: "computed", snapshots: Number.isSafeInteger(n) && n >= 0 ? n : 0, seconds: seconds() };
  };
}

/**
 * The `job_runs` row for a pass that ran no import child: only when the step computed something or
 * failed, so a quiet pass every 30 seconds leaves no row. A failure carries `error`, where the watchdog
 * tells a person to look.
 */
export function statsOnlyRow(outcome: StatsOutcome): { ok: boolean; items: number; detail: Record<string, unknown> } | null {
  if (outcome.status === "computed")
    return outcome.snapshots > 0 ? { ok: true, items: outcome.snapshots, detail: { step: "snapshot statistics", stats: outcome } } : null;
  if (outcome.status === "failed")
    return { ok: false, items: 0, detail: { step: "snapshot statistics", stats: outcome, error: `snapshot statistics: ${outcome.error}` } };
  return null;
}
