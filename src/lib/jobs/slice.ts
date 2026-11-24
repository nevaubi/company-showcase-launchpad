/**
 * Commit-after-work cursors for the rotating HTTP jobs (pure).
 *
 * The scheduler hangs up after about 5 s and the host cancels the handler with it, so a cursor written
 * before the work skips the slice until the next lap when the run is cut off. Here the cursor moves
 * only after the slice was stored:
 *
 *   claim   read the cursor and the attempt row `<job>-slice` (cursor = start * 10 + tries); record
 *           this attempt before any work, so a run that is cut off still counts as a try
 *   commit  done:    advance by the units that finished (a budget stop advances by fewer), clear tries
 *           failed:  hold the cursor; the next run repeats the slice
 *           blocked: hold the cursor and give the attempt back (the source refused us; the job backs
 *                    off instead, so a block never skips companies)
 *
 * A slice that was claimed `MAX_SLICE_TRIES` times without a commit is skipped at the next claim and
 * reported, so one bad slice (or one that always runs past the cut) cannot block the rotation.
 */

export const MAX_SLICE_TRIES = 3;
export const sliceKey = (job: string) => `${job}-slice`;

export interface SliceTries {
  start: number;
  tries: number;
}

/** `cursor = start * 10 + tries` (tries 0 to 9). */
export const encodeTries = (t: SliceTries) => Math.max(0, Math.floor(t.start)) * 10 + Math.min(9, Math.max(0, Math.floor(t.tries)));
export const decodeTries = (cursor: number | null | undefined): SliceTries | null => {
  const c = Number(cursor ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  return { start: Math.floor(c / 10), tries: c % 10 };
};

export interface Claim {
  /** first index of this run's slice */
  start: number;
  /** 1-based attempt number for this slice */
  attempt: number;
  /** a slice skipped at claim after too many tries (null when none) */
  skipped: { start: number; tries: number } | null;
  /** cursor to write now (only when a slice was skipped, so the skip survives a cut-off) */
  cursorNow: number | null;
  /** attempt row value to write before the work */
  triesCursor: number;
  /** the list wrapped while skipping */
  wrapped: boolean;
}

const norm = (n: number, total: number) => (total <= 0 ? 0 : ((Math.floor(n) % total) + total) % total);

export function claimSlice(cursor: number | null | undefined, tries: number | null | undefined, total: number, step: number, maxTries = MAX_SLICE_TRIES): Claim {
  let start = norm(Number(cursor ?? 0), total);
  const prev = decodeTries(tries);
  let attempt = prev && prev.start === start ? prev.tries + 1 : 1;
  let skipped: Claim["skipped"] = null;
  let cursorNow: number | null = null;
  let wrapped = false;
  if (attempt > maxTries && total > 0) {
    skipped = { start, tries: attempt - 1 };
    const next = start + Math.max(1, step);
    wrapped = next >= total;
    start = wrapped ? 0 : next;
    cursorNow = start;
    attempt = 1;
  }
  return { start, attempt, skipped, cursorNow, triesCursor: encodeTries({ start, tries: attempt }), wrapped };
}

/** `cut`: the run's time budget ran out before the slice finished; like `blocked`, no try is charged. */
export type SliceOutcome = "done" | "failed" | "blocked" | "cut";

/**
 * An error that only says the run's own time budget ran out: nothing was tried, or the last try got
 * no answer before the deadline. The work resumes next run, so it is not a failure. An answer from
 * the source (any HTTP status, e.g. "responded 503 (run budget spent)") stays a failure.
 */
export const budgetCut = (message: string) => /responded with an error(?: \(no answer in \d+ ms\))? \(run budget spent\)/.test(message);

export interface Commit {
  /** cursor to write, or null to leave it */
  cursor: number | null;
  /** attempt row value to write */
  triesCursor: number;
  wrapped: boolean;
}

/**
 * What to write after the work. `advanceBy` is how many units of the slice finished (done only;
 * defaults to the whole step). A done slice with `advanceBy` 0 holds the cursor (nothing finished).
 */
export function commitSlice(claim: Pick<Claim, "start" | "attempt">, outcome: SliceOutcome, total: number, step: number, advanceBy = step): Commit {
  if (outcome === "done" && advanceBy > 0) {
    const next = claim.start + Math.min(step, Math.max(1, Math.floor(advanceBy)));
    const wrapped = next >= total;
    return { cursor: wrapped ? 0 : next, triesCursor: 0, wrapped };
  }
  if (outcome === "blocked" || outcome === "cut") return { cursor: null, triesCursor: encodeTries({ start: claim.start, tries: claim.attempt - 1 }), wrapped: false };
  return { cursor: null, triesCursor: encodeTries({ start: claim.start, tries: claim.attempt }), wrapped: false };
}

/**
 * Default slice outcome for jobs whose units fail independently: done when at least one unit stored
 * (or there was nothing to do), failed when every attempted unit failed.
 */
export const outcomeOf = (attempted: number, failed: number): SliceOutcome => (attempted > 0 && failed >= attempted ? "failed" : "done");

/** Per-unit deadline: the time left in the run, never under `floorMs` (a unit always gets a fair try). */
export const unitTimeoutMs = (endMs: number, nowMs: number, floorMs = 500) => Math.max(floorMs, Math.floor(endMs - nowMs));

/**
 * The run budget: soft stop for starting new units. Defaults to 3.5 s so a run plus its database
 * writes fits under the scheduler's 5 s cut. JOB_RUN_BUDGET_MS raises it once the owner raises the
 * scheduler timeout (bounded at 25 s).
 */
export function runBudgetMs(env: Record<string, string | undefined>): number {
  const n = Number(env["JOB_RUN_BUDGET_MS"]);
  if (!Number.isFinite(n) || n <= 0) return 3500;
  return Math.min(25_000, Math.max(1000, Math.floor(n)));
}
