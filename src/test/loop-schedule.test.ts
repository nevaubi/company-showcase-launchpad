import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catchupDue, HEAL_STAGGER_MS, laneBudget, loopRunRow, loopSleepMs, nextDue, STEP_LIMITS_MS, stepLimit } from "../../scripts/lib/loop-schedule";

const now = Date.parse("2026-11-20T12:00:00Z");
describe("loop step timers", () => {
  it("move a full interval after success", () => {
    expect(nextDue(now, true, 24 * 3600_000, 3)).toEqual({ last: new Date(now).toISOString(), attempts: 0 });
  });
  it("retry a failed step after 1 h, doubling, never later than its interval", () => {
    const day = 24 * 3600_000;
    const due = (r: { last: string }) => Date.parse(r.last) + day - now;
    let r = nextDue(now, false, day, 0);
    expect([due(r), r.attempts]).toEqual([3600_000, 1]);
    r = nextDue(now, false, day, r.attempts);
    expect(due(r)).toBe(7200_000);
    expect(due(nextDue(now, false, day, 10))).toBe(day);
    expect(Date.parse(nextDue(now, false, 10 * 60_000, 0).last) + 10 * 60_000 - now).toBe(10 * 60_000);
  });
});

describe("child deadlines", () => {
  it("exist for every step name the loop runs", () => {
    const src = readFileSync("scripts/ir-deep-loop.ts", "utf8");
    const steps = [...src.matchAll(/\brun\("([a-z-]+)"/g)].map((m) => m[1]);
    expect(steps.length).toBeGreaterThan(10);
    for (const s of steps) expect(STEP_LIMITS_MS[s], s).toBeGreaterThan(0);
    expect(stepLimit("company")).toBe(6 * 3600_000);
  });
  it("record a loop run row", () => {
    expect(loopRunRow("canon", now - 5000, now, 0, false)).toMatchObject({ job: "loop:canon", ok: true, detail: { code: 0, ms: 5000 } });
    expect(loopRunRow("mirror", now - 5000, now, 124, true)).toMatchObject({ ok: false, detail: { timedOut: true } });
  });
});

describe("SEC catch-up schedule", () => {
  it("runs once a day after 03:00 UTC and again when the day pass gave up", () => {
    expect(catchupDue(null, Date.parse("2026-11-20T03:01:00Z"), null)).toBe(true);
    expect(catchupDue("2026-11-20T03:01:00Z", Date.parse("2026-11-20T12:00:00Z"), null)).toBe(false);
    expect(catchupDue("2026-11-19T03:01:00Z", Date.parse("2026-11-20T02:00:00Z"), null)).toBe(false);
    expect(catchupDue("2026-11-20T03:01:00Z", Date.parse("2026-11-20T06:00:00Z"), "gave up on 2026-11-19: 108 companies unresolved")).toBe(true);
    expect(catchupDue("2026-11-20T05:30:00Z", Date.parse("2026-11-20T06:00:00Z"), "gave up on 2026-11-19: 108 companies unresolved")).toBe(false);
    expect(catchupDue("2026-11-20T03:01:00Z", Date.parse("2026-11-20T06:00:00Z"), "tries 4 on 2026-11-19")).toBe(false);
  });
});

describe("lane budget", () => {
  it("starts no lane while open, one probe lane, and staggers lanes after a heal", () => {
    expect(laneBudget({ state: "open", retryAt: 1 }, 3, 0, null, now)).toBe(0);
    expect(laneBudget({ state: "probe" }, 3, 0, null, now)).toBe(1);
    expect(laneBudget({ state: "probe" }, 3, 1, null, now)).toBe(0);
    expect(laneBudget({ state: "closed" }, 3, 0, now, now)).toBe(1);
    expect(laneBudget({ state: "closed" }, 3, 1, now - HEAL_STAGGER_MS, now)).toBe(1);
    expect(laneBudget({ state: "closed" }, 3, 0, now - 3 * HEAL_STAGGER_MS, now)).toBe(3);
    expect(laneBudget({ state: "closed" }, 3, 1, null, now)).toBe(2);
  });
  it("sleeps until the probe when idle and open", () => {
    expect(loopSleepMs(1, undefined, now)).toBe(30_000);
    expect(loopSleepMs(0, undefined, now)).toBe(600_000);
    expect(loopSleepMs(0, now / 1000 + 120, now)).toBe(125_000);
  });
});
