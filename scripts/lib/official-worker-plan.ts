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
  const ok = i.exitCode === 0;
  const { items: toldItems, error: toldError, ...account } = i.told ?? {};
  const items = typeof toldItems === "number" && Number.isSafeInteger(toldItems) && toldItems >= 0 ? toldItems : 0;
  const said = [toldError, account.first_error].find((v): v is string => typeof v === "string" && v.length > 0);
  const ended = i.killed
    ? `stopped by the worker after ${Math.round(i.seconds)} s (time limit or lost lease)`
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
