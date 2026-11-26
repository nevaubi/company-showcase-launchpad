import { describe, expect, it } from "vitest";
import { besideEnabled, emptyState, rebuildDue, runPass, staleLane, type LaneInput, type PassDeps } from "../../scripts/lib/ir-rebuild-stale";

const NOW = Date.parse("2026-11-27T10:00:00Z");
// Three lanes, all reading, stale work left (a pass ended 2 min ago with 600 left).
const base: LaneInput = {
  beside: true,
  lanes: 3,
  enabled: true,
  running: false,
  busy: 3,
  laneStarted: true,
  otherRebuilder: false,
  memUsedGB: 4,
  memLimitGB: 16,
  lastEndMs: NOW - 2 * 60_000,
  lastLeft: 600,
  lastFailed: false,
  nowMs: NOW,
};

describe("stale lane beside reading", () => {
  it("keeps one lane free while stale payloads are left and every lane reads", () => {
    expect(staleLane(base)).toEqual({ readingLanes: 2, start: false });
  });
  it("starts as soon as a lane is free, with the other lanes reading and one started this tick", () => {
    expect(staleLane({ ...base, busy: 2 })).toEqual({ readingLanes: 2, start: true });
    // Old rule: never with a lane busy.
    expect(rebuildDue({ ...base, busy: 2 })).toBe(false);
  });
  it("counts as a busy lane while it runs: reading may fill the rest", () => {
    expect(staleLane({ ...base, running: true, busy: 3 })).toEqual({ readingLanes: 3, start: false });
  });
  it("assumes work is left before any pass ran in this process", () => {
    expect(staleLane({ ...base, busy: 1, lastEndMs: null, lastLeft: null })).toEqual({ readingLanes: 2, start: true });
  });
  it("with one lane it alternates: reserve while the company reads, pass when it ends, then the next read", () => {
    const one = { ...base, lanes: 1 };
    expect(staleLane({ ...one, busy: 1 })).toEqual({ readingLanes: 0, start: false });
    expect(staleLane({ ...one, busy: 0 })).toEqual({ readingLanes: 0, start: true });
    expect(staleLane({ ...one, busy: 1, running: true })).toEqual({ readingLanes: 1, start: false });
    // Pass just ended: the gap (1 min) lets the next company start first.
    expect(staleLane({ ...one, busy: 0, lastEndMs: NOW - 10_000 })).toEqual({ readingLanes: 1, start: false });
  });
  it("nothing left: no reserve, an hourly recheck only", () => {
    expect(staleLane({ ...base, busy: 2, lastLeft: 0 })).toEqual({ readingLanes: 3, start: false });
    expect(staleLane({ ...base, busy: 2, lastLeft: 0, lastEndMs: NOW - 61 * 60_000 })).toEqual({ readingLanes: 2, start: true });
  });
  it("waits 15 min after a failed pass", () => {
    expect(staleLane({ ...base, busy: 2, lastFailed: true, lastEndMs: NOW - 5 * 60_000 })).toEqual({ readingLanes: 3, start: false });
    expect(staleLane({ ...base, busy: 2, lastFailed: true, lastEndMs: NOW - 16 * 60_000 })).toEqual({ readingLanes: 2, start: true });
  });
  it("never beside canon, never when switched off", () => {
    expect(staleLane({ ...base, busy: 2, otherRebuilder: true })).toEqual({ readingLanes: 3, start: false });
    expect(staleLane({ ...base, busy: 2, enabled: false })).toEqual({ readingLanes: 3, start: false });
  });
  it("memory: no start at half the limit; the lane stays reserved while reads hold memory, released when all idle", () => {
    expect(staleLane({ ...base, busy: 2, memUsedGB: 9 })).toEqual({ readingLanes: 2, start: false });
    expect(staleLane({ ...base, busy: 0, memUsedGB: 9 })).toEqual({ readingLanes: 3, start: false });
  });
  it("IR_REBUILD_BESIDE=0 restores the idle-only rule exactly", () => {
    expect(besideEnabled({})).toBe(true);
    expect(besideEnabled({ IR_REBUILD_BESIDE: "0" })).toBe(false);
    const off = { ...base, beside: false };
    for (const v of [off, { ...off, busy: 2 }, { ...off, busy: 0, laneStarted: false }, { ...off, busy: 0, laneStarted: false, lastLeft: 0 }])
      expect(staleLane(v)).toEqual({ readingLanes: 3, start: rebuildDue(v) });
    expect(staleLane({ ...off, busy: 0, laneStarted: false }).start).toBe(true);
  });
});

describe("stale pass skips companies being read", () => {
  it("leaves them for a later pass", async () => {
    const done: string[] = [];
    let t = NOW;
    const deps: PassDeps = { rebuild: async (x) => (done.push(x), true), gate: async () => undefined, save: async () => undefined, now: () => (t += 1000), log: () => undefined, skip: new Set(["B"]) };
    const r = await runPass(emptyState(), ["A", "B", "C"], { enabled: true, maxCompanies: 20, maxMs: 15 * 60_000 }, deps);
    expect(done).toEqual(["A", "C"]);
    expect(r.left).toBe(0);
  });
});
