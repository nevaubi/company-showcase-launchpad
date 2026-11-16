import { describe, expect, it } from "vitest";
import { adfT, bhFdr, deflatedSharpe, EG_CRIT_5, halfLife, normCdf, normInv } from "./stats";
import { align, features, roundTripCost } from "./features";
import { STRATEGIES } from "./strategies";
import { evaluate, Samples, type Regime } from "./backtest";
import type { Bar } from "../financials/types";

// Deterministic pseudo-random numbers.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

describe("stats", () => {
  it("normal CDF and its inverse agree with tables", () => {
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
    expect(normInv(0.01)).toBeCloseTo(-2.326, 2);
  });
  it("Benjamini-Hochberg keeps only p-values under the stepped threshold", () => {
    expect(bhFdr([0.001, 0.008, 0.039, 0.041, 0.6], 0.05)).toEqual([true, true, false, false, false]);
  });
  it("ADF separates a mean-reverting series from a random walk", () => {
    const r = rng(7);
    const ar = [0], rw = [0];
    for (let t = 1; t < 500; t++) {
      ar.push(0.8 * ar[t - 1] + gauss(r));
      rw.push(rw[t - 1] + gauss(r));
    }
    expect(adfT(ar)).toBeLessThan(EG_CRIT_5);
    expect(adfT(rw)).toBeGreaterThan(EG_CRIT_5);
    // AR(1) with phi = 0.8: half-life = ln2 / -ln(0.8) ≈ 3.1 bars
    expect(halfLife(ar)).toBeGreaterThan(2);
    expect(halfLife(ar)).toBeLessThan(5);
  });
  it("deflated Sharpe falls as the number of strategies tried rises", () => {
    expect(deflatedSharpe(0.1, 500, 0, 3, 2, 0.003)).toBeGreaterThan(deflatedSharpe(0.1, 500, 0, 3, 50, 0.003));
  });
});

describe("costs", () => {
  it("charges more for thinner stocks and excludes those under $5M a day", () => {
    expect(roundTripCost(1e9)).toBe(0.0004);
    expect(roundTripCost(1e7)).toBe(0.003);
    expect(roundTripCost(4e6)).toBeNull();
  });
});

describe("no look-ahead", () => {
  it("features and signals at bar i do not change when later bars change", () => {
    const r = rng(3);
    const dates: string[] = [];
    const bars: Bar[] = [];
    let p = 100;
    for (let i = 0; i < 600; i++) {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);
      dates.push(d);
      const o = p;
      p *= 1 + 0.02 * gauss(r);
      bars.push([d, o, Math.max(o, p) * 1.01, Math.min(o, p) * 0.99, p, p, 1e6 * (1 + r() * (i % 37 === 0 ? 5 : 1))]);
    }
    const bench = align(dates, bars.map((b) => [...b] as Bar)).c;
    const base = features(align(dates, bars), bench);
    const cut = 450;
    const altered = bars.map((b, i) => (i > cut ? ([b[0], b[1] * 3, b[2] * 3, b[3] * 3, b[4] * 3, b[5] * 3, b[6] * 9] as Bar) : b));
    const alt = features(align(dates, altered), bench);
    for (const s of STRATEGIES) {
      if (!s.fire) continue;
      for (let i = 300; i <= cut; i++) expect(s.fire(alt, i)).toBe(s.fire(base, i));
    }
    expect(alt.sma200[cut]).toBe(base.sma200[cut]);
    expect(alt.rsi2[cut]).toBe(base.rsi2[cut]);
  });
});

describe("strict gate", () => {
  it("rejects a strategy whose trades are pure noise", () => {
    const r = rng(11);
    const dates = Array.from({ length: 2000 }, (_, i) => new Date(Date.UTC(2016, 0, 1) + i * 1.8 * 864e5).toISOString().slice(0, 10));
    const regime = dates.map((_, i) => (["Up, calm", "Down, stressed"] as Regime[])[i % 2]);
    const variants = Array.from({ length: 10 }, (_, k) => {
      const s = new Samples();
      for (let j = 0; j < 3000; j++) {
        const x = 0.03 * gauss(r);
        s.push(Math.floor(r() * 2000), x, x, x);
      }
      return { key: `noise:${k}`, samples: s };
    });
    const out = evaluate(variants, dates, regime);
    expect(out.every((v) => !v.passed)).toBe(true);
  });
  it("accepts a strategy with a real, stable edge", () => {
    const r = rng(5);
    const dates = Array.from({ length: 2000 }, (_, i) => new Date(Date.UTC(2016, 0, 1) + i * 1.8 * 864e5).toISOString().slice(0, 10));
    const regime = dates.map((_, i) => (["Up, calm", "Down, stressed"] as Regime[])[i % 2]);
    const mk = (key: string, mu: number) => {
      const s = new Samples();
      for (let j = 0; j < 4000; j++) {
        const x = mu + 0.03 * gauss(r);
        s.push(Math.floor(r() * 2000), x, x, x);
      }
      return { key, samples: s };
    };
    const out = evaluate([mk("edge", 0.006), mk("n1", 0), mk("n2", 0), mk("n3", 0)], dates, regime);
    expect(out[0].passed).toBe(true);
  });
});
