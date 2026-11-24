import { describe, expect, it } from "vitest";
import { fmtHf, yoyText } from "./format";
import { seriesStats, type Point } from "./core";

describe("fmtHf", () => {
  it("compacts dollars and keeps the sign before the currency mark", () => {
    expect(fmtHf(2_340_000_000_000, "U.S. dollars")).toBe("$2.34T");
    expect(fmtHf(5_040_000_000, "U.S. dollars")).toBe("$5.0B");
    expect(fmtHf(-5_040_000_000, "U.S. dollars")).toBe("−$5.0B");
    expect(fmtHf(-12_300_000, "U.S. dollars")).toBe("−$12.3M");
    expect(fmtHf(-950, "U.S. dollars")).toBe("−$950");
    expect(fmtHf(0, "U.S. dollars")).toBe("$0");
  });

  it("never prints a hyphen for a negative value in any unit", () => {
    for (const unit of [
      "U.S. dollars",
      "Percent",
      "Percent of total",
      "ratio",
      "Count",
      "Net count of respondents",
    ]) {
      for (const v of [-0.004, -0.5, -7.25, -43.2, -1234.5, -9.9e9, -3.2e12]) {
        expect(fmtHf(v, unit)).not.toContain("-");
      }
    }
  });

  it("prints percent, ratio and plain numbers in their own form", () => {
    expect(fmtHf(4.256, "Percent")).toBe("4.26%");
    expect(fmtHf(43.21, "Percent of total")).toBe("43.2%");
    expect(fmtHf(-4.256, "Percent")).toBe("−4.26%");
    expect(fmtHf(1.5, "ratio")).toBe("1.50×");
    expect(fmtHf(-0.25, "ratio")).toBe("−0.25×");
    expect(fmtHf(1234.567, "Count")).toBe("1,234.57");
    expect(fmtHf(-12, "Net count of respondents")).toBe("−12");
  });

  it("gives a value that rounds to zero no sign", () => {
    expect(fmtHf(-0.004, "Percent")).toBe("0.00%");
    expect(fmtHf(-0.001, "ratio")).toBe("0.00×");
    expect(fmtHf(-0.0001, "Count")).toBe("0");
  });
});

describe("yoyText", () => {
  const series = (a: number, b: number): Point[] => [
    ["2024-01-31", a],
    ["2024-04-30", a],
    ["2024-07-31", a],
    ["2024-09-30", a],
    ["2025-09-30", b],
  ];

  it("gives a signed percentage for a positive level", () => {
    expect(yoyText(seriesStats(series(100, 112.5), "U.S. dollars"), "U.S. dollars")).toBe(
      "+12.5% y/y",
    );
    expect(yoyText(seriesStats(series(100, 80), "U.S. dollars"), "U.S. dollars")).toBe(
      "−20.0% y/y",
    );
  });

  it("gives the change of a percent series in points, not in percent", () => {
    expect(yoyText(seriesStats(series(4.0, 4.25), "Percent"), "Percent")).toBe("+0.25 pts y/y");
    expect(yoyText(seriesStats(series(4.25, 4.0), "Percent of total"), "Percent of total")).toBe(
      "−0.25 pts y/y",
    );
  });

  it("gives a dollar change with the minus before the currency mark when no ratio can be formed", () => {
    // a level that was negative a year ago has no percentage change
    expect(yoyText(seriesStats(series(-2e9, 3e9), "U.S. dollars"), "U.S. dollars")).toBe(
      "+$5.0B y/y",
    );
    expect(yoyText(seriesStats(series(3e9, -2e9), "U.S. dollars"), "U.S. dollars")).toBe(
      "−$5.0B y/y",
    );
  });

  it("gives a ratio change as a plain signed number and no sign for no change", () => {
    expect(yoyText(seriesStats(series(1.5, 1.38), "ratio"), "ratio")).toBe("−0.12 y/y");
    expect(yoyText(seriesStats(series(1.5, 1.5), "ratio"), "ratio")).toBe("0.00 y/y");
    expect(yoyText({ yoy: { abs: -7 } }, "Net count of respondents")).toBe("−7 y/y");
  });

  it("gives nothing without a year-ago value", () => {
    expect(yoyText(seriesStats([["2025-09-30", 5]], "Percent"), "Percent")).toBeNull();
    expect(yoyText(null, "Percent")).toBeNull();
  });
});
