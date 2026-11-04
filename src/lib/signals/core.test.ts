import { describe, expect, it } from "vitest";
import { insiderSignal, paperReturn, summarize, valuationSignal } from "./core";
import type { InsiderTrade } from "../financials/types";

const trade = (owner: string, date: string, plan = false): InsiderTrade => ({
  accn: `a-${owner}`, filed: date, owner, role: "Director", date, code: "P", security: "Common", shares: 100, price: 10, acquired: true, ownedAfter: 1000, direct: true, plan10b5: plan, doc: "f.xml",
});

describe("signals", () => {
  it("needs two different insiders buying outside 10b5-1 plans within 90 days", () => {
    expect(insiderSignal([trade("A", "2026-09-01"), trade("A", "2026-09-05")], "2026-10-01")).toBeNull();
    expect(insiderSignal([trade("A", "2026-09-01"), trade("B", "2026-09-05", true)], "2026-10-01")).toBeNull();
    expect(insiderSignal([trade("A", "2026-09-01"), trade("B", "2026-09-05")], "2026-10-01")?.kind).toBe("insiderBuy");
    expect(insiderSignal([trade("A", "2026-05-01"), trade("B", "2026-09-05")], "2026-10-01")).toBeNull();
  });

  it("flags cheap at or below the 15th percentile of the trailing 5 years", () => {
    const series = Array.from({ length: 200 }, (_, k) => ({ date: new Date(Date.UTC(2020, 0, 1) + k * 7 * 86400000).toISOString().slice(0, 10), v: 20 + (k % 10), basis: "Q" }));
    series.push({ date: "2023-11-01", v: 5, basis: "Q" });
    expect(valuationSignal(series, series.length - 1, "P/E")?.kind).toBe("cheap");
    series.push({ date: "2023-11-08", v: 24, basis: "Q" });
    expect(valuationSignal(series, series.length - 1, "P/E")).toBeNull();
  });

  it("paper returns are signed by direction", () => {
    expect(paperReturn("long", 100, 110)).toBeCloseTo(0.1);
    expect(paperReturn("short", 100, 110)).toBeCloseTo(-0.1);
  });

  it("hit rate counts firings that beat SPY", () => {
    const s = summarize([{ ret: 0.1, excess: 0.05 }, { ret: -0.1, excess: -0.02 }]);
    expect(s.hitRate).toBe(0.5);
    expect(s.n).toBe(2);
  });
});
