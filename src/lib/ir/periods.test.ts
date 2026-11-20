import { fiscalLabel, fiscalYearEndMonth, uniqueHeads } from "./periods";
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
  const cal = (ends: string[]) => ({ ends, fallback: null });
  it("names NVIDIA's quarters by position and month, never by a guessed fiscal year number", () => {
    const nv = cal(["2024-01-28", "2025-01-26", "2026-01-25"]);
    expect(fiscalLabel("2024-10-27", "q", nv)).toMatchObject({ main: "Q3", sub: "Oct ’24" });
    expect(fiscalLabel("2025-01-26", "q", nv)).toMatchObject({ main: "Q4", sub: "Jan ’25" });
    expect(fiscalLabel("2025-04-27", "q", nv)).toMatchObject({ main: "Q1", sub: "Apr ’25" });
    expect(fiscalLabel("2025-01-26", "y", nv)).toEqual({ main: "FY ending", sub: "Jan ’25", short: "FY ending Jan ’25" });
  });
  it("gives a February-year-end retailer the same unambiguous heads (Home Depot's year to 2 Feb 2025 is its fiscal 2024)", () => {
    const hd = cal(["2024-01-28", "2025-02-02", "2026-02-01"]);
    expect(fiscalLabel("2025-02-02", "y", hd)).toMatchObject({ main: "FY ending", sub: "Jan ’25" });
    expect(fiscalLabel("2024-11-03", "q", hd)).toMatchObject({ main: "Q3", sub: "Oct ’24" });
    expect(fiscalLabel("2025-02-02", "y", hd).main).not.toMatch(/FY2[45]/);
  });
  it("is not thrown by a stray calendar-year column among January year-ends", () => {
    const nv = cal(["2024-01-28", "2024-12-31", "2025-01-26", "2026-01-25"]);
    expect(fiscalLabel("2024-10-27", "q", nv)).toMatchObject({ main: "Q3", sub: "Oct ’24" });
  });
  it("follows each era's year-end when a company changes it", () => {
    const ch = cal(["2022-06-30", "2023-06-30", "2024-12-31", "2025-12-31"]);
    expect(fiscalLabel("2025-12-31", "q", ch).main).toBe("Q4 FY25");
    expect(fiscalLabel("2025-09-30", "q", ch).main).toBe("Q3 FY25");
    expect(fiscalLabel("2023-03-31", "q", ch)).toMatchObject({ main: "Q3", sub: "Mar ’23" });
    expect(fiscalLabel("2023-06-30", "y", ch).main).toBe("FY ending");
    expect(fiscalLabel("2025-12-31", "y", ch).main).toBe("FY25");
  });
  it("labels an off-grid stub period by its month, so no two columns share a head", () => {
    const nv = cal(["2025-01-26"]);
    expect(fiscalLabel("2024-12-31", "q", nv)).toMatchObject({ main: "Dec ’24", sub: "" });
    const heads = uniqueHeads(["2024-12-31", "2025-01-26", "2025-01-31"], "q", nv);
    const shown = [...heads.values()].map((h) => `${h.main}|${h.sub}`);
    expect(new Set(shown).size).toBe(3);
  });
  it("reads calendar quarters when the payload shows a December year-end", () => {
    expect(fiscalLabel("2026-06-30", "q", 12)).toMatchObject({ main: "Q2 FY26", sub: "Jun ’26" });
    expect(fiscalYearEndMonth({ years: [], series: [{ k: "a", cat: "kpi", met: "other", label: "x", parent: null, total: false, unit: "usd", q: { "2026-03-31": { v: 1, m: 3 }, "2026-06-30": { v: 1, m: 3 } }, y: {} }] })).toBe(12);
  });
  it("leads with the calendar month when the fiscal year-end is unknown", () => {
    expect(fiscalLabel("2024-10-27", "q", null)).toMatchObject({ main: "Oct ’24", sub: "" });
  });
});
