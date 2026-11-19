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
