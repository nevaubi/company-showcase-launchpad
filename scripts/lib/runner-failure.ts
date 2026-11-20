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

