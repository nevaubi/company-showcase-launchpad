import { describe, expect, it } from "vitest";
import { black76, forwardDelta, impliedVol, normCdf, parityForward, varianceInterpolate } from "./pricing";

describe("normCdf", () => {
  it("matches the tabulated values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1)).toBeCloseTo(0.8413447460685429, 12);
    expect(normCdf(-1.96)).toBeCloseTo(0.024997895148220435, 12);
    expect(normCdf(2.5758293035489004)).toBeCloseTo(0.995, 10);
    expect(normCdf(-8)).toBeCloseTo(6.220960574271785e-16, 20);
  });
});

// Hull, Options, Futures and Other Derivatives: stock 42, strike 40, rate 10%, volatility 20%, six
// months. Call 4.76, put 0.81, d1 0.7693. On the forward: F = 42 e^(0.05), discount factor e^(-0.05).
describe("black76 against Hull's worked example", () => {
  const f = 42 * Math.exp(0.05);
  const df = Math.exp(-0.05);
  it("prices the call and the put", () => {
    expect(black76("C", f, 40, 0.5, 0.2, df)).toBeCloseTo(4.76, 2);
    expect(black76("P", f, 40, 0.5, 0.2, df)).toBeCloseTo(0.81, 2);
  });
  it("keeps put-call parity exactly", () => {
    const c = black76("C", f, 40, 0.5, 0.2, df);
    const p = black76("P", f, 40, 0.5, 0.2, df);
    expect(c - p).toBeCloseTo(df * (f - 40), 10);
    expect(parityForward(40, c, p, df)).toBeCloseTo(f, 10);
  });
  it("gives N(d1) as the call's delta", () => {
    expect(forwardDelta("C", f, 40, 0.5, 0.2)).toBeCloseTo(0.7791, 4);
    expect(forwardDelta("P", f, 40, 0.5, 0.2)).toBeCloseTo(0.7791 - 1, 4);
  });
});

describe("impliedVol", () => {
  // Hull: call at 1.875, stock 21, strike 20, rate 10%, three months → 23.5%
  it("recovers Hull's implied volatility", () => {
    const f = 21 * Math.exp(0.025);
    const df = Math.exp(-0.025);
    expect(impliedVol("C", 1.875, f, 20, 0.25, df)).toBeCloseTo(0.235, 3);
  });
  it("inverts its own price for calls and puts across strikes", () => {
    for (const vol of [0.08, 0.25, 0.6, 1.4])
      for (const k of [80, 100, 125])
        for (const right of ["C", "P"] as const) {
          const price = black76(right, 101, k, 30 / 365, vol, 0.9965);
          const back = impliedVol(right, price, 101, k, 30 / 365, 0.9965);
          // a price within a rounding error of intrinsic value carries no volatility
          if (back != null) expect(back).toBeCloseTo(vol, 6);
          else expect(price - 0.9965 * Math.max(0, right === "C" ? 101 - k : k - 101)).toBeLessThan(1e-9);
        }
  });
  it("gives nothing for a price at or under intrinsic value", () => {
    expect(impliedVol("C", 5, 105, 100, 0.1, 1)).toBeNull();
    expect(impliedVol("P", 0, 105, 100, 0.1, 1)).toBeNull();
  });
});

describe("varianceInterpolate", () => {
  it("is linear in total variance", () => {
    // 20% for 20 days and 30% for 40 days: variance·days 0.8 and 3.6; at 30 days 2.2 → sqrt(2.2/30)
    expect(varianceInterpolate({ d: 20, iv: 0.2 }, { d: 40, iv: 0.3 }, 30)).toBeCloseTo(Math.sqrt(2.2 / 30), 12);
  });
  it("returns each end at its own day and nothing outside the bracket", () => {
    expect(varianceInterpolate({ d: 30, iv: 0.2 }, { d: 60, iv: 0.3 }, 30)).toBeCloseTo(0.2, 12);
    expect(varianceInterpolate({ d: 31, iv: 0.2 }, { d: 60, iv: 0.3 }, 30)).toBeNull();
  });
});
