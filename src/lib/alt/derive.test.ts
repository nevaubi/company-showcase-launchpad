import { describe, expect, it } from "vitest";
import { binomialUpper, median, pLabel, quarterOnly, rangeVerdict, revenueNear, riseVerdict, trailingTwelveMonths, yearOnYear } from "./derive";

describe("binomialUpper", () => {
  it("matches hand-computed tails", () => {
    // 1,0,1,0 then 4: T = 6 over 5 windows; P(X ≥ 4) = 15·.2⁴·.8² + 6·.2⁵·.8 + .2⁶
    expect(binomialUpper(4, 6, 0.2)).toBeCloseTo(0.01696, 5);
    // 3,3,0,0 then 6: T = 12
    expect(binomialUpper(6, 12, 0.2)).toBeCloseTo(0.019405, 5);
    expect(binomialUpper(0, 5, 0.3)).toBe(1);
    expect(binomialUpper(6, 5, 0.3)).toBe(0);
  });
  it("stays finite for large totals", () => {
    const p = binomialUpper(400, 2000, 0.1);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-20);
  });
});

describe("riseVerdict (conditional test on whole windows)", () => {
  it("leaves a flat series alone", () => {
    expect(riseVerdict([5, 5, 5, 5, 5, 5, 5, 5, 5]).status).toBe("normal");
  });
  it("does not flag a steady trend (9 after 1..8: p = 0.057)", () => {
    const v = riseVerdict([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(v.status).toBe("normal");
    expect(v.p).toBeCloseTo(0.0567, 3);
  });
  it("flags a jump far above every earlier window", () => {
    const v = riseVerdict([2, 2, 2, 2, 2, 2, 2, 2, 12]);
    expect(v.status).toBe("rise");
    expect(v.p).toBeCloseTo(1.926e-5, 7);
    expect([v.mean, v.max, v.prior]).toEqual([2, 2, 8]);
  });
  it("treats the rate as estimated: 4 after 1,0,1,0 is not unusual (exact p = 0.017; a known-rate Poisson tail said 0.0018)", () => {
    expect(riseVerdict([1, 0, 1, 0, 4]).status).toBe("normal");
  });
  it("needs a year of whole windows before the latest", () => {
    expect(riseVerdict([0, 0, 0, 30]).status).toBe("short");
    expect(riseVerdict([0, 0, 0, 0, 30]).status).toBe("rise");
  });
  it("is not beaten by one old burst: the latest must top every earlier window", () => {
    expect(riseVerdict([0, 15, 0, 12, 0, 14, 1, 0, 14]).status).toBe("normal");
  });
  it("needs at least three units in the latest window", () => {
    expect(riseVerdict([0, 0, 0, 0, 0, 0, 0, 0, 2]).status).toBe("normal");
  });
  it("never flags a fall", () => {
    expect(riseVerdict([9, 8, 10, 9, 11, 8, 10, 9, 0]).status).toBe("normal");
  });
  it("labels p without false precision", () => {
    expect(pLabel(1.9e-5)).toBe("p < 0.0001");
    expect(pLabel(0.00062)).toBe("p = 0.0006");
  });
});

describe("rangeVerdict (a reading against its own range)", () => {
  const months = (vals: number[], from = 2024) => vals.map((value, i) => ({ date: `${from + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, value }));
  const rule = { days: 735, minPrior: 24, factor: 1.5, minLevel: 10_000, sides: "both" as const };
  it("flags a month at least 1.5× the highest of the prior 24", () => {
    const v = rangeVerdict(months([...Array(24).fill(20_000).map((x, i) => x + i * 100), 40_000]), rule);
    expect(v.status).toBe("above");
    expect(v.hi!.value).toBe(22_300);
    expect(v.ratio).toBeCloseTo(40_000 / 22_300, 6);
  });
  it("leaves a new high below the factor alone", () => {
    expect(rangeVerdict(months([...Array(24).fill(20_000), 29_000]), rule).status).toBe("normal");
  });
  it("leaves a steady trend alone", () => {
    expect(rangeVerdict(months(Array.from({ length: 25 }, (_, i) => 20_000 * 1.02 ** i)), rule).status).toBe("normal");
  });
  it("flags a fall below the lowest ÷ factor on two-sided rules", () => {
    expect(rangeVerdict(months([...Array(24).fill(20_000), 12_000]), rule).status).toBe("below");
  });
  it("needs the full span of earlier readings", () => {
    expect(rangeVerdict(months([...Array(12).fill(20_000), 90_000]), rule).status).toBe("short");
  });
  it("skips series under the level floor", () => {
    expect(rangeVerdict(months([...Array(24).fill(500), 5_000]), rule).status).toBe("normal");
  });
  it("needs an absolute move for rates", () => {
    const q = ["2022", "2023", "2024", "2025"].flatMap((y) => ["03-31", "06-30", "09-30", "12-31"].map((d) => `${y}-${d}`)).map((date) => ({ date, value: 0.02 }));
    const r2 = { days: 1840, minPrior: 16, factor: 2, minBeyond: 0.1, sides: "up" as const };
    expect(rangeVerdict([...q, { date: "2026-03-31", value: 0.06 }], r2).status).toBe("normal");
    expect(rangeVerdict([...q, { date: "2026-03-31", value: 0.4 }], r2).status).toBe("above");
  });
});

describe("quarterOnly", () => {
  it("turns year-to-date annualised rates into single quarters", () => {
    const q = quarterOnly([
      { date: "2026-03-31", value: 2.0 },
      { date: "2026-06-30", value: 1.1 },
      { date: "2026-09-30", value: 0.8 },
      { date: "2025-12-31", value: 0.5 },
    ]);
    // Q2 = 2·1.1 − 1·2.0 = 0.2; Q3 = 3·0.8 − 2·1.1 = 0.2; 2025-Q4 needs 2025-Q3, which is not on file
    expect(q.map((x) => [x.date, Number(x.value.toFixed(6))])).toEqual([["2026-03-31", 2], ["2026-06-30", 0.2], ["2026-09-30", 0.2]]);
  });
});

describe("periods", () => {
  it("compares full years and keeps a partial year apart", () => {
    const rows = [
      { date: "2024-09-30", value: 100, meta: { fiscal_year: 2024 } },
      { date: "2025-09-30", value: 150, meta: { fiscal_year: 2025 } },
      { date: "2026-09-30", value: 120, meta: { fiscal_year: 2026 } },
    ];
    // FY2026 ended 2026-09-30 and is still within the 120-day reporting lag on 2026-11-23
    const y = yearOnYear(rows, "2026-11-23")!;
    expect(y.latest.value).toBe(150);
    expect(y.prior!.value).toBe(100);
    expect(y.change).toBe(0.5);
    expect(y.partials.map((r) => r.value)).toEqual([120]);
  });
  it("compares quarters with the same quarter a year earlier", () => {
    const rows = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((date, i) => ({ date, value: 10 + i }));
    const y = yearOnYear(rows, "2026-11-23")!;
    expect([y.latest.value, y.prior!.value]).toEqual([15, 11]);
  });
  it("sums the trailing twelve months", () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({ date: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, value: i < 12 ? 10 : 20 }));
    const t = trailingTwelveMonths(rows, "2026-12-15")!;
    expect([t.sum, t.prior, t.change]).toEqual([240, 120, 1]);
  });
  it("finds the revenue year nearest a period end", () => {
    const pts = [{ value: 71, end: "2024-12-31" }, { value: 75, end: "2025-12-31" }];
    expect(revenueNear(pts, "2025-09-30")!.value).toBe(75);
    expect(revenueNear(pts, "2027-09-30")).toBeNull();
  });
  it("medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
