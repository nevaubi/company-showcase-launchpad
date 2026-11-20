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
  prose: 2 * 3600_000,
  verify: 3600_000,
  reports: 15 * 60_000,
  "filing-steps": 3600_000,
  analytics: 30 * 60_000,
  freshness: 5 * 60_000,
  "sec-catchup": 50 * 60_000,
  company: 6 * 3600_000,
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
  const now = new Date(nowMs);
  const today3 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3);
  const lastMs = last ? Date.parse(last) : 0;
  if (nowMs >= today3 && lastMs < today3) return true;
  // "gave up on <day>: N companies unresolved": catch up once per give-up (at most every 2 hours).
  return !!dayPassReason && /^gave up/i.test(dayPassReason) && nowMs - lastMs > 2 * 3600_000;
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
