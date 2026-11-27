/**
 * Pure scheduling rules for the worker loop (scripts/ir-deep-loop.ts): child deadlines, when a
 * periodic side step is due again after success or failure, the daily SEC catch-up, and how many AI
 * lanes may start given the provider circuit and a recent heal.
 */
import { lanesAllowed, type CircuitDecision } from "@/lib/jobs/provider-health";

/** Longest a child of each loop step may run before it is killed (SIGTERM, then SIGKILL after 30 s). */
export const STEP_LIMITS_MS: Record<string, number> = {
  mirror: 3 * 3600_000,
  import: 3600_000,
  detail: 2 * 3600_000,
  "ir-site": 2 * 3600_000,
  canon: 4 * 3600_000,
  "alt-slow": 3 * 3600_000,
  sod: 2 * 3600_000,
  "medicare-states": 2 * 3600_000,
  tri: 2 * 3600_000,
  reactions: 3600_000,
  // options-snapshot.ts --night stops itself after 50 min (it resumes next pass)
  "options-night": 3600_000,
  prose: 2 * 3600_000,
  verify: 3600_000,
  reports: 15 * 60_000,
  "filing-steps": 3600_000,
  analytics: 30 * 60_000,
  freshness: 5 * 60_000,
  "sec-catchup": 50 * 60_000,
  "form4-repair": 30 * 60_000,
  "registrant-drift": 10 * 60_000,
  // scripts/coverage.ts: about ten seconds of database work; the limit only catches a hung read
  coverage: 10 * 60_000,
  company: 6 * 3600_000,
  // fresh lane: at most IR_FRESH_MAX_FILES newest files and their rebuilds (scripts/lib/ir-fresh.ts)
  fresh: 90 * 60_000,
  // stale payload lane: at most 30 min of new companies, then the one in progress (scripts/lib/ir-rebuild-stale.ts)
  "ir-rebuild": 45 * 60_000,
};

export const stepLimit = (step: string) => STEP_LIMITS_MS[step] ?? 3600_000;

/** First retry 1 h after a failure, doubling, never later than the step's normal interval. */
export const FAIL_BACKOFF_MS = 3600_000;

/**
 * When a periodic step last "counts as run": after a zero exit, now (the next run is a full interval
 * away); after a failure, backdated so the next run comes after a backoff (1 h, 2 h, 4 h, … capped at
 * the interval). Returns the new `last*` timestamp and failure streak.
 */
export function nextDue(nowMs: number, ok: boolean, intervalMs: number, attempts: number): { last: string; attempts: number } {
  if (ok) return { last: new Date(nowMs).toISOString(), attempts: 0 };
  const n = attempts + 1;
  const backoff = Math.min(intervalMs, FAIL_BACKOFF_MS * 2 ** (n - 1));
  return { last: new Date(nowMs - intervalMs + backoff).toISOString(), attempts: n };
}

export const isDue = (last: string | null | undefined, intervalMs: number, nowMs: number) => !last || nowMs - Date.parse(last) >= intervalMs;

/** The SEC catch-up runs once a UTC day at the first pass after 03:00, and again when the day pass gave up. */
export function catchupDue(last: string | null | undefined, nowMs: number, dayPassReason: string | null | undefined): boolean {
  return catchupDueAfter(last, nowMs, dayPassReason, undefined);
}

/** Lanes released one at a time after a heal, so memory is not hit by every lane at once. */
export const HEAL_STAGGER_MS = 5 * 60_000;

/**
 * New company lanes that may start now: none while the reader route is open, one while it probes,
 * and after a heal one more every HEAL_STAGGER_MS until all lanes are back. Memory guards are applied
 * by the caller on top of this.
 */
export function laneBudget(decision: CircuitDecision, lanes: number, busy: number, healedAtMs: number | null, nowMs: number): number {
  let cap = lanesAllowed(decision, lanes);
  if (decision.state === "closed" && healedAtMs != null) cap = Math.min(cap, 1 + Math.floor(Math.max(0, nowMs - healedAtMs) / HEAL_STAGGER_MS));
  if (decision.state === "probe") return busy === 0 ? 1 : 0;
  return Math.max(0, cap - busy);
}

/** How long the loop sleeps: busy 30 s; idle 10 min, or less when a provider probe is due sooner. */
export function loopSleepMs(busy: number, retryAtS: number | undefined, nowMs: number): number {
  if (busy) return 30_000;
  const idle = 10 * 60_000;
  if (!retryAtS) return idle;
  return Math.max(30_000, Math.min(idle, retryAtS * 1000 - nowMs + 5_000));
}

/** `loop:<step>` run row for a finished child (makes side jobs auditable from the database). */
export function loopRunRow(step: string, startedMs: number, endMs: number, code: number, timedOut: boolean) {
  return {
    job: `loop:${step}`,
    started_at: new Date(startedMs).toISOString(),
    finished_at: new Date(endMs).toISOString(),
    ok: code === 0 && !timedOut,
    items: 0,
    detail: { code, ms: endMs - startedMs, ...(timedOut ? { timedOut: true, limitMs: stepLimit(step) } : {}) },
  };
}

// ---------- review fixes (W1c) ----------

const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGABRT: 6, SIGKILL: 9, SIGSEGV: 11, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15 };

/**
 * A child's exit code as the loop records it (review F1). The child runs under `sh -c "exec bun …"`,
 * so a signal kill arrives as (code null, signal) instead of sh's 128 + n: an out-of-memory SIGKILL
 * must still read 137, or it counts against the company. Deadline kills read 124.
 */
export function exitCode(code: number | null, signal: string | null, timedOut: boolean): number {
  if (timedOut) return 124;
  if (code != null) return code;
  return signal ? 128 + (SIGNALS[signal] ?? 0) : 1;
}

/**
 * Does an unfinished company run count toward setting it aside (3 strikes)? Not for an
 * out-of-memory kill (137), not when a reader could not start ("incomplete"), and not for a deadline
 * kill (124) while the company is still making progress (fewer unread files than before) (review F6).
 */
export function countsAgainstCompany(code: number, stage: string | null, unreadBefore: number | null, unreadAfter: number | null): boolean {
  if (code === 137 || stage === "incomplete") return false;
  if (code === 124) return unreadBefore == null || unreadAfter == null || unreadAfter >= unreadBefore;
  return true;
}

/**
 * After a company stopped on credits, should the loop fall back to its fixed 10-minute wait (no new
 * lanes)? Only when the circuit cannot govern the lanes: switched off, unreadable, or a closed route
 * that no heal explains (an untagged quota error that tripped nothing). A route that is open or due a
 * probe already holds the lanes, and a route a probe healed during the run must release them (review F2).
 */
export function creditStopAfter(o: { circuitOn: boolean; readable: boolean; state: "closed" | "open" | "probe"; healedDuringRun: boolean }): boolean {
  if (!o.circuitOn || !o.readable) return true;
  if (o.state !== "closed") return false;
  return !o.healedDuringRun;
}

/** Some provider row on the route was healed (closed by a write) at or after `sinceMs`. */
export function healedSince(rows: { paused_reason: string | null; updated_at: string | null }[], sinceMs: number): boolean {
  return rows.some((r) => r.paused_reason == null && !!r.updated_at && Date.parse(r.updated_at) >= sinceMs);
}

/**
 * The text-reading sweep: runs while its route is closed; while it is due a probe and no company
 * lane exists to take the probe (deep builds idle), it becomes the probe itself with one worker and
 * one item, so the 61k-document sweep cannot stall in "probe" forever (review F4).
 */
export function proseMode(proseState: "closed" | "open" | "probe", busyLanes: number, laneStarted: boolean): "run" | "probe" | null {
  if (proseState === "closed") return "run";
  if (proseState === "probe" && busyLanes === 0 && !laneStarted) return "probe";
  return null;
}

/** The SEC catch-up repeats after a give-up only when the give-up reason changed (review F18). */
export function catchupDueAfter(last: string | null | undefined, nowMs: number, reason: string | null | undefined, lastReason: string | null | undefined): boolean {
  const now = new Date(nowMs);
  const today3 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3);
  const lastMs = last ? Date.parse(last) : 0;
  if (nowMs >= today3 && lastMs < today3) return true;
  if (!reason || !/^gave up/i.test(reason) || reason === lastReason) return false;
  return nowMs - lastMs > 2 * 3600_000;
}

/** A heal re-runs the canon pass at once at most once a UTC day, so a flapping route cannot repeat it (review F14). */
export function canonResetAllowed(lastResetAt: string | null | undefined, nowMs: number): boolean {
  return !lastResetAt || new Date(lastResetAt).toISOString().slice(0, 10) !== new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The config re-queue scans `ir_documents` every 30 minutes while switched on. After a pass that
 * found nothing it goes idle, and a configuration trip seen on the reader route re-arms it (review F19).
 */
export function healConfigDue(o: { enabled: boolean; last: string | null | undefined; nowMs: number; idle: boolean; readerState: "closed" | "open" | "probe" }): boolean {
  if (!o.enabled || o.idle || o.readerState !== "closed") return false;
  return !o.last || o.nowMs - Date.parse(o.last) >= 30 * 60_000;
}

/** Loop timers a `loop-request:<step>` row may clear (written by the freshness check's remedies). */
export type LoopTimer = "lastCanon" | "lastAltSlow" | "lastDetail" | "lastMirror";
export const LOOP_REQUEST_TIMERS: Record<string, LoopTimer> = { canon: "lastCanon", "alt-slow": "lastAltSlow", detail: "lastDetail", mirror: "lastMirror" };
export const LOOP_REQUEST_PREFIX = "loop-request:";
/** Sets `scripts/analytics-publish.ts --set=` accepts. */
export const ANALYTICS_SETS: readonly string[] = ["markets", "auctions", "hedge", "hq", "context"];
/** Requests handled per pass; the freshness check writes at most a handful per 6 h. */
export const LOOP_REQUEST_MAX = 20;
export type LoopRequestAction = { job: string; step: string } & ({ kind: "timer"; key: LoopTimer } | { kind: "analytics"; set: string } | { kind: "unknown" });

/**
 * What the loop does with the request rows it read (pure, bounded, idempotent): clear the step's
 * timer (so the step is due at its next check, still under its own guards: memory, side-job slot,
 * provider route), or forget the analytics set's last publish time. Every request row is deleted
 * after it is applied; applying the same request twice only clears a timer twice.
 */
export function planLoopRequests(rows: readonly { job: string }[], max = LOOP_REQUEST_MAX): LoopRequestAction[] {
  const out: LoopRequestAction[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.job.startsWith(LOOP_REQUEST_PREFIX) || seen.has(r.job)) continue;
    seen.add(r.job);
    const step = r.job.slice(LOOP_REQUEST_PREFIX.length);
    if (step.startsWith("analytics:") && ANALYTICS_SETS.includes(step.slice("analytics:".length))) out.push({ job: r.job, step, kind: "analytics", set: step.slice("analytics:".length) });
    else if (LOOP_REQUEST_TIMERS[step]) out.push({ job: r.job, step, kind: "timer", key: LOOP_REQUEST_TIMERS[step] });
    else out.push({ job: r.job, step, kind: "unknown" });
    if (out.length >= max) break;
  }
  return out;
}

/** Clear the reader pauses left from before the circuits existed, once per start, while the route is healthy (review F12). */
export function clearStalePausesNow(o: { done: boolean; circuitOn: boolean; readable: boolean; readerState: "closed" | "open" | "probe" }): boolean {
  return !o.done && o.circuitOn && o.readable && o.readerState === "closed";
}
