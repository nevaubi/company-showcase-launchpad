/** What the batch runner does with one failed item (pure: no database, no Node APIs). */
import { classifyError, maxAttempts, retryDelayMs } from "@/lib/jobs/failure";

/**
 * What the runner does with one failed item (tested in src/test/runner-failure.test.ts): quota/config
 * stop the run and leave the item untouched; rate/transient retry up to `maxAttempts` times with
 * jittered backoff, then charge the item; permanent charges it at once.
 */
export type FailureAction =
  | { act: "stop"; cls: "quota" | "config"; stop: string }
  | { act: "retry"; cls: "rate" | "transient"; tries: number; sleepMs: number }
  | { act: "fail"; cls: string; status: string };

export function failureAction(err: unknown, triesBefore: number, rand: () => number = Math.random, maxSleepMs = 120_000): FailureAction {
  const cls = classifyError(err);
  const message = err instanceof Error ? err.message : String(err);
  if (cls === "quota" || cls === "config") return { act: "stop", cls, stop: `${cls === "config" ? "auth" : "quota"}: ${message.slice(0, 200)}` };
  if (cls === "rate" || cls === "transient") {
    const tries = triesBefore + 1;
    if (tries <= maxAttempts(cls)) {
      const ra = (err as { retryAfterMs?: number } | null)?.retryAfterMs;
      return { act: "retry", cls, tries, sleepMs: Math.min(retryDelayMs(cls, tries - 1, rand, ra) ?? 0, maxSleepMs) };
    }
    return { act: "fail", cls, status: `error: ${cls}: ${message.slice(0, 190)}` };
  }
  return { act: "fail", cls, status: `error: ${message.slice(0, 200)}` };
}


/**
 * Provider outage detector (review F3): one bad document may fail transiently on its own, but when
 * most of the last `size` attempts failed transiently across several items, the provider is down.
 * The runner then trips the provider (class `transient`, 2 min) and stops, instead of charging a
 * whole queue `error: transient: …` during a brownout.
 */
export const OUTAGE_WINDOW = 8;
export const OUTAGE_FAILS = 6;
export const OUTAGE_ITEMS = 2;
export interface Attempt {
  id: string;
  ok: boolean;
}
export function noteAttempt(window: readonly Attempt[], a: Attempt, size = OUTAGE_WINDOW): { window: Attempt[]; outage: boolean } {
  const next = [...window, a].slice(-size);
  const fails = next.filter((x) => !x.ok);
  return { window: next, outage: !a.ok && fails.length >= OUTAGE_FAILS && new Set(fails.map((x) => x.id)).size >= OUTAGE_ITEMS };
}

/**
 * Per-item configuration strike (review F5): a configuration stop leaves the item untouched, but when
 * the same item stops the run twice in a row (the probe re-reads the company's first unread item), it
 * is that item's fault, not the provider's: charge it so the circuit can heal on the next item. The
 * strike lives in job_state `config-strike:<job>` (cursor = strikes, paused_reason = `item:<id>`).
 */
export const CONFIG_STRIKE_PREFIX = "config-strike:";
export const configStrikeKey = (job: string) => `${CONFIG_STRIKE_PREFIX}${job}`;
export function configStrike(prev: { cursor: number | null; paused_reason: string | null } | null, itemId: string): { charge: boolean; row: { cursor: number; paused_reason: string } | null } {
  const same = prev?.paused_reason === `item:${itemId}`;
  if (same) return { charge: true, row: null };
  return { charge: false, row: { cursor: 1, paused_reason: `item:${itemId}` } };
}
