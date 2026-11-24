import { describe, expect, it } from "vitest";
import { countVerdict, eventWindows, median, poissonLower, poissonUpper, revenueNear, seriesVerdict, trailingTwelveMonths, trailingYear, yearOnYear } from "./derive";

describe("poisson tails", () => {
  it("matches hand-computed values", () => {
    // P(X ≥ 3 | 1) = 1 − e^-1 (1 + 1 + 1/2) = 0.0803
    expect(poissonUpper(3, 1)).toBeCloseTo(0.0803, 4);
    // P(X ≤ 0 | 4) = e^-4 = 0.0183
    expect(poissonLower(0, 4)).toBeCloseTo(0.0183, 4);
    expect(poissonUpper(0, 3)).toBe(1);
  });
});

describe("countVerdict (event windows)", () => {
  it("does not flag a flat series", () => {
    expect(countVerdict([5, 5, 5, 5, 5, 5, 5, 5, 5]).status).toBe("normal");
  });
  it("does not flag a steady upward trend", () => {
    // λ = 4.5 over the prior eight, P(X ≥ 9 | 4.5) = 0.040 > 0.005
    const v = countVerdict([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(v.baseline).toBeCloseTo(4.5, 6);
    expect(v.p).toBeCloseTo(0.04, 2);
    expect(v.status).toBe("normal");
  });
  it("flags a jump far above a stable history", () => {
    // λ = 2, P(X ≥ 12 | 2) ≈ 2.2e-6, z = (12 − 2)/max(0, √2, 1) = 7.07
    const v = countVerdict([2, 2, 2, 2, 2, 2, 2, 2, 12]);
    expect(v.status).toBe("spike");
    expect(v.p).toBeLessThan(1e-5);
    expect(v.z).toBeCloseTo(7.07, 2);
  });
  it("treats a source that only started covering the company as new, not unusual", () => {
    expect(countVerdict([0, 0, 0, 0, 0, 0, 0, 0, 34]).status).toBe("new");
  });
  it("needs four windows of history", () => {
    expect(countVerdict([0, 0, 0, 0, 0, 1, 1, 1, 9]).status).toBe("short");
    expect(countVerdict([0, 0, 0, 0, 1, 1, 1, 1, 9]).status).toBe("spike");
  });
  it("does not mistake a lumpy history for a quiet one", () => {
    // λ = 5.25 but sd ≈ 6.4, so 14 is z ≈ 1.4: normal
    expect(countVerdict([0, 15, 0, 12, 0, 14, 1, 0, 14]).status).toBe("normal");
  });
  it("flags a collapse from a busy rate", () => {
    expect(countVerdict([9, 8, 10, 9, 11, 8, 10, 9, 0]).status).toBe("drop");
  });
  it("honours a shorter baseline", () => {
    expect(countVerdict([30, 30, 1, 1, 1, 1, 1, 1, 8], { maxPrior: 5 }).baseline).toBe(1);
  });
});

describe("seriesVerdict (modified z)", () => {
  it("does not flag a flat series", () => {
    expect(seriesVerdict(Array(13).fill(1000), { log: true }).status).toBe("normal");
  });
  it("does not flag a steady 3% monthly climb", () => {
    const xs = Array.from({ length: 13 }, (_, i) => 1000 * 1.03 ** i);
    expect(seriesVerdict(xs, { log: true }).status).toBe("normal");
  });
  it("flags a reading many MADs above the median", () => {
    const xs = [100, 110, 95, 105, 100, 98, 102, 107, 99, 101, 103, 97, 600];
    const v = seriesVerdict(xs, { log: true });
    expect(v.status).toBe("spike");
    expect(v.median).toBe(100.5); // sorted prior: …100, 100, 101, 102…
  });
  it("needs eight earlier readings", () => {
    expect(seriesVerdict([1, 2, 3, 4, 5, 6, 7, 900]).status).toBe("short");
  });
  it("works on a rate's own scale with a floor", () => {
    const nco = [0.4, 0.42, 0.41, 0.43, 0.4, 0.41, 0.42, 0.4, 1.4];
    expect(seriesVerdict(nco, { floor: 0.02 }).status).toBe("spike");
  });
});

describe("windows and trends", () => {
  it("counts records per 90-day window back from today", () => {
    expect(eventWindows(["2026-11-20", "2026-08-01", "2026-08-20", null, "2027-01-01"], "2026-11-23", 3)).toEqual([0, 2, 1]);
  });
  it("compares the trailing year with the year before", () => {
    const t = trailingYear([{ date: "2026-10-01", value: 5 }, { date: "2026-01-01", value: 3 }, { date: "2025-06-01", value: 4 }], "2026-11-23");
    expect([t.count, t.prevCount, t.sum, t.prevSum, t.change]).toEqual([2, 1, 8, 4, 1]);
  });
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
    expect(y.partial!.value).toBe(120);
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
