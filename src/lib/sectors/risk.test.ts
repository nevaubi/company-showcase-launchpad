import { describe, expect, it } from "vitest";
import { tapeIndex } from "./breadth";
import { groupMarket, groupRisk, marketIndex } from "./risk";

const market = marketIndex({
  generatedAt: "2026-11-24T00:01:12.000Z",
  companies: [
    { ticker: "AAA", stats: { n: 11, avgAbsMove: 0.03 }, active: [{ kind: "breakout_52w", date: "2026-11-19", ago: 2 }, { kind: "volume_climax", date: "2026-11-20", ago: 1 }] },
    { ticker: "BBB", stats: { n: 9, avgAbsMove: 0.07 }, active: [{ kind: "death_cross", date: "2026-11-17", ago: 4 }] },
    { ticker: "CCC", stats: { n: 0, avgAbsMove: Number.NaN }, active: [] },
    { ticker: "DDD", stats: { n: 5, avgAbsMove: 0.05 }, active: [{ kind: "breakout_52w", date: "2026-11-20" }] },
  ] as never,
});

describe("markets file index", () => {
  it("keeps the build day, the size and the fields the pages use", () => {
    expect(market.asOf).toBe("2026-11-24");
    expect(market.size).toBe(4);
    expect(market.by.get("AAA")).toMatchObject({ prints: 11, avgAbsMove: 0.03 });
    expect(market.by.get("AAA")!.signals.map((s) => [s.label, s.bias, s.ago])).toEqual([["52-week breakout", "bullish", 2], ["Volume climax", "neutral", 1]]);
    expect(market.by.get("CCC")).toMatchObject({ prints: 0, avgAbsMove: null }); // no release measured: no move, not NaN
    expect(market.by.get("DDD")!.signals[0].ago).toBeNull();
  });
});

describe("group risk", () => {
  it("averages earnings moves over the members that have one and counts live signals", () => {
    const g = groupMarket(["AAA", "BBB", "CCC", "ZZZ"], market);
    expect(g.covered).toBe(3); // ZZZ is not in the file
    expect(g.earnings.n).toBe(2);
    expect(g.earnings.v).toBeCloseTo(0.05); // (3% + 7%) / 2; CCC has no measured release
    expect(g.signals).toMatchObject({ total: 3, companies: 2, bullish: 1, bearish: 1, neutral: 1 });
    expect(g.signals.kinds.map((k) => [k.label, k.n])).toEqual([["52-week breakout", 1], ["Death cross", 1], ["Volume climax", 1]]);
  });
  it("orders patterns by how many members show them", () => {
    const g = groupMarket(["AAA", "BBB", "DDD"], market);
    expect(g.signals.kinds[0]).toMatchObject({ label: "52-week breakout", n: 2, bias: "bullish" });
  });
  it("has no figure, and says zero covered, before the file loads", () => {
    const g = groupMarket(["AAA"], null);
    expect(g).toMatchObject({ covered: 0, earnings: { v: null, n: 0 }, signals: { total: 0, companies: 0 } });
  });
  it("takes the median beta and the median annualised volatility with their counts", () => {
    const beta = new Map<string, number | null>([["AAA", 1.4], ["BBB", 0.6], ["CCC", 1.1], ["DDD", null]]);
    const tape = tapeIndex([
      { tk: "AAA", vol60: 0.01, above200: null, near_high: null },
      { tk: "BBB", vol60: 0.03, above200: null, near_high: null },
      { tk: "CCC", vol60: null, above200: null, near_high: null },
    ]);
    const r = groupRisk(["AAA", "BBB", "CCC", "DDD"], { beta, tape, market });
    expect(r.members).toBe(4);
    expect(r.beta).toEqual({ v: 1.1, n: 3 }); // 0.6, 1.1, 1.4
    expect(r.vol.n).toBe(2);
    expect(r.vol.v).toBeCloseTo(0.02 * Math.sqrt(252)); // median daily 2%, × √252 = 31.7%
    expect(r.covered).toBe(4);
    expect(groupRisk(["AAA"], {})).toMatchObject({ beta: { v: null, n: 0 }, vol: { v: null, n: 0 } });
  });
});
