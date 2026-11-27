import { describe, expect, it } from "vitest";
import TA from "./ta";
import { toHist } from "./data";

const closes = Array.from({ length: 600 }, (_, i) => 100 + 10 * Math.sin(i / 15) + i * 0.05);

describe("technicals library port", () => {
  it("computes indicators aligned to the input with warm-up nulls", () => {
    const s = TA.sma(closes, 50);
    expect(s[48]).toBeNull();
    expect(s[49]).toBeCloseTo(closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50, 10);
    const r = TA.rsi(closes, 14);
    expect(r[13]).toBeNull();
    expect(r[14]).toBeGreaterThan(0);
    expect(r[599]).toBeLessThanOrEqual(100);
  });
  it("runs the full analysis and backtests every signal against the base rate", () => {
    const h = toHist("TEST", {
      meta: { symbol: "TEST" },
      d: closes.map((_, i) =>
        new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10),
      ),
      o: closes,
      h: closes.map((c) => c + 1),
      l: closes.map((c) => c - 1),
      c: closes,
      v: closes.map(() => 1e6),
      div: [],
    });
    const A = TA.analyze({ o: h.o, h: h.h, l: h.l, c: h.c, v: h.v, tr: h.tr, d: h.d });
    expect(A.backtest.base[20].n).toBe(600 - 252 - 20);
    expect(A.cone.map((c) => c.n)).toEqual([10, 21, 63, 126, 252]);
    expect(A.state.i).toBe(599);
    const S = TA.summary(A.state, { cone: A.cone, since: "2020" });
    expect(
      TA.validateSummary(S, { ...A.state, vol21: A.cone[1].current, vol21pct: A.cone[1].pct }),
    ).toEqual([]);
  });
  it("reinvests dividends in the total-return index", () => {
    const h = toHist("D", {
      meta: { symbol: "D" },
      d: ["2024-01-02", "2024-01-03", "2024-01-04"],
      o: [10, 10, 10],
      h: [10, 10, 10],
      l: [10, 10, 10],
      c: [10, 10, 10],
      v: [1, 1, 1],
      div: [["2024-01-03", 0.5]],
    });
    expect(h.tr).toEqual([1, 1.05, 1.05]);
  });
});

it("compares matched, completed calendar months and drops missing month-end quotes", async () => {
  const { monthEndReturns, seasonalContext } = await import("./seasonality");
  const dates = ["2025-01-31", "2025-02-28", "2025-03-28", "2025-04-30", "2025-05-30", "2025-06-11"];
  const prices = [100, 110, 120, 130, 143, 164];
  const rows = monthEndReturns(dates, prices);
  expect(rows.map(r => r[0])).toEqual(["2025-02","2025-05"]);
  const ctx = seasonalContext(dates, prices, [{sym:"XLF", kind:"sector", d: dates.slice(0,2), tr:[100,104]}]);
  expect(ctx[1].median).toBeCloseTo(.1);
  expect(ctx[1].excess[0].median).toBeCloseTo(.06);
  expect(ctx[4].excess[0]).toMatchObject({n:0, median:null});
});
