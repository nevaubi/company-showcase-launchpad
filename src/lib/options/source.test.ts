import { describe, expect, it } from "vitest";
import { iv30Basis, quoteMoment, quotePage, quotedAt, sameSource, sourceName, sourceOf, volMethod } from "./source";

describe("options source", () => {
  it("reads a row without a source as Cboe, the only source before 27 Nov 2026", () => {
    expect(sourceOf({})).toBe("cboe");
    expect(sourceOf({ source: "yahoo" })).toBe("yahoo");
    expect(sourceName({ source: "yahoo" })).toBe("Yahoo Finance");
  });
  it("links each source's own quote page", () => {
    expect(quotePage("BRK-B", { source: "cboe" })).toBe("https://www.cboe.com/delayed_quotes/brk.b/quote_table");
    expect(quotePage("BRK-B", { source: "yahoo" })).toBe("https://finance.yahoo.com/quote/BRK-B/options/");
  });
  it("keeps only the newest row's source for a history", () => {
    const rows = [{ d: 3, source: "yahoo" }, { d: 2, source: "cboe" }, { d: 1, source: "yahoo" }];
    expect(sameSource(rows).map((r) => r.d)).toEqual([3, 1]);
    expect(sameSource([])).toEqual([]);
  });
  it("says when the quotes were taken in New York time", () => {
    // 20:42 UTC on a standard-time day is 15:42 in New York
    expect(quotedAt({ state: "REGULAR", quoted: "2026-11-27T20:42:00.000Z" })).toEqual({ time: "15:42", atClose: false });
    expect(quoteMoment({ state: "REGULAR", quoted: "2026-11-27T20:42:00.000Z" })).toBe("15:42 New York quotes");
    expect(quoteMoment({ state: "POST", quoted: "2026-11-27T21:00:02.000Z" })).toBe("close");
    // an early close ends at 13:00; read after it, the quotes are still the session's last
    expect(quoteMoment({ state: "POST", quoted: "2026-11-27T18:00:01.000Z" })).toBe("close");
    expect(quoteMoment(null)).toBe("close");
  });
  it("states how the 30-day volatility was built", () => {
    expect(iv30Basis({ source: "cboe" })).toMatch(/^Cboe's own/);
    const between = iv30Basis({ source: "yahoo", meta: { iv30From: { kind: "between", lo: { e: "2026-12-18", d: 21, iv: 0.281 }, hi: { e: "2027-01-15", d: 49, iv: 0.302 } } } });
    expect(between).toContain("2026-12-18 expiry (21 days, 28.1%)");
    expect(between).toContain("2027-01-15 expiry (49 days, 30.2%)");
    expect(iv30Basis({ source: "yahoo", meta: { iv30From: { kind: "single", at: { e: "2026-12-18", d: 21, iv: 0.281 } } } })).toContain("the only expiry listed near 30 days");
  });
  it("names the model and the rate for computed volatility", () => {
    expect(volMethod({ source: "yahoo", meta: { rate: 0.0436 } })).toContain("discounted at 4.36%");
    expect(volMethod({ source: "cboe" })).toContain("as Cboe publishes them");
  });
});
