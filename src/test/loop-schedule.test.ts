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

describe("review fixes in the loop (W1c)", () => {
  it("records an out-of-memory kill under `exec` as 137 and a deadline kill as 124 (F1)", async () => {
    const { exitCode } = await import("../../scripts/lib/loop-schedule");
    expect(exitCode(null, "SIGKILL", false)).toBe(137);
    expect(exitCode(null, "SIGTERM", false)).toBe(143);
    expect(exitCode(null, "SIGKILL", true)).toBe(124);
    expect(exitCode(0, null, false)).toBe(0);
    expect(exitCode(3, null, false)).toBe(3);
    const src = readFileSync("scripts/ir-deep-loop.ts", "utf8");
    expect(src).toMatch(/p\.on\("exit", \(code, signal\) => \{[\s\S]{0,200}exitCode\(code, signal, timedOut\)/);
  });
  it("counts a deadline kill against the company only when it read nothing (F6)", async () => {
    const { countsAgainstCompany } = await import("../../scripts/lib/loop-schedule");
    expect(countsAgainstCompany(137, null, 50, 50)).toBe(false);
    expect(countsAgainstCompany(1, "incomplete", 50, 50)).toBe(false);
    expect(countsAgainstCompany(124, null, 500, 320)).toBe(false);
    expect(countsAgainstCompany(124, null, 500, 500)).toBe(true);
    expect(countsAgainstCompany(1, null, null, null)).toBe(true);
  });
  it("holds the lanes after a credit stop only when the circuit cannot (F2)", async () => {
    const { creditStopAfter, healedSince } = await import("../../scripts/lib/loop-schedule");
    const t0 = Date.parse("2026-11-20T10:00:00Z");
    const healed = healedSince([{ paused_reason: null, updated_at: "2026-11-20T10:05:00Z" }], t0);
    expect(healed).toBe(true);
    expect(healedSince([{ paused_reason: null, updated_at: "2026-11-20T09:00:00Z" }], t0)).toBe(false);
    // the probe healed the route during the run: lanes return, no 10-minute wait
    expect(creditStopAfter({ circuitOn: true, readable: true, state: "closed", healedDuringRun: true })).toBe(false);
    // tripped: the circuit holds the lanes until its probe
    expect(creditStopAfter({ circuitOn: true, readable: true, state: "open", healedDuringRun: false })).toBe(false);
    // closed with no heal = an untagged stop that tripped nothing; switched off or unreadable: old wait
    expect(creditStopAfter({ circuitOn: true, readable: true, state: "closed", healedDuringRun: false })).toBe(true);
    expect(creditStopAfter({ circuitOn: false, readable: true, state: "closed", healedDuringRun: true })).toBe(true);
    expect(creditStopAfter({ circuitOn: true, readable: false, state: "closed", healedDuringRun: true })).toBe(true);
  });
  it("lets the text sweep take a due probe when no company lane can (F4)", async () => {
    const { proseMode } = await import("../../scripts/lib/loop-schedule");
    expect(proseMode("closed", 2, true)).toBe("run");
    expect(proseMode("probe", 0, false)).toBe("probe");
    expect(proseMode("probe", 0, true)).toBeNull();
    expect(proseMode("probe", 1, false)).toBeNull();
    expect(proseMode("open", 0, false)).toBeNull();
  });
  it("repeats the SEC catch-up after a give-up only when the reason changes (F18)", async () => {
    const { catchupDueAfter } = await import("../../scripts/lib/loop-schedule");
    const r = "gave up on 2026-11-19: 108 companies unresolved";
    expect(catchupDueAfter("2026-11-20T03:30:00Z", Date.parse("2026-11-20T08:00:00Z"), r, null)).toBe(true);
    expect(catchupDueAfter("2026-11-20T08:00:00Z", Date.parse("2026-11-20T12:00:00Z"), r, r)).toBe(false);
    expect(catchupDueAfter("2026-11-20T08:00:00Z", Date.parse("2026-11-20T12:00:00Z"), "gave up on 2026-11-20: 3 companies unresolved", r)).toBe(true);
  });
  it("resets the canon timer on a heal at most once a UTC day (F14)", async () => {
    const { canonResetAllowed } = await import("../../scripts/lib/loop-schedule");
    expect(canonResetAllowed(null, now)).toBe(true);
    expect(canonResetAllowed("2026-11-20T01:00:00Z", now)).toBe(false);
    expect(canonResetAllowed("2026-11-19T23:00:00Z", now)).toBe(true);
  });
  it("stops the config re-queue scan after an empty pass until a configuration trip (F19)", async () => {
    const { healConfigDue } = await import("../../scripts/lib/loop-schedule");
    const base = { enabled: true, last: null, nowMs: now, idle: false, readerState: "closed" as const };
    expect(healConfigDue(base)).toBe(true);
    expect(healConfigDue({ ...base, idle: true })).toBe(false);
    expect(healConfigDue({ ...base, enabled: false })).toBe(false);
    expect(healConfigDue({ ...base, readerState: "probe" })).toBe(false);
    expect(healConfigDue({ ...base, last: new Date(now - 10 * 60_000).toISOString() })).toBe(false);
    const src = readFileSync("scripts/ir-deep-loop.ts", "utf8");
    expect(src).toMatch(/reader\.cls === "config"\) healConfigIdle = false/);
  });
  it("keeps re-reads of finished companies across restarts (F8)", () => {
    const src = readFileSync("scripts/ir-deep-loop.ts", "utf8");
    expect(src).toMatch(/const pendingReread: string\[\] = \(state\.pendingReread \?\?= \[\]\)/);
    expect(src).not.toMatch(/const pendingReread: string\[\] = \[\];/);
  });
  it("clears pre-circuit reader pauses once per start while the route is healthy (F12)", async () => {
    const { clearStalePausesNow } = await import("../../scripts/lib/loop-schedule");
    expect(clearStalePausesNow({ done: false, circuitOn: true, readable: true, readerState: "closed" })).toBe(true);
    expect(clearStalePausesNow({ done: true, circuitOn: true, readable: true, readerState: "closed" })).toBe(false);
    expect(clearStalePausesNow({ done: false, circuitOn: true, readable: true, readerState: "open" })).toBe(false);
    expect(clearStalePausesNow({ done: false, circuitOn: true, readable: false, readerState: "closed" })).toBe(false);
  });
});

describe("freshness remedies reach the loop (W1b request)", () => {
  it("turns loop-request rows into timer clears and forced analytics sets, bounded", async () => {
    const { planLoopRequests } = await import("../../scripts/lib/loop-schedule");
    const plan = planLoopRequests([{ job: "loop-request:canon" }, { job: "loop-request:analytics:hq" }, { job: "loop-request:alt-slow" }, { job: "loop-request:analytics:bogus" }, { job: "loop-request:canon" }, { job: "other" }]);
    expect(plan).toEqual([
      { job: "loop-request:canon", step: "canon", kind: "timer", key: "lastCanon" },
      { job: "loop-request:analytics:hq", step: "analytics:hq", kind: "analytics", set: "hq" },
      { job: "loop-request:alt-slow", step: "alt-slow", kind: "timer", key: "lastAltSlow" },
      { job: "loop-request:analytics:bogus", step: "analytics:bogus", kind: "unknown" },
    ]);
    expect(planLoopRequests(Array.from({ length: 50 }, (_, i) => ({ job: `loop-request:x${i}` })), 20)).toHaveLength(20);
  });
  it("every step the freshness check can request is one the loop knows", async () => {
    const { planLoopRequests } = await import("../../scripts/lib/loop-schedule");
    const { REMEDY, loopRequestKey } = await import("@/lib/jobs/remediation");
    for (const r of Object.values(REMEDY)) if (r.kind === "loop") expect(planLoopRequests([{ job: loopRequestKey(r.step) }])[0].kind, r.step).not.toBe("unknown");
  });
  it("the loop reads, applies and deletes the request rows each pass", () => {
    const src = readFileSync("scripts/ir-deep-loop.ts", "utf8");
    expect(src).toMatch(/await takeLoopRequests\(\)/);
    expect(src).toMatch(/like\("job", `\$\{LOOP_REQUEST_PREFIX\}%`\)[\s\S]{0,80}limit\(LOOP_REQUEST_MAX\)/);
    expect(src).toMatch(/delete\(\)\.eq\("job", a\.job\)/);
  });
});
