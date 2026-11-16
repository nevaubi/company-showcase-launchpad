import { describe, expect, it } from "vitest";
import type { SetupsFile } from "@/lib/signals/setups";
import { botsText, setupsText } from "./trading-text";

const stats = { n: 140, days: 90, avgNet: 0.0056, avgGross: 0.007, avgExSpy: 0.004, hit: 0.55, t: 1.7, sharpe: 0.1, skew: 0, kurt: 3 };
const file = {
  generatedAt: "2026-11-16T23:00:00Z",
  asOf: "2026-11-16",
  companies: 1773,
  regime: "Up, stressed",
  oosStart: "2022-01-01",
  gate: { minN: 100, minDays: 50, minT: 2, minDsr: 0.95, fdrQ: 0.05, minRegimeN: 30, minRegimes: 2 },
  variants: [
    { key: "pre_earnings:L:5", strategy: "pre_earnings", family: "events", side: 1, horizon: 5, inSample: stats, outSample: stats, regimes: {}, years: [], curve: [], maxDrawdown: -0.08, dsr: 0.6, fdr: false, passed: false, failed: ["t < 2"] },
  ],
  setups: [
    { ticker: "BJ", name: "BJ's Wholesale", sector: "Consumer Staples", key: "pre_earnings:L:5", strategy: "pre_earnings", family: "events", side: 1, horizon: 5, firedAt: "2026-11-13", detail: "Results expected in about 5 trading days", strength: 1, price: 111.88, stop: 105.69, target: 124.27, atr: 2, edge: 0.0056, proven: false, spark: [] },
  ],
  pairsProven: false,
  pairs: [],
  market: { vix: 22.9, vix3m: 20.6, vixRatio: 1.11, breadth200: 0.55, nearHighs: 0.1, shortRatio: 0.55 },
  source: "daily",
} as unknown as SetupsFile;

describe("assistant setups text", () => {
  it("labels unproven setups as watch-only and states why the strategy fails", () => {
    const t = setupsText(file, { ticker: "BJ" });
    expect(t).toContain("0 of 1 strategy versions pass");
    expect(t).toContain("BJ BJ's Wholesale [Consumer Staples] LONG");
    expect(t).toContain("watch-only");
    expect(t).toContain("fails: t < 2");
    expect(t).toContain("VIX/VIX3M 1.11 (inverted: stress)");
  });
  it("hides watch-only setups when asked for proven only", () => {
    expect(setupsText(file, { includeWatch: false })).toContain("none.");
  });
  it("summarises an autopilot against SPY", () => {
    const t = botsText([{ id: "b1", name: "House momentum", house: true, status: "active", capital: 100000, startedOn: "2026-11-01", lastAsOf: "2026-11-16", lastError: null, description: null, open: 3, stats: { totalReturn: 0.021, spyReturn: -0.01, excess: 0.031, trades: 12, hit: 0.58, avgTrade: 0.004, maxDrawdown: -0.03, sharpe: null, days: 11 } }]);
    expect(t).toContain("return +2.10% vs SPY −1.00% (excess +3.10%)");
    expect(t).toContain("Sharpe — (needs 20+ days)");
    expect(t).toContain("</app/autopilots/b1>");
  });
});
