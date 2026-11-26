/**
 * Stale IR payload lane (round 7). A company's stored series payload (ir_company_series) is stale when
 * its stats carry no `build` at the current `BUILD_FORMAT` (src/lib/ir/payload.ts): every rebuild since
 * this lane writes `stats.build`, so the table alone says which payloads are stale and no payload is
 * downloaded to find out. The lane rebuilds them from stored facts, stored label maps and stored
 * document text (`rebuildCompany`): no model, gateway or paid API is called.
 *
 * Order: covered banks first (the IR priority bank group, largest first), then every other stale
 * company by the loop's rank (20-day dollar volume), unranked ones last in ticker order.
 * Bounds per pass: one company at a time, at most `maxCompanies` companies and no new company once
 * `maxMs` is spent. Resumable and idempotent: each pass reselects from the table, so a company rebuilt
 * by a killed pass is not taken again and one that was not is taken next pass.
 * Failures: a failed company is skipped for a day; after three failures it is left for review (listed
 * in the lane's state and in every pass's job_runs row) until a rebuild elsewhere stamps it current.
 *
 * Settings (worker environment):
 *   IR_REBUILD_STALE=0          switch the lane off (on by default: bounded and model-free)
 *   IR_REBUILD_MAX=20           companies per pass (1 to 200)
 *   IR_REBUILD_MINUTES=15       minutes per pass before no new company starts (1 to 30); the loop
 *                               stops a pass outright at 45 min (`ir-rebuild` in loop-schedule.ts)
 * Pure: the script (scripts/ir-rebuild-stale.ts) and the loop own the database and storage.
 */
import { byRank } from "@/lib/jobs/priority";
import { PRIORITY_GROUPS, type PriorityCompany } from "./ir-priority";

export const REBUILD_JOB = "ir-rebuild-stale";
/** Lane state in the private ir-documents bucket, beside the loop's own state file. */
export const REBUILD_STATE = "ops/ir-rebuild-stale.json";
/** A failed company waits this long before its next try. */
export const FAIL_WAIT_MS = 86_400_000;
/** Failures after which a company is left for review. */
export const REVIEW_AFTER = 3;
/** Gap between the loop's checks once nothing is left to rebuild. */
export const IDLE_RECHECK_MS = 3_600_000;

export interface RebuildSettings {
  enabled: boolean;
  maxCompanies: number;
  maxMs: number;
}

const bounded = (v: string | undefined, def: number, lo: number, hi: number) => {
  const n = Math.floor(Number(v ?? def));
  return Number.isFinite(n) && n >= lo ? Math.min(hi, n) : def;
};

export function rebuildSettings(env: Record<string, string | undefined>): RebuildSettings {
  return {
    enabled: env["IR_REBUILD_STALE"] !== "0",
    maxCompanies: bounded(env["IR_REBUILD_MAX"], 20, 1, 200),
    maxMs: bounded(env["IR_REBUILD_MINUTES"], 15, 1, 30) * 60_000,
  };
}

/** One ir_company_series row as the lane selects it: ticker and `stats->build` only. */
export interface SeriesRow {
  ticker: string;
  build: unknown;
}

/** Tickers whose stored stats lack the current build format (missing, older, or not a number). */
export function staleTickers(rows: readonly SeriesRow[], format: number): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    const b = typeof r.build === "number" ? r.build : typeof r.build === "string" ? Number(r.build) : NaN;
    if (!(Number.isFinite(b) && b >= format)) out.add(r.ticker);
  }
  return [...out];
}

/** Banks first (largest first), then the rest by rank, unranked ones after in ticker order. */
export function rebuildOrder(stale: readonly string[], coverage: readonly PriorityCompany[], rank: Map<string, number>): string[] {
  const want = new Set(stale);
  const isBank = PRIORITY_GROUPS["banks"]!;
  const banks = byRank(coverage.filter((c) => want.has(c.ticker) && isBank(c)), (c) => c.ticker, rank).map((c) => c.ticker);
  const bankSet = new Set(banks);
  const rest = byRank([...want].filter((t) => !bankSet.has(t)).sort(), (t) => t, rank);
  return [...banks, ...rest];
}

export interface FailureEntry {
  count: number;
  /** ISO time of the last failure */
  at: string;
  error: string;
}

export interface RebuildState {
  failures: Record<string, FailureEntry>;
  /** end of the last pass */
  at?: string;
  /** companies still stale and eligible after the last pass (not counting review or waiting ones) */
  left?: number;
  /** companies stale at the start of the last pass */
  stale?: number;
  /** last pass's rebuilt companies, in order */
  rebuilt?: string[];
}

export const emptyState = (): RebuildState => ({ failures: {} });

/** Companies left for review (three failures), in ticker order. */
export const reviewList = (s: RebuildState): string[] =>
  Object.keys(s.failures)
    .filter((t) => s.failures[t]!.count >= REVIEW_AFTER)
    .sort();

export type Skip = "review" | "waiting" | null;

/** Why a company is not taken now: left for review, or failed within the last day. */
export function skipReason(s: RebuildState, t: string, nowMs: number): Skip {
  const f = s.failures[t];
  if (!f) return null;
  if (f.count >= REVIEW_AFTER) return "review";
  if (nowMs - Date.parse(f.at) < FAIL_WAIT_MS) return "waiting";
  return null;
}

/** Companies of `order` the lane may take now, in order. */
export const eligible = (s: RebuildState, order: readonly string[], nowMs: number): string[] => order.filter((t) => !skipReason(s, t, nowMs));

/** Record a failure (in place); returns whether the company is now left for review. */
export function recordFailure(s: RebuildState, t: string, error: string, nowMs: number): boolean {
  const prev = s.failures[t];
  s.failures[t] = { count: (prev?.count ?? 0) + 1, at: new Date(nowMs).toISOString(), error: error.slice(0, 300) };
  return s.failures[t]!.count >= REVIEW_AFTER;
}

/** A rebuilt company leaves the failure list. */
export function recordSuccess(s: RebuildState, t: string) {
  delete s.failures[t];
}

/** Companies no longer stale (a reading run or a hand rebuild stamped them) leave the failure list too. */
export function pruneFailures(s: RebuildState, stale: readonly string[]) {
  const set = new Set(stale);
  for (const t of Object.keys(s.failures)) if (!set.has(t)) delete s.failures[t];
}

export interface PassDeps {
  /** rebuild one company; resolves false when it has no stored facts (counted as a failure) */
  rebuild: (ticker: string) => Promise<boolean>;
  /** wait for the database to be responsive (dbGate) */
  gate: () => Promise<void>;
  /** persist the lane state (after every company, so a killed pass loses nothing) */
  save: (s: RebuildState) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
  /** set by a stop signal: no new company starts */
  stopped?: () => boolean;
}

export interface PassResult {
  rebuilt: string[];
  failed: Record<string, string>;
  review: string[];
  /** eligible companies not reached this pass */
  left: number;
  stale: number;
  stoppedBy: "done" | "companies" | "time" | "signal";
}

/**
 * One bounded pass: the stale tickers in lane order, one at a time, stopping at `maxCompanies` or
 * once `maxMs` is spent. State is saved after every company.
 */
export async function runPass(state: RebuildState, order: readonly string[], settings: RebuildSettings, deps: PassDeps): Promise<PassResult> {
  const t0 = deps.now();
  pruneFailures(state, order);
  const todo = eligible(state, order, t0);
  const result: PassResult = { rebuilt: [], failed: {}, review: [], left: 0, stale: order.length, stoppedBy: "done" };
  let i = 0;
  for (; i < todo.length; i++) {
    if (deps.stopped?.()) {
      result.stoppedBy = "signal";
      break;
    }
    if (result.rebuilt.length + Object.keys(result.failed).length >= settings.maxCompanies) {
      result.stoppedBy = "companies";
      break;
    }
    if (deps.now() - t0 >= settings.maxMs) {
      result.stoppedBy = "time";
      break;
    }
    const t = todo[i]!;
    await deps.gate();
    const started = deps.now();
    let error: string | null = null;
    try {
      if (!(await deps.rebuild(t))) error = "no stored facts";
    } catch (e) {
      error = (e as Error).message || String(e);
    }
    if (error === null) {
      recordSuccess(state, t);
      result.rebuilt.push(t);
      deps.log(`${t}: rebuilt in ${((deps.now() - started) / 1000).toFixed(1)} s`);
    } else {
      result.failed[t] = error.slice(0, 300);
      const review = recordFailure(state, t, error, deps.now());
      deps.log(`${t}: rebuild failed (${error.slice(0, 160)})${review ? ` — ${REVIEW_AFTER} failures, left for review` : " — skipped for a day"}`);
    }
    state.at = new Date(deps.now()).toISOString();
    await deps.save(state);
  }
  result.left = todo.length - i;
  result.review = reviewList(state);
  state.at = new Date(deps.now()).toISOString();
  state.left = result.left;
  state.stale = order.length;
  state.rebuilt = result.rebuilt;
  await deps.save(state);
  return result;
}

/** The job_runs row one pass writes (job `ir-rebuild-stale`). */
export function passRunRow(startedMs: number, endMs: number, r: PassResult) {
  return {
    job: REBUILD_JOB,
    started_at: new Date(startedMs).toISOString(),
    finished_at: new Date(endMs).toISOString(),
    ok: Object.keys(r.failed).length === 0,
    items: r.rebuilt.length,
    detail: { rebuilt: r.rebuilt, failed: r.failed, review: r.review, left: r.left, stale: r.stale, stoppedBy: r.stoppedBy, ms: endMs - startedMs },
  };
}

export interface DueInput {
  enabled: boolean;
  /** a pass is running */
  running: boolean;
  /** companies in reading runs */
  busy: number;
  /** a reading run was started in this loop iteration */
  laneStarted: boolean;
  /** another step that rebuilds payloads (canon) is running */
  otherRebuilder: boolean;
  memUsedGB: number;
  memLimitGB: number;
  /** when the last pass ended, and whether it left anything to do / failed */
  lastEndMs: number | null;
  lastLeft: number | null;
  lastFailed: boolean;
  nowMs: number;
}

/**
 * Whether the loop starts a pass now: only with no reading run (none running, none started this
 * iteration, whatever the reason: nothing to read, the reader route closed on credit, a credit stop),
 * memory under half the limit, and no other rebuilder running. Back to back while work is left (the
 * loop's next iteration offers the lanes first), hourly once nothing is left, after 15 min on a failed
 * pass.
 */
export function rebuildDue(i: DueInput): boolean {
  if (!i.enabled || i.running || i.busy > 0 || i.laneStarted || i.otherRebuilder) return false;
  if (i.memUsedGB >= i.memLimitGB * 0.5) return false;
  if (i.lastEndMs === null) return true;
  const gap = i.lastFailed ? 15 * 60_000 : i.lastLeft === 0 ? IDLE_RECHECK_MS : 60_000;
  return i.nowMs - i.lastEndMs >= gap;
}
