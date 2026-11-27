import { describe, expect, it } from "vitest";
import { constantMaturityIv, summarizeChain } from "./core";
import { black76, forwardDelta, type Right } from "./pricing";
import { newYork, yahooChain, yahooOptionsPath, yahooQuotePage, yahooSymbol, type YahooContract, type YahooOptionsResult } from "./yahoo";

// Monday 16 Nov 2026, 16:00 in New York (21:00 UTC, standard time)
const CLOSE = Date.UTC(2026, 10, 16, 21) / 1000;
const RATE = 0.04;
/** A smile that is linear in strike: 30% at 100, two tenths of a point more per dollar below. */
const smile = (k: number) => 0.3 + 0.002 * (100 - k);
const STRIKES = [80, 85, 90, 92.5, 95, 97.5, 100, 102.5, 105, 107.5, 110, 115, 120];

function block(expiry: string, forward: number) {
  const d = Math.round((Date.parse(expiry) - Date.parse("2026-11-16")) / 86400000);
  const t = d / 365;
  const df = Math.exp(-RATE * t);
  const yy = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const one = (right: Right, k: number): YahooContract => {
    const px = black76(right, forward, k, t, smile(k), df);
    // a symmetric two-cent market around the model price keeps the midpoint exact
    return { contractSymbol: `XYZ${yy}${right}${String(Math.round(k * 1000)).padStart(8, "0")}`, strike: k, bid: px - 0.01, ask: px + 0.01, volume: 10, openInterest: 100 };
  };
  // far out of the money a two-cent market is wider than 60% of the price: such a quote is not read
  const tightAt = (right: Right, k: number) => 0.02 / black76(right, forward, k, t, smile(k), df) <= 0.6;
  return { expirationDate: Date.parse(expiry) / 1000, calls: STRIKES.map((k) => one("C", k)), puts: STRIKES.map((k) => one("P", k)), d, t, df, forward, tightAt };
}

describe("newYork", () => {
  it("gives the New York day and minute in standard and daylight time", () => {
    expect(newYork(CLOSE * 1000)).toEqual({ date: "2026-11-16", minutes: 16 * 60 });
    expect(newYork(Date.UTC(2026, 6, 1, 19, 45))).toEqual({ date: "2026-07-01", minutes: 15 * 60 + 45 });
    // 01:30 UTC is still the evening before in New York
    expect(newYork(Date.UTC(2026, 10, 17, 1, 30)).date).toBe("2026-11-16");
  });
});

describe("yahoo addresses", () => {
  it("keeps the class dash and asks for every expiry", () => {
    expect(yahooSymbol("brk-b")).toBe("BRK-B");
    expect(yahooOptionsPath("BRK-B", "a/b")).toBe("/v7/finance/options/BRK-B?getAllData=true&crumb=a%2Fb");
    expect(yahooQuotePage("BF-B")).toBe("https://finance.yahoo.com/quote/BF-B/options/");
  });
});

describe("yahooChain", () => {
  const near = block("2026-12-04", 100.1);
  const far = block("2027-01-15", 100.4);
  const result: YahooOptionsResult = {
    underlyingSymbol: "XYZ",
    quote: { regularMarketPrice: 100, regularMarketTime: CLOSE, marketState: "POST" },
    options: [near, far],
  };
  const read = yahooChain(result, RATE, "2026-11-13")!;

  it("dates the chain by the New York session and records how it was read", () => {
    expect(read.chain.last_trade_time).toBe("2026-11-16T16:00:00");
    expect(read.chain.iv30).toBeUndefined();
    const tight = [near, far].flatMap((b) => STRIKES.flatMap((k) => [b.tightAt("C", k), b.tightAt("P", k)])).filter(Boolean).length;
    expect(tight).toBeGreaterThan(40);
    expect(read.meta).toMatchObject({ state: "POST", rate: RATE, rateDate: "2026-11-13", expiries: 2, contracts: 52, twoSided: tight, forwards: 2 });
  });

  it("recovers each contract's volatility and delta from its quoted midpoint", () => {
    for (const b of [near, far])
      for (const k of STRIKES)
        for (const right of ["C", "P"] as const) {
          const o = read.chain.options.find((x) => x.option === b[right === "C" ? "calls" : "puts"].find((c) => c.strike === k)!.contractSymbol)!;
          if (!b.tightAt(right, k)) {
            expect(o.iv).toBe(0);
            continue;
          }
          expect(o.iv).toBeCloseTo(smile(k), 6);
          expect(o.delta).toBeCloseTo(forwardDelta(right, b.forward, k, b.t, smile(k)), 6);
        }
  });

  it("feeds the summary: 30-day volatility between the two expiries, skew at the nearer one", () => {
    const s = summarizeChain("XYZ", read.chain)!;
    expect(s.date).toBe("2026-11-16");
    expect(s.price).toBe(100);
    // both expiries are at 30% at the money, so every interpolation between them is 30%
    expect(s.iv30).toBeCloseTo(0.3, 3);
    expect(s.iv30From).toMatchObject({ kind: "between", lo: { e: "2026-12-04", d: 18 }, hi: { e: "2027-01-15", d: 60 } });
    expect(s.atmIv).toBeCloseTo(0.3, 3);
    // 18 days out: the strikes whose deltas are nearest ∓0.25, found from the model deltas
    const pick = (right: Right, want: number) => STRIKES.map((k) => ({ k, gap: Math.abs(forwardDelta(right, near.forward, k, near.t, smile(k)) - want) })).sort((a, b) => a.gap - b.gap)[0].k;
    expect(s.skew25).toBeCloseTo(smile(pick("P", -0.25)) - smile(pick("C", 0.25)), 3);
    expect(s.callOi).toBe(2600);
    expect(s.putOi).toBe(2600);
    expect(s.term.map((x) => x.e)).toEqual(["2026-12-04", "2027-01-15"]);
  });

  it("computes nothing from one-sided or empty quotes, and still counts the contracts", () => {
    const dead: YahooOptionsResult = {
      ...result,
      quote: { ...result.quote, marketState: "PRE" },
      options: [{ ...near, calls: near.calls.map((c) => ({ ...c, bid: 0, ask: 0 })) }],
    };
    const r = yahooChain(dead, RATE)!;
    expect(r.meta).toMatchObject({ state: "PRE", contracts: 26, twoSided: STRIKES.filter((k) => near.tightAt("P", k)).length, forwards: 0 });
    expect(r.chain.options.every((o) => o.iv === 0 && o.delta === 0)).toBe(true);
    // no call is quoted, so no straddle and no volatility: nothing to store
    expect(summarizeChain("XYZ", r.chain)).toBeNull();
  });

  it("is null for a stock without listed options", () => {
    expect(yahooChain({ underlyingSymbol: "ZZZ", quote: { regularMarketPrice: 5, regularMarketTime: CLOSE }, options: [] }, RATE)).toBeNull();
    expect(yahooChain(null, RATE)).toBeNull();
  });

  it("counts the rest of the session into the time to expiry", () => {
    // read at 15:00: one hour of today is left, so the same prices imply a slightly lower volatility
    const early = yahooChain({ ...result, quote: { ...result.quote, marketState: "REGULAR", regularMarketTime: CLOSE - 3600 } }, RATE)!;
    const a = early.chain.options.find((o) => o.option.endsWith("C00100000") && o.option.includes("261204"))!;
    const b = read.chain.options.find((o) => o.option === a.option)!;
    expect(a.iv).toBeLessThan(b.iv);
    expect(a.iv / b.iv).toBeCloseTo(Math.sqrt(18 / (18 + 1 / 24)), 3);
    // an early close: the session is over at 13:00, so none of today is left
    const half = yahooChain({ ...result, quote: { ...result.quote, marketState: "POST", regularMarketTime: CLOSE - 3 * 3600 } }, RATE)!;
    expect(half.chain.options.find((o) => o.option === a.option)!.iv).toBeCloseTo(b.iv, 9);
  });
});

describe("constantMaturityIv", () => {
  const p = (e: string, d: number, iv: number) => ({ e, d, iv });
  it("interpolates total variance between the expiries around 30 days", () => {
    const r = constantMaturityIv([p("b", 46, 0.3), p("a", 18, 0.2), p("c", 80, 0.5)])!;
    // w = 12/28; variance·days = (16/28)·0.04·18 + (12/28)·0.09·46
    expect(r.iv).toBeCloseTo(Math.sqrt(((16 / 28) * 0.04 * 18 + (12 / 28) * 0.09 * 46) / 30), 12);
    expect(r.basis).toEqual({ kind: "between", lo: p("a", 18, 0.2), hi: p("b", 46, 0.3) });
  });
  it("uses one expiry alone only when it is 14 to 60 days out", () => {
    expect(constantMaturityIv([p("a", 32, 0.25), p("b", 4, 0.9)])).toEqual({ iv: 0.25, basis: { kind: "single", at: p("a", 32, 0.25) } });
    expect(constantMaturityIv([p("a", 75, 0.25), p("b", 4, 0.9)])).toBeNull();
    expect(constantMaturityIv([p("a", 9, 0.4)])).toBeNull();
  });
  it("ignores expiries inside a week and beyond 120 days", () => {
    expect(constantMaturityIv([p("a", 3, 0.9), p("b", 200, 0.3)])).toBeNull();
  });
});
