import { describe, expect, it } from "vitest";
import { inWorkerWindow, nightStartMs, parseWorker, toFetch, workerBlocked, workerPlan, workerProgress, WORKER_KEY } from "./options-worker";

// Monday 23 Nov 2026 evening: night 20261123 starts 22:00 UTC.
const T = (iso: string) => Date.parse(iso);
const NIGHT = 20261123;
// Production 24 Nov: every app run since 19 Nov answered this (options-backoff row).
const blocked = (at: string, retry: string) => ({ job: "options-backoff", cursor: Math.ceil(T(retry) / 1000), paused_reason: "blocked: Cboe refused option chains (403 x4, 429 x0) [n=13]", updated_at: at });

describe("options through the worker", () => {
  it("knows the night window (weekday evenings, until the night number turns)", () => {
    expect(nightStartMs(NIGHT)).toBe(T("2026-11-23T22:00:00Z"));
    expect(inWorkerWindow(T("2026-11-23T21:59:00Z"))).toBe(false);
    expect(inWorkerWindow(T("2026-11-23T22:00:00Z"))).toBe(true);
    expect(inWorkerWindow(T("2026-11-24T07:59:00Z"))).toBe(true);
    expect(inWorkerWindow(T("2026-11-24T08:00:00Z"))).toBe(false);
    // Saturday evening is no session night
    expect(inWorkerWindow(T("2026-11-28T23:00:00Z"))).toBe(false);
  });
  it("takes the night when the app job is blocked, from the top", () => {
    const now = T("2026-11-23T22:20:00Z");
    const p = workerPlan({ nowMs: now, backoff: blocked("2026-11-23T22:15:00Z", "2026-11-23T23:15:00Z"), worker: null, storedTonight: 0, total: 1844 });
    expect(p).toMatchObject({ run: true, night: NIGHT, start: 0 });
  });
  it("leaves the night to the app job while it collects", () => {
    const now = T("2026-11-24T00:30:00Z");
    expect(workerPlan({ nowMs: now, backoff: null, worker: null, storedTonight: 400, total: 1844 })).toMatchObject({ run: false, why: "the app job is collecting" });
    // an old block from an earlier night with its retry time passed is not tonight's
    expect(workerPlan({ nowMs: now, backoff: blocked("2026-11-20T03:00:00Z", "2026-11-20T04:00:00Z"), worker: null, storedTonight: 400, total: 1844 }).run).toBe(false);
  });
  it("takes over when the app job stored nothing 90 minutes into the night", () => {
    expect(workerPlan({ nowMs: T("2026-11-23T23:00:00Z"), backoff: null, worker: null, storedTonight: 0, total: 1844 }).run).toBe(false);
    expect(workerPlan({ nowMs: T("2026-11-23T23:31:00Z"), backoff: null, worker: null, storedTonight: 3, total: 1844 })).toMatchObject({ run: true, start: 0 });
  });
  it("resumes where tonight's pass stopped, starts a new night at 0, and stops when the list is through", () => {
    const now = T("2026-11-24T01:00:00Z");
    const back = blocked("2026-11-24T00:55:00Z", "2026-11-24T01:55:00Z");
    const mid = workerProgress(NIGHT, 640, 1844, now);
    expect(mid).toEqual({ job: WORKER_KEY, cursor: 640, paused_reason: `night:${NIGHT}`, updated_at: new Date(now).toISOString() });
    expect(workerPlan({ nowMs: now, backoff: back, worker: mid, storedTonight: 640, total: 1844 })).toMatchObject({ run: true, start: 640 });
    // a pass under way keeps going even if the app job's block lifted
    expect(workerPlan({ nowMs: now, backoff: null, worker: mid, storedTonight: 640, total: 1844 })).toMatchObject({ run: true, start: 640 });
    // last night's row: tonight starts at the top
    const lastNight = workerProgress(20261120, 900, 1844, now);
    expect(workerPlan({ nowMs: now, backoff: back, worker: lastNight, storedTonight: 0, total: 1844 })).toMatchObject({ run: true, start: 0 });
    const done = workerProgress(NIGHT, 1844, 1844, now);
    expect(done.paused_reason).toBe(`night:${NIGHT} done`);
    expect(workerPlan({ nowMs: now, backoff: back, worker: done, storedTonight: 1800, total: 1844 })).toMatchObject({ run: false, why: "tonight's list is through" });
  });
  it("records its own pause when Cboe refuses the worker too, doubling, and waits it out", () => {
    const now = T("2026-11-24T01:00:00Z");
    const back = blocked("2026-11-24T00:55:00Z", "2026-11-24T01:55:00Z");
    const first = workerBlocked(NIGHT, 120, null, now, [403, 403, 403]);
    expect(first.cursor).toBe(120);
    expect(first.paused_reason).toBe(`night:${NIGHT} blocked until 2026-11-24T01:02:00.000Z Cboe refused the worker (403 x3, 429 x0) [n=1]`);
    expect(workerPlan({ nowMs: now + 60_000, backoff: back, worker: first, storedTonight: 120, total: 1844 }).run).toBe(false);
    expect(workerPlan({ nowMs: now + 3 * 60_000, backoff: back, worker: first, storedTonight: 120, total: 1844 })).toMatchObject({ run: true, start: 120 });
    const second = workerBlocked(NIGHT, 120, parseWorker(first), now, [429]);
    expect(second.paused_reason).toMatch(/blocked until 2026-11-24T01:04:00.000Z .*\[n=2\]$/);
    // never touches the app job's own backoff row
    expect(second.job).toBe(WORKER_KEY);
  });
  it("never fetches a name stored tonight by either side", () => {
    expect(toFetch(["AAPL", "MSFT", "NVDA"], new Set(["MSFT"]))).toEqual(["AAPL", "NVDA"]);
  });
});
