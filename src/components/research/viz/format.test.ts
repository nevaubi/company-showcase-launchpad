import { describe, expect, it } from "vitest";
import { compact, fmtValue, histogramBins, pctIsFraction, regression, toShares, waterfallBars } from "./format";

describe("viz formatting", () => {
  it("formats compact numbers, money, percents, multiples and bp", () => {
    expect(compact(96.2e9)).toBe("96.2B");
    expect(fmtValue(-1.5e6, "$")).toBe("-$1.5M");
    expect(fmtValue(0.125, "%")).toBe("12.5%");
    expect(fmtValue(12.5, "%")).toBe("12.5%");
    expect(fmtValue(0.04, "%", { sign: true })).toBe("+4.0%");
    expect(fmtValue(48.24, "x")).toBe("48.2x");
    expect(fmtValue(25.4, "bp")).toBe("25bp");
    expect(fmtValue(null, "$")).toBe("—");
  });

  it("detects fraction-style percent series", () => {
    expect(pctIsFraction([0.1, -0.2, 0.05])).toBe(true);
    expect(pctIsFraction([10, 20])).toBe(false);
  });

  it("builds waterfall bars with running totals", () => {
    const b = waterfallBars([{ label: "Start", value: 100, total: true }, { label: "+", value: 20 }, { label: "-", value: -30 }, { label: "End", value: 90, total: true }]);
    expect(b.map((x) => [x.base, x.size, x.kind])).toEqual([[0, 100, "total"], [100, 20, "up"], [90, 30, "down"], [0, 90, "total"]]);
  });

  it("bins values and fits a regression line", () => {
    const h = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(h).toHaveLength(5);
    expect(h.reduce((s, x) => s + x.n, 0)).toBe(10);
    const r = regression([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
    expect(r?.slope).toBeCloseTo(2);
    expect(r?.intercept).toBeCloseTo(1);
    expect(r?.r2).toBeCloseTo(1);
    expect(regression([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBeNull();
  });

  it("normalizes rows to shares", () => {
    expect(toShares([{ y: "a", A: 1, B: 3 }], ["A", "B"])[0]).toMatchObject({ A: 0.25, B: 0.75 });
  });
});
