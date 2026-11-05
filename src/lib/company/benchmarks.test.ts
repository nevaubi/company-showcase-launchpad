import { describe, expect, it } from "vitest";
import { median, metricsOf, rankIn } from "./benchmarks";
import type { UniverseEntry } from "@/lib/financials/types";

const co = {
  ticker: "X", sharesOutstanding: 100, epsTTM: 2, revenueGrowthYoY: 0.1, grossMarginTTM: 0.5,
  f: { asOf: null, ttm: { revenue: 1000, operatingIncome: 200, netIncome: 150, fcf: 100, ebitda: 300, buybacks: 50, dividends: 50 }, bs: { netDebt: 600, equity: 1500 }, revenueHistory: [], revenueCagr3y: null, revenueCagr5y: 0.08, epsGrowthYoY: null, dilutedShares: null },
} as unknown as UniverseEntry;

describe("sector benchmarks", () => {
  it("derives valuation and quality ratios from the SEC fundamentals", () => {
    const m = metricsOf(co, 20); // mcap 2,000
    expect(m.mcap).toBe(2000);
    expect(m.pe).toBe(10);
    expect(m.evEbitda).toBeCloseTo((2000 + 600) / 300);
    expect(m.opm).toBe(0.2);
    expect(m.fcfYield).toBe(0.05);
    expect(m.roe).toBe(0.1);
    expect(m.leverage).toBe(2);
    expect(m.shYield).toBe(0.05);
  });

  it("hides P/E when earnings are negative", () => {
    expect(metricsOf({ ...co, epsTTM: -1 }, 20).pe).toBeNull();
  });

  it("takes medians and ranks with the right direction", () => {
    expect(median([3, 1, null, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(rankIn(10, [5, 10, 20], "low")).toEqual({ rank: 2, of: 3 });
    expect(rankIn(10, [5, 10, 20], "high")).toEqual({ rank: 2, of: 3 });
  });
});
