import { describe, expect, it } from "vitest";
import TA from "./ta";
import { toHist } from "./data";
import {
  eventRows,
  gapRows,
  gapStats,
  indicatorBoard,
  lastCross,
  levelRows,
  openGaps,
  relSlope,
  runLength,
  trendLineRows,
} from "./dense";

function series(n = 700) {
  const c = Array.from({ length: n }, (_, i) => 100 + 12 * Math.sin(i / 17) + i * 0.04);
  // An up gap at bar 650 that stays open (price moves well above it), and a down gap at 400 that later fills.
  for (let i = 650; i < n; i++) c[i] += 40;
  const o = c.map((x, i) => (i > 0 ? c[i - 1] : x));
  o[650] = c[649] * 1.06;
  o[400] = c[399] * 0.94;
  c[400] = o[400];
  return { c, o };
}
function hist() {
  const { c, o } = series();
  return toHist("TEST", {
    meta: { symbol: "TEST" },
    d: c.map((_, i) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10)),
    o,
    h: c.map((x, i) => Math.max(x, o[i]) + 0.3),
    l: c.map((x, i) => Math.min(x, o[i]) - 0.3),
    c,
    v: c.map((_, i) => 1e6 + (i % 7) * 1e5),
    div: [],
  });
}

describe("dense technical helpers", () => {
  it("finds the last cross and its direction", () => {
    expect(lastCross([1, 2, 3, 4], [2, 2, 2, 2])).toEqual({ i: 2, dir: 1 });
    expect(lastCross([3, 3, 1, 1], 2)).toEqual({ i: 2, dir: -1 });
    expect(lastCross([1, 1, 1], [2, 2, 2])).toBeNull();
    expect(lastCross([null, 1, 3], [2, 2, 2])).toEqual({ i: 2, dir: 1 });
  });
  it("counts how long the current sign has held", () => {
    expect(runLength([-1, 1, 1, 1])).toBe(3);
    expect(runLength([1, -1, -1])).toBe(2);
    expect(runLength([1, null])).toBe(0);
  });
  it("measures a relative regression slope", () => {
    expect(relSlope([1, 2, 3, 4, 5], 5)).toBeCloseTo(1 / 3, 6);
    expect(relSlope([5, 4, 3, 2, 1], 5)!).toBeLessThan(0);
    expect(relSlope([null, null, 1], 5)).toBeNull();
  });
  it("builds every board group from the analysis", () => {
    const H = hist();
    const A = TA.analyze({ o: H.o, h: H.h, l: H.l, c: H.c, v: H.v, tr: H.tr, d: H.d });
    const board = indicatorBoard(H, A);
    expect(board.map((g) => g.title)).toEqual([
      "Trend",
      "Momentum",
      "Trend strength",
      "Volatility",
      "Volume",
    ]);
    const keys = board.flatMap((g) => g.rows.map((r) => r.key));
    for (const k of [
      "regime",
      "vs50",
      "cross",
      "supertrend",
      "rsi",
      "macd",
      "adx",
      "di",
      "atr",
      "bbw",
      "squeeze",
      "relvol",
      "obv",
    ])
      expect(keys).toContain(k);
    expect(board.flatMap((g) => g.rows).every((r) => r.formula.length > 10)).toBe(true);
  });
  it("lists gaps open-first with fill timing and distance", () => {
    const H = hist();
    const A = TA.analyze({ o: H.o, h: H.h, l: H.l, c: H.c, v: H.v, tr: H.tr, d: H.d });
    const rows = gapRows(H, A);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const firstFilled = rows.findIndex((r) => r.filledDate != null);
    const lastOpen = rows.map((r) => r.filledDate == null).lastIndexOf(true);
    if (firstFilled >= 0 && lastOpen >= 0) expect(lastOpen).toBeLessThan(firstFilled);
    const up = rows.find((r) => r.i === 650)!;
    expect(up.dir).toBe(1);
    expect(up.size).toBeCloseTo(0.06, 6);
    expect(up.filledDate).toBeNull();
    expect(up.distance).toBeLessThan(0);
    const down = rows.find((r) => r.i === 400)!;
    expect(down.dir).toBe(-1);
    expect(down.barsToFill).not.toBeNull();
    const s = gapStats(rows);
    expect(s.total).toBe(rows.length);
    expect(s.open + rows.filter((r) => r.filledDate).length).toBe(s.total);
  });
  it("dates levels and trend lines and returns forward returns per event", () => {
    const H = hist();
    const A = TA.analyze({ o: H.o, h: H.h, l: H.l, c: H.c, v: H.v, tr: H.tr, d: H.d });
    for (const L of levelRows(H, A)) {
      expect(L.first <= L.last).toBe(true);
      expect(["support", "resistance"]).toContain(L.kind);
    }
    for (const t of trendLineRows(H, A)) expect(t.from < t.to).toBe(true);
    const ev = eventRows(H, A);
    expect(ev.length).toBe(A.events.length);
    expect(ev[0].i).toBeGreaterThanOrEqual(ev[ev.length - 1].i);
    const old = ev.find((e) => e.i + 60 < H.n)!;
    expect(old.fwd[60]).toBeCloseTo(H.tr[old.i + 60] / H.tr[old.i] - 1, 10);
    const recent = ev.find((e) => e.i + 5 >= H.n);
    if (recent) expect(recent.fwd[5]).toBeNull();
  });
  it("finds open gaps in chart bars", () => {
    const { c, o } = series(700);
    const bars = c.map((x, i) => [
      new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10),
      o[i],
      Math.max(x, o[i]) + 0.3,
      Math.min(x, o[i]) - 0.3,
      x,
      x,
      1e6,
    ]) as [string, number, number, number, number, number, number][];
    const g = openGaps(bars);
    expect(g.some((x) => x.dir === 1 && x.date === bars[650][0])).toBe(true);
    expect(g.every((x) => x.top >= x.bottom)).toBe(true);
  });
});
