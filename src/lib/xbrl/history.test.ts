import { describe, expect, it } from "vitest";
import type { DetailPeriod, DetailTable, FilingDetail } from "./detail";
import { historySpan, mergeHistory, periodSources } from "./history";

const FY = (y: number): DetailPeriod => ({ key: `D${y}-01-01_${y}-12-31`, start: `${y}-01-01`, end: `${y}-12-31`, months: 12 });
const k = (y: number) => FY(y).key;

function filing(accn: string, year: number, tables: DetailTable[], extra: Partial<FilingDetail> = {}): FilingDetail {
  const periods: Record<string, DetailPeriod> = {};
  for (let y = year - 2; y <= year; y++) periods[k(y)] = FY(y);
  periods["Q"] = { key: "Q", start: `${year}-10-01`, end: `${year}-12-31`, months: 3 };
  periods["B1"] = { key: "B1", label: "Year 1", end: `${year}-12-31`, months: 0 };
  return { format: 3, ticker: "X", accn, form: "10-K", filed: `${year + 1}-02-10`, reportDate: `${year}-12-31`, doc: `${accn}.htm`, periods, tables, segments: null, concentration: [], counts: { facts: 0, dimensional: 0 }, ...extra };
}
const table = (rows: [string, string, Record<string, number>][], periods: string[], extra: Partial<DetailTable> = {}): DetailTable => ({
  id: "revenue|us-gaap:Revenues|USD|srt:StatementGeographicalAxis",
  family: "revenue",
  title: "Revenue by region",
  concept: "us-gaap:Revenues",
  conceptLabel: "Revenue",
  axis: "srt:StatementGeographicalAxis",
  axisLabel: "Region",
  unit: "USD",
  periods,
  rows: rows.map(([member, label, vals]) => ({ member, label, values: Object.fromEntries(Object.entries(vals).map(([p, v]) => [p, { v, id: `${member}-${p}` }])) })),
  ...extra,
});

// Latest 10-K covers FY2023–FY2025; the one two years back covers FY2021–FY2023 (FY2023 as originally filed).
const latest = filing("new", 2025, [
  table([["x:US", "United States", { [k(2023)]: 100, [k(2024)]: 110, [k(2025)]: 120 }], ["x:EMEA", "Europe", { [k(2023)]: 50, [k(2024)]: 55, [k(2025)]: 60 }]], [k(2023), k(2024), k(2025)], { total: { [k(2025)]: { v: 180 } } }),
  table([["x:Ob", "Purchase obligations", { B1: 9 }]], ["B1"], { id: "commitments|x|USD|", family: "commitments" }),
]);
const older = filing("old", 2023, [
  table(
    [
      ["x:US", "United States", { [k(2021)]: 80, [k(2022)]: 90, [k(2023)]: 99 }],
      ["x:EuropeOld", "Europe", { [k(2021)]: 40, [k(2022)]: 45, [k(2023)]: 49, Q: 12 }],
      ["x:LatAm", "Latin America", { [k(2021)]: 5, [k(2022)]: 6, [k(2023)]: 7 }],
    ],
    [k(2021), k(2022), k(2023), "Q"],
    { total: { [k(2021)]: { v: 125 }, [k(2023)]: { v: 155 } } },
  ),
  table([["x:Ob", "Purchase obligations", { B1: 4 }]], ["B1"], { id: "commitments|x|USD|", family: "commitments" }),
]);

describe("multi-year filing detail", () => {
  const m = mergeHistory(latest, [older]);
  const t = m.tables[0];
  const row = (label: string) => t.rows.find((r) => r.label === label)!;

  it("adds the earlier fiscal years in date order", () => {
    expect(t.periods).toEqual([k(2021), k(2022), k(2023), k(2024), k(2025)]);
    expect(row("United States").values[k(2021)].v).toBe(80);
  });

  it("keeps the newest filing's value for a year both filings report", () => {
    expect(row("United States").values[k(2023)].v).toBe(100);
    expect(row("Europe").values[k(2023)].v).toBe(50);
  });

  it("points carried-in values at their own filing", () => {
    expect(row("United States").values[k(2021)]).toMatchObject({ accn: "old", doc: "old.htm", id: "x:US-" + k(2021) });
    expect(row("United States").values[k(2025)].accn).toBeUndefined();
    expect(t.total?.[k(2021)]).toMatchObject({ v: 125, accn: "old" });
    expect(t.total?.[k(2023)]).toBeUndefined();
  });

  it("matches a renamed member by its label", () => {
    expect(row("Europe").values[k(2022)].v).toBe(45);
    expect(t.rows.filter((r) => r.label === "Europe")).toHaveLength(1);
  });

  it("keeps a region the latest filing dropped, only for years no newer filing reports", () => {
    const latam = row("Latin America");
    expect(latam.former).toBe(true);
    expect(Object.keys(latam.values).sort()).toEqual([k(2021), k(2022)]);
  });

  it("never carries quarter or maturity-bucket columns", () => {
    expect(t.periods).not.toContain("Q");
    expect(m.tables[1].periods).toEqual(["B1"]);
    expect(m.tables[1].rows[0].values.B1.v).toBe(9);
  });

  it("names the span and the filing behind each column", () => {
    expect(historySpan(m)).toBe("FY2021–FY2025");
    const src = periodSources(m);
    expect(src.map((s) => s.accn)).toEqual(["new", "old"]);
    expect(src[1].keys.sort()).toEqual([k(2021), k(2022)]);
  });

  it("returns the filing unchanged without earlier 10-Ks", () => {
    expect(mergeHistory(latest, [])).toBe(latest);
    expect(mergeHistory(latest, [latest])).toBe(latest);
  });

  it("extends the segment P&L by segment member or label", () => {
    const seg = (accn: string, year: number, member: string, vals: Record<string, number>) =>
      filing(accn, year, [], {
        segments: { periods: Object.keys(vals), segments: [{ member, label: "Cloud" }], rows: [{ concept: "us-gaap:Revenues", label: "Revenue", kind: "revenue", values: { [member]: Object.fromEntries(Object.entries(vals).map(([p, v]) => [p, { v }])) } }] },
      });
    const merged = mergeHistory(seg("new", 2025, "x:Cloud", { [k(2024)]: 10, [k(2025)]: 12 }), [seg("old", 2023, "x:CloudOld", { [k(2022)]: 7, [k(2023)]: 8, [k(2024)]: 99 })]);
    expect(merged.segments!.segments).toHaveLength(1);
    expect(merged.segments!.periods).toEqual([k(2022), k(2023), k(2024), k(2025)]);
    expect(merged.segments!.rows[0].values["x:Cloud"][k(2022)]).toMatchObject({ v: 7, accn: "old" });
    expect(merged.segments!.rows[0].values["x:Cloud"][k(2024)].v).toBe(10);
  });
});

describe("growth over the years shown", () => {
  it("compounds from the first to the latest fiscal year", async () => {
    const { cagrOf } = await import("./detail");
    const m = mergeHistory(latest, [older]);
    const t = m.tables[0];
    const us = t.rows.find((r) => r.label === "United States")!;
    const g = cagrOf(t, us.values, m.periods)!;
    expect(g.years).toBe(4);
    expect(g.rate).toBeCloseTo((120 / 80) ** (1 / 4) - 1, 6);
    // Latin America: 2021–2022 only, too short to compound.
    expect(cagrOf(t, t.rows.find((r) => r.label === "Latin America")!.values, m.periods)).toBeNull();
    // Three years in the latest filing alone are only two years apart.
    expect(cagrOf(latest.tables[0], latest.tables[0].rows[0].values, latest.periods)).toBeNull();
  });
});

describe("row matching across filings", () => {
  it("joins a label that only gained a parenthetical note, never two candidates", () => {
    const geo = (accn: string, year: number, rows: [string, string, Record<string, number>][]) => filing(accn, year, [table(rows, Object.keys(rows[0][2]))]);
    const merged = mergeHistory(geo("new", 2025, [["x:CnHk", "China (including Hong Kong)", { [k(2025)]: 20 }]]), [geo("old", 2023, [["country:CN", "China", { [k(2022)]: 7 }]])]);
    expect(merged.tables[0].rows).toHaveLength(1);
    expect(merged.tables[0].rows[0].values[k(2022)].v).toBe(7);
    const two = mergeHistory(geo("new", 2025, [["a", "Other (Americas)", { [k(2025)]: 1 }], ["b", "Other (Asia)", { [k(2025)]: 2 }]]), [geo("old", 2023, [["c", "Other", { [k(2022)]: 3 }]])]);
    expect(two.tables[0].rows.find((r) => r.label === "Other")?.former).toBe(true);
  });
});
