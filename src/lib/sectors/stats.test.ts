import { describe, expect, it } from "vitest";
import { compareNullable, distribution, ends, mean, median, percentileRanks, positiveMedian, quantileSorted, ranks, shareOf, sortBy } from "./stats";

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
  it("plots the 2nd to 98th percentile of a large group and its full range up to 20 values", () => {
    // 0..100: type-7 quantiles of 101 evenly spaced values are the values themselves
    const big = distribution(Array.from({ length: 101 }, (_, i) => i), (x) => x);
    expect([big.lo, big.hi]).toEqual([2, 98]);
    expect(big.points.filter((p) => p.clipped).map((p) => p.v)).toEqual([0, 1, 99, 100]);
    // exactly 20 values: nothing is pinned, even an outlier
    const small = distribution([...Array.from({ length: 19 }, (_, i) => i), 900], (x) => x);
    expect([small.lo, small.hi]).toEqual([0, 900]);
    expect(small.points.some((p) => p.clipped)).toBe(false);
  });
  it("widens a range of one repeated value", () => {
    const d = distribution([0.1, 0.1], (x) => x);
    expect(d.lo).toBeLessThan(0.1);
    expect(d.hi).toBeGreaterThan(0.1);
  });
});

describe("highest and lowest lists", () => {
  const pts = (vals: number[]) => distribution(vals.map((v, i) => ({ id: `T${String(i).padStart(2, "0")}`, v })), (x) => x.v).points;
  const id = (x: { id: string }) => x.id;
  it("takes five from each end of a group of twelve, never the same company twice", () => {
    const e = ends(pts([5, 1, 9, 3, 12, 7, 2, 11, 4, 10, 6, 8]), id);
    expect(e.all).toBeNull();
    expect(e.top.map((p) => p.v)).toEqual([12, 11, 10, 9, 8]);
    expect(e.bottom.map((p) => p.v)).toEqual([1, 2, 3, 4, 5]);
    expect(e.top.some((p) => e.bottom.includes(p))).toBe(false);
  });
  it("gives one ranked list when fewer than ten values are known", () => {
    // a group of seven: five from each end would list three companies twice
    const e = ends(pts([0.05, 0.064, 0.075, 0.086, 0.135, 0.2, 0.3]), id);
    expect(e.all!.map((p) => p.v)).toEqual([0.3, 0.2, 0.135, 0.086, 0.075, 0.064, 0.05]);
    expect(e.top).toEqual([]);
    expect(e.bottom).toEqual([]);
  });
  it("reports ties cut off at the fifth place and orders them by id", () => {
    // lowest five of twelve: −3, −2, −1.1, −1.1, −1.1 and a fourth −1.1 left out
    const e = ends(pts([-3, -2, -1.1, -1.1, -1.1, -1.1, 0, 1, 2, 3, 4, 5]), id);
    expect(e.bottom.map((p) => p.item.id)).toEqual(["T00", "T01", "T02", "T03", "T04"]);
    expect(e.bottomTied).toBe(1);
    expect(e.topTied).toBe(0);
  });
});

describe("mean", () => {
  it("averages the finite values only", () => {
    expect(mean([0.02, null, 0.04, Number.NaN])).toBeCloseTo(0.03);
    expect(mean([null])).toBeNull();
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
