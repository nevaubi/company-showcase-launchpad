import { describe, expect, it } from "vitest";
import { adjustedT, finalize, overlapLag, variantPartial, type DailyAgg, type Regime, type VariantProof } from "./backtest";
import { buildEvidence, EVIDENCE, LISTED, liveCheck, monthlyBlocks, priorScale } from "./evidence";
import { variantMeta, type LiveRecord, type VariantMeta } from "./setups";
import { bhFdr, bhQ, expectedMaxZ, hacSe, tCdf, tHac } from "./stats";
import { STRATEGIES } from "./strategies";
import { parseRealVariants, realVariants } from "./variants-real.fixture";

// Deterministic pseudo-random numbers.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** Every variant the engine tries: 46, as in production. */
const KEYS = STRATEGIES.flatMap((s) => s.sides.flatMap((side) => s.horizons.map((h) => `${s.id}:${side > 0 ? "L" : "S"}:${h}`)));
const monthOf = (k: number) => `${2022 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
const NO_REGIMES = { "Up, calm": { n: 0, avgNet: null }, "Up, stressed": { n: 0, avgNet: null }, "Down, calm": { n: 0, avgNet: null }, "Down, stressed": { n: 0, avgNet: null } } as VariantProof["regimes"];

/** A variant whose months since January 2022 averaged `monthly` (net return per trade, one value a month). */
function variant(key: string, monthly: number[], over: Partial<VariantProof> & { live?: LiveRecord } = {}): VariantMeta {
  let cum = 0;
  const curve = monthly.map((x, k) => [monthOf(k), (cum += x)] as [string, number]);
  const split = { n: 5000, days: 1000, avgNet: 0, avgGross: 0, avgExSpy: 0, hit: 0.5, t: 0, sharpe: 0, skew: 0, kurt: 3 };
  const { live, ...rest } = over;
  return variantMeta({ key, inSample: split, outSample: split, regimes: NO_REGIMES, years: [], curve, maxDrawdown: 0, dsr: 0, fdr: false, passed: false, failed: [], ...rest }, live);
}

/** All 46 variants with monthly averages of pure noise (sd 1% a month), plus a true mean for the keys in `real` (in sds). */
function universe(seed: number, real: Record<string, number> = {}, months = 59): VariantMeta[] {
  const r = rng(seed);
  return KEYS.map((key) => variant(key, Array.from({ length: months }, () => (real[key] ?? 0) * 0.01 + 0.01 * gauss(r))));
}

describe("standard errors when trades overlap", () => {
  it("matches a hand-computed Newey-West case, on a regular and an irregular grid", () => {
    // x = 1, 2, 3, 4: deviations -1.5, -0.5, 0.5, 1.5, sum of squares 5.
    expect(hacSe([1, 2, 3, 4], 0)).toBeCloseTo(Math.sqrt(5 / 12), 12);
    // Lag 1: neighbours' products 0.75 - 0.25 + 0.75 = 1.25, weight 1/2, twice: 5 + 1.25 = 6.25.
    expect(hacSe([1, 2, 3, 4], 1)).toBeCloseTo(Math.sqrt(6.25 / 12), 12);
    // Days 0, 1, 3, 4: the middle pair is two days apart and drops out: 5 + 2 * 0.5 * 1.5 = 6.5.
    expect(hacSe([1, 2, 3, 4], 1, [0, 1, 3, 4])).toBeCloseTo(Math.sqrt(6.5 / 12), 12);
    // Lag 2 on the regular grid adds the pairs two apart, (-1.5)(0.5) + (-0.5)(1.5) = -1.5, at weight 1/3:
    // 5 + 2 * (2/3 * 1.25 + 1/3 * -1.5) = 5.6667.
    expect(hacSe([1, 2, 3, 4], 2)).toBeCloseTo(Math.sqrt((5 + 2 * ((2 / 3) * 1.25 - 0.5)) / 12), 12);
  });

  it("recovers the true error of overlapping five-day sums that the plain formula understates", () => {
    const r = rng(21);
    const e = Array.from({ length: 6004 }, () => gauss(r));
    const h = 5;
    const x = Array.from({ length: 6000 }, (_, t) => e[t] + e[t + 1] + e[t + 2] + e[t + 3] + e[t + 4]);
    // The mean of n overlapping sums of h unit shocks has variance about h^2 / n; the plain formula says h / n.
    const truth = h / Math.sqrt(x.length);
    expect(hacSe(x, 0) / truth).toBeLessThan(0.5);
    expect(hacSe(x, overlapLag(h)) / truth).toBeGreaterThan(0.8);
    expect(hacSe(x, overlapLag(h)) / truth).toBeLessThan(1.1);
    expect(Math.abs(tHac(x, overlapLag(h)))).toBeLessThan(Math.abs(tHac(x, 0)));
  });

  it("stores an overlap-corrected t beside the plain one and judges the gate on the smaller", () => {
    const r = rng(5);
    const dates = Array.from({ length: 1300 }, (_, i) => new Date(Date.UTC(2021, 9, 1) + i * 864e5).toISOString().slice(0, 10));
    const regime = dates.map((_, i) => (i % 2 ? "Up, calm" : "Down, stressed") as Regime);
    const e = Array.from({ length: 1320 }, () => gauss(r));
    // One trade a day whose return is a ten-day moving sum: neighbouring days share nine tenths of it.
    const days: DailyAgg[] = dates.map((_, i) => {
      let s = 0;
      for (let k = 0; k < 10; k++) s += e[i + k];
      const net = 0.0011 + 0.002 * s;
      return { i, n: 1, net, ex: net, gross: net, hits: net > 0 ? 1 : 0 };
    });
    const p = variantPartial("reversal:L:10", days, dates, regime);
    const o = p.outSample;
    expect(o.t!).toBeGreaterThan(2);
    expect(o.tHac!).toBeLessThan(o.t! / 2);
    expect(adjustedT(o)).toBe(o.tHac);
    // A result stored before the correction existed is read as it was.
    expect(adjustedT({ t: 2.4 })).toBe(2.4);
    const v = finalize([p])[0];
    expect(v.failed.some((f) => f.startsWith("Not statistically significant"))).toBe(true);
    // Without overlap (a one-day hold) the two agree.
    const one = variantPartial("gap:L:1", days, dates, regime).outSample;
    expect(one.tHac).toBe(one.t);
  });

  it("Student's t and Benjamini-Hochberg q-values agree with tables and with the existing rule", () => {
    expect(tCdf(2.086, 20)).toBeCloseTo(0.975, 4);
    expect(tCdf(-2.228, 10)).toBeCloseTo(0.025, 4);
    expect(1 - tCdf(3, 24)).toBeCloseTo(0.00311, 4);
    expect(tCdf(1.96, 1e6)).toBeCloseTo(0.975, 4);
    const p = [0.001, 0.008, 0.039, 0.041, 0.6];
    // m p / rank: 0.005, 0.02, 0.065, 0.05125, 0.6, then the running minimum from the right.
    expect(bhQ(p).map((x) => +x.toFixed(5))).toEqual([0.005, 0.02, 0.05125, 0.05125, 0.6]);
    for (const level of [0.01, 0.05, 0.06, 0.2]) expect(bhQ(p).map((x) => x <= level)).toEqual(bhFdr(p, level));
    expect(expectedMaxZ(46)).toBeCloseTo(2.24, 2);
  });
});

describe("month-by-month record", () => {
  it("reads monthly averages off the stored running sum and leaves the earlier years out", () => {
    const monthly = [0.01, -0.005, 0.02, 0, 0.005, -0.01, 0.015, 0.01, -0.005, 0.02, 0.005, 0.01];
    let cum = 0.5; // whatever happened before 2022 is already in the running sum
    const curve: [string, number][] = [["2021-11", 0.3], ["2021-12", 0.5], ...monthly.map((x, k) => [monthOf(k), (cum += x)] as [string, number])];
    const b = monthlyBlocks(curve, 5)!;
    expect(b.months).toBe(12);
    expect(b.mean).toBeCloseTo(0.075 / 12, 12);
    expect(b.positive).toBe(8);
    // Sum of squares 0.001525 less 12 * 0.00625^2, over 11.
    expect(b.sd).toBeCloseTo(Math.sqrt((0.001525 - 12 * 0.00625 ** 2) / 11), 10);
    expect(b.se).toBeGreaterThanOrEqual(b.sd / Math.sqrt(12) - 1e-15);
    expect(monthlyBlocks(curve.slice(0, 9), 5)).toBeNull(); // seven months since 2022 is not a record
  });

  it("widens the error when months move together and never narrows it when they alternate", () => {
    const r = rng(3);
    let prev = 0;
    const trending = Array.from({ length: 60 }, () => (prev = 0.7 * prev + 0.01 * gauss(r)));
    const b = monthlyBlocks(variant("pead:L:40", trending).curve, 40)!;
    expect(b.se).toBeGreaterThan((b.sd / Math.sqrt(60)) * 1.3);
    expect(b.nEff).toBeLessThan(40);
    const zigzag = Array.from({ length: 60 }, (_, k) => 0.002 + (k % 2 ? 0.01 : -0.01));
    const z = monthlyBlocks(variant("pead:L:40", zigzag).curve, 40)!;
    expect(z.se).toBeCloseTo(z.sd / Math.sqrt(60), 12);
  });
});

describe("shrinkage toward zero", () => {
  it("finds no spread of real edges in noise and about the right one when edges are real", () => {
    const r = rng(9);
    const noise = Array.from({ length: 400 }, (_, k) => ({ group: `g${k}`, z: gauss(r), n: 60 }));
    const none = priorScale(noise, true);
    expect(Math.abs(none.raw)).toBeLessThan(3 * none.se);
    expect(none.value).toBe(0);
    // True information ratio sd 0.3 a month over 60 months: t = effect * sqrt(60) + noise.
    const real = Array.from({ length: 400 }, (_, k) => ({ group: `g${k}`, z: 0.3 * gauss(r) * Math.sqrt(60) + gauss(r), n: 60 }));
    const some = priorScale(real, true);
    expect(some.raw).toBeGreaterThan(0.06);
    expect(some.raw).toBeLessThan(0.12);
    expect(some.value).toBeGreaterThan(0);
    expect(some.value).toBeLessThan(some.raw);
    // Two holding periods of one rule count once.
    const twins = priorScale([...real.slice(0, 50), ...real.slice(0, 50)], true);
    expect(twins.groups).toBe(priorScale(real.slice(0, 50), true).groups);
  });

  it("keeps more of the average the more months stand behind it", () => {
    // Half the rules have a real edge of 0.45 monthly sds; one of them has only two years of record.
    const real = Object.fromEntries(KEYS.filter((_, k) => k % 2 === 0).map((k) => [k, 0.45]));
    const vs = universe(4, real).map((v) => (v.key === "insider:L:20" ? variant(v.key, universe(4, real, 24).find((x) => x.key === v.key)!.curve.map((p, k, a) => p[1] - (k ? a[k - 1][1] : 0))) : v));
    const book = buildEvidence(vs, "Up, calm", "2026-11-20");
    expect(book.prior.value).toBeGreaterThan(0);
    const long = book.byKey.get("insider:L:40")!, short = book.byKey.get("insider:L:20")!;
    expect(long.blocks!.months).toBe(59);
    expect(short.blocks!.months).toBe(24);
    const pooled = (e: typeof long) => (book.prior.value * e.blocks!.nEff) / (1 + book.prior.value * e.blocks!.nEff);
    expect(pooled(long)).toBeGreaterThan(pooled(short));
    for (const e of book.variants) {
      expect(e.kept).toBeGreaterThanOrEqual(0);
      expect(e.kept).toBeLessThan(1);
      // The edge is the kept share of the monthly average, never more.
      expect(Math.abs(e.base)).toBeLessThanOrEqual(Math.abs(e.blocks!.mean) + 1e-15);
    }
  });

  it("lists nothing when every record is noise, in nearly every universe", () => {
    let withAny = 0, listed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const book = buildEvidence(universe(seed), "Up, calm", "2026-11-20");
      const n = book.variants.filter((e) => LISTED.includes(e.grade)).length;
      if (n) withAny++;
      listed += n;
      // Nothing is kept of a record that luck explains.
      for (const e of book.variants) if (e.blocks!.t < book.discovery.expectedBestT && book.prior.value === 0) expect(e.edge).toBe(0);
    }
    // False-discovery control at 10%: at most about one universe in ten lists anything at all.
    expect(withAny).toBeLessThanOrEqual(30);
    expect(listed / 200).toBeLessThan(0.25);
  });

  it("lists rules with a real edge and few others", () => {
    const real = { "insider:L:20": 0.55, "pead:L:20": 0.55, "stressRev:L:5": 0.55 };
    let found = 0, extra = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const book = buildEvidence(universe(seed, real), "Up, calm", "2026-11-20");
      for (const e of book.variants) {
        if (!LISTED.includes(e.grade)) continue;
        if (e.key in real) {
          found++;
          expect(e.edge).toBeGreaterThan(0);
          expect(e.edge).toBeLessThan(e.blocks!.mean);
        } else extra++;
      }
    }
    expect(found / 300).toBeGreaterThan(0.85);
    // No more than about one listed rule in ten is luck.
    expect(extra / (found + extra)).toBeLessThan(0.2);
  });

  it("needs two years of months and a positive record", () => {
    const strong = Array.from({ length: 18 }, (_, k) => 0.02 + (k % 2 ? 0.004 : -0.004));
    const vs = [...universe(7).filter((v) => v.key !== "custMom:L:21"), variant("custMom:L:21", strong)];
    const e = buildEvidence(vs, "Up, calm", "2026-11-20").byKey.get("custMom:L:21")!;
    expect(e.blocks!.t).toBeGreaterThan(10);
    expect(e.grade).toBe("unproven");
    expect(e.reason).toBe("Only 18 months with trades since 2022");
    const loser = buildEvidence(universe(7, { "gap:S:1": -0.8 }), "Up, calm", "2026-11-20").byKey.get("gap:S:1")!;
    expect(loser.grade).toBe("unproven");
    expect(loser.reason).toBe("Does not make money after costs since 2022");
    expect(loser.q).toBeGreaterThan(0.99);
  });
});

describe("today's regime", () => {
  const cells = (up: number, down: number) => ({ "Up, calm": { n: 4000, avgNet: up }, "Up, stressed": { n: 0, avgNet: null }, "Down, calm": { n: 20, avgNet: 0.004 }, "Down, stressed": { n: 4000, avgNet: down } }) as VariantProof["regimes"];

  it("leaves the edge alone when regimes differ by no more than noise", () => {
    const r = rng(12);
    // Monthly sd 1%; a regime with half the trades over 59 months is worth about 15 months, so its average
    // wobbles by about 0.26% from luck alone. These regimes differ by less than that.
    const vs = universe(12).map((v) => ({ ...v, regimes: cells(0.0018 * gauss(r), 0.0018 * gauss(r)) }));
    const book = buildEvidence(vs, "Down, stressed", "2026-11-20");
    expect(book.regimePrior.value).toBe(0);
    for (const e of book.variants) expect(e.regime!.adjust).toBe(0);
  });

  it("moves the edge toward a regime that really differs, by less than the raw difference, and ignores thin regimes", () => {
    const real = { "insider:L:20": 0.6 };
    // Every rule earns 1.5% more per trade in falling, stressed markets than in calm rising ones.
    const vs = universe(15, real).map((v) => ({ ...v, regimes: cells(-0.0075, 0.0075) }));
    const down = buildEvidence(vs, "Down, stressed", "2026-11-20");
    const up = buildEvidence(vs, "Up, calm", "2026-11-20");
    expect(down.regimePrior.value).toBeGreaterThan(0);
    const d = down.byKey.get("insider:L:20")!, u = up.byKey.get("insider:L:20")!;
    expect(d.regime!.deviation).toBeCloseTo(0.0075, 4);
    expect(d.regime!.adjust).toBeGreaterThan(0);
    expect(d.regime!.adjust).toBeLessThan(0.0075);
    expect(d.edge).toBeCloseTo(d.base + d.regime!.adjust, 12);
    expect(u.edge).toBeLessThan(u.base);
    // A rule that would be listed is not when its edge in today's market is negative.
    expect(LISTED.includes(d.grade)).toBe(true);
    expect(u.edge < 0 ? u.grade : "unproven").toBe("unproven");
    // 20 trades in "Down, calm" is below the 30 the gate asks for: no opinion there.
    expect(d.regimes.some((f) => f.regime === "Down, calm")).toBe(false);
    expect(buildEvidence(vs, "Down, calm", "2026-11-20").byKey.get("insider:L:20")!.regime).toBeNull();
  });
});

describe("probation", () => {
  const real = { "rsi2:L:3": 0.9 };
  const withLive = (live: LiveRecord) => universe(31, real).map((v) => (v.key === "rsi2:L:3" ? { ...v, live } : v));

  it("counts independent holding periods, not signals", () => {
    // First live signal Mon 2 Nov; by Fri 20 Nov there are 14 weekdays after it; a 3-day hold fired
    // on or before 17 Nov has finished: 12 signal days, four holding periods end to end.
    const c = liveCheck({ live: { n: 400, avgNet: -0.02, avgExSpy: -0.02, hit: 0.3, since: "2026-11-02" }, horizon: 3 }, 0.004, 0.01, "2026-11-20");
    expect(c.blocks).toBe(4);
    // Monthly sd 1% over 12 trading days: 1% * sqrt(21 / 12).
    expect(c.band).toBeCloseTo(1.96 * 0.01 * Math.sqrt(21 / 12), 10);
    expect(c.z).toBeCloseTo((-0.02 - 0.004) / (0.01 * Math.sqrt(21 / 12)), 10);
    expect(c.verdict).toBe("short");
    expect(liveCheck({ live: { n: 0, avgNet: null, avgExSpy: null, hit: null, since: null }, horizon: 3 }, 0.004, 0.01, "2026-11-20").verdict).toBe("none");
  });

  it("leaves a rule listed while its live record is too short to judge", () => {
    const e = buildEvidence(withLive({ n: 190, avgNet: -0.03, avgExSpy: -0.03, hit: 0.3, since: "2026-11-16" }), "Up, calm", "2026-11-20").byKey.get("rsi2:L:3")!;
    expect(e.live.verdict).toBe("short");
    expect(LISTED.includes(e.grade)).toBe(true);
  });

  it("demotes a rule whose live record contradicts its backtest once there is enough of it", () => {
    // Since 1 Sep: 58 weekdays to 20 Nov, 56 signal days that could have finished, 19 three-day holds.
    const behind = buildEvidence(withLive({ n: 900, avgNet: -0.02, avgExSpy: -0.02, hit: 0.4, since: "2026-09-01" }), "Up, calm", "2026-11-20").byKey.get("rsi2:L:3")!;
    expect(behind.live.blocks).toBeGreaterThanOrEqual(EVIDENCE.liveMinBlocks);
    expect(behind.live.z!).toBeLessThan(EVIDENCE.liveZ);
    expect(behind.live.verdict).toBe("behind");
    expect(behind.grade).toBe("probation");
    expect(behind.reason).toBe("Live record is well below its backtest");
    // The same length of record close to the backtest keeps its grade.
    const fine = buildEvidence(withLive({ n: 900, avgNet: 0.004, avgExSpy: 0.004, hit: 0.52, since: "2026-09-01" }), "Up, calm", "2026-11-20").byKey.get("rsi2:L:3")!;
    expect(fine.live.verdict).toBe("in line");
    expect(LISTED.includes(fine.grade)).toBe(true);
    // A small loss inside the range the backtest allows is not a contradiction. Since 21 Oct: 22 weekdays,
    // 20 signal days that could have finished, seven three-day holds: enough to judge, and a wide range.
    const dip = buildEvidence(withLive({ n: 900, avgNet: -0.003, avgExSpy: -0.003, hit: 0.48, since: "2026-10-21" }), "Up, calm", "2026-11-20").byKey.get("rsi2:L:3")!;
    expect(dip.live.blocks).toBe(7);
    expect(dip.live.z!).toBeGreaterThan(EVIDENCE.liveZ);
    expect(dip.live.z!).toBeLessThan(0);
    expect(dip.live.verdict).toBe("in line");
  });
});

describe("production record of 20 Nov 2026", () => {
  const rows = parseRealVariants();
  const vs = realVariants();

  it("re-applies the strict gate to the stored statistics and gets what production stored", () => {
    expect(rows).toHaveLength(46);
    for (const r of rows) {
      const v = vs.find((x) => x.key === r.partial.key)!;
      expect(v.passed).toBe(r.stored.passed);
      expect(v.fdr).toBe(r.stored.fdr);
      expect(Math.abs((v.dsr ?? 0) - (r.stored.dsr ?? 0))).toBeLessThan(2e-5);
    }
    expect(vs.filter((v) => v.passed)).toHaveLength(0);
  });

  it("cuts the best stored t-statistics down once months replace overlapping days", () => {
    const book = buildEvidence(vs, "Down, stressed", "2026-11-20");
    const e = (k: string) => book.byKey.get(k)!;
    // High-volume attention, long, 20 days: stored t 2.52 over 1,096 signal days.
    expect(e("volPremium:L:20").tStored).toBeCloseTo(2.51753, 5);
    expect(e("volPremium:L:20").blocks!.months).toBe(58);
    expect(e("volPremium:L:20").blocks!.mean).toBeCloseTo(0.00667, 5);
    expect(e("volPremium:L:20").blocks!.t).toBeCloseTo(1.88, 2);
    // Pre-earnings run-up: 2.28 stored, 0.90 by months. Insider buying, 20 days: 2.28 and 1.24.
    expect(e("earnRunup:L:6").blocks!.t).toBeCloseTo(0.9, 2);
    expect(e("insider:L:20").blocks!.t).toBeCloseTo(1.24, 2);
    // The short-selling flow shorts lose money reliably either way.
    expect(e("shortFlow:S:5").blocks!.t).toBeLessThan(-3.5);
  });

  it("finds nothing that can be told apart from luck", () => {
    const book = buildEvidence(vs, "Down, stressed", "2026-11-20");
    const d = book.discovery;
    expect(d.tested).toBe(46);
    expect(d.expectedBestT).toBeCloseTo(2.24, 2);
    expect(d.bestKey).toBe("custMom:L:21");
    expect(d.bestT!).toBeCloseTo(1.97, 2);
    expect(d.bestT!).toBeLessThan(d.expectedBestT);
    expect(d.atSingleBar).toBe(3);
    expect(d.expectedAtSingleBar).toBeCloseTo(2.3, 5);
    expect(d.firstBarT).toBeCloseTo(2.85, 2);
    expect(book.variants.filter((e) => LISTED.includes(e.grade))).toHaveLength(0);
    expect(Math.min(...book.variants.map((e) => e.q))).toBeCloseTo(0.706, 2);
    // The spread of real edges is within one standard error of zero, and regimes add nothing.
    expect(book.prior.raw).toBeLessThan(book.prior.se);
    expect(book.prior.value).toBe(0);
    expect(book.regimePrior.value).toBe(0);
    expect(book.variants.every((e) => e.edge === 0)).toBe(true);
    // The live record is two signal days long: nothing can be demoted on it.
    expect(book.byKey.get("rsi2:L:3")!.live).toMatchObject({ n: 190, blocks: 1, verdict: "short" });
  });
});
