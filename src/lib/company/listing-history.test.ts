import { describe, expect, it } from "vitest";
import { listingClosure } from "./listing-history";

describe("historical listings", () => {
  it.each([
    ["ROKU", "2026-11-06", "2026-11-09"],
    ["BKH", "2026-11-13", "2026-11-16"],
    ["NWE", "2026-11-13", "2026-11-16"],
    ["ITGR", "2026-11-16", "2026-11-17"],
    ["KVUE", "2026-10-30", "2026-11-02"],
  ])("keeps %s active through its final trading session", (ticker, last, next) => {
    expect(listingClosure(ticker, last)).toBeUndefined();
    expect(listingClosure(ticker.toLowerCase(), next)?.effective).toEqual(next);
  });
  it("leaves continuing issuers and benchmark symbols alone", () => {
    expect(listingClosure("BAH", "2026-11-25")).toBeUndefined();
    expect(listingClosure("SPY", "2026-11-25")).toBeUndefined();
  });
});
