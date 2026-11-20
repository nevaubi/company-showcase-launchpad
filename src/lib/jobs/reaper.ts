/**
 * Reaper (pure): which unfinished `job_runs` rows, expired runner leases and abandoned report runs
 * to close, and what to record. The worker applies the result (bounded per pass).
 */

/** Scheduled HTTP jobs: the scheduler hangs up after about 5 s, so no run can still be alive after 10 min. */
export const HTTP_JOBS: readonly string[] = ["prices", "macro", "sec", "filing-cache", "ir-docs", "ir-site", "ir-extract", "estimates", "alt-data", "setups", "gov-data", "options", "short-volume", "sec-discover", "partner-mirror", "emails"];

export const HTTP_MAX_RUN_MS = 10 * 60_000;
export const WORKER_MAX_RUN_MS = 3 * 3600_000;
/** Longest legitimate worker step (a partner mirror pass may take hours; its deadline is 3 h, P1-7). */
export const REAP_LIMIT = 500;
export const LEASE_GRACE_MS = 10 * 60_000;
export const REPORT_RUN_MAX_MS = 2 * 3600_000;

export const maxRunMs = (job: string) => (HTTP_JOBS.includes(job) ? HTTP_MAX_RUN_MS : WORKER_MAX_RUN_MS);

export interface RunRow {
  id: string | number;
  job: string;
  started_at: string;
  finished_at: string | null;
}

/** Unfinished runs older than their job's limit, oldest first, at most `limit`. */
export function staleRuns<R extends RunRow>(rows: readonly R[], nowMs: number, limit = REAP_LIMIT): R[] {
  return rows
    .filter((r) => r.finished_at == null && nowMs - Date.parse(r.started_at) > maxRunMs(r.job))
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .slice(0, Math.max(0, limit));
}

/** What a reaped run records: finished at its own start (it did no measurable work), not ok. */
export function reapPatch(r: RunRow) {
  return {
    finished_at: r.started_at,
    ok: false,
    detail: {
      reaped: true,
      reason: HTTP_JOBS.includes(r.job) ? "no finish recorded (scheduler hung up after 5 s)" : "no finish recorded (worker step died or was killed)",
    },
  };
}

/** Runner leases (`*-runner*` keys) that ran out more than the grace period ago: cosmetic clean-up. */
export function expiredLeases<R extends { job: string; lease_until: string | null }>(rows: readonly R[], nowMs: number, graceMs = LEASE_GRACE_MS): R[] {
  return rows.filter((r) => r.lease_until != null && /-runner/.test(r.job) && Date.parse(r.lease_until) < nowMs - graceMs);
}

/** `report_runs` rows stuck in `running` longer than the limit (abandoned by a killed process). */
export function staleReportRuns<R extends { id: string; status: string; created_at: string }>(rows: readonly R[], nowMs: number, maxMs = REPORT_RUN_MAX_MS, limit = REAP_LIMIT): R[] {
  return rows.filter((r) => r.status === "running" && nowMs - Date.parse(r.created_at) > maxMs).slice(0, Math.max(0, limit));
}

/** Summary for the reaper's own run row. */
export function reapSummary(runs: readonly RunRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) out[r.job] = (out[r.job] ?? 0) + 1;
  return out;
}
