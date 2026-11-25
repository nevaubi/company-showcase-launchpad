// Snapshot statistics after each import pass (scripts/lib/snapshot-stats.ts), with a fake database client:
// a quiet no-op while migration 0069 is not applied, bounded in time, recorded, never the lane's failure.
import { describe, expect, it } from "vitest";
import { STATS_ARGS, STATS_FUNCTION, STATS_RECHECK_MS, snapshotStatsStep, statsOnlyRow, type StatsRpc } from "../../scripts/lib/snapshot-stats";

function fake(answers: (() => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)[]) {
  const calls: { fn: string; args: Record<string, unknown>; signal: AbortSignal }[] = [];
  const rpc: StatsRpc = (fn, args, signal) => {
    calls.push({ fn, args, signal });
    const next = answers.shift();
    if (!next) throw new Error("no more fake answers");
    return next();
  };
  return { rpc, calls };
}
const answer = (data: unknown, error: { code?: string; message?: string } | null = null) => () => Promise.resolve({ data, error });

describe("before migration 0069", () => {
  for (const code of ["PGRST202", "42883"]) {
    it(`is a quiet no-op on ${code}: said once, not called again for an hour, never a failure`, async () => {
      let clock = Date.parse("2026-11-25T21:00:00Z");
      const lines: string[] = [];
      const f = fake([answer(null, { code, message: "Could not find the function public.source_compute_missing_stats" }),
        answer(null, { code, message: "still missing" }), answer(4)]);
      const step = snapshotStatsStep({ rpc: f.rpc, log: (l) => lines.push(l), now: () => clock });
      expect(await step()).toEqual({ status: "not_installed" });
      clock += 30_000;
      expect(await step()).toEqual({ status: "not_installed" });
      expect(f.calls).toHaveLength(1);
      clock += STATS_RECHECK_MS;
      expect(await step()).toEqual({ status: "not_installed" });
      expect(f.calls).toHaveLength(2);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/not installed \(migration 0069\)/);
      // once 0069 is applied the next hourly look finds it, without a restart
      clock += STATS_RECHECK_MS;
      expect(await step()).toMatchObject({ status: "computed", snapshots: 4 });
      // a pass without an import child leaves no row for any of this
      expect(statsOnlyRow({ status: "not_installed" })).toBeNull();
    });
  }
});

describe("after migration 0069", () => {
  it("asks for ten snapshots and 100,000 values and records what was computed", async () => {
    const f = fake([answer(7), answer(0)]);
    const step = snapshotStatsStep({ rpc: f.rpc, log: () => undefined });
    const outcome = await step();
    expect(outcome).toMatchObject({ status: "computed", snapshots: 7 });
    expect(f.calls[0]).toMatchObject({ fn: STATS_FUNCTION, args: { _max_snapshots: 10, _max_values: 100_000 } });
    expect(STATS_ARGS).toEqual({ _max_snapshots: 10, _max_values: 100_000 });
    expect(statsOnlyRow(outcome)).toMatchObject({ ok: true, items: 7, detail: { step: "snapshot statistics" } });
    // nothing left to compute: no row
    expect(statsOnlyRow(await step())).toBeNull();
  });

  it("gives up on a call that does not answer in time, and the call is told to stop", async () => {
    let signal: AbortSignal | undefined;
    const rpc: StatsRpc = (_fn, _args, s) => {
      signal = s;
      return new Promise(() => undefined);
    };
    const started = Date.now();
    const outcome = await snapshotStatsStep({ rpc, log: () => undefined, timeoutMs: 40 })();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(outcome).toMatchObject({ status: "failed", error: "no answer in 0.04 s" });
    expect(signal?.aborted).toBe(true);
  });

  it("an error backs off this step only, from a minute, and carries the error to the row", async () => {
    let clock = Date.parse("2026-11-25T21:00:00Z");
    const f = fake([answer(null, { code: "57014", message: "canceling statement due to statement timeout" }), answer(2)]);
    const step = snapshotStatsStep({ rpc: f.rpc, log: () => undefined, now: () => clock });
    const failed = await step();
    expect(failed).toMatchObject({ status: "failed", error: "canceling statement due to statement timeout" });
    expect(statsOnlyRow(failed)).toMatchObject({ ok: false, items: 0, detail: { error: "snapshot statistics: canceling statement due to statement timeout" } });
    clock += 30_000;
    expect(await step()).toMatchObject({ status: "deferred", until: "2026-11-25T21:01:00.000Z" });
    expect(f.calls).toHaveLength(1);
    clock += 31_000;
    expect(await step()).toMatchObject({ status: "computed", snapshots: 2 });
  });

  it("a client that throws is a failure of this step, not of the run", async () => {
    const rpc: StatsRpc = () => Promise.reject(new TypeError("fetch failed: no database reply within 150s"));
    expect(await snapshotStatsStep({ rpc, log: () => undefined })()).toMatchObject({ status: "failed", error: "fetch failed: no database reply within 150s" });
  });
});
