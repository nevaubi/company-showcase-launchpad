import { describe, expect, it } from "vitest";
import { fmtAlt, fmtChange, fmtDay, fmtPct, fmtSigned, fmtShare } from "./catalog";

// fmtAlt is used across the app (daily brief, overview extras, state deposits, the assistant): these
// pin the output every caller now receives.
describe("fmtAlt", () => {
  it("scales dollars with one convention per step", () => {
    expect(fmtAlt(69313261998.29, "USD")).toBe("$69.3B");
    expect(fmtAlt(2_034_500_000_000, "USD")).toBe("$2.03T");
    expect(fmtAlt(501_234, "USD")).toBe("$501K");
    expect(fmtAlt(842, "USD")).toBe("$842");
  });
  it("moves up a step instead of printing 1000 of a unit", () => {
    expect(fmtAlt(999_960_000_000, "USD")).toBe("$1.00T");
    expect(fmtAlt(999_960_000, "USD")).toBe("$1.0B");
    expect(fmtAlt(999_600, "USD")).toBe("$1.0M");
    expect(fmtAlt(9_999_960, null)).toBe("10.0M");
  });
  it("uses a true minus and no sign on a value that rounds to zero", () => {
    expect(fmtAlt(-12_500_000, "USD")).toBe("−$12.5M");
    expect(fmtAlt(-0.3, "USD")).toBe("$0");
    expect(fmtAlt(-0.001, "%")).toBe("0.00%");
  });
  it("formats rates, ratios, pounds and plain counts", () => {
    expect(fmtAlt(0.614, "%")).toBe("0.61%");
    expect(fmtAlt(1.5, "ratio")).toBe("1.50×");
    expect(fmtAlt(2221, "lbs")).toBe("2,221 lb");
    expect(fmtAlt(4_512_000, "lbs")).toBe("4.5M lb");
    expect(fmtAlt(804_312, null)).toBe("804K");
    expect(fmtAlt(12_345, null)).toBe("12K");
    expect(fmtAlt(999_600, null)).toBe("1.0M");
    expect(fmtAlt(12_345, "lbs")).toBe("12K lb");
    expect(fmtAlt(1_532, null)).toBe("1,532");
    expect(fmtAlt(2.5, null)).toBe("2.5");
    expect(fmtAlt(1.2e9, null)).toBe("1.2B");
    expect(fmtAlt(null, "USD")).toBe("–");
    expect(fmtAlt(Number.NaN, null)).toBe("–");
  });
});

describe("fmtChange", () => {
  it("one decimal under 10%, none above, a true minus", () => {
    expect(fmtChange(0.057)).toBe("+5.7%");
    expect(fmtChange(-0.12)).toBe("−12%");
    expect(fmtChange(0.993)).toBe("+99%");
  });
  it("no sign for no change, and a cap far above", () => {
    expect(fmtChange(0)).toBe("0.0%");
    expect(fmtChange(-0.0004)).toBe("0.0%");
    expect(fmtChange(12)).toBe("> +999%");
    expect(fmtChange(null)).toBe("–");
  });
});

describe("fmtShare and fmtDay", () => {
  it("shares", () => {
    expect(fmtShare(0.92)).toBe("92%");
    expect(fmtShare(0.031)).toBe("3.1%");
    expect(fmtShare(0.0004)).toBe("<0.1%");
    expect(fmtShare(0)).toBe("0.0%");
    expect(fmtShare(undefined)).toBe("–");
  });
  it("days", () => {
    expect(fmtDay("2026-11-20")).toBe("Nov 20, 2026");
    expect(fmtDay(null)).toBe("–");
  });
});

describe("table cells (one decimal convention per column)", () => {
  it("signs a change with a true minus at a fixed number of decimals, an en dash when missing", () => {
    expect(fmtSigned(-0.123, 0)).toBe("−12%");
    expect(fmtSigned(0.123, 1)).toBe("+12.3%");
    expect(fmtSigned(-0.001, 0)).toBe("0%");
    expect(fmtSigned(null, 0)).toBe("–");
  });
  it("prints a share at fixed decimals, an en dash when missing", () => {
    expect(fmtPct(0.1234, 1)).toBe("12.3%");
    expect(fmtPct(undefined, 1)).toBe("–");
    expect(fmtPct(Number.NaN, 0)).toBe("–");
  });
});
