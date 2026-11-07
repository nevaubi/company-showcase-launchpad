import { describe, expect, it } from "vitest";
import { niceTicks, ols, percentileOfRank, quantileSorted, rowsOf, type CrossFile } from "./cross";

describe("cross-section helpers", () => {
  it("fits OLS and correlation", () => {
    const f = ols([1, 2, 3, 4], [3, 5, 7, 9]);
    expect(f.b).toBeCloseTo(2);
    expect(f.a).toBeCloseTo(1);
    expect(f.r).toBeCloseTo(1);
    expect(ols([1, 2, 3], [3, 2, 1]).r).toBeCloseTo(-1);
    expect(Number.isNaN(ols([1], [2]).b)).toBe(true);
  });
  it("interpolates quantiles", () => {
    const xs = [0, 10, 20, 30, 40];
    expect(quantileSorted(xs, 0.5)).toBe(20);
    expect(quantileSorted(xs, 0.125)).toBe(5);
    expect(quantileSorted(xs, 1)).toBe(40);
  });
  it("turns ranks into percentiles", () => {
    expect(percentileOfRank(1, 11)).toBe(1);
    expect(percentileOfRank(11, 11)).toBe(0);
    expect(percentileOfRank(6, 11)).toBeCloseTo(0.5);
    expect(percentileOfRank(1, 1)).toBe(1);
  });
  it("makes round ticks", () => {
    expect(niceTicks(-0.86, 3.7, 6)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(-0.99, 4.18, 6)).toEqual([0, 2, 4]);
    expect(niceTicks(0.012, 0.087, 6)).toEqual([0.02, 0.04, 0.06, 0.08]);
  });
  it("maps column arrays to rows", () => {
    const X = {
      cols: ["sym", "sector", "kind", "r63"],
      rows: [["A", "Tech", "stock", 0.1]],
    } as unknown as CrossFile;
    expect(rowsOf(X)[0]).toEqual({ sym: "A", sector: "Tech", kind: "stock", r63: 0.1 });
  });
});
