/** Bounded scheduling decisions shared by the official-source worker and tests. */
export const SOURCE_WORKER_JOB = "official-sources-runner";
export const SOURCE_REFRESH_JOB = "official-source-refresh";
export const ABS_WORKER_JOB = "abs-bulk-runner";
export const WORKER_LEASE_MS = 180_000;
export const RESOURCE_WAIT_EXIT = 75;

/** Keep headroom for the existing IR readers before starting another bounded child. */
export function canStartOfficialChild(limit: number | null, used: number | null, active: number): boolean {
  if (limit === null || used === null || !Number.isFinite(limit) || !Number.isFinite(used)
      || limit <= 0 || used < 0) return active === 0;
  const reservations = (Math.max(0, active) + 1) * 256 * 1024 ** 2;
  return used < limit * 0.7 && limit - used >= limit * 0.15 + reservations;
}

export function retryDelay(failures: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** Math.min(7, Math.max(0, failures - 1)));
}

/** A failed or terminated unit remains at the same cursor. */
export function advanceCursor(cursor: number, count: number, exitCode: number | null): number {
  if (!Number.isSafeInteger(count) || count <= 0) return 0;
  const current = ((cursor % count) + count) % count;
  return exitCode === 0 ? (current + 1) % count : current;
}

export function enabled(value: string | undefined, defaultValue = true): boolean {
  return value === undefined ? defaultValue : /^(1|true)$/i.test(value);
}

/**
 * The `job_runs` row for one child process: how it ended, plus the child's own account of its work
 * when it left one (scripts/lib/run-receipt.ts). `error` is always present on a failed run, because
 * that is where the freshness page and the watchdog tell a person to look.
 */
export function childReceipt(i: {
  child: string;
  exitCode: number | null;
  /** the worker ended the process (time limit or lost lease) */
  killed: boolean;
  seconds: number;
  told: Record<string, unknown> | null;
}): { ok: boolean; items: number; detail: Record<string, unknown> } {
  const { items: toldItems, error: toldError, ok: toldOk, ...account } = i.told ?? {};
  // a child that exits 0 (so its lane keeps its pace) can still say the run failed: every dataset it tried failed
  const failedByAccount = i.exitCode === 0 && !i.killed && toldOk === false;
  const ok = i.exitCode === 0 && !failedByAccount;
  const items = typeof toldItems === "number" && Number.isSafeInteger(toldItems) && toldItems >= 0 ? toldItems : 0;
  const said = [toldError, account.first_error].find((v): v is string => typeof v === "string" && v.length > 0);
  const ended = i.killed
    ? `stopped by the worker after ${Math.round(i.seconds)} s (time limit or lost lease)`
    : failedByAccount
      ? "child exited with code 0 and reported a failed run"
      : `child exited with code ${i.exitCode ?? "none"}`;
  return {
    ok,
    items,
    detail: {
      ...account,
      child: i.child,
      exit_code: i.exitCode,
      ...(i.told ? {} : { note: "The child left no receipt: only how the process ended is known." }),
      ...(ok ? (typeof toldError === "string" && toldError ? { error: toldError } : {}) : { error: safeError(said ? `${ended}: ${said}` : ended) }),
    },
  };
}

export function safeError(error: unknown): string {
  // No URL query strings or credential-looking tokens belong in the operational ledger.
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/[^\s]+/g, "[remote request]")
    .replace(/(?:sb_secret_|sb_publishable_|eyJ)[A-Za-z0-9_.-]+/g, "[credential]")
    .slice(0, 400);
}

// ---------------------------------------------------------------------------------------------
// ABS lane rotation (review rev-workers S7)
// ---------------------------------------------------------------------------------------------

/** A CIK whose last look found nothing to do is not looked at again for an hour. */
export const ABS_IDLE_RECHECK_MS = 3_600_000;
/** Pause between two runs on the same CIK while it has filings left; the child keeps SEC at 2 a second. */
export const ABS_STAY_PAUSE_MS = 5_000;
/** Pause before the next CIK, as before: at most one CIK a minute. */
export const ABS_MOVE_PAUSE_MS = 60_000;
/** Runs in a row on one CIK before the others get a turn; the CIK is taken up again on the next pass. */
export const ABS_STAY_MAX_RUNS = 40;

/** What the lane remembers of a CIK in this process: when it was last worked and what it had left. */
export type AbsSeen = { at: number; left: number };
export type AbsStay = { index: number; runs: number };
export type AbsTurn = { index: number; command: "run" | "load" } | { waitMs: number };

/**
 * Which watched CIK the ABS lane works next, by its index in the watch list. While a CIK's last run
 * left filings to do, it is worked again (`load`: its listing was read at the start of this visit),
 * up to `ABS_STAY_MAX_RUNS` runs in a row. Otherwise the rotation goes on from `cursor` to the first CIK
 * not looked at in this process, or with work left, or idle for an hour, and lists it again (`run`).
 * When every CIK was idle within the hour, the lane waits for the first one to come due.
 */
export function absNextTurn(i: {
  count: number;
  cursor: number;
  seen: ReadonlyMap<number, AbsSeen>;
  stay: AbsStay | null;
  now: number;
}): AbsTurn {
  if (!Number.isSafeInteger(i.count) || i.count <= 0) return { waitMs: ABS_IDLE_RECHECK_MS };
  const start = ((i.cursor % i.count) + i.count) % i.count;
  if (i.stay && i.stay.index === start && i.stay.runs < ABS_STAY_MAX_RUNS) return { index: start, command: "load" };
  let soonest = Infinity;
  for (let step = 0; step < i.count; step++) {
    const index = (start + step) % i.count;
    const seen = i.seen.get(index);
    if (!seen || seen.left > 0 || i.now - seen.at >= ABS_IDLE_RECHECK_MS) return { index, command: "run" };
    soonest = Math.min(soonest, seen.at + ABS_IDLE_RECHECK_MS - i.now);
  }
  return { waitMs: Math.max(1_000, Math.min(ABS_IDLE_RECHECK_MS, soonest)) };
}

/**
 * After a run on `index`: what to remember (`seen`: null means forget, so the CIK is taken up again),
 * where the rotation stands and how long to pause. Only a clean run (exit 0) moves the rotation or
 * stays; a failed run keeps the cursor, forgets the CIK and leaves the pause to the lane's backoff.
 * `left` is what the run's receipt says is still to do for that CIK; a clean run that left no receipt
 * counts as having nothing left, so a CIK is never worked again on a guess.
 */
export function absAfterRun(i: {
  count: number;
  index: number;
  exitCode: number | null;
  left: number | null;
  stay: AbsStay | null;
  now: number;
}): { seen: AbsSeen | null; stay: AbsStay | null; cursor: number; pauseMs: number | null } {
  const left = i.left !== null && Number.isSafeInteger(i.left) && i.left > 0 ? i.left : 0;
  if (i.exitCode !== 0) return { seen: null, stay: null, cursor: i.index, pauseMs: null };
  const runs = i.stay?.index === i.index ? i.stay.runs + 1 : 1;
  if (left > 0 && runs < ABS_STAY_MAX_RUNS)
    return { seen: { at: i.now, left }, stay: { index: i.index, runs }, cursor: i.index, pauseMs: ABS_STAY_PAUSE_MS };
  return { seen: { at: i.now, left }, stay: null, cursor: (i.index + 1) % Math.max(1, i.count), pauseMs: ABS_MOVE_PAUSE_MS };
}

/** The filings still to do for `cik` as the abs-ee child's receipt states them (`ciks[].left`); null when it does not say. */
export function absLeftFromReceipt(told: Record<string, unknown> | null, cik: number): number | null {
  const lines = Array.isArray(told?.ciks) ? (told.ciks as unknown[]) : [];
  for (const line of lines) {
    const l = line as { cik?: unknown; left?: unknown } | null;
    if (l && l.cik === cik && typeof l.left === "number" && Number.isSafeInteger(l.left) && l.left >= 0) return l.left;
  }
  return null;
}
