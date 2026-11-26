import { describe, expect, it } from "vitest";
import { BUILD_FORMAT, buildPayload } from "@/lib/ir/payload";
import {
  eligible,
  emptyState,
  FAIL_WAIT_MS,
  IDLE_RECHECK_MS,
  passRunRow,
  rebuildDue,
  rebuildOrder,
  rebuildSettings,
  recordFailure,
  reviewList,
  runPass,
  skipReason,
  staleTickers,
  type DueInput,
  type PassDeps,
  type RebuildState,
} from "../../scripts/lib/ir-rebuild-stale";
import { STEP_LIMITS_MS } from "../../scripts/lib/loop-schedule";

const coverage = [
  { ticker: "AAPL", industry: "Consumer Electronics" },
  { ticker: "JPM", industry: "Banks" },
  { ticker: "USB", industry: "Regional Banks" },
  { ticker: "MSFT", industry: "Software" },
  { ticker: "XYZB", group: "Banks" },
  { ticker: "ZZZ", industry: "Retail" },
];
const rank = new Map([
  ["AAPL", 1],
  ["MSFT", 2],
  ["JPM", 3],
  ["USB", 40],
]);

describe("selection", () => {
  it("takes payloads whose stats lack the current build format", () => {
    const rows = [
      { ticker: "A", build: null },
      { ticker: "B", build: BUILD_FORMAT },
      { ticker: "C", build: BUILD_FORMAT - 1 },
      { ticker: "D", build: String(BUILD_FORMAT) },
      { ticker: "E", build: "x" },
      { ticker: "F", build: BUILD_FORMAT + 1 },
      { ticker: "G", build: undefined },
    ];
    expect(staleTickers(rows, BUILD_FORMAT)).toEqual(["A", "C", "E", "G"]);
  });

  it("the builder writes the build format into stats", () => {
    const p = buildPayload("T", []);
    expect(p.build).toBe(BUILD_FORMAT);
    expect(p.stats.build).toBe(BUILD_FORMAT);
    expect(staleTickers([{ ticker: "T", build: p.stats.build }], BUILD_FORMAT)).toEqual([]);
  });
});

describe("order", () => {
  it("puts banks first, largest first, then the rest by rank, unranked last by ticker", () => {
    const stale = ["ZZZ", "AAPL", "USB", "MSFT", "XYZB", "JPM", "NEW"];
    expect(rebuildOrder(stale, coverage, rank)).toEqual(["JPM", "USB", "XYZB", "AAPL", "MSFT", "NEW", "ZZZ"]);
  });

  it("only orders stale companies", () => {
    expect(rebuildOrder(["MSFT"], coverage, rank)).toEqual(["MSFT"]);
  });

  it("without a rank keeps banks first in coverage order", () => {
    expect(rebuildOrder(["AAPL", "XYZB", "JPM"], coverage, new Map())).toEqual(["JPM", "XYZB", "AAPL"]);
  });
});

describe("settings", () => {
  it("is on by default and bounded", () => {
    expect(rebuildSettings({})).toEqual({ enabled: true, maxCompanies: 20, maxMs: 15 * 60_000 });
    expect(rebuildSettings({ IR_REBUILD_STALE: "0" }).enabled).toBe(false);
    expect(rebuildSettings({ IR_REBUILD_MAX: "5000", IR_REBUILD_MINUTES: "500" })).toMatchObject({ maxCompanies: 200, maxMs: 30 * 60_000 });
    expect(rebuildSettings({ IR_REBUILD_MAX: "0", IR_REBUILD_MINUTES: "abc" })).toMatchObject({ maxCompanies: 20, maxMs: 15 * 60_000 });
  });

  it("the loop's deadline for a pass is above its longest budget", () => {
    expect(STEP_LIMITS_MS["ir-rebuild"]).toBeGreaterThan(30 * 60_000);
  });
});

/** A fake world: a clock, a rebuild that takes `costMs` per company and can fail, and saved states. */
function world(opts: { costMs?: number; fail?: Set<string>; empty?: Set<string>; stopAfter?: number } = {}) {
  let now = Date.parse("2026-11-26T00:00:00Z");
  const built: string[] = [];
  const saves: string[] = [];
  const lines: string[] = [];
  let gates = 0;
  const deps: PassDeps = {
    rebuild: async (t) => {
      now += opts.costMs ?? 1000;
      if (opts.fail?.has(t)) throw new Error(`boom ${t}`);
      if (opts.empty?.has(t)) return false;
      built.push(t);
      return true;
    },
    gate: async () => {
      gates++;
    },
    save: async (s) => {
      saves.push(JSON.stringify(s));
    },
    now: () => now,
    log: (l) => lines.push(l),
    stopped: () => opts.stopAfter !== undefined && built.length >= opts.stopAfter,
  };
  return { deps, built, saves, lines, gates: () => gates, advance: (ms: number) => (now += ms), now: () => now };
}

const settings = (maxCompanies = 20, maxMs = 15 * 60_000) => ({ enabled: true, maxCompanies, maxMs });

describe("bounds", () => {
  it("stops at the company limit, one at a time, gating each", async () => {
    const w = world();
    const s = emptyState();
    const r = await runPass(s, ["A", "B", "C", "D"], settings(2), w.deps);
    expect(w.built).toEqual(["A", "B"]);
    expect(r).toMatchObject({ stoppedBy: "companies", left: 2, stale: 4 });
    expect(w.gates()).toBe(2);
    expect(s.left).toBe(2);
  });

  it("starts no company once the time budget is spent", async () => {
    const w = world({ costMs: 6 * 60_000 });
    const r = await runPass(emptyState(), ["A", "B", "C", "D"], settings(20, 15 * 60_000), w.deps);
    expect(w.built).toEqual(["A", "B", "C"]);
    expect(r).toMatchObject({ stoppedBy: "time", left: 1 });
  });

  it("stops on a signal", async () => {
    const w = world({ stopAfter: 1 });
    const r = await runPass(emptyState(), ["A", "B"], settings(), w.deps);
    expect(w.built).toEqual(["A"]);
    expect(r.stoppedBy).toBe("signal");
  });

  it("an empty order is a pass with nothing left", async () => {
    const w = world();
    const s = emptyState();
    const r = await runPass(s, [], settings(), w.deps);
    expect(r).toMatchObject({ stoppedBy: "done", left: 0, rebuilt: [] });
    expect(s.left).toBe(0);
  });
});

describe("resume and idempotence", () => {
  it("saves after every company, so a killed pass loses nothing", async () => {
    const w = world();
    await runPass(emptyState(), ["A", "B", "C"], settings(), w.deps);
    // one save per company plus the closing save
    expect(w.saves.length).toBe(4);
  });

  it("the next pass reselects from the table: rebuilt companies are not taken again", async () => {
    // Pass 1 rebuilds A and B; the table then shows them current, so the stale list is C, D.
    const w = world();
    const s = emptyState();
    await runPass(s, ["A", "B", "C", "D"], settings(2), w.deps);
    await runPass(s, ["C", "D"], settings(2), w.deps);
    expect(w.built).toEqual(["A", "B", "C", "D"]);
    const r = await runPass(s, [], settings(2), w.deps);
    expect(r.left).toBe(0);
  });
});

describe("failure handling", () => {
  it("skips a failed company for a day and goes on with the next", async () => {
    const w = world({ fail: new Set(["B"]) });
    const s = emptyState();
    const r = await runPass(s, ["A", "B", "C"], settings(), w.deps);
    expect(w.built).toEqual(["A", "C"]);
    expect(r.failed).toEqual({ B: "boom B" });
    expect(s.failures["B"]).toMatchObject({ count: 1, error: "boom B" });
    expect(w.lines.some((l) => l.includes("B: rebuild failed") && l.includes("skipped for a day"))).toBe(true);
    expect(skipReason(s, "B", w.now())).toBe("waiting");
    expect(eligible(s, ["B", "D"], w.now())).toEqual(["D"]);
    expect(eligible(s, ["B", "D"], w.now() + FAIL_WAIT_MS)).toEqual(["B", "D"]);
  });

  it("a company with no stored facts counts as a failure", async () => {
    const w = world({ empty: new Set(["A"]) });
    const s = emptyState();
    const r = await runPass(s, ["A"], settings(), w.deps);
    expect(r.failed).toEqual({ A: "no stored facts" });
    expect(s.failures["A"]!.count).toBe(1);
  });

  it("three failures leave a company for review; it is listed and no longer taken", async () => {
    const w = world({ fail: new Set(["B"]) });
    const s = emptyState();
    for (let i = 0; i < 3; i++) {
      await runPass(s, ["B"], settings(), w.deps);
      w.advance(FAIL_WAIT_MS);
    }
    expect(s.failures["B"]!.count).toBe(3);
    expect(reviewList(s)).toEqual(["B"]);
    expect(skipReason(s, "B", w.now() + 30 * FAIL_WAIT_MS)).toBe("review");
    const r = await runPass(s, ["B", "C"], settings(), w.deps);
    expect(r.review).toEqual(["B"]);
    expect(w.built).toEqual(["C"]);
    expect(w.lines.some((l) => l.includes("left for review"))).toBe(true);
    expect(passRunRow(0, 1000, r).detail.review).toEqual(["B"]);
  });

  it("a success after a failure clears it; a company no longer stale leaves the list", async () => {
    const s: RebuildState = emptyState();
    recordFailure(s, "A", "x", Date.parse("2026-11-20T00:00:00Z"));
    recordFailure(s, "Z", "x", Date.parse("2026-11-20T00:00:00Z"));
    const w = world();
    await runPass(s, ["A"], settings(), w.deps);
    expect(s.failures).toEqual({});
  });

  it("the job_runs row records rebuilt, failed and what is left", async () => {
    const w = world({ fail: new Set(["B"]) });
    const r = await runPass(emptyState(), ["A", "B"], settings(), w.deps);
    const row = passRunRow(0, 5000, r);
    expect(row).toMatchObject({ job: "ir-rebuild-stale", ok: false, items: 1, detail: { rebuilt: ["A"], failed: { B: "boom B" }, left: 0, stale: 2, ms: 5000 } });
  });
});

describe("when the loop starts a pass", () => {
  const base: DueInput = {
    enabled: true,
    running: false,
    busy: 0,
    laneStarted: false,
    otherRebuilder: false,
    memUsedGB: 2,
    memLimitGB: 16,
    lastEndMs: null,
    lastLeft: null,
    lastFailed: false,
    nowMs: 10_000_000,
  };
  it("idle with memory to spare: yes", () => expect(rebuildDue(base)).toBe(true));
  it("never beside a reading run, a new lane, another pass or another rebuilder", () => {
    expect(rebuildDue({ ...base, busy: 1 })).toBe(false);
    expect(rebuildDue({ ...base, laneStarted: true })).toBe(false);
    expect(rebuildDue({ ...base, running: true })).toBe(false);
    expect(rebuildDue({ ...base, otherRebuilder: true })).toBe(false);
  });
  it("not when switched off or memory is at half the limit", () => {
    expect(rebuildDue({ ...base, enabled: false })).toBe(false);
    expect(rebuildDue({ ...base, memUsedGB: 8 })).toBe(false);
  });
  it("back to back while work is left, hourly when none, 15 min after a failed pass", () => {
    const at = base.nowMs;
    expect(rebuildDue({ ...base, lastEndMs: at - 30_000, lastLeft: 5 })).toBe(false);
    expect(rebuildDue({ ...base, lastEndMs: at - 60_000, lastLeft: 5 })).toBe(true);
    expect(rebuildDue({ ...base, lastEndMs: at - 60_000, lastLeft: 0 })).toBe(false);
    expect(rebuildDue({ ...base, lastEndMs: at - IDLE_RECHECK_MS, lastLeft: 0 })).toBe(true);
    expect(rebuildDue({ ...base, lastEndMs: at - 10 * 60_000, lastFailed: true })).toBe(false);
    expect(rebuildDue({ ...base, lastEndMs: at - 15 * 60_000, lastFailed: true })).toBe(true);
  });
});
