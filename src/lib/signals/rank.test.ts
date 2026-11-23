import { describe, expect, it } from "vitest";
import type { Regime } from "./backtest";
import { buildEvidence, type BlockStats, type EvidenceBook, type Grade, type VariantEvidence } from "./evidence";
import { barsLookRight, compareSetups, crowd, DEFAULT_FILTERS, dollarVolumeOf, holdBucket, RANK_LIMITS, rankSetups, toSetup, type LiveSignal, type RankFilters } from "./rank";
import { parseVariantKey } from "./setups";
import { STRATEGY } from "./strategies";
import { realVariants } from "./variants-real.fixture";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const blocks = (mean: number, t: number): BlockStats => ({ months: 59, mean, sd: 0.01, se: 0.01 / Math.sqrt(59), t, positive: 35, nEff: 59 });

/** Evidence for one variant, written by hand so the ranking is tested on its own. */
function ev(key: string, grade: Grade, edge: number, t = 3.5, mean = 0.004): VariantEvidence {
  const k = parseVariantKey(key);
  return {
    key, ...k, family: STRATEGY[k.strategy].family, passed: grade === "proven", blocks: blocks(mean, t), tStored: t, p: 0.001, q: grade === "unproven" ? 0.7 : 0.03,
    kept: 0.5, base: edge, regimes: [], regime: null, edge, live: { n: 0, avgNet: null, avgExSpy: null, hit: null, since: null, blocks: 0, band: null, z: null, verdict: "none" },
    grade, reason: "",
  };
}

function book(variants: VariantEvidence[], regime: Regime = "Up, calm"): EvidenceBook {
  return {
    asOf: "2026-11-20", regime, variants, byKey: new Map(variants.map((e) => [e.key, e])),
    prior: { value: 0.01, raw: 0.02, se: 0.01, groups: 14 }, regimePrior: { value: 0, raw: 0, se: 0.01, groups: 46 },
    discovery: { tested: variants.length, expectedBestT: 2.24, firstBarT: 2.85, bestT: 3.5, bestKey: variants[0]?.key ?? null, atSingleBar: 1, expectedAtSingleBar: 2.3, proven: 0, candidates: 0, watch: 0, probation: 0 },
  };
}

const SECTORS = ["Energy", "Financials", "Health Care", "Industrials", "Information Technology", "Materials", "Utilities"];

function sig(ticker: string, variant: string, over: Partial<LiveSignal> = {}): LiveSignal {
  return { ticker, name: ticker, sector: "Energy", variant, firedAt: "2026-11-20", firstSeen: "2026-11-20", strength: 2, detail: "", price: 100, atr: 2, dv20: 2e8, cost: 0.0008, ...over };
}

describe("liquidity", () => {
  it("reads dollar volume off the stored figure, or off the cost tier when none is stored", () => {
    expect(dollarVolumeOf({ dv20: 3.2e7, cost: 0.0016 }, 1, 5)).toBe(3.2e7);
    expect(dollarVolumeOf({ dv20: null, cost: 0.0004 }, 1, 5)).toBe(5e8);
    expect(dollarVolumeOf({ dv20: null, cost: 0.0016 }, 1, 20)).toBe(2e7);
    // A short pays 3% a year to borrow on top of the round trip: 0.0016 + 0.03 * 20 / 252.
    expect(dollarVolumeOf({ dv20: null, cost: 0.0016 + (0.03 * 20) / 252 }, -1, 20)).toBe(2e7);
    expect(dollarVolumeOf({ dv20: null, cost: 0.003 }, 1, 5)).toBe(5e6);
    expect(dollarVolumeOf({ dv20: null, cost: null }, 1, 5)).toBeNull();
  });

  it("keeps thin stocks off the list unless the floor is lowered", () => {
    const b = book([ev("insider:L:20", "candidate", 0.004)]);
    const signals = [sig("BIG", "insider:L:20", { dv20: 9e8 }), sig("MID", "insider:L:20", { dv20: 3e7 }), sig("THIN", "insider:L:20", { dv20: 8e6, cost: 0.003 }), sig("OLD", "insider:L:20", { dv20: null, cost: 0.003 })];
    expect(rankSetups(b, signals).list.map((r) => r.ticker).sort()).toEqual(["BIG", "MID"]);
    const low: RankFilters = { ...DEFAULT_FILTERS, minDollarVolume: 5e6 };
    expect(rankSetups(b, signals, low).list).toHaveLength(4);
    expect(rankSetups(b, signals, { ...DEFAULT_FILTERS, minDollarVolume: 5e8 }).list.map((r) => r.ticker)).toEqual(["BIG"]);
  });
});

describe("broken price history", () => {
  it("keeps a row whose average daily range is impossible out of the ranked lists and flags it", () => {
    expect(barsLookRight(100, 2)).toBe(true);
    expect(barsLookRight(100, 39.9)).toBe(true);
    expect(barsLookRight(100, 40)).toBe(false);
    expect(barsLookRight(100, 0)).toBe(false);
    expect(barsLookRight(100, NaN)).toBe(false);
    // SanDisk on 20 Nov 2026 as stored: price 79.24 with a 14-day range of 137.87 (a bad series).
    const b = book([ev("insider:L:20", "candidate", 0.004), ev("volPremium:L:20", "unproven", 0)]);
    const signals = [sig("SNDK", "insider:L:20", { price: 79.24, atr: 137.869 }), sig("SNDK", "volPremium:L:20", { price: 79.24, atr: 137.869 }), sig("GOOD", "insider:L:20")];
    const r = rankSetups(b, signals);
    expect(r.list.map((x) => x.ticker)).toEqual(["GOOD"]);
    expect(r.closest.some((x) => x.ticker === "SNDK")).toBe(false);
    const flagged = r.all.filter((x) => x.ticker === "SNDK");
    expect(flagged).toHaveLength(2);
    expect(flagged.every((x) => !x.barsOk)).toBe(true);
    expect(r.all.find((x) => x.ticker === "GOOD")!.barsOk).toBe(true);
  });
});

describe("expected edge of one signal", () => {
  const b = book([ev("insider:L:20", "candidate", 0.004)]);

  it("charges a signal for trading costs above the rule's usual and gives no credit below", () => {
    const signals = [sig("A", "insider:L:20", { cost: 0.0004 }), sig("B", "insider:L:20", { cost: 0.0008 }), sig("C", "insider:L:20", { cost: 0.0016 }), sig("D", "insider:L:20", { cost: 0.0008 }), sig("E", "insider:L:20", { cost: 0.0008 })];
    const by = new Map(rankSetups(b, signals).all.map((r) => [r.ticker, r]));
    // Median cost 0.0008.
    expect(by.get("A")!.edge).toBeCloseTo(0.004, 12);
    expect(by.get("B")!.edge).toBeCloseTo(0.004, 12);
    expect(by.get("C")!.costPenalty).toBeCloseTo(0.0008, 12);
    expect(by.get("C")!.edge).toBeCloseTo(0.0032, 12);
  });

  it("drops a signal whose cost eats the whole edge", () => {
    const thin = book([ev("gap:L:1", "watch", 0.0005)]);
    const signals = [sig("A", "gap:L:1", { cost: 0.0004 }), sig("B", "gap:L:1", { cost: 0.0004 }), sig("C", "gap:L:1", { cost: 0.0016, dv20: 3e7 })];
    const out = rankSetups(thin, signals);
    expect(out.list.map((r) => r.ticker)).toEqual(["A", "B"]);
    expect(out.all.find((r) => r.ticker === "C")!.edge).toBeLessThan(0);
  });

  it("uses strength only to order signals of one rule, never to change the edge", () => {
    const signals = [sig("A", "insider:L:20", { strength: 2 }), sig("B", "insider:L:20", { strength: 5 }), sig("C", "insider:L:20", { strength: 3 })];
    const out = rankSetups(b, signals).list;
    expect(out.map((r) => r.ticker)).toEqual(["B", "C", "A"]);
    expect(out.map((r) => r.strengthPct)).toEqual([1, 0.5, 0]);
    expect(new Set(out.map((r) => r.edge)).size).toBe(1);
  });

  it("attaches the risk plan: stop and target from the average daily range", () => {
    const [r] = rankSetups(b, [sig("A", "insider:L:20", { price: 100, atr: 2 })]).list;
    // Event trades get 2.5 ranges of room and a target twice that.
    expect(r).toMatchObject({ stop: 95, target: 110, side: 1, horizon: 20 });
    expect(r.risk).toBeCloseTo(0.05, 12);
    expect(toSetup(r, [1, 2])).toMatchObject({ ticker: "A", key: "insider:L:20", proven: false, edge: 0.004, stop: 95, target: 110, spark: [1, 2] });
  });
});

describe("crowding control", () => {
  const variants = [ev("insider:L:20", "candidate", 0.006), ev("pead:L:20", "candidate", 0.005), ev("stressRev:L:5", "watch", 0.004), ev("volPremium:L:20", "watch", 0.003), ev("tsmom:L:21", "watch", 0.002), ev("rsi2:L:3", "unproven", 0, 1.2)];
  const b = book(variants);
  const many: LiveSignal[] = [];
  for (const v of variants) for (let k = 0; k < 30; k++) many.push(sig(`${v.key.slice(0, 3).toUpperCase()}${k}`, v.key, { sector: SECTORS[k % SECTORS.length], strength: 1 + (k % 7), dv20: 5e7 + k * 1e7 }));

  it("caps the list at twenty with at most five per rule and five per sector, one per ticker", () => {
    const { list, counts } = rankSetups(b, many);
    expect(list).toHaveLength(RANK_LIMITS.max);
    const count = (f: (r: (typeof list)[number]) => string) => Math.max(...[...list.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map<string, number>()).values()]);
    expect(count((r) => `${r.strategy}:${r.side}`)).toBeLessThanOrEqual(RANK_LIMITS.perRule);
    expect(count((r) => r.sector)).toBeLessThanOrEqual(RANK_LIMITS.perSector);
    expect(count((r) => r.ticker)).toBe(1);
    expect(counts.listed).toBe(150);
    // Better grades and larger edges come first.
    expect(list[0].key).toBe("insider:L:20");
    expect(list.every((r) => r.grade !== "unproven")).toBe(true);
  });

  it("gives a stock one row even when several rules fire on it", () => {
    const signals = [sig("XOM", "insider:L:20"), sig("XOM", "pead:L:20"), sig("XOM", "stressRev:L:5"), sig("CVX", "pead:L:20")];
    const { list, all } = rankSetups(b, signals);
    expect(list.map((r) => `${r.ticker} ${r.key}`)).toEqual(["XOM insider:L:20", "CVX pead:L:20"]);
    expect(all).toHaveLength(4);
  });

  it("shows two holding periods of one rule as one setup, on the better-evidenced one", () => {
    const twin = book([ev("insider:L:20", "candidate", 0.004), ev("insider:L:40", "candidate", 0.006)]);
    const out = rankSetups(twin, [sig("XOM", "insider:L:20"), sig("XOM", "insider:L:40")]);
    expect(out.all.map((r) => r.key)).toEqual(["insider:L:40"]);
  });

  it("keeps the latest firing when a rule fires on a stock several days running", () => {
    const out = rankSetups(b, [sig("XOM", "pead:L:20", { firedAt: "2026-11-18", strength: 9 }), sig("XOM", "pead:L:20", { firedAt: "2026-11-20", strength: 3 }), sig("XOM", "pead:L:20", { firedAt: "2026-11-19", strength: 5 })]);
    expect(out.all).toHaveLength(1);
    expect(out.all[0]).toMatchObject({ firedAt: "2026-11-20", strength: 3 });
    expect(out.counts).toMatchObject({ fired: 3, known: 3, filtered: 1 });
  });

  it("applies the limits to rows in the order given", () => {
    const rows = rankSetups(b, many).all;
    const tight = crowd(rows, { max: 6, perRule: 2, perSector: 1 });
    expect(tight).toHaveLength(6);
    expect(new Set(tight.map((r) => r.sector)).size).toBe(6);
  });
});

describe("ranking", () => {
  const variants = [ev("insider:L:20", "candidate", 0.006), ev("pead:S:20", "watch", 0.004), ev("stressRev:L:5", "proven", 0.002), ev("rsi2:L:3", "unproven", 0, 1.9), ev("gap:L:1", "unproven", 0, 0.4), ev("gap:S:1", "unproven", 0, -2, -0.002), ev("tsmom:L:21", "probation", 0.003)];
  const b = book(variants);
  const signals: LiveSignal[] = [];
  const r = rng(77);
  for (const v of variants) for (let k = 0; k < 12; k++) signals.push(sig(`${v.key.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase()}${k}`, v.key, { sector: SECTORS[Math.floor(r() * SECTORS.length)], strength: Math.round(r() * 50) / 10, dv20: 2e7 + Math.round(r() * 9e8), cost: [0.0004, 0.0008, 0.0016][Math.floor(r() * 3)] }));

  it("is the same whatever order the signals arrive in", () => {
    const want = rankSetups(b, signals);
    for (const seed of [1, 2, 3, 4, 5]) {
      const q = rng(seed);
      const shuffled = [...signals].map((s) => [q(), s] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
      const got = rankSetups(b, shuffled);
      expect(got.list.map((x) => x.id)).toEqual(want.list.map((x) => x.id));
      expect(got.closest.map((x) => x.id)).toEqual(want.closest.map((x) => x.id));
      expect(got.all.map((x) => x.id)).toEqual(want.all.map((x) => x.id));
    }
    // The comparator is a total order on distinct rows.
    const all = want.all;
    for (let i = 1; i < all.length; i++) expect(compareSetups(all[i - 1], all[i])).toBeLessThan(0);
  });

  it("puts proven rules first, then candidates, then watched rules, each by expected edge", () => {
    const { list } = rankSetups(b, signals);
    expect([...new Set(list.map((x) => x.grade))]).toEqual(["proven", "candidate", "watch"]);
    expect(list.some((x) => x.grade === "probation" || x.grade === "unproven")).toBe(false);
  });

  it("offers the next in line separately: rules with a positive record, closest to the bar first, none on probation", () => {
    const { list, closest, all } = rankSetups(b, signals);
    expect(closest).toHaveLength(RANK_LIMITS.max);
    expect(closest.slice(0, list.length).map((x) => x.id)).toEqual(list.map((x) => x.id));
    const rest = closest.slice(list.length);
    expect(rest.length).toBeGreaterThan(0);
    // Rules that are not listed rank by their t-statistic: 1.9 before 0.4; the losing rule never shows.
    expect(rest[0].key).toBe("rsi2:L:3");
    expect(closest.some((x) => x.key === "gap:S:1" || x.key === "tsmom:L:21")).toBe(false);
    expect(all.some((x) => x.key === "gap:S:1")).toBe(true);
    expect(all.some((x) => x.key === "tsmom:L:21")).toBe(true);
  });

  it("filters by side, holding period, family and sector before the limits apply", () => {
    const f = (over: Partial<RankFilters>) => rankSetups(b, signals, { ...DEFAULT_FILTERS, ...over });
    expect(f({ side: "short" }).list.every((x) => x.side === -1)).toBe(true);
    expect(f({ side: "short" }).list.length).toBeGreaterThan(0);
    expect(f({ hold: "week" }).list.every((x) => x.horizon <= 5)).toBe(true);
    expect(f({ hold: "month" }).all.every((x) => x.horizon >= 20)).toBe(true);
    expect(f({ family: "events" }).all.every((x) => x.family === "events")).toBe(true);
    expect(f({ sector: "Energy" }).all.every((x) => x.sector === "Energy")).toBe(true);
    expect([holdBucket(1), holdBucket(5), holdBucket(6), holdBucket(10), holdBucket(20), holdBucket(40)]).toEqual(["week", "week", "fortnight", "fortnight", "month", "month"]);
  });

  it("ignores variants it has no evidence for and rows without a price", () => {
    const out = rankSetups(b, [sig("XOM", "pairs:L:20"), sig("CVX", "insider:L:20", { price: 0 }), sig("OXY", "insider:L:20")]);
    expect(out.all.map((x) => x.ticker)).toEqual(["OXY"]);
    expect(out.counts).toMatchObject({ fired: 3, known: 1 });
  });
});

describe("the list on real statistics and on noise", () => {
  const live = (variants: string[], n: number) => variants.flatMap((v) => Array.from({ length: n }, (_, k) => sig(`T${k}`, v, { sector: SECTORS[k % SECTORS.length] })));

  it("is empty on the production record of 20 Nov 2026, with the closest rules still reachable", () => {
    const vs = realVariants();
    const b = buildEvidence(vs, "Down, stressed", "2026-11-20");
    const out = rankSetups(b, live(vs.map((v) => v.key), 40));
    expect(out.list).toEqual([]);
    expect(out.counts.listed).toBe(0);
    expect(out.closest).toHaveLength(RANK_LIMITS.max);
    // Closest first: customer momentum (t 1.97), high-volume attention (1.88), sector-adjusted overreaction (1.71).
    expect([...new Set(out.closest.map((x) => x.strategy))].slice(0, 3)).toEqual(["custMom", "volPremium", "residual"]);
    expect(out.closest.every((x) => x.edge === 0 && x.grade === "unproven")).toBe(true);
  });

  it("is empty or nearly empty when every strategy's record is pure noise", () => {
    const gauss = (q: () => number) => Math.sqrt(-2 * Math.log(q() + 1e-12)) * Math.cos(2 * Math.PI * q());
    const keys = realVariants().map((v) => v.key);
    let rows = 0, nonEmpty = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const q = rng(seed * 31);
      const noise = realVariants().map((v) => {
        let cum = 0;
        return { ...v, passed: false, curve: Array.from({ length: 59 }, (_, k) => [`${2022 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`, (cum += 0.01 * gauss(q))] as [string, number]) };
      });
      const out = rankSetups(buildEvidence(noise, "Up, calm", "2026-11-20"), live(keys, 40));
      rows += out.list.length;
      if (out.list.length) nonEmpty++;
    }
    // Where the old page showed up to 150 rows of near misses, noise now fills well under one row a day on average.
    expect(nonEmpty).toBeLessThanOrEqual(9);
    expect(rows / 60).toBeLessThan(1.5);
  });
});
