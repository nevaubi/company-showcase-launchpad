import { fiscalLabel, fiscalYearEndMonth } from "./periods";
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadSeries } from "./payload";
import { cellsFor, closingMonth, periodGrids, quarterMonths } from "./periods";

const series = (k: string, q: Record<string, number>, extra: Partial<PayloadSeries> = {}): PayloadSeries => ({
  k,
  cat: "kpi",
  met: "users",
  label: k,
  parent: null,
  total: false,
  unit: "count",
  q: Object.fromEntries(Object.entries(q).map(([e, v]) => [e, { v, m: extra.pit ? 0 : 3 }])),
  y: {},
  ...extra,
});
const payload = (quarters: string[], years: string[], s: PayloadSeries[]): IrPayload =>
  ({ v: 2, ticker: "X", builtAt: "", quarters, years, docs: [], series: s, groups: [], checks: [], stats: {} }) as unknown as IrPayload;

describe("IR period grids", () => {
  it("reads 52/53-week year ends as the month they close", () => {
    expect(closingMonth("2026-01-03")).toBe(12);
    expect(closingMonth("2026-08-01")).toBe(7);
    expect(closingMonth("2026-09-26")).toBe(9);
  });

  it("splits month-end balances from older payloads into a monthly view", () => {
    const p = payload(
      ["2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"],
      ["2025-12-31"],
      [series("Revenue", { "2026-03-31": 1, "2026-06-30": 2 }, { unit: "usd", met: "revenue" }), series("Funded customers", { "2026-04-30": 26, "2026-05-31": 27, "2026-06-30": 28, "2026-07-31": 29 }, { pit: true })],
    );
    expect([...(quarterMonths(p) ?? [])].sort((a, b) => a - b)).toEqual([3, 6, 9, 12]);
    const g = periodGrids(p);
    expect(g.q).toEqual(["2026-03-31", "2026-06-30"]);
    expect(g.m).toEqual(["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"]);
    expect(Object.keys(cellsFor(p.series[1], "m")).sort()).toEqual(g.m);
    expect(Object.keys(cellsFor(p.series[0], "m"))).toEqual([]);
  });

  it("keeps a quarter that carries flows even after a fiscal-year change", () => {
    const p = payload(["2025-12-31", "2026-02-28"], ["2025-12-31"], [series("Revenue", { "2025-12-31": 1, "2026-02-28": 2 }, { unit: "usd" })]);
    expect(periodGrids(p).q).toEqual(["2025-12-31", "2026-02-28"]);
    expect(periodGrids(p).m).toEqual([]);
  });
});

describe("fiscal column heads", () => {
  it("names NVIDIA's quarters by its January fiscal year", () => {
    expect(fiscalLabel("2024-10-27", "q", 1)).toEqual({ main: "Q3 FY25", sub: "Oct ’24" });
    expect(fiscalLabel("2025-01-26", "q", 1)).toEqual({ main: "Q4 FY25", sub: "Jan ’25" });
    expect(fiscalLabel("2025-04-27", "q", 1)).toEqual({ main: "Q1 FY26", sub: "Apr ’25" });
    expect(fiscalLabel("2026-02-01", "y", 1)).toEqual({ main: "FY26", sub: "Jan ’26" });
  });
  it("reads calendar quarters when the payload shows a December year-end", () => {
    expect(fiscalLabel("2026-06-30", "q", 12)).toEqual({ main: "Q2 FY26", sub: "Jun ’26" });
    expect(fiscalYearEndMonth({ years: [], series: [{ k: "a", cat: "kpi", met: "other", label: "x", parent: null, total: false, unit: "usd", q: { "2026-03-31": { v: 1, m: 3 }, "2026-06-30": { v: 1, m: 3 } }, y: {} }] })).toBe(12);
  });
  it("leads with the calendar month when the fiscal year-end is unknown", () => {
    expect(fiscalLabel("2024-10-27", "q", null)).toEqual({ main: "Oct ’24", sub: "" });
  });
});
