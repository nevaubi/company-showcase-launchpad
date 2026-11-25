// Snapshot statistics after each import pass (scripts/lib/snapshot-stats.ts), with a fake database client:
// a quiet no-op while migration 0069 is not applied, one snapshot per call, a failing snapshot skipped for a day,
// bounded in time, recorded, never the lane's failure (review int-code S1).
import { describe, expect, it } from "vitest";
import {
  STATS_FUNCTION, STATS_LIST_MS, STATS_MAX_VALUES, STATS_PASS_CALLS, STATS_RECHECK_MS, STATS_SKIP_MS,
  snapshotStatsStep, statsOnlyRow, type StatsList, type StatsRpc,
} from "../../scripts/lib/snapshot-stats";

type Answer = { data: unknown; error: { code?: string; message?: string } | null };
function fake(answer: (id: string) => Promise<Answer>, lists: Awaited<ReturnType<StatsList>>[]) {
  const calls: { fn: string; args: Record<string, unknown>; signal: AbortSignal }[] = [];
  let listed = 0;
  const rpc: StatsRpc = (fn, args, signal) => {
    calls.push({ fn, args, signal });
    return answer(String(args._snapshot_id));
  };
  const list: StatsList = () => {
    const next = lists[Math.min(listed, lists.length - 1)];
    listed++;
    return Promise.resolve(next);
  };
  return { rpc, list, calls, listed: () => listed };
}
const ok = () => Promise.resolve<Answer>({ data: { snapshot_id: "x" }, error: null });
const timeout = { code: "57014", message: "canceling statement due to statement timeout" };
const ids = (n: number, prefix = "s") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe("before migration 0069", () => {
  for (const code of ["PGRST202", "PGRST205", "42883", "42P01"]) {
    it(`is a quiet no-op on ${code}: said once, not looked for again for an hour, never a failure`, async () => {
      let clock = Date.parse("2026-11-25T21:00:00Z");
      const lines: string[] = [];
      const missing = { error: { code, message: "Could not find the table public.source_snapshot_stats" } };
      const f = fake(ok, [missing, missing, { ids: ["a", "b"] }]);
      const step = snapshotStatsStep({ rpc: f.rpc, list: f.list, log: (l) => lines.push(l), now: () => clock });
      expect(await step()).toEqual({ status: "not_installed" });
      clock += 30_000;
      expect(await step()).toEqual({ status: "not_installed" });
      expect(f.listed()).toBe(1);
      clock += STATS_RECHECK_MS;
      expect(await step()).toEqual({ status: "not_installed" });
      expect(f.listed()).toBe(2);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/not installed \(migration 0069\)/);
      // once 0069 is applied the next hourly look finds it, without a restart
      clock += STATS_RECHECK_MS;
      expect(await step()).toMatchObject({ status: "computed", snapshots: 2, left: 0 });
      expect(f.calls).toHaveLength(2);
      // a pass without an import child leaves no row for any of this
      expect(statsOnlyRow({ status: "not_installed" })).toBeNull();
    });
  }
});

describe("after migration 0069", () => {
  it("computes one snapshot per call with 20,000 values at most, newest first, up to ten a pass", async () => {
    const clock = Date.parse("2026-11-25T21:00:00Z");
    const f = fake(ok, [{ ids: ids(25) }]);
    const step = snapshotStatsStep({ rpc: f.rpc, list: f.list, log: () => undefined, now: () => clock });
    const outcome = await step();
    expect(outcome).toMatchObject({ status: "computed", snapshots: STATS_PASS_CALLS, left: 15 });
    expect(f.calls.map((c) => c.args)).toEqual(ids(10).map((id) => ({ _snapshot_id: id, _max_values: STATS_MAX_VALUES })));
    expect(f.calls.every((c) => c.fn === STATS_FUNCTION)).toBe(true);
    expect(STATS_MAX_VALUES).toBe(20_000);
    expect(statsOnlyRow(outcome)).toMatchObject({ ok: true, items: 10, detail: { step: "snapshot statistics" } });
    // the list is read once per half hour: the next pass goes on from the queue
    await step();
    await step();
    expect(f.listed()).toBe(1);
    expect(f.calls.map((c) => c.args._snapshot_id)).toEqual(ids(25));
    // nothing left to compute: no row
    expect(statsOnlyRow(await step())).toBeNull();
  });

  it("skips a snapshot whose call fails for a day, goes on with the others, and records the failure without failing the lane", async () => {
    let clock = Date.parse("2026-11-25T21:00:00Z");
    // FHFA's tract table times out; the snapshots after it still get their statistics
    const f = fake((id) => (id === "fhfa_tract" ? Promise.resolve<Answer>({ data: null, error: timeout }) : ok()), [{ ids: ["mer_1", "fhfa_tract", "mer_2", "mer_3"] }, { ids: ["fhfa_tract", "mer_4"] }]);
    const step = snapshotStatsStep({ rpc: f.rpc, list: f.list, log: () => undefined, now: () => clock });
    const first = await step();
    expect(first).toMatchObject({ status: "computed", snapshots: 1, failed: [{ snapshot: "fhfa_tract", error: "canceling statement due to statement timeout", skipped_until: "2026-11-26T21:00:00.000Z" }] });
    const row = statsOnlyRow(first);
    expect(row).toMatchObject({ ok: true, items: 1, detail: { step: "snapshot statistics", stats: { failed: [{ snapshot: "fhfa_tract" }] } } });
    expect("error" in (row?.detail ?? {})).toBe(false);
    // this step backs off from a minute, then the queue goes on past the failed snapshot
    clock += 30_000;
    expect(await step()).toMatchObject({ status: "deferred", until: "2026-11-25T21:01:00.000Z" });
    clock += 31_000;
    expect(await step()).toMatchObject({ status: "computed", snapshots: 2, left: 0 });
    // a new list still names the failed snapshot: it waits out its day
    clock += STATS_LIST_MS;
    expect(await step()).toMatchObject({ status: "computed", snapshots: 1 });
    expect(f.calls.map((c) => c.args._snapshot_id)).toEqual(["mer_1", "fhfa_tract", "mer_2", "mer_3", "mer_4"]);
    clock += STATS_SKIP_MS;
    const again = await step();
    expect(again).toMatchObject({ status: "failed", snapshots: 0, failed: [{ snapshot: "fhfa_tract" }] });
    expect(statsOnlyRow(again)).toMatchObject({ ok: true, items: 0 });
  });

  it("gives up on a call that does not answer in time, and the call is told to stop", async () => {
    let signal: AbortSignal | undefined;
    const rpc: StatsRpc = (_fn, _args, s) => {
      signal = s;
      return new Promise(() => undefined);
    };
    const started = Date.now();
    const outcome = await snapshotStatsStep({ rpc, list: () => Promise.resolve({ ids: ["a"] }), log: () => undefined, timeoutMs: 40 })();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(outcome).toMatchObject({ status: "failed", error: "no answer in 0.04 s", failed: [{ snapshot: "a" }] });
    expect(signal?.aborted).toBe(true);
  });

  it("a list or a client that fails is a failure of this step, recorded, not a failed run", async () => {
    const listFails = await snapshotStatsStep({ rpc: () => Promise.resolve({ data: null, error: null }), list: () => Promise.reject(new TypeError("fetch failed")), log: () => undefined })();
    expect(listFails).toMatchObject({ status: "failed", error: "list of snapshots without statistics: fetch failed" });
    expect(statsOnlyRow(listFails)).toMatchObject({ ok: true, items: 0 });
    const rpc: StatsRpc = () => Promise.reject(new TypeError("fetch failed: no database reply within 150s"));
    expect(await snapshotStatsStep({ rpc, list: () => Promise.resolve({ ids: ["a"] }), log: () => undefined })()).toMatchObject({ status: "failed", error: "fetch failed: no database reply within 150s" });
  });
});
