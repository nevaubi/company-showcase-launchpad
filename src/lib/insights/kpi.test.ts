import { describe, expect, it } from "vitest";
import { cardsOf, chartFor, filterIndex, fmtChartValue, orderedRows, type KpiIndexFile, type KpiInsightsFile, type KpiIndexRow } from "./kpi";

const file = (over: Partial<KpiInsightsFile> = {}): KpiInsightsFile => ({
  ticker: "SBUX",
  name: "Starbucks",
  sector: "Consumer Discretionary",
  generated: "2026-11-07T20:00:00Z",
  run_id: "x",
  status: "signals_only",
  insights: [],
  dropped: [],
  models: {},
  signals: [
    { kind: "mix", strength: 4, reason: "ticket up while traffic down", facts: ["m:comps"], chart: { name: "Comps", unit: "%", points: [["2026-06-28", 7.9], ["2026-09-27", 7.2]] } },
    { kind: "trend", strength: 2, reason: "Digital share highest in 13 quarters", facts: ["k:digital:ext"] },
  ],
  facts: {
    "m:comps": { text: "Global comparable store sales growth was 7.2%...", sources: [{ doc: "864b627ede2ead30", page: 1, label: "Q4 FY26" }] },
    "k:digital:ext": { text: "Digital share was 38.8%...", sources: [] },
  },
  kpi_count: 120,
  label: "Signals detected in code",
  ...over,
});

const row = (t: string, over: Partial<KpiIndexRow> = {}): KpiIndexRow => ({
  ticker: t,
  name: t,
  sector: "Industrials",
  generated: "2026-11-07T20:00:00Z",
  status: "signals_only",
  n_insights: 0,
  n_signals: 3,
  kinds: ["trend"],
  strength: 2,
  reason: "r",
  top: null,
  signals: [],
  ...over,
});

describe("kpi insights helpers", () => {
  it("shows detected signals when no model insights exist, and model insights when they do", () => {
    const f = file();
    const cards = cardsOf(f);
    expect(cards.map((c) => c.title)).toEqual(["ticket up while traffic down", "Digital share highest in 13 quarters"]);
    expect(cards[0].model).toBe(false);
    const g = file({ insights: [{ title: "Price carried comps", text: "Ticket 5.2% while traffic 1.8%.", kind: "mix", refs: ["m:comps"] }], status: "ok" });
    expect(cardsOf(g)).toHaveLength(1);
    expect(cardsOf(g)[0].model).toBe(true);
    expect(chartFor(g, ["m:comps"])?.name).toBe("Comps");
    expect(chartFor(g, ["nope"])).toBeUndefined();
  });

  it("orders companies with written insights first, then by strength, and filters", () => {
    const idx: KpiIndexFile = {
      generated: "",
      count: 3,
      order: [],
      method: "",
      companies: {
        A: row("A", { strength: 5 }),
        B: row("B", { strength: 1, n_insights: 2, kinds: ["contracts"], sector: "Energy" }),
        C: row("C", { strength: 3 }),
      },
    };
    const rows = orderedRows(idx);
    expect(rows.map((r) => r.ticker)).toEqual(["B", "A", "C"]);
    const base = { sector: "all", kind: "all" as const, scope: "all" as const, q: "", withInsights: false };
    expect(filterIndex(rows, { ...base, kind: "contracts" }, new Set()).map((r) => r.ticker)).toEqual(["B"]);
    expect(filterIndex(rows, { ...base, scope: "watchlist" }, new Set(["C"])).map((r) => r.ticker)).toEqual(["C"]);
    expect(filterIndex(rows, { ...base, withInsights: true }, new Set()).map((r) => r.ticker)).toEqual(["B"]);
    expect(filterIndex(rows, { ...base, sector: "Energy" }, new Set()).map((r) => r.ticker)).toEqual(["B"]);
  });

  it("formats chart values in their unit", () => {
    expect(fmtChartValue(7.2, "%")).toBe("7.2%");
    expect(fmtChartValue(16.78e9, "USD")).toBe("$16.78B");
    expect(fmtChartValue(43, "count")).toBe("43");
    expect(fmtChartValue(6.8, "x")).toBe("6.80");
    expect(fmtChartValue(8295, "count")).toBe("8,295");
  });
});
