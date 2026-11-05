import { describe, expect, it } from "vitest";
import { composite, mostUnusual, ratioSeries, readAuctions, seriesStats, type Auction, type Point } from "./core";

const q = (vals: number[]): Point[] => vals.map((v, i) => [`${2020 + Math.floor(i / 4)}-${String((i % 4) * 3 + 3).padStart(2, "0")}-30`, v]);

describe("seriesStats", () => {
  it("flags a record high and computes y/y percent change for levels", () => {
    const s = seriesStats(q([1, 2, 3, 4, 5, 6, 7, 8, 10]), "U.S. dollars")!;
    expect(s.record).toBe("high");
    expect(s.percentile).toBe(100);
    expect(s.yearAgo![1]).toBe(5);
    expect(s.yoy!.pct).toBeCloseTo(100, 5);
  });
  it("uses absolute change for percent series", () => {
    const s = seriesStats(q([10, 10, 10, 10, 12]), "percent")!;
    expect(s.yoy).toEqual({ abs: 2 });
  });
});

it("ratioSeries only divides matching dates", () => {
  expect(ratioSeries([["a", 10], ["b", 9]], [["a", 2]])).toEqual([["a", 5]]);
});

it("composite signs inputs and needs two", () => {
  expect(composite([{ z: 2, sign: 1 }, { z: -1, sign: -1 }])).toBe(1.5);
  expect(composite([{ z: 2, sign: 1 }, { z: null, sign: 1 }])).toBeNull();
});

it("mostUnusual skips stale series", () => {
  const data = q([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 9]);
  const r = mostUnusual([{ m: "A", name: "A", unit: "", data }, { m: "B", name: "B", unit: "", data: data.map(([d, v]) => [d.replace("2023", "2019"), v] as Point) }], "2023-01-01");
  expect(r.map((x) => x.m)).toEqual(["A"]);
});

it("readAuctions grades an auction vs prior same-term auctions", () => {
  const base = (date: string, btc: number, indirect: number, dealer: number): Auction => ({ date, term: "10-Year", type: "Note", cusip: date, rate: 4, btc, indirect, direct: 15, dealer, amount: 1 });
  const r = readAuctions([base("2026-01-01", 2.5, 65, 15), base("2026-02-01", 2.5, 65, 15), base("2026-03-01", 2.5, 65, 15), base("2026-04-01", 2.2, 55, 25)]);
  expect(r[0].date).toBe("2026-04-01");
  expect(r[0].score).toBeCloseTo(-13, 5);
  expect(r[0].verdict).toBe("weak");
});
