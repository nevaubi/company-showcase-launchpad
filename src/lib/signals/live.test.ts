import { describe, expect, it } from "vitest";
import { liveDays, livePeriods, sameLiveTrades, type LiveTrade } from "./live";

const t = (variant: string, ticker: string, firedAt: string, net: number): LiveTrade => ({ variant, ticker, firedAt, net });

describe("live record by signal day", () => {
  it("groups trades by rule and entry day", () => {
    const m = liveDays([t("a", "X", "2026-11-17", 0.02), t("a", "Y", "2026-11-16", -0.01), t("a", "Z", "2026-11-16", 0.03), t("b", "X", "2026-11-16", 0.01)]);
    expect(m.get("a")).toEqual([
      { date: "2026-11-16", n: 2, mean: expect.closeTo(0.01, 12) },
      { date: "2026-11-17", n: 1, mean: 0.02 },
    ]);
    expect(m.get("b")).toHaveLength(1);
  });

  it("opens a new period only once the first trade of the current one is out", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-20", "2026-11-23", "2026-12-07"].map((date) => ({ date, n: 1, mean: 0.01 }));
    // 5-day hold: 16 to 20 Nov is within 4 weekdays; 23 Nov is 5 weekdays after 16 Nov: a new period.
    const p = livePeriods(days, 5);
    expect(p.map((x) => [x.start, x.days])).toEqual([
      ["2026-11-16", 3],
      ["2026-11-23", 1],
      ["2026-12-07", 1],
    ]);
    // The period's average is the average of its day averages: a 60-trade day counts once.
    expect(livePeriods([{ date: "2026-11-16", n: 60, mean: -0.03 }, { date: "2026-11-17", n: 1, mean: 0.01 }], 5)[0].mean).toBeCloseTo(-0.01, 12);
  });

  it("finds rules that fired on the same stocks on the same days with the same outcomes", () => {
    const rows = ["A", "B", "C"].flatMap((k, i) => [t("residual:L:5", k, "2026-11-16", 0.01 * i), t("stressRev:L:5", k, "2026-11-16", 0.01 * i)]);
    rows.push(t("rsi2:L:3", "A", "2026-11-16", 0));
    const same = sameLiveTrades(rows);
    expect(same.get("residual:L:5")).toEqual(["stressRev:L:5"]);
    expect(same.get("stressRev:L:5")).toEqual(["residual:L:5"]);
    expect(same.has("rsi2:L:3")).toBe(false);
    // One differing outcome is not the same record.
    rows[0] = t("residual:L:5", "A", "2026-11-16", 0.5);
    expect(sameLiveTrades(rows).size).toBe(0);
  });
});
