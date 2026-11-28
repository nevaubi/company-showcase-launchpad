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
 *   IR_REBUILD_PARALLEL=1       companies rebuilt side by side, each in a process of its own (1 to 8).
 *                               The worker keeps 1 (it shares memory with the readers); a catch-up run
 *                               by hand on an idle machine passes --parallel
 *   IR_REBUILD_BESIDE=0         back to idle-only passes (default: the lane takes one reading lane's
 *                               place while stale payloads are left, `staleLane`)
 *   IR_REBUILD_REPAIR_BEFORE=<ISO time>
 *                               repair pass: payloads at the current build format written before that
 *                               time are rebuilt once (a build rule was wrong until then). It runs with
 *                               IR_REBUILD_STALE=0 too and then takes only those payloads: no payload of
 *                               an older format and no waiting fill is touched. Unset: off.
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
  /** a pass may run: the stale lane is on, or a repair time is set */
  enabled: boolean;
  maxCompanies: number;
  maxMs: number;
  /** IR_REBUILD_STALE: payloads below the build format and waiting fills are taken */
  stale: boolean;
  /** IR_REBUILD_REPAIR_BEFORE in ms: payloads at the current format built before it are taken; null when unset */
  repairBefore: number | null;
  /** IR_REBUILD_PARALLEL: companies rebuilt side by side, each in a process of its own (1 to 8; default 1) */
  parallel: number;
}

const bounded = (v: string | undefined, def: number, lo: number, hi: number) => {
  const n = Math.floor(Number(v ?? def));
  return Number.isFinite(n) && n >= lo ? Math.min(hi, n) : def;
};

/** What a pass itself reads of the settings: its bounds. */
export type PassBounds = Pick<RebuildSettings, "enabled" | "maxCompanies" | "maxMs">;

export function rebuildSettings(env: Record<string, string | undefined>): RebuildSettings {
  const stale = env["IR_REBUILD_STALE"] !== "0";
  const at = Date.parse(env["IR_REBUILD_REPAIR_BEFORE"] ?? "");
  const repairBefore = Number.isFinite(at) ? at : null;
  return {
    enabled: stale || repairBefore !== null,
    maxCompanies: bounded(env["IR_REBUILD_MAX"], 20, 1, 200),
    maxMs: bounded(env["IR_REBUILD_MINUTES"], 15, 1, 30) * 60_000,
    stale,
    repairBefore,
    parallel: bounded(env["IR_REBUILD_PARALLEL"], 1, 1, 8),
  };
}

/** One ir_company_series row as the lane selects it: ticker and `stats->build` only. */
export interface SeriesRow {
  ticker: string;
  build: unknown;
  /** `stats->quality->fill` (waiting, pass, at), when the lane selects it */
  fill?: unknown;
  /** when the payload was written, when the lane selects it (the repair pass reads it) */
  built_at?: string | null;
}

/** Extra rebuilds of a company whose table fill left history documents waiting: at most this many in a row, */
export const FILL_PASSES = 8;
/** and at most one an hour. */
export const FILL_PASS_GAP_MS = 3_600_000;

/**
 * Tickers whose stored stats lack the current build format (missing, older, or not a number), and, with `nowMs`,
 * those whose table fill left documents waiting (history not yet read within one rebuild's downloads), at most
 * once an hour and `FILL_PASSES` times in a row (the count is the payload's own `fill.pass`, so it cannot loop).
 * `pick.stale === false` leaves both groups alone (IR_REBUILD_STALE=0). `pick.repairBefore` adds the payloads
 * at exactly the current format written before that time (the repair pass): once rebuilt, a payload's `built_at`
 * is past it, so each is taken once.
 */
export function staleTickers(
  rows: readonly SeriesRow[],
  format: number,
  nowMs?: number,
  pick: { stale?: boolean; repairBefore?: number | null } = {},
): string[] {
  const out = new Set<string>();
  const takeStale = pick.stale !== false;
  for (const r of rows) {
    const b = typeof r.build === "number" ? r.build : typeof r.build === "string" ? Number(r.build) : NaN;
    if (!(Number.isFinite(b) && b >= format)) {
      if (takeStale) out.add(r.ticker);
      continue;
    }
    if (takeStale && nowMs != null && r.fill && typeof r.fill === "object") {
      const f = r.fill as { waiting?: unknown; pass?: unknown; at?: unknown };
      const at = typeof f.at === "string" ? Date.parse(f.at) : NaN;
      if (Number(f.waiting ?? 0) > 0 && Number(f.pass ?? 0) < FILL_PASSES && Number.isFinite(at) && nowMs - at >= FILL_PASS_GAP_MS)
        out.add(r.ticker);
    }
    if (pick.repairBefore != null && b === format) {
      const built = typeof r.built_at === "string" ? Date.parse(r.built_at) : NaN;
      if (Number.isFinite(built) && built < pick.repairBefore) out.add(r.ticker);
    }
  }
  return [...out];
}

/**
 * Covered companies with no stored payload at all whose stored documents can give one without a model: at
 * least one release or supplement kept as HTML (`withDocs`, the count per ticker). The table fill reads
 * their statement tables straight from those documents (`--first` of the script); a company whose documents
 * print no statement the fill can read ends as "no stored facts" and waits like any failure.
 */
export function firstBuildTickers(
  coverage: readonly { ticker: string }[],
  haveSeries: ReadonlySet<string>,
  withDocs: ReadonlyMap<string, number>,
): string[] {
  return coverage.map((c) => c.ticker).filter((t) => !haveSeries.has(t) && (withDocs.get(t) ?? 0) > 0);
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
  /** companies a reading lane holds now: left for a later pass (their read rebuilds them anyway) */
  skip?: ReadonlySet<string>;
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
 * One bounded pass: the stale tickers in lane order, stopping at `maxCompanies` or once `maxMs` is
 * spent. State is saved after every company. `settings.parallel` (default 1: one at a time) is how
 * many companies are rebuilt side by side: each lane takes the next company in order, so the order
 * and the bounds are the same and only the wall time differs; no new company starts once a bound is hit.
 */
export async function runPass(state: RebuildState, order: readonly string[], settings: PassBounds & { parallel?: number }, deps: PassDeps): Promise<PassResult> {
  const t0 = deps.now();
  pruneFailures(state, order);
  const todo = eligible(state, order, t0).filter((t) => !deps.skip?.has(t));
  const result: PassResult = { rebuilt: [], failed: {}, review: [], left: 0, stale: order.length, stoppedBy: "done" };
  const lanes = Math.max(1, Math.floor(settings.parallel ?? 1));
  /** next company to take, and how many were taken */
  let i = 0;
  let stoppedBy: PassResult["stoppedBy"] | null = null;
  const one = async (t: string) => {
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
      deps.log(`${t}: rebuild failed (${error.slice(0, 160)})${review ? `; ${REVIEW_AFTER} failures, left for review` : "; skipped for a day"}`);
    }
    state.at = new Date(deps.now()).toISOString();
    await deps.save(state);
  };
  const lane = async () => {
    for (;;) {
      if (stoppedBy || i >= todo.length) return;
      if (deps.stopped?.()) stoppedBy = "signal";
      else if (i >= settings.maxCompanies) stoppedBy = "companies";
      else if (deps.now() - t0 >= settings.maxMs) stoppedBy = "time";
      if (stoppedBy) return;
      await one(todo[i++]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, Math.max(1, todo.length)) }, lane));
  result.stoppedBy = stoppedBy ?? "done";
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

/** IR_REBUILD_BESIDE=0 restores idle-only passes (`rebuildDue`); on by default. */
export const besideEnabled = (env: Record<string, string | undefined>) => env["IR_REBUILD_BESIDE"] !== "0";

export interface LaneInput extends DueInput {
  /** IR_REBUILD_BESIDE */
  beside: boolean;
  /** the loop's lanes (reading lanes, fresh pass and stale pass together) */
  lanes: number;
}

export interface LaneDecision {
  /** busy lanes of every kind (the stale pass included) below which a read (company or fresh pass) may start */
  readingLanes: number;
  /** start a stale pass now */
  start: boolean;
}

/** The usual gap after the last pass: 15 min after a failure, 1 h once nothing is left, else 1 min. */
const gapOver = (i: DueInput) => {
  if (i.lastEndMs === null) return true;
  const gap = i.lastFailed ? 15 * 60_000 : i.lastLeft === 0 ? IDLE_RECHECK_MS : 60_000;
  return i.nowMs - i.lastEndMs >= gap;
};

/**
 * Beside reading (round 8): while stale payloads are left (no pass yet in this process, which a new
 * build format's deploy always starts, or the last pass left some) and the gap since the last pass has
 * gone by (1 min; 15 min after a failure; 1 h when nothing was left, the idle recheck), one lane is kept for the stale pass (reading gets lanes minus one, so with one lane it alternates:
 * the running read ends, one pass, the next read). The pass starts as soon as a lane is free, counts as
 * a busy lane while it runs (`busy` includes it) and reading goes on beside it. Never beside canon; a
 * pass starts only with memory under half the limit. Off (IR_REBUILD_BESIDE=0): `rebuildDue` exactly,
 * and reading keeps every lane.
 */
export function staleLane(i: LaneInput): LaneDecision {
  if (!i.beside) return { readingLanes: i.lanes, start: rebuildDue(i) };
  const memOk = i.memUsedGB < i.memLimitGB * 0.5;
  const due = i.enabled && !i.running && !i.otherRebuilder && gapOver(i);
  const start = due && i.busy < i.lanes && memOk;
  // Keep a lane free for it (the loop offers lanes to reading before it starts the pass); but with
  // every lane idle and memory still too high the pass cannot start, so reading is not held back for nothing.
  const reserve = due && !(i.busy === 0 && !memOk);
  return { readingLanes: reserve ? Math.max(0, i.lanes - 1) : i.lanes, start };
}
