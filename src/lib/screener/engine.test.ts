import { describe, expect, it } from "vitest";
import type { UniverseEntry } from "@/lib/financials/types";
import {
  basicRow,
  emptySpec,
  filterText,
  run,
  validate,
  withLive,
  type Catalogue,
  type FieldDef,
  type Row,
} from "./engine";

const fields: FieldDef[] = [
  { id: "pe", g: "val", n: "P/E", u: "x", d: "", q: [8, 20, 60] },
  { id: "om", g: "qual", n: "Operating margin", u: "pct", d: "", q: [-0.1, 0.15, 0.4] },
  { id: "mcap", g: "val", n: "Market cap", u: "usd", d: "", q: [2e9, 30e9, 900e9] },
  { id: "above_sma200", g: "px", n: "Above 200-day", u: "bool", d: "" },
  { id: "price", g: "px", n: "Price", u: "usd", d: "" },
  { id: "fcf_yield", g: "val", n: "FCF yield", u: "pct", d: "" },
];
const F = new Map(fields.map((f) => [f.id, f]));
const rows: Row[] = [
  {
    ticker: "AAA",
    name: "Alpha",
    sector: "Industrials",
    industry: "Machinery",
    pe: 10,
    om: 0.2,
    mcap: 10e9,
    above_sma200: true,
    sp500: true,
    sp100: false,
  },
  {
    ticker: "BBB",
    name: "Beta",
    sector: "Industrials",
    industry: "Machinery",
    pe: 30,
    om: 0.05,
    mcap: 50e9,
    above_sma200: false,
    sp500: true,
    sp100: true,
  },
  {
    ticker: "CCC",
    name: "Gamma",
    sector: "Utilities",
    industry: "Electric",
    pe: 15,
    om: 0.3,
    mcap: 20e9,
    above_sma200: true,
    sp500: false,
    sp100: false,
  },
  {
    ticker: "DDD",
    name: "Delta",
    sector: "Utilities",
    industry: "Electric",
    pe: null,
    om: -0.1,
    mcap: 5e9,
    above_sma200: false,
    sp500: false,
    sp100: false,
  },
];
const cat: Catalogue = {
  fields,
  sectors: ["Industrials", "Utilities"],
  industries: ["Machinery", "Electric"],
  tickers: rows.map((r) => r.ticker),
};

describe("validate", () => {
  it("normalizes ops, booleans and percentage slips", () => {
    const { spec, errors, warnings } = validate(
      {
        filters: [
          { field: "om", op: "gt", value: 15 },
          { field: "above_sma200", op: "=", value: true },
          { field: "pe", op: "bottom_pct", pct: 50, scope: "sector" },
        ],
        sectors: ["utilities"],
        sort: { field: "pe", dir: "ASC" },
      },
      cat,
    );
    expect(errors).toEqual([]);
    expect(spec.filters[0]).toEqual({ field: "om", op: ">", value: 0.15 });
    expect(spec.filters[1]).toEqual({ field: "above_sma200", op: "true" });
    expect(spec.filters[2]).toMatchObject({ op: "bottom", pct: 50, scope: "sector" });
    expect(spec.sectors).toEqual(["Utilities"]);
    expect(spec.sort).toEqual({ field: "pe", dir: "asc" });
    expect(warnings.length).toBe(1);
  });
  it("reports unknown fields and tickers", () => {
    const { errors, spec } = validate(
      {
        filters: [{ field: "nope", op: ">", value: 1 }],
        tickers: ["ZZZ"],
        similar_to: { ticker: "AAA" },
      },
      cat,
    );
    expect(errors).toContain('Unknown field "nope" in filter 1');
    expect(errors).toContain('Unknown ticker "ZZZ"');
    expect(spec.similar_to).toEqual({ ticker: "AAA", n: 25 });
  });
});

describe("run", () => {
  it("filters, ranks within sector and sorts with nulls last", () => {
    const spec = {
      ...emptySpec(),
      filters: [
        validate({ filters: [{ field: "pe", op: "bottom", pct: 50, scope: "sector" }] }, cat).spec
          .filters[0],
      ],
      sort: { field: "pe", dir: "asc" as const },
    };
    expect(run(rows, spec, F).rows.map((r) => r.ticker)).toEqual(["AAA", "CCC"]);
    const s2 = { ...emptySpec(), sort: { field: "pe", dir: "desc" as const } };
    expect(run(rows, s2, F).rows.map((r) => r.ticker)).toEqual(["BBB", "CCC", "AAA", "DDD"]);
  });
  it("applies index membership and booleans", () => {
    const spec = {
      ...emptySpec(),
      index: "sp500" as const,
      filters: [{ field: "above_sma200", op: "true" as const }],
    };
    expect(run(rows, spec, F).rows.map((r) => r.ticker)).toEqual(["AAA"]);
  });
  it("describes filters", () => {
    expect(filterText({ field: "om", op: ">", value: 0.15 }, F)).toBe("Operating margin > 15%");
    expect(filterText({ field: "pe", op: "bottom", pct: 25, scope: "sector" }, F)).toBe(
      "P/E: bottom 25% in sector",
    );
  });
});

describe("rows", () => {
  it("builds valuation from SEC fundamentals and a live price", () => {
    const u = {
      ticker: "XYZ",
      name: "XYZ Corp",
      sector: "Industrials",
      industry: "Machinery",
      sharesOutstanding: 100,
      epsTTM: 2,
      revenueGrowthYoY: 0.1,
      grossMarginTTM: 0.4,
      f: {
        asOf: "2026-09-30",
        ttm: {
          revenue: 1000,
          grossProfit: 400,
          operatingIncome: 200,
          netIncome: 150,
          fcf: 100,
          epsDiluted: 2,
          dividends: -20,
          buybacks: -30,
          dna: 50,
        },
        bs: { totalDebt: 300, cash: 100, equity: 500 },
        revenueHistory: [],
        revenueCagr3y: 0.08,
        revenueCagr5y: 0.07,
        epsGrowthYoY: 0.12,
        dilutedShares: 100,
      },
    } as unknown as UniverseEntry;
    const r = basicRow(u, 40);
    expect(r.mcap).toBe(4000);
    expect(r.pe).toBe(20);
    expect(r.ev).toBe(4200);
    expect(r.om).toBe(0.2);
    expect(r.nd_ebitda).toBeCloseTo(0.8);
    expect(r.sh_yield).toBeCloseTo(50 / 4000);
    expect(basicRow(u, null).mcap).toBeNull();
  });
  it("moves price-based fields to the live quote", () => {
    const r: Row = {
      ticker: "AAA",
      name: "A",
      sector: "",
      industry: "",
      price: 100,
      mcap: 1000,
      pe: 20,
      fcf_yield: 0.05,
      ev: 1200,
      om: 0.2,
    };
    const o = withLive(r, {
      symbol: "AAA",
      price: 110,
      previousClose: 100,
      change: 10,
      changePct: 10,
      spark: [],
    });
    expect(o.mcap).toBeCloseTo(1100);
    expect(o.pe).toBeCloseTo(22);
    expect(o.fcf_yield).toBeCloseTo(0.05 / 1.1);
    expect(o.ev).toBeCloseTo(1300);
    expect(o.om).toBe(0.2);
  });
});
