import { describe, expect, it } from "vitest";
import { optionsContext, shortTrend, type OptionsDay, type ShortDay } from "./positioning";

/** Consecutive weekdays ending at `end`, oldest first. */
function weekdays(n: number, end = "2026-11-20"): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T00:00:00Z`);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const days = (shares: number[], total = 1000): ShortDay[] => weekdays(shares.length).map((date, i) => ({ date, short: shares[i] * total, total }));

describe("shortTrend", () => {
  it("compares the last 20 trading days with the 20 before, weighted by volume", () => {
    const t = shortTrend(days([...Array(20).fill(0.4), ...Array(20).fill(0.5)]))!;
    expect(t).toMatchObject({ asOf: "2026-11-20", days: 20 });
    expect(t.share).toBeCloseTo(0.5, 12);
    expect(t.prior).toBeCloseTo(0.4, 12);
    expect(t.share60).toBeNull();
    expect(t.series).toHaveLength(40);
    // volume-weighted, not an average of daily shares
    const w = shortTrend([...days(Array(19).fill(0.5)).map((d, i) => ({ ...d, date: weekdays(20)[i] })), { date: "2026-11-20", short: 9000, total: 10000 }])!;
    expect(w.share).toBeCloseTo((19 * 500 + 9000) / (19 * 1000 + 10000), 12);
  });

  it("has no prior window on a short history and no trend under five days", () => {
    expect(shortTrend(days(Array(30).fill(0.45)))).toMatchObject({ days: 20, prior: null });
    expect(shortTrend(days(Array(12).fill(0.45)))).toMatchObject({ days: 12, prior: null });
    expect(shortTrend(days(Array(4).fill(0.45)))).toBeNull();
    expect(shortTrend([])).toBeNull();
  });

  it("stops at a gap, so a reused ticker's old rows are not counted", () => {
    const old: ShortDay[] = weekdays(300, "2019-06-28").map((date) => ({ date, short: 900, total: 1000 }));
    const t = shortTrend([...old, ...days(Array(25).fill(0.3))])!;
    expect(t.series).toHaveLength(25);
    expect(t.share).toBeCloseTo(0.3, 12);
    expect(t.prior).toBeNull();
  });

  it("skips days with no volume or an impossible count", () => {
    const rows = [...days(Array(10).fill(0.4)), { date: "2026-11-21", short: 0, total: 0 }, { date: "2026-11-22", short: 20, total: 10 }];
    expect(shortTrend(rows)).toMatchObject({ asOf: "2026-11-20", days: 10 });
  });
});

const term = [
  { e: "2026-11-27", d: 7, m: 0.02, iv: 0.22, k: 350 },
  { e: "2026-12-18", d: 28, m: 0.045, iv: 0.24, k: 350 },
  { e: "2027-01-15", d: 56, m: 0.07, iv: 0.25, k: 350 },
  { e: "2027-02-19", d: 91, m: 0.09, iv: 0.26, k: 350 },
];
const option = (date: string, iv30: number | null, over: Partial<OptionsDay> = {}): OptionsDay => ({ date, price: 350, iv30, skew25: 0.05, pc_oi: 0.9, pc_vol: 1.2, term, ...over });

describe("optionsContext", () => {
  it("reads the newest day and the change from five recorded days earlier", () => {
    const dates = weekdays(8);
    const rows = dates.map((d, i) => option(d, 0.2 + i * 0.01));
    const c = optionsContext([...rows].reverse(), null)!;
    expect(c).toMatchObject({ asOf: "2026-11-20", iv30: 0.27, recorded: 8, putCallOpenInterest: 0.9, putCallVolume: 1.2, skew25: 0.05, rank: null });
    expect(c.ivChange).toEqual({ points: expect.closeTo(0.05, 12), from: dates[2] });
    // no earnings date: the expiry about a month out (the first at or after 30 days)
    expect(c.implied).toEqual({ move: 0.07, expiry: "2027-01-15", days: 56, through: "month" });
  });

  it("prices the move through the next report when the date is known and close enough", () => {
    const rows = weekdays(3).map((d) => option(d, 0.25));
    expect(optionsContext(rows, "2026-12-10")!.implied).toEqual({ move: 0.045, expiry: "2026-12-18", days: 28, through: "earnings" });
    // a report date already past, or with no expiry within 45 days after it, falls back to the month
    expect(optionsContext(rows, "2026-11-01")!.implied?.through).toBe("month");
    expect(optionsContext(rows, "2027-06-01")!.implied?.through).toBe("month");
  });

  it("ranks implied volatility only once twenty earlier days are recorded", () => {
    const dates = weekdays(22);
    const rows = dates.map((d, i) => option(d, 0.2 + (i % 5) * 0.02));
    const c = optionsContext(rows, null)!;
    expect(c.rank).toEqual({ rank: expect.closeTo((0.22 - 0.2) / (0.28 - 0.2), 12), n: 21 });
    expect(optionsContext(rows.slice(-20), null)!.rank).toBeNull();
  });

  it("handles days without an implied volatility and an empty history", () => {
    expect(optionsContext([], null)).toBeNull();
    const c = optionsContext([option("2026-11-19", 0.2), option("2026-11-20", null, { term: [] })], null)!;
    expect(c).toMatchObject({ iv30: null, ivChange: null, implied: null, recorded: 1 });
  });
});
