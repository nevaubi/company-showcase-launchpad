import { describe, expect, it } from "vitest";
import { MINUS, compareDecimal, formatDecimal, parseDecimal, percentChange, ratioDecimal, roundDecimal, subtractDecimal } from "./decimal";

const d = (text: string) => {
  const v = parseDecimal(text);
  if (!v) throw new Error(text);
  return v;
};

describe("exact decimals", () => {
  it("reads the digits as written", () => {
    expect(d("8.292398")).toEqual({ int: 8292398n, scale: 6 });
    expect(d("-11619811")).toEqual({ int: -11619811n, scale: 0 });
    expect(d("18767000.0")).toEqual({ int: 187670000n, scale: 1 });
    expect(d("1.5e3")).toEqual({ int: 1500n, scale: 0 });
    expect(parseDecimal("1,234")).toBeNull();
    expect(parseDecimal("NA")).toBeNull();
  });

  it("rounds half away from zero on the digits, not on a binary float", () => {
    // 1.005 is 1.00499999999999989... as a double; the stored digits round up.
    expect(formatDecimal(d("1.005"), { decimals: 2 })).toBe("1.01");
    expect(formatDecimal(d("-1.005"), { decimals: 2 })).toBe(`${MINUS}1.01`);
    expect(formatDecimal(d("8.292398"), { decimals: 2 })).toBe("8.29");
    expect(roundDecimal(d("2.5"), 0)).toEqual({ int: 3n, scale: 0 });
  });

  it("groups digits and writes a true minus sign and an explicit plus", () => {
    expect(formatDecimal(d("24067204474"), { decimals: 0 })).toBe("24,067,204,474");
    expect(formatDecimal(d("-0.21"), { decimals: 2 })).toBe(`${MINUS}0.21`);
    expect(formatDecimal(d("3.6"), { decimals: 1, plus: true })).toBe("+3.6");
    expect(formatDecimal(d("0"), { decimals: 1, plus: true })).toBe("0.0");
    expect(formatDecimal(d("4.1"), { decimals: 2 })).toBe("4.10");
  });

  it("computes changes and shares exactly", () => {
    expect(formatDecimal(percentChange(d("132.257"), d("127.601"), 1)!, { decimals: 1 })).toBe("3.6");
    expect(formatDecimal(percentChange(d("345672"), d("314147"), 1)!, { decimals: 1 })).toBe("10.0");
    expect(formatDecimal(subtractDecimal(d("3.88"), d("4.09")), { decimals: 2 })).toBe(`${MINUS}0.21`);
    expect(formatDecimal(ratioDecimal(d("1"), d("3"), 100, 1)!, { decimals: 1 })).toBe("33.3");
    expect(percentChange(d("1"), d("0"), 1)).toBeNull();
    expect(compareDecimal(d("789723000"), d("685331511"))).toBe(1);
    expect(compareDecimal(d("1.50"), d("1.5"))).toBe(0);
  });
});
