import { describe, expect, it } from "vitest";
import { buildEvidence } from "@/lib/signals/evidence";
import type { LiveSignal } from "@/lib/signals/rank";
import type { SetupsFile } from "@/lib/signals/setups";
import { realVariants } from "@/lib/signals/variants-real.fixture";
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
  it("without the evidence book, labels setups not listed and states why the rule fails", () => {
    const t = setupsText(file, { ticker: "BJ" });
    expect(t).toContain("0 of 1 rules pass the strict gate");
    expect(t).toContain("BJ BJ's Wholesale [Consumer Staples] LONG");
    expect(t).toContain("rule not listed");
    expect(t).toContain("fails: t < 2");
    expect(t).toContain("VIX/VIX3M 1.11 (inverted: stress)");
  });
  it("hides signals from rules that are not listed when asked for listed rules only", () => {
    expect(setupsText(file, { includeWatch: false })).toContain("none.");
  });
  it("on the real 46 rules, says none clears the bar and gives the Watch list rows without stop or target", () => {
    const variants = realVariants();
    const book = buildEvidence(variants, "Down, stressed", "2026-11-20");
    const live: LiveSignal[] = variants.slice(0, 6).map((v, k) => ({ ticker: `T${k}`, name: `Company ${k}`, sector: k % 2 ? "Energy" : "Financials", variant: v.key, firedAt: "2026-11-20", firstSeen: "2026-11-20", strength: 2, detail: "", price: 100, atr: 2, dv20: 2e8, cost: 0.0008 }));
    const t = setupsText({ ...file, variants, book, live });
    expect(t).toContain("No rule clears the bar today, so the short list is empty");
    expect(t).toContain("a t near 2.2,");
    expect(t).toContain("the best today reaches 1.97");
    expect(t).toContain("An empty list says that nothing here is exceptional, not that no rule has any edge.");
    expect(t).toContain("SHORT LIST (0");
    expect(t).toContain("none: no listed rule has a live signal.");
    expect(t).toContain("WATCH LIST, NOT LISTED");
    // Rows of rules that are not listed carry no stop, target or expected edge.
    const watch = t.split("\n").filter((l) => l.includes("rule not listed"));
    expect(watch.length).toBeGreaterThan(0);
    for (const l of watch) expect(l).not.toMatch(/stop \$|target \$|expected edge [-+0-9]/);
    expect(t).toContain("a watch list, not evidence and not a recommendation");
    expect(t).toMatch(/rule not listed/);
    expect(t).not.toMatch(/watch-only|PASSES every check/);
    // Nothing on the list is described as proven: the word appears only in the definition of the grade.
    expect(t.match(/proven/g)?.length).toBe(2);
  });
  it("summarises an autopilot against SPY", () => {
    const t = botsText([{ id: "b1", name: "House momentum", house: true, status: "active", capital: 100000, startedOn: "2026-11-01", lastAsOf: "2026-11-16", lastError: null, description: null, open: 3, stats: { totalReturn: 0.021, spyReturn: -0.01, excess: 0.031, trades: 12, hit: 0.58, avgTrade: 0.004, maxDrawdown: -0.03, sharpe: null, days: 11 } }]);
    expect(t).toContain("return +2.10% vs SPY −1.00% (excess +3.10%)");
    expect(t).toContain("Sharpe — (needs 20+ days)");
    expect(t).toContain("</app/autopilots/b1>");
  });
});
