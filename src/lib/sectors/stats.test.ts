import { describe, expect, it } from "vitest";
import { compareNullable, distribution, median, percentileRanks, positiveMedian, quantileSorted, ranks, shareOf, sortBy } from "./stats";

describe("median", () => {
  it("skips missing values", () => {
    // 1, 3, 7 → 3; nulls, undefined and NaN are not zeros
    expect(median([7, null, 1, undefined, Number.NaN, 3])).toBe(3);
  });
  it("averages the middle pair for an even count", () => {
    expect(median([4, 1, 10, 2])).toBe(3); // (2 + 4) / 2
  });
  it("is null when nothing is known", () => {
    expect(median([null, undefined])).toBeNull();
    expect(median([])).toBeNull();
  });
  it("positive median ignores losses", () => {
    // P/E of 12, 20, −5 (a loss), 0 → median of 12 and 20 = 16
    expect(positiveMedian([12, 20, -5, 0])).toBe(16);
  });
});

describe("quantiles", () => {
  it("interpolates between ranks (type 7)", () => {
    const s = [1, 2, 3, 4];
    expect(quantileSorted(s, 0.25)).toBeCloseTo(1.75); // h = 0.75 → 1 + 0.75
    expect(quantileSorted(s, 0.75)).toBeCloseTo(3.25);
    expect(quantileSorted([5], 0.9)).toBe(5);
  });
});

describe("breadth share", () => {
  it("divides by known members only", () => {
    const s = shareOf([true, false, null, true, undefined, true]);
    expect(s).toMatchObject({ hits: 3, known: 4, total: 6 });
    expect(s.share).toBe(0.75);
  });
  it("flags a group with few known members as thin", () => {
    const s = shareOf([true, true, false]);
    expect(s.share).toBeCloseTo(2 / 3);
    expect(s.thin).toBe(true);
    expect(shareOf([true, true, false, false, true]).thin).toBe(false);
  });
  it("has no share when no member is known", () => {
    expect(shareOf([null, null]).share).toBeNull();
  });
});

describe("ranks", () => {
  it("gives ties the same competition rank and skips the next", () => {
    expect(ranks([10, 30, 30, 20, null])).toEqual([4, 1, 1, 3, null]);
  });
  it("ranks ascending when asked (cheapest first)", () => {
    expect(ranks([15, 8, 8, 40], true)).toEqual([3, 1, 1, 4]);
  });
  it("percentile ranks count ties half and ignore missing values", () => {
    // values 1, 2, 2, 3: below/equal → 0, (1 + 0.5)/3, (1 + 0.5)/3, 1
    expect(percentileRanks([1, 2, 2, 3, null])).toEqual([0, 0.5, 0.5, 1, null]);
    expect(percentileRanks([4])).toEqual([null]);
  });
});

describe("distribution", () => {
  it("gives quartiles, the median and the plotted range", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, null].map((v, i) => ({ id: i, v }));
    const d = distribution(items, (x) => x.v);
    expect(d.n).toBe(9);
    expect(d.missing).toBe(1);
    expect(d.median).toBe(5);
    expect(d.q1).toBe(3);
    expect(d.q3).toBe(7);
    expect([d.lo, d.hi]).toEqual([1, 9]); // small groups plot their full range
    expect(d.points[0].v).toBe(1);
    expect(d.points.at(-1)!.pct).toBe(1);
  });
  it("pins extreme outliers to the edge in a large group", () => {
    const items = Array.from({ length: 40 }, (_, i) => i).concat([5000]);
    const d = distribution(items, (x) => x);
    expect(d.hi).toBeLessThan(5000);
    expect(d.points.find((p) => p.v === 5000)!.clipped).toBe(true);
    expect(d.points.find((p) => p.v === 20)!.clipped).toBe(false);
  });
  it("widens a range of one repeated value", () => {
    const d = distribution([0.1, 0.1], (x) => x);
    expect(d.lo).toBeLessThan(0.1);
    expect(d.hi).toBeGreaterThan(0.1);
  });
});

describe("sorting", () => {
  it("keeps missing values last in both directions", () => {
    const rows = [{ k: "a", v: 2 }, { k: "b", v: null }, { k: "c", v: 5 }, { k: "d", v: 2 }];
    expect(sortBy(rows, (r) => r.v, "desc", (r) => r.k).map((r) => r.k)).toEqual(["c", "a", "d", "b"]);
    expect(sortBy(rows, (r) => r.v, "asc", (r) => r.k).map((r) => r.k)).toEqual(["a", "d", "c", "b"]);
    expect(compareNullable("Banks", "Software", "asc")).toBeLessThan(0);
  });
});
