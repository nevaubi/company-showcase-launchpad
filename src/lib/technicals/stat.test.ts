import { describe, expect, it } from "vitest";
import { bhFdr } from "@/lib/signals/stats";
import {
  bhAdjust,
  blockBootstrapSum,
  countIndependent,
  dailyTerms,
  efficiencyRatio,
  ForwardReturns,
  forwardTest,
  hashSeed,
  incBeta,
  logGamma,
  marketModel,
  mean,
  median,
  neweyWest,
  nwLag,
  olsTrend,
  quantileSorted,
  rng,
  sd,
  tTwoSided,
  trailingRank,
  varianceRatio,
  zTwoSided,
} from "./stat";

/** Standard normal draws from the seeded generator (Box-Muller). */
function normals(seed: number, n: number) {
  const u = rng(seed);
  return Float64Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u()));
}
/** Total-return index and daily log returns from a list of daily log returns (index 0 is the start). */
function index(r: ArrayLike<number>) {
  const tr = new Float64Array(r.length + 1);
  const lr = new Float64Array(r.length + 1);
  tr[0] = 1;
  for (let i = 0; i < r.length; i++) {
    lr[i + 1] = r[i];
    tr[i + 1] = tr[i] * Math.exp(r[i]);
  }
  return { tr, lr };
}

describe("descriptive statistics", () => {
  it("matches hand values", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5); // sample SD of a textbook example
    expect(quantileSorted([0, 10, 20, 30, 40], 0.125)).toBe(5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("distribution functions against table values", () => {
  it("log gamma", () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(logGamma(10.5)).toBeCloseTo(13.940625219403763, 10);
  });
  it("regularised incomplete beta", () => {
    expect(incBeta(0.3, 2, 2)).toBeCloseTo(3 * 0.09 - 2 * 0.027, 12); // I_x(2,2) = 3x² − 2x³
    expect(incBeta(0.5, 2, 3)).toBeCloseTo(0.6875, 12); // 6x² − 8x³ + 3x⁴
    expect(incBeta(0.9, 5, 0.5)).toBeCloseTo(1 - incBeta(0.1, 0.5, 5), 12);
    expect(incBeta(0, 2, 2)).toBe(0);
    expect(incBeta(1, 2, 2)).toBe(1);
  });
  it("Student-t two-sided p-values at the usual critical values", () => {
    expect(tTwoSided(12.706, 1)).toBeCloseTo(0.05, 4);
    expect(tTwoSided(2.228, 10)).toBeCloseTo(0.05, 4);
    expect(tTwoSided(2.086, 20)).toBeCloseTo(0.05, 4);
    expect(tTwoSided(3.169, 10)).toBeCloseTo(0.01, 4);
    expect(tTwoSided(2.0, 10)).toBeCloseTo(0.073388, 5);
    expect(tTwoSided(0, 7)).toBeCloseTo(1, 12);
    expect(tTwoSided(-2.228, 10)).toBeCloseTo(tTwoSided(2.228, 10), 12);
    // many degrees of freedom: the normal value
    expect(tTwoSided(1.96, 1e6)).toBeCloseTo(0.05, 4);
    expect(zTwoSided(1.959964)).toBeCloseTo(0.05, 5);
  });
});

describe("Benjamini-Hochberg", () => {
  it("adjusts a worked example", () => {
    // sorted p: .005 .01 .03 .04 → p·m/rank: .02 .02 .04 .04
    expect(bhAdjust([0.01, 0.04, 0.03, 0.005])).toEqual([0.02, 0.04, 0.04, 0.02]);
  });
  it("is monotone and never below the raw p-value", () => {
    const p = [0.001, 0.2, 0.03, 0.5, 0.0004, 0.049, 0.9, 0.012];
    const q = bhAdjust(p);
    p.forEach((v, i) => expect(q[i]).toBeGreaterThanOrEqual(v));
    const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
    for (let k = 1; k < order.length; k++) expect(q[order[k]]).toBeGreaterThanOrEqual(q[order[k - 1]]);
  });
  it("agrees with the signals library's discovery rule at any level", () => {
    const u = rng(11);
    const p = Array.from({ length: 60 }, (_, i) => (i < 6 ? u() * 0.002 : u()));
    const q = bhAdjust(p);
    for (const level of [0.01, 0.05, 0.1, 0.25]) {
      const d = bhFdr(p, level);
      p.forEach((_, i) => expect(q[i] <= level).toBe(d[i]));
    }
  });
});

describe("seeded random numbers", () => {
  it("repeats for a seed and differs across seeds", () => {
    const a = rng(42);
    const b = rng(42);
    const c = rng(43);
    const xa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xa);
    expect([c(), c(), c()]).not.toEqual(xa);
    expect(hashSeed("AAPL|above_200|20")).toBe(hashSeed("AAPL|above_200|20"));
    expect(hashSeed("AAPL|above_200|20")).not.toBe(hashSeed("AAPL|above_200|5"));
  });
  it("is uniform enough", () => {
    const u = rng(7);
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = u();
      s += x;
      s2 += x * x;
    }
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(s2 / n - (s / n) ** 2).toBeCloseTo(1 / 12, 2);
  });
});

describe("Newey-West", () => {
  it("matches a hand calculation", () => {
    // deviations −2 −1 0 1 2: γ0 = 2, γ1 = 0.8; long-run variance with one lag = 2 + 2·½·0.8 = 2.8
    const r = neweyWest([1, 2, 3, 4, 5], 1);
    expect(r.mean).toBe(3);
    expect(r.lrv).toBeCloseTo(2.8, 12);
    expect(r.se).toBeCloseTo(Math.sqrt(2.8 / 5), 12);
    expect(neweyWest([1, 2, 3, 4, 5], 0).lrv).toBeCloseTo(2, 12);
  });
  it("uses the usual automatic lag", () => {
    expect(nwLag(100)).toBe(4);
    expect(nwLag(126)).toBe(4);
    expect(nwLag(1000)).toBe(6);
  });
});

describe("regressions", () => {
  it("fits a trend line (hand values)", () => {
    const exact = olsTrend([2, 5, 8, 11, 14])!;
    expect(exact.slope).toBeCloseTo(3, 12);
    expect(exact.intercept).toBeCloseTo(2, 12);
    expect(exact.r2).toBeCloseTo(1, 12);
    // y = 1 3 2 5 4: Sxy 8, Sxx 10, Syy 10 → slope .8, SSE 3.6, R² .64, SE √(3.6/3/10)
    const f = olsTrend([1, 3, 2, 5, 4])!;
    expect(f.slope).toBeCloseTo(0.8, 12);
    expect(f.intercept).toBeCloseTo(1.4, 12);
    expect(f.r2).toBeCloseTo(0.64, 12);
    expect(f.seSlope).toBeCloseTo(Math.sqrt(0.12), 12);
    expect(olsTrend([1, 2])).toBeNull();
  });
  it("fits a market model", () => {
    const x = Array.from(normals(3, 250));
    const exact = marketModel(x.map((v) => 0.001 + 2 * v), x)!;
    expect(exact.beta).toBeCloseTo(2, 10);
    expect(exact.alpha).toBeCloseTo(0.001, 10);
    expect(exact.r2).toBeCloseTo(1, 10);
    expect(exact.residSd).toBeCloseTo(0, 8);
    const e = normals(4, 250);
    const noisy = marketModel(x.map((v, i) => 1.5 * v + 0.5 * e[i]), x)!;
    expect(noisy.beta).toBeGreaterThan(1.5 - 4 * noisy.seBeta);
    expect(noisy.beta).toBeLessThan(1.5 + 4 * noisy.seBeta);
    expect(noisy.corr ** 2).toBeCloseTo(noisy.r2, 12);
    expect(marketModel([1, 2, 3], [1, 2, 3])).toBeNull();
  });
});

describe("variance ratio (Lo-MacKinlay)", () => {
  it("matches a hand calculation", () => {
    // returns 1 2 −1 2 −1 2 1 2 (T = 8, μ = 1): σa² = 12/7; two-period sum of squares 7, m = 10.5 → VR = 7/18
    const v = varianceRatio([0, 1, 3, 2, 4, 3, 5, 6, 8], 2)!;
    expect(v.vr).toBeCloseTo(7 / 18, 12);
    expect(v.z).toBeCloseTo(-(11 / 18) / (1 / 3), 10); // δ1 = 16/144
    expect(v.zIid).toBeCloseTo(-(11 / 18) / Math.sqrt(0.125), 10);
    expect(v.n).toBe(8);
  });
  it("is about 1 for independent returns and holds its level", () => {
    let reject = 0;
    let sum = 0;
    const N = 300;
    for (let s = 0; s < N; s++) {
      const r = normals(100 + s, 1000);
      const lp = new Float64Array(1001);
      for (let i = 0; i < 1000; i++) lp[i + 1] = lp[i] + 0.0003 + 0.015 * r[i];
      const v = varianceRatio(lp, 5)!;
      sum += v.vr;
      if (v.p < 0.05) reject++;
    }
    expect(sum / N).toBeGreaterThan(0.97);
    expect(sum / N).toBeLessThan(1.03);
    expect(reject / N).toBeLessThan(0.09);
  });
  it("falls below 1 when moves reverse and rises above 1 when they continue", () => {
    const mk = (phi: number) => {
      const e = normals(9, 3000);
      const lp = new Float64Array(3001);
      let prev = 0;
      for (let i = 0; i < 3000; i++) {
        prev = phi * prev + 0.015 * e[i];
        lp[i + 1] = lp[i] + prev;
      }
      return varianceRatio(lp, 5)!;
    };
    const rev = mk(-0.3);
    const con = mk(0.3);
    expect(rev.vr).toBeLessThan(0.75);
    expect(rev.z).toBeLessThan(-4);
    expect(con.vr).toBeGreaterThan(1.3);
    expect(con.z).toBeGreaterThan(4);
  });
  it("needs enough data", () => {
    expect(varianceRatio([0, 1, 2, 3], 2)).toBeNull();
    expect(varianceRatio(new Float64Array(50).fill(1), 2)).toBeNull(); // no variation
  });
});

describe("small helpers", () => {
  it("efficiency ratio", () => {
    expect(efficiencyRatio([0, 1, 2, 3])).toBe(1);
    expect(efficiencyRatio([0, 1, 0, 1, 0])).toBe(0);
    expect(efficiencyRatio([0, 2, 1, 3])).toBeCloseTo(0.6, 12);
    expect(efficiencyRatio([1, 1, 1])).toBeNull();
  });
  it("trailing percentile rank uses only the window ending at each bar", () => {
    expect(trailingRank([5, 1, 3, null, 3, 9], 3, 2)).toEqual([null, 0.5, 2 / 3, null, 1, 1]);
    // changing a later value never changes an earlier rank
    const x = Array.from(normals(5, 400));
    const a = trailingRank(x, 100, 50);
    const y = [...x];
    y[399] = 99;
    const b = trailingRank(y, 100, 50);
    expect(b.slice(0, 399)).toEqual(a.slice(0, 399));
  });
  it("counts non-overlapping occurrences", () => {
    expect(countIndependent([1, 1, 1, 0, 1, 1], 0, 5, 2)).toBe(3);
    expect(countIndependent([1, 1, 1, 1, 1, 1], 0, 5, 3)).toBe(2);
    expect(countIndependent([1, 0, 0, 0, 0, 1], 0, 5, 5)).toBe(2);
    expect(countIndependent([1, 1, 1, 1, 1, 1], 2, 5, 1)).toBe(4);
  });
});

describe("block bootstrap", () => {
  it("recovers the sampling spread of a mean", () => {
    const e = normals(21, 4000);
    const w = e.map((v) => 0.2 + v);
    const ci = blockBootstrapSum(w, 10, 1000, 5, w.length)!;
    const m = mean(w);
    // true standard error of the mean is 1/√4000 = 0.0158; the interval should be about m ± 1.96 SE
    expect(ci[0]).toBeLessThan(m);
    expect(ci[1]).toBeGreaterThan(m);
    expect((ci[1] - ci[0]) / (2 * 1.96)).toBeGreaterThan(0.0158 * 0.85);
    expect((ci[1] - ci[0]) / (2 * 1.96)).toBeLessThan(0.0158 * 1.15);
    expect(blockBootstrapSum(w, 10, 1000, 5, w.length)).toEqual(ci); // same seed, same interval
    expect(blockBootstrapSum(w, 10, 1000, 6, w.length)).not.toEqual(ci);
  });
  it("widens when the terms are positively autocorrelated", () => {
    const e = normals(22, 4000);
    const ar = new Float64Array(4000);
    for (let i = 1; i < 4000; i++) ar[i] = 0.7 * ar[i - 1] + e[i];
    const narrow = blockBootstrapSum(ar, 1, 1000, 1, 4000)!;
    const wide = blockBootstrapSum(ar, 40, 1000, 1, 4000)!;
    expect(wide[1] - wide[0]).toBeGreaterThan(2 * (narrow[1] - narrow[0]));
  });
  it("declines to run on too little data", () => {
    expect(blockBootstrapSum([1, 2, 3], 10, 1000, 1)).toBeNull();
    expect(blockBootstrapSum(new Float64Array(100), 10, 50, 1)).toBeNull();
  });
});

describe("forward returns after a condition", () => {
  it("computes the effect exactly as its definition", () => {
    const r = normals(31, 600).map((v) => 0.0005 + 0.012 * v);
    const { tr, lr } = index(r);
    const u = rng(77);
    const flag = Uint8Array.from({ length: tr.length }, () => (u() < 0.3 ? 1 : 0));
    for (const h of [1, 5, 20]) {
      const F = new ForwardReturns(tr, h);
      const t = forwardTest(F, lr, flag, 50)!;
      // definition: mean h-day log return on flagged bars minus the mean over all bars in the sample
      let sc = 0;
      let nc = 0;
      let sa = 0;
      for (let k = 50; k <= t.last; k++) {
        const f = Math.log(tr[k + h] / tr[k]);
        sa += f;
        if (flag[k]) {
          sc += f;
          nc++;
        }
      }
      expect(t.n).toBe(nc);
      expect(t.nAll).toBe(t.last - 50 + 1);
      expect(t.excess).toBeCloseTo(sc / nc - sa / t.nAll, 12);
      expect(t.meanLog).toBeCloseTo(sc / nc, 12);
      expect(t.meanAllLog).toBeCloseTo(sa / t.nAll, 12);
      // the Hodrick identity: the daily terms add up to the same effect
      const w = dailyTerms(F, lr, flag, 50, t.n);
      expect(w.reduce((a, b) => a + b, 0) / t.n).toBeCloseTo(t.excess, 12);
      expect(t.t).toBeCloseTo(t.excess / t.se, 10);
      expect(t.p).toBeCloseTo(tTwoSided(t.t, t.nEff - 1), 12);
    }
  });
  it("reports simple-return summaries of the same windows", () => {
    // five bars rising 10% a day: every 2-day forward return is +21%
    const tr = [1, 1.1, 1.21, 1.331, 1.4641, 1.61051, 1.771561];
    const F = new ForwardReturns(tr, 2);
    expect(F.last).toBe(4);
    const b = F.baseline(0);
    expect(b.mean).toBeCloseTo(0.21, 12);
    expect(b.median).toBeCloseTo(0.21, 12);
    expect(b.hit).toBe(1);
    expect(b.meanLog).toBeCloseTo(2 * Math.log(1.1), 12);
  });
  it("holds its level when the condition is persistent and the windows overlap, where a naive t-test does not", () => {
    // Returns are unpredictable; the condition is a slow regime that has nothing to do with them.
    let hodrick = 0;
    let naive = 0;
    const N = 300;
    const h = 20;
    for (let s = 0; s < N; s++) {
      const r = normals(1000 + s, 1500).map((v) => 0.0004 + 0.015 * v);
      const { tr, lr } = index(r);
      const u = rng(5000 + s);
      const flag = new Uint8Array(tr.length);
      let state = 0;
      for (let i = 0; i < flag.length; i++) {
        if (u() < 0.02) state = 1 - state; // regimes last about 50 days
        flag[i] = state;
      }
      const F = new ForwardReturns(tr, h);
      const t = forwardTest(F, lr, flag, 0);
      if (!t) continue;
      if (t.p < 0.05) hodrick++;
      // the textbook mistake: treat every overlapping window as an independent observation
      const xs: number[] = [];
      for (let k = 0; k <= F.last; k++) if (flag[k]) xs.push(F.F[k]);
      const z = (mean(xs) - t.meanAllLog) / (sd(xs) / Math.sqrt(xs.length));
      if (zTwoSided(z) < 0.05) naive++;
    }
    expect(hodrick / N).toBeLessThan(0.08);
    expect(hodrick / N).toBeGreaterThan(0.02);
    expect(naive / N).toBeGreaterThan(0.4);
  });
  it("finds an effect that is really there", () => {
    let found = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      const e = normals(2000 + s, 2000);
      const u = rng(9000 + s);
      const flag = new Uint8Array(2001);
      const r = new Float64Array(2000);
      let state = 0;
      for (let i = 0; i < 2000; i++) {
        if (u() < 0.02) state = 1 - state;
        flag[i] = state;
        // the day after a flagged close earns 0.15% more on average
        r[i] = 0.0002 + (state ? 0.0015 : 0) + 0.012 * e[i];
      }
      const { tr, lr } = index(r);
      const t = forwardTest(new ForwardReturns(tr, 5), lr, flag, 0, { bootstrap: 400, seed: s + 1 })!;
      if (t.p < 0.05 && t.excess > 0 && t.ci && t.ci[0] > 0) found++;
    }
    expect(found / N).toBeGreaterThan(0.7);
  });
  it("splits the sample in halves and refuses samples that are too short", () => {
    const r = normals(8, 400).map((v) => 0.012 * v);
    const { tr, lr } = index(r);
    const flag = Uint8Array.from({ length: tr.length }, (_, i) => (i % 4 === 0 ? 1 : 0));
    const t = forwardTest(new ForwardReturns(tr, 5), lr, flag, 0)!;
    expect(t.halves[0]).not.toBeNull();
    expect(t.halves[1]).not.toBeNull();
    expect(t.ci).toBeNull(); // no bootstrap asked for
    expect(forwardTest(new ForwardReturns(tr.slice(0, 50), 20), lr, flag, 0)).toBeNull();
    expect(forwardTest(new ForwardReturns(tr, 5), lr, new Uint8Array(tr.length), 0)).toBeNull(); // never true
    expect(forwardTest(new ForwardReturns(tr, 5), lr, new Uint8Array(tr.length).fill(1), 0)).toBeNull(); // always true
  });
});
