/**
 * The field counts step of the official-source worker (migration 0070), on only with FIELD_COUNTS_ENABLED=1 (unset
 * is off). It runs in the import lane when no snapshot waits to be imported, under the lane's lease, as one bounded
 * child (`scripts/source-field-counts.ts`: one snapshot at a time, newest published first, at most 25 snapshots,
 * 2 GiB of source files and 420 s a run), recorded in job_runs by the lane's `childRun` like the import child.
 *
 * Until 0070 is applied the table does not exist (PostgREST PGRST205, Postgres 42P01): the step then starts no child
 * and writes no row, says so once per process and looks again hourly, so it can deploy before the migration and needs
 * no restart after it. A run that left snapshots to count is followed by another at the next idle pass; a run that
 * left none, by a look after 30 minutes, or at the next idle pass after the import lane published. A snapshot that
 * failed (its file does not match it, or storage or the database failed on it), that a whole run could not count, or
 * that a stopped child was counting, is skipped by this process for a day; a child that ended badly backs the step
 * off from a minute to an hour. None of it is a reason to back off or fail the import lane.
 */
import { RESOURCE_WAIT_EXIT, enabled, safeError } from "./official-worker-plan";

export const FIELD_COUNTS_SCRIPT = "scripts/source-field-counts.ts";
/** FIELD_COUNTS_ENABLED: "1" or "true" turns the step on; unset, or anything else, leaves it off. */
export const fieldCountsEnabled = (value: string | undefined) => enabled(value, false);
/** The child's bounds: snapshots, source bytes and seconds a run. */
export const FIELD_COUNTS_MAX_SNAPSHOTS = 25;
export const FIELD_COUNTS_MAX_BYTES = 2 * 1024 ** 3;
export const FIELD_COUNTS_RUN_SECONDS = 420;
/** The longest the lane lets the child run before stopping it (its own deadline comes first). */
export const FIELD_COUNTS_CHILD_MS = 480_000;
/** A missing table is looked for again after this long. */
export const FIELD_COUNTS_RECHECK_MS = 3_600_000;
/** After a run that left nothing to count, the next look. */
export const FIELD_COUNTS_IDLE_MS = 30 * 60_000;
/** A snapshot that failed is not tried again for this long. */
export const FIELD_COUNTS_SKIP_MS = 86_400_000;
/** Snapshot ids passed to one run to skip, at most. */
export const FIELD_COUNTS_SKIP_MAX = 100;
/** After a child that could not start for lack of memory. */
export const FIELD_COUNTS_RESOURCE_WAIT_MS = 60_000;

type PgError = { code?: string; message?: string };
export type ChildEnd = { code: number | null; told: Record<string, unknown> | null };
export type FieldCountsPass =
  | { status: "ran"; code: number | null; items: number; left: number | null }
  | { status: "not_installed" }
  | { status: "waiting"; until: string }
  | { status: "probe_failed"; error: string };

/** PostgREST PGRST205 (no such table) or PGRST200 (no such relationship), Postgres 42P01. */
export const countsTableMissing = (error: PgError | null | undefined) => error?.code === "PGRST205" || error?.code === "PGRST200" || error?.code === "42P01";

const SNAPSHOT_ID = /^[0-9a-f]{64}$/;
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : (v as { snapshot?: unknown } | null)?.snapshot)).filter((v): v is string => typeof v === "string" && SNAPSHOT_ID.test(v)) : [];
const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

/** The child's arguments for one run. */
export function fieldCountsArgs(skip: readonly string[]): string[] {
  return [
    "--all",
    `--max-snapshots=${FIELD_COUNTS_MAX_SNAPSHOTS}`,
    `--max-bytes=${FIELD_COUNTS_MAX_BYTES}`,
    `--max-runtime-seconds=${FIELD_COUNTS_RUN_SECONDS}`,
    ...(skip.length ? [`--skip=${skip.slice(0, FIELD_COUNTS_SKIP_MAX).join(",")}`] : []),
  ];
}

export function fieldCountsStep(o: {
  /** One small select of the table (`snapshot_id`, limit 1): tells a missing table from a present one. */
  probe: () => PromiseLike<{ error: PgError | null }>;
  log: (line: string) => void;
  now?: () => number;
}) {
  const now = o.now ?? Date.now;
  let missingAt: number | null = null;
  let said = false;
  let failures = 0;
  let nextAt = 0;
  const skip = new Map<string, number>();

  const missing = (): FieldCountsPass => {
    missingAt = now();
    if (!said) {
      said = true;
      o.log("field counts skipped: table source_field_counts is not installed (migration 0070); looked for again hourly");
    }
    return { status: "not_installed" };
  };
  const backOff = () => {
    failures += 1;
    nextAt = now() + Math.min(FIELD_COUNTS_RECHECK_MS, 60_000 * 2 ** (failures - 1));
  };
  const skipFor = (list: string[]) => {
    for (const id of list) skip.set(id, now() + FIELD_COUNTS_SKIP_MS);
  };

  return {
    /** One idle pass of the lane: runs the child when it is due, through `run` (the lane's childRun). */
    async pass(run: (args: string[]) => Promise<ChildEnd>): Promise<FieldCountsPass> {
      const started = now();
      if (missingAt !== null && started - missingAt < FIELD_COUNTS_RECHECK_MS) return { status: "not_installed" };
      if (started < nextAt) return { status: "waiting", until: new Date(nextAt).toISOString() };
      let probed: { error: PgError | null };
      try {
        probed = await o.probe();
      } catch (e) {
        probed = { error: { message: safeError(e) } };
      }
      if (countsTableMissing(probed.error)) return missing();
      if (probed.error) {
        backOff();
        return { status: "probe_failed", error: safeError(probed.error.message ?? probed.error.code ?? "no answer") };
      }
      if (missingAt !== null) o.log("field counts: table source_field_counts found; counting starts");
      missingAt = null;
      for (const [id, until] of skip) if (until <= started) skip.delete(id);
      const { code, told } = await run(fieldCountsArgs([...skip.keys()]));
      if (code === RESOURCE_WAIT_EXIT) {
        nextAt = now() + FIELD_COUNTS_RESOURCE_WAIT_MS;
        return { status: "ran", code, items: 0, left: null };
      }
      if (told?.not_installed === true) return missing();
      skipFor([...ids(told?.failed), ...ids(told?.too_long)]);
      const items = count(told?.items) ?? 0;
      const left = count(told?.left);
      if (code !== 0) {
        // stopped or crashed: the snapshot it was counting waits a day, so one file cannot hold the step
        skipFor(ids([told?.current]));
        backOff();
        o.log(`field counts child ended with code ${code ?? "none"}; next run after ${new Date(nextAt).toISOString()}`);
        return { status: "ran", code, items, left };
      }
      if (typeof told?.error === "string" && items === 0 && !ids(told?.failed).length) {
        // the run could not even list its queue
        backOff();
        return { status: "ran", code, items, left };
      }
      failures = 0;
      nextAt = left !== null && left > 0 ? now() : now() + FIELD_COUNTS_IDLE_MS;
      return { status: "ran", code, items, left };
    },
    /** The import lane published: look for new snapshots at the next idle pass. */
    wake() {
      if (missingAt === null && failures === 0) nextAt = 0;
    },
    /** Snapshot ids this process skips now (for the account of a pass and the tests). */
    skipping(): string[] {
      return [...skip.keys()];
    },
  };
}
