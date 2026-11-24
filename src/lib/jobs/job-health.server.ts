/**
 * Job health read: `job_health()` when the database has it, otherwise the same rows computed from
 * `job_runs` (job-health.ts). Production lacks the function (migration 0066 not applied), and the
 * watchdog has about a second for all its reads, so the fallback reads in parallel, one request per
 * job on the (job, started_at DESC) index plus one request for jobs not named here, each with the
 * time that is left. A job whose read failed or timed out is returned in `unread`, never as a job
 * without runs.
 */
import { SOURCES } from "./freshness";
import { HTTP_JOBS } from "./reaper";
import { EXCLUDED_JOBS, healthFromRuns, missingFunction, type HealthRow, type RunRow } from "./job-health";

/** The narrow shape of the client this read needs (the admin client, or a test double). */
export interface HealthClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  from(table: string): unknown;
}

export interface HealthRead {
  rows: HealthRow[];
  /** where the rows came from */
  source: "function" | "job_runs";
  /** jobs whose runs could not be read (never judged silent) */
  unread: string[];
  /** the function's error when it failed for another reason than being missing */
  error?: string;
}

const PAGE = 1000;
/** Columns of a run, with the two detail fields the run classes need (never the whole detail). */
const COLS = "job,started_at,finished_at,ok,error:detail->>error,outcome:detail->>outcome";

/** Every job the app knows by name: scheduled HTTP jobs, worker steps and the freshness sources. */
export const KNOWN_JOBS = [...new Set([...HTTP_JOBS, ...SOURCES.map((s) => s.job)])].sort();

type Answer = { data: RunRow[] | null; error: { message: string } | null };
type Query = PromiseLike<Answer> & {
  select(c: string): Query;
  eq(c: string, v: unknown): Query;
  not(c: string, op: string, v: unknown): Query;
  gt(c: string, v: unknown): Query;
  order(c: string, o: { ascending: boolean }): Query;
  limit(n: number): Query;
};

const within = <T,>(p: PromiseLike<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([Promise.resolve(p), new Promise<"timeout">((r) => setTimeout(() => r("timeout"), Math.max(0, ms)))]);

/** The function's rows when it exists; else the fallback over `job_runs` within `budgetMs`. */
export async function readJobHealth(db: HealthClient, opts: { hours?: number; budgetMs?: number; nowMs?: number } = {}): Promise<HealthRead> {
  const hours = opts.hours ?? 24;
  const started = Date.now();
  const budget = opts.budgetMs ?? 1000;
  const fn = await within(db.rpc("job_health", { _hours: hours }), budget);
  if (fn === "timeout") return { rows: [], source: "function", unread: KNOWN_JOBS, error: `job_health took over ${budget} ms` };
  if (!fn.error) {
    const vendor = await vendorHealth(db, hours, budget - (Date.now() - started), opts.nowMs ?? Date.now());
    return { rows: [...((fn.data ?? []) as HealthRow[]).map(numeric), ...vendor], source: "function", unread: [] };
  }
  if (!missingFunction(fn.error)) return { rows: [], source: "function", unread: KNOWN_JOBS, error: fn.error!.message };
  return readFromRuns(db, { hours, budgetMs: budget - (Date.now() - started), nowMs: opts.nowMs });
}

const numeric = (j: HealthRow): HealthRow => ({ ...j, runs: Number(j.runs), unfinished: Number(j.unfinished), failed: Number(j.failed), fail_streak: Number(j.fail_streak) });

/**
 * The vendor collector's row, which job_health() leaves out (11,500 runs a day). Read apart, newest
 * 1,000 runs, with run classes: most of its "failed" runs are the vendor saying it has no data for
 * that company (`empty`), which is an answer; what is left (e.g. ENOSPC on the worker disk) is failed.
 */
async function vendorHealth(db: HealthClient, hours: number, budgetMs: number, nowMs: number): Promise<HealthRow[]> {
  const since = new Date(nowMs - Math.min(Math.max(hours, 1), 336) * 3600_000).toISOString();
  const q = (db.from("job_runs") as Query).select(COLS).eq("job", "vendor-backfill").gt("started_at", since).order("started_at", { ascending: false }).limit(PAGE);
  const a = await within(q, Math.max(100, budgetMs));
  if (a === "timeout" || a.error) return [];
  const list = a.data ?? [];
  return healthFromRuns(list, nowMs, hours, { include: VENDOR, partial: list.length >= PAGE ? VENDOR : undefined });
}
const VENDOR: ReadonlySet<string> = new Set(["vendor-backfill"]);

/** The fallback alone (exported for tests and for callers that know the function is missing). */
export async function readFromRuns(db: HealthClient, opts: { hours?: number; budgetMs?: number; nowMs?: number } = {}): Promise<HealthRead> {
  const hours = opts.hours ?? 24;
  const nowMs = opts.nowMs ?? Date.now();
  const since = new Date(nowMs - Math.min(Math.max(hours, 1), 336) * 3600_000).toISOString();
  const runs = () => (db.from("job_runs") as Query).select(COLS).gt("started_at", since).order("started_at", { ascending: false }).limit(PAGE);
  const named = KNOWN_JOBS.filter((j) => !EXCLUDED_JOBS.has(j));
  // Jobs not named here (new jobs, worker `loop:*` steps): one request, excluded jobs left out so
  // vendor-backfill's volume (11,500 runs a day) cannot crowd them out of the page.
  const others = runs().not("job", "in", `(${[...named, ...EXCLUDED_JOBS].join(",")})`);
  const reads = [...named.map((j) => runs().eq("job", j)), others];
  const ms = Math.max(100, opts.budgetMs ?? 1000);
  const [answers, vendor] = await Promise.all([Promise.all(reads.map((q) => within(q, ms))), vendorHealth(db, hours, ms, nowMs)]);
  const rows: RunRow[] = [];
  const unread: string[] = [];
  const partial = new Set<string>();
  answers.forEach((a, i) => {
    const job = i < named.length ? named[i] : null;
    if (a === "timeout" || a.error) {
      // The catch-all read failing hides only unnamed jobs, which no silence rule judges.
      if (job) unread.push(job);
      return;
    }
    const list = a.data ?? [];
    rows.push(...list);
    if (list.length >= PAGE) {
      if (job) partial.add(job);
      // The catch-all page is full: the oldest job in it may have more runs than were read.
      else for (const r of list) partial.add(r.job);
    }
  });
  return { rows: [...healthFromRuns(rows, nowMs, hours, { partial }), ...vendor], source: "job_runs", unread };
}
