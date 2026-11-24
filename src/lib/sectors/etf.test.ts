import { describe, expect, it } from "vitest";
import { fundRisk, type Closes } from "./etf";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
/** Closes from a list of daily returns, starting at 100. */
const closes = (rets: number[], skip: number[] = []): Closes => {
  let p = 100;
  const out: [string, number][] = [[day(0), p]];
  rets.forEach((r, i) => {
    p *= 1 + r;
    out.push([day(i + 1), p]);
  });
  return out.filter((_, i) => !skip.includes(i));
};
// 40 returns alternating +1% and −1%, and a second pattern that is not a multiple of the first
const A = Array.from({ length: 40 }, (_, i) => (i % 2 ? -0.01 : 0.01));
const B = Array.from({ length: 40 }, (_, i) => (i % 4 < 2 ? 0.02 : -0.02));

describe("fund risk", () => {
  it("gives volatility, beta and correlation of a fund that moves twice as much as the benchmark", () => {
    const r = fundRisk([{ symbol: "SPY", closes: closes(A) }, { symbol: "X2", closes: closes(A.map((x) => 2 * x)) }, { symbol: "INV", closes: closes(A.map((x) => -x)) }], "SPY");
    expect(r.sessions).toBe(40);
    expect([r.from, r.to]).toEqual([day(1), day(40)]);
    // ±1% around a zero mean: sample variance 40 × 0.0001 / 39
    const sd = Math.sqrt((40 * 0.0001) / 39);
    expect(r.vol[0]).toBeCloseTo(sd * Math.sqrt(252), 10);
    expect(r.vol[1]).toBeCloseTo(2 * sd * Math.sqrt(252), 10);
    expect(r.beta).toEqual([1, expect.closeTo(2, 10), expect.closeTo(-1, 10)]);
    expect(r.corr[0][1]).toBeCloseTo(1, 10);
    expect(r.corr[0][2]).toBeCloseTo(-1, 10);
    expect(r.corr[1][1]).toBe(1);
    expect(r.corr[2][1]).toBe(r.corr[1][2]);
  });
  it("finds no relation between two patterns that are uncorrelated by construction", () => {
    // A is +,−,+,−; B is +,+,−,−: the products cancel within every block of four
    const r = fundRisk([{ symbol: "SPY", closes: closes(A) }, { symbol: "B", closes: closes(B) }], "SPY");
    expect(r.corr[0][1]).toBeCloseTo(0, 10);
    expect(r.beta[1]).toBeCloseTo(0, 10);
  });
  it("uses only sessions every fund has, and only the last ones asked for", () => {
    const r = fundRisk([{ symbol: "SPY", closes: closes(A) }, { symbol: "GAP", closes: closes(A, [10, 11]) }], "SPY", 20);
    expect(r.sessions).toBe(20);
    expect(r.to).toBe(day(40));
    const all = fundRisk([{ symbol: "SPY", closes: closes(A) }, { symbol: "GAP", closes: closes(A, [10, 11]) }], "SPY");
    expect(all.sessions).toBe(38); // 41 closes less two days missing in one fund
  });
  it("gives nothing on a handful of sessions or without the benchmark", () => {
    const short = fundRisk([{ symbol: "SPY", closes: closes(A.slice(0, 12)) }, { symbol: "X", closes: closes(A.slice(0, 12)) }], "SPY");
    expect(short.sessions).toBe(0);
    expect(short.vol).toEqual([null, null]);
    expect(fundRisk([{ symbol: "X", closes: closes(A) }], "SPY").beta).toEqual([null]);
    expect(fundRisk([], "SPY").symbols).toEqual([]);
  });
});
