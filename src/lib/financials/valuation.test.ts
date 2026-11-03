import { describe, expect, it } from "vitest";
import { multipleStats, multiplesAt, restateShares, splitFactor, weeklyBars, type FundamentalsAt } from "./valuation";
import type { Bar } from "./types";

const f = (over: Partial<FundamentalsAt> = {}): FundamentalsAt => ({
  end: "2025-12-31",
  available: "2026-02-01",
  label: "Q4 FY25",
  shares: 1_000,
  revenue: 50_000,
  ebitda: 20_000,
  netIncome: 10_000,
  fcf: 8_000,
  dividends: 2_000,
  buybacks: 3_000,
  debt: 30_000,
  cash: 10_000,
  equity: 40_000,
  ...over,
});

describe("stock-split restatement", () => {
  it("recognises a 4-for-1 split between quarters", () => {
    expect(splitFactor(4_000, 1_000)).toBe(4);
  });
  it("recognises a 1-for-10 reverse split", () => {
    expect(splitFactor(100, 1_000)).toBeCloseTo(0.1);
  });
  it("ignores ordinary buyback drift", () => {
    expect(splitFactor(970, 1_000)).toBe(1);
  });
  it("restates earlier share counts to today's basis across two splits", () => {
    // 10:1 then 4:1 → earliest counts multiply by 40
    expect(restateShares([10, 10, 100, 100, 400])).toEqual([400, 400, 400, 400, 400]);
  });
});

describe("multiples", () => {
  it("prices P/E as market cap over TTM net income", () => {
    const m = multiplesAt(f(), 200, false); // mcap 200k
    expect(m.mcap).toBe(200_000);
    expect(m.values.pe).toBe(20);
  });
  it("builds EV from debt less cash and short-term investments", () => {
    const m = multiplesAt(f(), 200, false);
    expect(m.ev).toBe(220_000);
    expect(m.values.evEbitda).toBe(11);
  });
  it("drops enterprise-value multiples for banks", () => {
    const m = multiplesAt(f(), 200, true);
    expect(m.values.evEbitda).toBeNull();
    expect(m.values.pfcf).toBeNull();
    expect(m.values.pb).toBe(5);
  });
  it("leaves P/E empty when trailing earnings are negative", () => {
    expect(multiplesAt(f({ netIncome: -5 }), 200, false).values.pe).toBeNull();
  });
  it("computes shareholder yield from dividends plus buybacks", () => {
    expect(multiplesAt(f(), 200, false).values.shYield).toBeCloseTo(0.025);
  });
});

describe("history helpers", () => {
  it("keeps the last trading day of each week", () => {
    const bar = (d: string, c: number): Bar => [d, c, c, c, c, c, 0];
    const w = weeklyBars([bar("2026-01-05", 1), bar("2026-01-09", 2), bar("2026-01-12", 3)]);
    expect(w.map((b) => b[0])).toEqual(["2026-01-09", "2026-01-12"]);
  });
  it("reports median and percentile of the current value", () => {
    const s = multipleStats([10, 20, 30, 40, 25]);
    expect(s.median).toBe(25);
    expect(s.current).toBe(25);
    expect(s.percentile).toBe(0.6);
  });
});
