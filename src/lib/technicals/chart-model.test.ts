import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/financials/types";
import {
  barsInRange,
  bucketize,
  drawdownSeries,
  fmtBarDate,
  fmtBucket,
  fmtQuote,
  fmtVolume,
  grainFor,
  indexOnOrAfter,
  linearTicks,
  logTicks,
  spreadLabels,
  tickDecimals,
  timeTicks,
  weekKey,
} from "./chart-model";

/** Weekday bars from a start date: close i + 100, open one below, high two above, low two below, volume 10. */
function weekdays(start: string, n: number): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const c = 100 + out.length;
      out.push([d.toISOString().slice(0, 10), c - 1, c + 2, c - 2, c, c, 10]);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("chart model: merging bars into candles", () => {
  it("keys a bar by the Monday of its week", () => {
    // 20 Nov 2026 is a Friday; its week starts Monday 16 Nov. A Monday keys to itself, a Sunday to the Monday before.
    expect(weekKey("2026-11-20")).toBe("2026-11-16");
    expect(weekKey("2026-11-16")).toBe("2026-11-16");
    expect(weekKey("2026-11-22")).toBe("2026-11-16");
    // across a year boundary: Friday 1 Jan 2027 belongs to the week of Monday 28 Dec 2026
    expect(weekKey("2027-01-01")).toBe("2026-12-28");
  });

  it("picks the finest grain that leaves each candle its minimum width", () => {
    // 250 bars in 900 px: 3.6 px each, daily candles fit
    expect(grainFor(250, 900)).toBe("bar");
    // 2,520 bars in 900 px: daily 0.36 px; weekly 504 candles at 1.8 px; monthly 120 candles at 7.5 px
    expect(grainFor(2520, 900)).toBe("month");
    // 1,260 bars in 900 px: weekly 252 candles at 3.6 px
    expect(grainFor(1260, 900)).toBe("week");
    // 4,750 bars in 320 px: monthly 226 candles at 1.4 px, so quarterly
    expect(grainFor(4750, 320)).toBe("quarter");
    // intraday bars are never merged
    expect(grainFor(5000, 300, 3, true)).toBe("bar");
  });

  it("merges to first open, highest high, lowest low, last close and summed volume", () => {
    // Mon 2 Nov to Fri 13 Nov 2026: two full weeks
    const rows = weekdays("2026-11-02", 10);
    const w = bucketize(rows, 0, 9, "week");
    expect(w).toHaveLength(2);
    expect(w[0]).toEqual({ i0: 0, i1: 4, t0: "2026-11-02", t: "2026-11-06", o: 99, h: 106, l: 98, c: 104, v: 50 });
    expect(w[1]).toEqual({ i0: 5, i1: 9, t0: "2026-11-09", t: "2026-11-13", o: 104, h: 111, l: 103, c: 109, v: 50 });
    // one candle per bar at the daily grain, and the range is honoured
    const d = bucketize(rows, 2, 4, "bar");
    expect(d.map((b) => b.i0)).toEqual([2, 3, 4]);
    expect(d[0].o).toBe(101);
    // out-of-range bounds are clipped
    expect(bucketize(rows, -5, 99, "bar")).toHaveLength(10);
  });

  it("splits months and quarters on the calendar", () => {
    // 23 Nov 2026 onward: 6 sessions in November (23, 24, 25, 26, 27, 30), then December
    const rows = weekdays("2026-11-23", 30);
    const m = bucketize(rows, 0, 29, "month");
    expect(m.map((b) => b.t0.slice(0, 7))).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(m[0].i1 - m[0].i0 + 1).toBe(6);
    // December 2026 has 23 weekdays
    expect(m[1].i1 - m[1].i0 + 1).toBe(23);
    const q = bucketize(rows, 0, 29, "quarter");
    expect(q.map((b) => b.t0)).toEqual(["2026-11-23", "2027-01-01"]);
    // every source bar lands in exactly one candle
    expect(q.reduce((a, b) => a + (b.i1 - b.i0 + 1), 0)).toBe(30);
    expect(m.reduce((a, b) => a + b.v, 0)).toBe(300);
  });
});

describe("chart model: axis values", () => {
  it("places linear ticks on round numbers inside the range", () => {
    expect(linearTicks(101.3, 148.9, 5)).toEqual([110, 120, 130, 140]);
    expect(linearTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(linearTicks(-0.42, 0.03, 4)).toEqual([-0.4, -0.2, 0]);
    expect(linearTicks(5, 5, 4)).toEqual([5]);
    expect(linearTicks(NaN, 5, 4)).toEqual([]);
    // no floating-point dust in the labels
    expect(linearTicks(0.1, 0.7, 6)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });

  it("places log ticks on 1, 2, 5 multiples and thins them to the count", () => {
    expect(logTicks(8, 260, 6)).toEqual([10, 20, 50, 100, 200]);
    // a wide range keeps only the rounder multiples
    const wide = logTicks(0.5, 900, 5);
    expect(wide).toEqual([1, 3, 10, 30, 100, 300]);
    // a narrow range falls back to linear steps
    expect(logTicks(100, 180, 4)).toEqual([100, 120, 140, 160, 180]);
    expect(logTicks(0, 10, 4)).toEqual([]);
    expect(logTicks(-1, 10, 4)).toEqual([]);
  });

  it("chooses the decimals an axis needs", () => {
    expect(tickDecimals([100, 120, 140])).toBe(0);
    expect(tickDecimals([1.5, 2, 2.5])).toBe(1);
    expect(tickDecimals([0.25, 0.3, 0.35])).toBe(2);
    expect(tickDecimals([0.005, 0.01])).toBe(3);
    expect(tickDecimals([250])).toBe(0);
    expect(tickDecimals([2.5])).toBe(2);
  });

  it("formats quotes, volume and dates", () => {
    expect(fmtQuote(342.555)).toBe("342.56");
    expect(fmtQuote(1234.5)).toBe("1,234.50");
    expect(fmtQuote(0.3456)).toBe("0.3456");
    expect(fmtVolume(1_234_000_000)).toBe("1.23B");
    expect(fmtVolume(48_600_000)).toBe("48.6M");
    expect(fmtVolume(9_400)).toBe("9K");
    expect(fmtVolume(512)).toBe("512");
    expect(fmtBarDate("2026-11-20")).toBe("Nov 20, 2026");
    expect(fmtBarDate("2026-01-05")).toBe("Jan 5, 2026");
    // 19:35 UTC on 20 Nov 2026 is 14:35 in New York (standard time)
    expect(fmtBarDate("2026-11-20T19:35:00.000Z")).toBe("Nov 20, 14:35");
    expect(fmtBucket({ t0: "2026-11-16", t: "2026-11-20" }, "week")).toBe("Nov 16 to 20, 2026");
    expect(fmtBucket({ t0: "2026-11-30", t: "2026-12-04" }, "week")).toBe("Nov 30 to Dec 4, 2026");
    expect(fmtBucket({ t0: "2026-11-02", t: "2026-11-30" }, "month")).toBe("Nov 2026");
    expect(fmtBucket({ t0: "2026-10-01", t: "2026-12-31" }, "quarter")).toBe("Q4 2026");
    expect(fmtBucket({ t0: "2026-11-20", t: "2026-11-20" }, "week")).toBe("Nov 20, 2026");
  });

  it("puts time ticks on calendar boundaries, never closer than the minimum gap", () => {
    // one year of daily bars in 900 px: months fit (about 75 px each)
    const rows = weekdays("2025-11-24", 252);
    const buckets = bucketize(rows, 0, 251, "bar");
    const t = timeTicks(buckets, 900, 64);
    expect(t.length).toBeGreaterThanOrEqual(10);
    expect(t.length).toBeLessThanOrEqual(12);
    // every tick sits on the first session of a month
    for (const x of t) expect(buckets[x.k].t0.slice(0, 7)).not.toBe(buckets[x.k - 1].t0.slice(0, 7));
    // January carries the year and is the major tick
    const jan = t.find((x) => buckets[x.k].t0.slice(5, 7) === "01")!;
    expect(jan.label).toBe("2026");
    expect(jan.major).toBe(true);
    expect(t.filter((x) => x.major)).toHaveLength(1);
    const slot = 900 / 252;
    for (let j = 1; j < t.length; j++) expect((t[j].k - t[j - 1].k) * slot).toBeGreaterThanOrEqual(64);

    // the same year in 320 px: months no longer fit, quarters do
    const narrow = timeTicks(buckets, 320, 64);
    expect(narrow.length).toBeLessThanOrEqual(4);
    for (let j = 1; j < narrow.length; j++) expect((narrow[j].k - narrow[j - 1].k) * (320 / 252)).toBeGreaterThanOrEqual(64);

    // ten years of monthly candles: one label a year or every second year
    const ten = bucketize(weekdays("2016-11-21", 2610), 0, 2609, "month");
    const years = timeTicks(ten, 900, 64);
    expect(years.every((x) => /^\d{4}$/.test(x.label))).toBe(true);
    expect(years.length).toBeGreaterThanOrEqual(5);
    expect(years.length).toBeLessThanOrEqual(11);
    expect(timeTicks([], 900)).toEqual([]);
  });

  it("spreads overlapping labels apart inside the pane", () => {
    // three tags at 100, 104, 106 with a 14 px gap become 100, 114, 128
    expect(spreadLabels([100, 104, 106], 14, 0, 400)).toEqual([100, 114, 128]);
    // input order is kept
    expect(spreadLabels([106, 100, 104], 14, 0, 400)).toEqual([128, 100, 114]);
    // a stack that runs past the bottom is pushed back up
    expect(spreadLabels([390, 395, 398], 14, 0, 400)).toEqual([372, 386, 400]);
    // labels already apart do not move; out-of-range ones are clamped
    expect(spreadLabels([50, 200, 500], 14, 0, 400)).toEqual([50, 200, 400]);
    expect(spreadLabels([], 14, 0, 400)).toEqual([]);
  });
});

describe("chart model: series helpers", () => {
  it("computes the decline from the running high", () => {
    const dd = drawdownSeries([100, 110, 99, 104.5, 121, 60.5]);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBe(0);
    expect(dd[2]).toBeCloseTo(-0.1, 12);
    expect(dd[3]).toBeCloseTo(-0.05, 12);
    expect(dd[4]).toBe(0);
    expect(dd[5]).toBeCloseTo(-0.5, 12);
  });

  it("finds the first bar on or after a date", () => {
    const rows = weekdays("2026-11-02", 10);
    expect(indexOnOrAfter(rows, "2026-11-02")).toBe(0);
    // Saturday 7 Nov falls to Monday 9 Nov, the sixth bar
    expect(indexOnOrAfter(rows, "2026-11-07")).toBe(5);
    expect(indexOnOrAfter(rows, "2026-11-13")).toBe(9);
    expect(indexOnOrAfter(rows, "2026-12-01")).toBe(10);
    expect(indexOnOrAfter(rows, "2020-01-01")).toBe(0);
  });

  it("counts the bars a range covers on the bars' own dates", () => {
    // weekdays from Mon 23 Nov 2015 through Fri 20 Nov 2026
    const rows = weekdays("2015-11-23", 2870);
    expect(rows[rows.length - 1][0]).toBe("2026-11-20");
    expect(barsInRange(rows, "max")).toBe(2870);
    // one month back is 20 Oct 2026 (a Tuesday): 20 Oct to 20 Nov inclusive is 24 weekdays
    expect(barsInRange(rows, "1mo")).toBe(24);
    // year to date: 1 Jan 2026 to 20 Nov 2026 is 232 weekdays
    expect(barsInRange(rows, "ytd")).toBe(232);
    // one year back is 20 Nov 2025 (a Thursday): 262 weekdays inclusive
    expect(barsInRange(rows, "1y")).toBe(262);
    // ten years back is 20 Nov 2016 (a Sunday): the range starts Monday 21 Nov 2016
    expect(barsInRange(rows, "10y")).toBe(rows.length - indexOnOrAfter(rows, "2016-11-21"));
    // more history asked for than exists: everything
    expect(barsInRange(rows.slice(-100), "5y")).toBe(100);
    expect(barsInRange([], "1y")).toBe(0);
    // never fewer than two bars
    expect(barsInRange(rows.slice(-1), "1mo")).toBe(2);
  });
});
