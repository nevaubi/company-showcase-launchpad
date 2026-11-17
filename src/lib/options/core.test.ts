import { describe, expect, it } from "vitest";
import { cboeSymbol, earningsImpliedMove, impliedMoveBy, ivRank, parseOcc, realizedVol, snapshotRow, summarizeChain, type CboeOption } from "./core";

const opt = (option: string, bid: number, ask: number, extra: Partial<CboeOption> = {}): CboeOption => ({ option, bid, ask, iv: 0.3, open_interest: 100, volume: 10, delta: 0.5, ...extra });

describe("parseOcc", () => {
  it("reads root, expiry, type and strike", () => {
    expect(parseOcc("AAPL261218C00352500")).toEqual({ root: "AAPL", expiry: "2026-12-18", type: "C", strike: 352.5 });
  });
  it("skips adjusted contracts whose root carries a digit", () => {
    expect(parseOcc("AAPL1261218C00350000")).toBeNull();
  });
  it("maps share classes to Cboe's symbol", () => {
    expect(cboeSymbol("BRK-B")).toBe("BRK.B");
  });
});

describe("summarizeChain", () => {
  const chain = {
    symbol: "XYZ",
    current_price: 102,
    iv30: 31.5,
    last_trade_time: "2026-11-16T16:00:00",
    options: [
      // 2 days out: 100 and 105 strikes, straddle interpolated at 102
      opt("XYZ261118C00100000", 2.9, 3.1), opt("XYZ261118P00100000", 0.9, 1.1),
      opt("XYZ261118C00105000", 0.9, 1.1), opt("XYZ261118P00105000", 3.9, 4.1),
      // 32 days out: one strike plus 25-delta wings
      opt("XYZ261218C00100000", 5.9, 6.1, { iv: 0.32 }), opt("XYZ261218P00100000", 3.9, 4.1, { iv: 0.34, delta: -0.45 }),
      opt("XYZ261218C00115000", 1.0, 1.2, { iv: 0.28, delta: 0.24 }), opt("XYZ261218P00090000", 1.2, 1.4, { iv: 0.38, delta: -0.26 }),
      // expired today and a wide, untrustworthy quote
      opt("XYZ261116C00100000", 1.9, 2.1), opt("XYZ261116P00100000", 0.1, 0.2),
      opt("XYZ270115C00100000", 0.5, 9.0), opt("XYZ270115P00100000", 0.5, 9.0),
      // an adjusted contract (different deliverable) never counts
      opt("XYZ1261218C00100000", 50, 51, { open_interest: 99999 }),
    ],
  };
  const s = summarizeChain("XYZ", chain)!;
  it("dates the snapshot by the quotes' trading day and converts Cboe's IV30 from percent", () => {
    expect(s.date).toBe("2026-11-16");
    expect(s.iv30).toBe(0.315);
  });
  it("interpolates the at-the-money straddle between the strikes around the price", () => {
    // straddle 100 = 3 + 1 = 4; straddle 105 = 1 + 4 = 5; at 102 → 4.4 → 4.4/102
    expect(s.term[0].e).toBe("2026-11-18");
    expect(s.term[0].d).toBe(2);
    expect(s.term[0].m).toBeCloseTo(4.4 / 102, 4);
  });
  it("leaves out expired and badly quoted expiries", () => {
    expect(s.term.map((t) => t.e)).toEqual(["2026-11-18", "2026-12-18"]);
  });
  it("reads 25-delta skew and at-the-money IV at the expiry nearest 30 days", () => {
    expect(s.skew25).toBeCloseTo(0.38 - 0.28, 6);
    expect(s.atmIv).toBeCloseTo(0.33, 6);
  });
  it("counts open interest only for the stock's own contracts", () => {
    expect(s.callOi + s.putOi).toBe(1200);
    expect(snapshotRow(s).pc_oi).toBe(1);
  });
});

describe("implied moves", () => {
  const term = [
    { e: "2026-11-20", d: 4, m: 0.03, iv: 0.5, k: 100 },
    { e: "2026-11-27", d: 11, m: 0.06, iv: 0.5, k: 100 },
    { e: "2026-12-18", d: 32, m: 0.09, iv: 0.45, k: 100 },
  ];
  it("uses the first expiry strictly after the report, so either report time is covered", () => {
    expect(earningsImpliedMove(term, "2026-11-20", "2026-11-16")?.e).toBe("2026-11-27");
    expect(earningsImpliedMove(term, "2026-11-19", "2026-11-16")?.e).toBe("2026-11-20");
  });
  it("gives nothing for a report already past or beyond the listed expiries", () => {
    expect(earningsImpliedMove(term, "2026-11-10", "2026-11-16")).toBeNull();
    expect(earningsImpliedMove(term, "2027-03-01", "2026-11-16")).toBeNull();
  });
  it("reads the move by a horizon off the next expiry at or after it", () => {
    expect(impliedMoveBy(term, 10)?.e).toBe("2026-11-27");
    expect(impliedMoveBy(term, 60)).toBeNull();
  });
});

describe("volatility history", () => {
  it("annualises close-to-close volatility", () => {
    const closes = Array.from({ length: 22 }, (_, i) => 100 * (i % 2 ? 1.01 : 1));
    expect(realizedVol(closes, 20)).toBeGreaterThan(0.15);
    expect(realizedVol(closes.slice(0, 10), 20)).toBeNull();
  });
  it("ranks implied volatility only once enough days are recorded", () => {
    expect(ivRank([0.2, 0.3], 0.25)).toBeNull();
    const h = Array.from({ length: 20 }, (_, i) => 0.2 + i * 0.01);
    const r = ivRank(h, 0.4)!;
    expect(r.rank).toBeCloseTo(1, 6);
    expect(r.pct).toBe(1);
    expect(ivRank(h, 0.2)!.rank).toBe(0);
  });
});

describe("earningsPricing", () => {
  const term = [
    { e: "2026-11-20", d: 4, m: 0.03, iv: 0.5, k: 100 },
    { e: "2026-11-27", d: 11, m: 0.06, iv: 0.5, k: 100 },
  ];
  it("compares the priced move with the median past reaction and counts bigger past moves", async () => {
    const { earningsPricing } = await import("./core");
    const p = earningsPricing(term, "2026-11-24", "2026-11-16", [0.02, -0.08, 0.05, -0.1])!;
    expect(p.point.e).toBe("2026-11-27");
    expect(p.past).toEqual({ n: 4, median: 0.065, mean: 0.0625, exceeded: 2 });
  });
});
