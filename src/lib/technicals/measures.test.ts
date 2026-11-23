import { describe, expect, it } from "vitest";
import { indicators, type Bars } from "./conditions";
import {
  drawdownStats,
  impliedMove,
  liquidity,
  measures,
  randomWalk,
  relStrength,
  RISK,
  trendFit,
  type BenchSeries,
} from "./measures";
import { simulateBars } from "./simulate";
import { rng } from "./stat";

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10));
/** Flat OHLC bars from closes (and optional volumes); total return = close rebased. */
function bars(c: number[], v?: number[]): Bars {
  return { d: days(c.length), o: [...c], h: c.map((x) => x * 1.01), l: c.map((x) => x * 0.99), c, v: v ?? c.map(() => 1e6), tr: c.map((x) => x / c[0]) };
}

describe("trend fit", () => {
  it("recovers an exact exponential trend", () => {
    const tr = Array.from({ length: 300 }, (_, i) => Math.exp(0.001 * i));
    const f = trendFit(tr, 126)!;
    expect(f.slopeAnn).toBeCloseTo(Math.exp(0.252) - 1, 10);
    expect(f.r2).toBeCloseTo(1, 10);
    expect(f.efficiency).toBeCloseTo(1, 10);
    expect(f.efficiencyRw).toBeCloseTo(1 / Math.sqrt(126), 12);
    expect(trendFit(tr.slice(0, 100), 126)).toBeNull();
  });
  it("does not call a random walk's wandering a significant drift", () => {
    // The fitted line often looks convincing (high R²) on a driftless random walk; the drift test must not be fooled.
    let highR2 = 0;
    let driftSig = 0;
    const N = 300;
    for (let s = 0; s < N; s++) {
      const B = simulateBars(300 + s, { n: 400, drift: 0, garch: false });
      const f = trendFit(B.tr, 126)!;
      if (f.r2 > 0.5) highR2++;
      if (f.driftP < 0.05) driftSig++;
    }
    expect(highR2 / N).toBeGreaterThan(0.3);
    expect(driftSig / N).toBeLessThan(0.09);
  });
});

describe("relative strength and the market model", () => {
  const n = 400;
  const u = rng(3);
  const rb = Array.from({ length: n }, () => (u() - 0.5) * 0.03);
  const btr = [1];
  for (let i = 1; i < n; i++) btr.push(btr[i - 1] * (1 + rb[i]));
  const bench: BenchSeries = { sym: "SPY", kind: "market", d: days(n), tr: btr };

  it("is zero against itself, with beta and correlation of one", () => {
    const r = relStrength({ ...bars(btr), tr: btr }, bench);
    expect(r.rs63).toBeCloseTo(0, 12);
    expect(r.rs252).toBeCloseTo(0, 12);
    expect(r.rsMom).toBeCloseTo(0, 12);
    expect(r.beta).toBeCloseTo(1, 10);
    expect(r.corr).toBeCloseTo(1, 10);
    expect(r.idioVol).toBeCloseTo(0, 8);
    expect(r.n).toBe(252);
  });
  it("reads beta two for a series with twice the benchmark's daily returns", () => {
    const tr = [1];
    for (let i = 1; i < n; i++) tr.push(tr[i - 1] * (1 + 2 * rb[i]));
    const r = relStrength({ ...bars(tr), tr }, bench);
    expect(r.beta).toBeCloseTo(2, 10);
    expect(r.r2).toBeCloseTo(1, 10);
    // (1 + own) / (1 + benchmark) − 1 over the last 63 sessions
    const own = tr[n - 1] / tr[n - 64] - 1;
    const b = btr[n - 1] / btr[n - 64] - 1;
    expect(r.rs63).toBeCloseTo((1 + own) / (1 + b) - 1, 12);
  });
  it("pairs returns by date when the benchmark misses days", () => {
    const tr = [1];
    for (let i = 1; i < n; i++) tr.push(tr[i - 1] * (1 + 2 * rb[i]));
    const keep = days(n).map((_, i) => i % 7 !== 3);
    const sparse: BenchSeries = { sym: "X", kind: "sector", d: days(n).filter((_, i) => keep[i]), tr: btr.filter((_, i) => keep[i]) };
    const r = relStrength({ ...bars(tr), tr }, sparse);
    expect(r.n).toBeLessThan(252);
    expect(r.beta).toBeCloseTo(2, 10); // only days with both sides are used, so the fit is still exact
  });
});

describe("random walk or not", () => {
  const ar = (phi: number, seed: number) => {
    const B = simulateBars(seed, { n: 1400, garch: false, drift: 0 });
    const lr = B.tr.map((x, i) => (i ? Math.log(x / B.tr[i - 1]) : 0));
    const tr = [1];
    let prev = 0;
    for (let i = 1; i < lr.length; i++) {
      prev = phi * prev + lr[i];
      tr.push(tr[i - 1] * Math.exp(prev));
    }
    return tr;
  };
  it("reads continuation, reversal and neither", () => {
    expect(randomWalk(ar(0.3, 1)).reading).toBe("continue");
    expect(randomWalk(ar(-0.3, 2)).reading).toBe("reverse");
    const w = randomWalk(ar(0, 3));
    expect(w.rows.map((r) => r.q)).toEqual([2, 5, 10, 20]);
    expect(w.window).toBe(1260);
    // joint p is the Šidák combination of the strongest horizon
    const best = w.rows.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    expect(w.pJoint).toBeCloseTo(1 - (1 - best.p) ** 4, 12);
  });
  it("rarely calls a true random walk anything else", () => {
    let wrong = 0;
    const N = 200;
    for (let s = 0; s < N; s++) if (randomWalk(simulateBars(7000 + s, { n: 1300 }).tr).reading !== "random") wrong++;
    expect(wrong / N).toBeLessThan(0.08);
  });
});

describe("drawdown", () => {
  it("matches a hand example", () => {
    const d = days(6);
    const s = drawdownStats(d, [1, 1.2, 0.9, 1.0, 1.3, 1.1]);
    expect(s.current).toBeCloseTo(1.1 / 1.3 - 1, 12);
    expect(s.peakDate).toBe(d[4]);
    expect(s.sessionsUnder).toBe(1);
    expect(s.max).toBeCloseTo(0.9 / 1.2 - 1, 12);
    expect([s.maxPeak, s.maxTrough, s.maxRecovered]).toEqual([d[1], d[2], d[4]]);
    expect(s.longestUnder).toBe(3); // from the high on day 1 to the new high on day 4
    expect([s.longestFrom, s.longestTo]).toEqual([d[1], d[4]]);
  });
  it("reports a spell that has not ended", () => {
    const d = days(7);
    const s = drawdownStats(d, [1, 1.1, 1.2, 1.0, 0.9, 0.95, 1.0]);
    expect(s.sessionsUnder).toBe(4);
    expect(s.longestUnder).toBe(4);
    expect(s.longestTo).toBeNull();
    expect(s.maxRecovered).toBeNull();
    expect(s.max).toBeCloseTo(0.9 / 1.2 - 1, 12);
  });
});

describe("liquidity", () => {
  it("matches hand values on a constructed series", () => {
    const n = 80;
    // price alternates 100, 101; volume 1,000 on up days and 3,000 on down days, last bar 6,000
    const c = Array.from({ length: n }, (_, i) => (i % 2 ? 101 : 100));
    const v: number[] = c.map((x) => (x === 101 ? 1000 : 3000));
    v[n - 1] = 6000; // last bar is an up day (index 79 → 101)
    const L = liquidity(bars(c, v), true);
    // prior 20 sessions: 10 down days of 3,000 and 10 up days of 1,000 → average 2,000
    expect(L.relVol).toBeCloseTo(3, 12);
    // last 20 sessions: 10 down × 3,000 and 9 up × 1,000 + 6,000
    expect(L.upVolShare).toBeCloseTo(15000 / 45000, 12);
    const dv = c.map((x, i) => x * v[i]);
    const last20 = dv.slice(-20).sort((a, b) => a - b);
    expect(L.dollarVol20).toBeCloseTo((last20[9] + last20[10]) / 2, 6);
    expect(L.dollarVol60).toBeCloseTo(dv.slice(-60).reduce((a, b) => a + b, 0) / 60, 6);
    let ill = 0;
    for (let i = n - 60; i < n; i++) ill += Math.abs(c[i] / c[i - 1] - 1) / dv[i];
    expect(L.amihud).toBeCloseTo((ill / 60) * 1e6, 12);
  });
  it("says nothing without volume", () => {
    const L = liquidity(bars(Array.from({ length: 100 }, () => 50), Array.from({ length: 100 }, () => 0)), false);
    expect(L).toEqual({ hasVolume: false, dollarVol20: null, dollarVol60: null, amihud: null, relVol: null, upVolShare: null });
  });
});

describe("all measures on one history", () => {
  const B = simulateBars(41, { n: 1500 });
  const I = indicators(B);
  const M = measures({ bars: B, indicators: I, earnings: [B.d[1400]] });
  const i = B.c.length - 1;

  it("computes momentum from the total-return index", () => {
    expect(M.momentum.mom12_1).toBeCloseTo(B.tr[i - 21] / B.tr[i - 252] - 1, 12);
    expect(M.momentum.mom6_1).toBeCloseTo(B.tr[i - 21] / B.tr[i - 126] - 1, 12);
    expect(M.momentum.r63).toBeCloseTo(B.tr[i] / B.tr[i - 63] - 1, 12);
    expect(M.asOf).toBe(B.d[i]);
    expect(M.bars).toBe(1500);
  });
  it("turns volatility into expected moves", () => {
    const rv = M.volatility.rv21!;
    const lr = B.c.slice(i - 21, i + 1).map((x, k, a) => (k ? Math.log(x / a[k - 1]) : NaN)).slice(1);
    const m = lr.reduce((a, b) => a + b, 0) / 21;
    expect(rv).toBeCloseTo(Math.sqrt((lr.reduce((a, b) => a + (b - m) ** 2, 0) / 20) * 252), 10);
    expect(M.volatility.expected.map((e) => e.sessions)).toEqual([5, 21]);
    expect(M.volatility.expected[0].pct).toBeCloseTo((rv / Math.sqrt(252)) * Math.sqrt(5), 12);
    expect(M.volatility.expected[1].high).toBeCloseTo(M.close * (1 + (rv / Math.sqrt(252)) * Math.sqrt(21)), 10);
    expect(impliedMove(0.32, 5)).toBeCloseTo(0.32 * Math.sqrt(5 / 252), 12);
    expect(impliedMove(0.32, 21)).toBeCloseTo(0.092376, 6);
  });
  it("does the stop and position arithmetic", () => {
    const atr = M.risk.atr!;
    expect(M.risk.stopPct).toBeCloseTo((RISK.stopAtrs * atr) / M.close, 12);
    expect(M.risk.stopLevel).toBeCloseTo(M.close - RISK.stopAtrs * atr, 10);
    // losing stopPct on a position of this size costs riskFraction of the account
    expect(M.risk.positionPct! * M.risk.stopPct!).toBeCloseTo(RISK.riskFraction, 12);
    expect(M.risk.worstDay).toBeLessThan(0);
    expect(M.risk.var95).toBeGreaterThan(0);
    expect(M.risk.var95!).toBeLessThan(-M.risk.worstDay!);
  });
  it("lists levels from high to low with their distance in ATRs", () => {
    const L = M.levels;
    expect(L.length).toBeGreaterThan(4);
    for (let k = 1; k < L.length; k++) expect(L[k].price).toBeLessThanOrEqual(L[k - 1].price);
    for (const r of L) {
      expect(r.distance).toBeCloseTo(r.price / M.close - 1, 12);
      expect(r.atrs).toBeCloseTo((r.price - M.close) / M.risk.atr!, 10);
    }
    const labels = L.map((r) => r.label);
    for (const want of ["50-day average", "200-day average", "52-week high", "52-week low", "VWAP from the 52-week low", "VWAP from the last earnings release"])
      expect(labels).toContain(want);
    expect(L.find((r) => r.label === "52-week high")!.price).toBeCloseTo(Math.max(...B.h.slice(-252)), 10);
  });
  it("anchors the VWAP at the bar it names", () => {
    const a = 1400;
    let pv = 0;
    let vv = 0;
    for (let k = a; k <= i; k++) {
      pv += ((B.h[k] + B.l[k] + B.c[k]) / 3) * B.v[k];
      vv += B.v[k];
    }
    expect(M.levels.find((r) => r.label === "VWAP from the last earnings release")!.price).toBeCloseTo(pv / vv, 8);
  });
  it("reports stretch from the same bar", () => {
    const w = B.c.slice(-20);
    const m = w.reduce((a, b) => a + b, 0) / 20;
    const s = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
    expect(M.stretch.z20).toBeCloseTo((M.close - m) / s, 10);
    expect(M.stretch.rsiRank).toBeGreaterThan(0);
    expect(M.stretch.rsiRank).toBeLessThanOrEqual(1);
  });
});
