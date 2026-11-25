import { describe, expect, it } from "vitest";
import { add, cmp, dec, div, fmt, isDecimal, mul, ZERO, type Dec } from "./decimal";

const d = (s: string) => dec(s) as Dec;

describe("abs decimal", () => {
  it("reads the plain decimals the files write and nothing else", () => {
    expect(fmt(d("115000000.00000000"))).toBe("115000000");
    expect(fmt(d(".03486000"))).toBe("0.03486");
    expect(fmt(d("-12.50"))).toBe("-12.5");
    expect(fmt(d("+7"))).toBe("7");
    expect(fmt(d("5."))).toBe("5");
    expect(fmt(d("-0.00"))).toBe("0");
    for (const bad of ["", " ", "N/A", "1,234.5", "1e5", "12.3.4", ".", "--1", "0x10", " 1"])
      expect(dec(bad), bad).toBeNull();
    expect(isDecimal("0.07165")).toBe(true);
    expect(isDecimal("7.165%")).toBe(false);
  });

  it("adds exactly where floating point does not", () => {
    // 0.1 + 0.2 is 0.30000000000000004 as floats; ten thousand cents-precise balances drift further
    expect(fmt(add(d("0.1"), d("0.2")))).toBe("0.3");
    let total = ZERO;
    let float = 0;
    for (let i = 0; i < 10_000; i++) {
      total = add(total, d("1234567.89"));
      float += 1234567.89;
    }
    expect(fmt(total)).toBe("12345678900");
    expect(float).not.toBe(12345678900);
  });

  it("multiplies exactly and divides to a stated number of places, half away from zero", () => {
    expect(fmt(mul(d("0.06844"), d("63000000.00")))).toBe("4311720");
    expect(fmt(div(d("5028220"), d("73000000"), 10) as Dec)).toBe("0.068879726");
    expect(fmt(div(d("1"), d("3"), 4) as Dec)).toBe("0.3333");
    expect(fmt(div(d("2"), d("3"), 4) as Dec)).toBe("0.6667");
    expect(fmt(div(d("-2"), d("3"), 4) as Dec)).toBe("-0.6667");
    expect(fmt(div(d("1"), d("8"), 2) as Dec)).toBe("0.13");
    expect(fmt(div(d("-1"), d("8"), 2) as Dec)).toBe("-0.13");
    expect(div(d("1"), d("0.00"), 4)).toBeNull();
  });

  it("compares across different scales", () => {
    expect(cmp(d("1.50"), d("1.5"))).toBe(0);
    expect(cmp(d("1.49"), d("1.5"))).toBe(-1);
    expect(cmp(d("-1"), d("-1.01"))).toBe(1);
  });
});
