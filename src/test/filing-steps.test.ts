import { describe, expect, it } from "vitest";
import { fromCursor, oldestSignals, retryable, supplyTickers, toCursor, wantsSupply } from "../../scripts/lib/filing-steps";

describe("filing steps", () => {
  it("round-trips the discovered_at cursor", () => { expect(fromCursor(toCursor("2026-11-19T08:57:06Z"))).toBe("2026-11-19T08:57:06.000Z"); });
  it("retries a failing filing at most five times", () => { expect(retryable(4)).toBe(true); expect(retryable(5)).toBe(false); });
  it("refreshes supply only for recent filings, once per company", () => {
    const f = (ticker: string, filed: string) => ({ accn: ticker + filed, ticker, form: "10-Q", filed, doc: "x", discovered_at: "" });
    expect(wantsSupply({ filed: "2026-09-01" }, "2026-11-19")).toBe(false);
    expect(supplyTickers([f("A", "2026-11-10"), f("A", "2026-11-12"), f("B", "2026-08-01")], "2026-11-19")).toEqual(["A"]);
  });
  it("picks never-signalled companies first, then the oldest", () => {
    expect(oldestSignals(["A", "B", "C"], new Map([["A", "2026-11-01"], ["B", "2026-10-01"]]), 2)).toEqual(["C", "B"]);
  });
});

import { contextSlice } from "../../scripts/lib/analytics-publish";
describe("company context rolling refresh", () => {
  it("takes 20 a run and wraps around after the whole list", () => {
    const all = Array.from({ length: 45 }, (_, i) => `T${i}`);
    expect(contextSlice(all, 0)).toEqual({ tickers: all.slice(0, 20), next: 20 });
    const last = contextSlice(all, 40);
    expect(last.tickers).toEqual([...all.slice(40), ...all.slice(0, 15)]);
    expect(last.next).toBe(15);
  });
});

import { missingFromRegistry, weekSlice } from "../../scripts/lib/alt-slow";
describe("slow alt-data rotation", () => {
  it("covers every company exactly once across seven days", () => {
    const all = Array.from({ length: 50 }, (_, i) => `T${String(i).padStart(2, "0")}`);
    const seen = Array.from({ length: 7 }, (_, d) => weekSlice(all, new Date(d * 86_400_000))).flat();
    expect(seen.sort()).toEqual([...all].sort());
  });
  it("finds newly covered companies missing from the registry", () => {
    expect(missingFromRegistry(["A", "B", "NEW"], { A: {}, B: {} })).toEqual(["NEW"]);
  });
});

import { accnOf, afterCursor, completeSeconds, INTEL_EVERY_MS, intelMarker, nextCursor, oldestSignals as oldest } from "../../scripts/lib/filing-steps";
describe("filing-steps cursor precision", () => {
  const at = "2026-11-19T08:57:06.123Z";
  const rows = Array.from({ length: 40 }, (_, i) => ({ accn: `0001-26-${String(i).padStart(6, "0")}`, discovered_at: at }));
  it("40 filings sharing one second make progress in batches of 30", () => {
    let c = { sec: toCursor("2026-11-19T08:00:00Z"), accn: "" };
    const first = afterCursor(rows, c).slice(0, 30);
    for (const f of first) c = nextCursor(c, f);
    const second = afterCursor(rows, c).slice(0, 30);
    expect(second).toHaveLength(10);
    expect(new Set([...first, ...second].map((r) => r.accn)).size).toBe(40);
    for (const f of second) c = nextCursor(c, f);
    expect(afterCursor(rows, c)).toEqual([]);
  });
  it("never moves backwards and reads the stored accession", () => {
    const c = { sec: 100, accn: "b" };
    expect(nextCursor(c, { accn: "a", discovered_at: new Date(100_000).toISOString() })).toBe(c);
    expect(accnOf("after:0001-x")).toBe("0001-x");
    expect(accnOf(null)).toBe("");
  });
  it("drops a page's cut-off last second so it is fetched whole", () => {
    const page = [{ discovered_at: "2026-11-19T08:00:00.100Z" }, { discovered_at: "2026-11-19T08:00:01.100Z" }, { discovered_at: "2026-11-19T08:00:01.500Z" }];
    expect(completeSeconds(page, 3)).toEqual({ rows: [page[0]], partialSec: toCursor("2026-11-19T08:00:01Z") });
    expect(completeSeconds(page, 10).partialSec).toBeNull();
  });
});

describe("weekly supply intel marker", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  it("advances only after stored work or a clean empty run", () => {
    expect(intelMarker({ stored: 12, companies: 20, failedStages: 3, emptyStages: 0, stop: null }, null, now).action).toBe("advance");
    expect(intelMarker({ stored: 0, companies: 20, failedStages: 0, emptyStages: 80, stop: null }, null, now).action).toBe("advance");
  });
  it("retries a failed run after 1 h, doubling, and gives up after 8 tries", () => {
    const r1 = intelMarker({ stored: 0, companies: 1, failedStages: 1, emptyStages: 0, stop: null }, null, now);
    expect(r1).toMatchObject({ action: "retry", cursor: 1 });
    expect(Date.parse(r1.updated_at) + INTEL_EVERY_MS - now).toBe(3600_000);
    const r2 = intelMarker(null, { cursor: 1, paused_reason: r1.paused_reason }, now, "no result file (exit 1)");
    expect(r2.cursor).toBe(2);
    expect(Date.parse(r2.updated_at) + INTEL_EVERY_MS - now).toBe(7200_000);
    const quota = intelMarker({ stored: 0, companies: 1, failedStages: 0, emptyStages: 0, stop: "quota: credit_balance_exhausted" }, null, now);
    expect(quota.paused_reason).toMatch(/^retry 1: quota/);
    expect(intelMarker(null, { cursor: 8, paused_reason: "retry 8: x" }, now).action).toBe("give-up");
  });
  it("breaks never-signalled ties by dv20 rank", () => {
    expect(oldest(["A", "B", "C"], new Map(), 2, new Map([["C", 1], ["B", 2]]))).toEqual(["C", "B"]);
  });
});
