// Growth in the Financials table is shown only over a span whose ends both have values and that reaches the
// table's newest column (p5-shots M7: AAPL interest expense, empty FY2024 to FY2026, showed +9.2%).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { Cell, CompanyDataset, Period, Row } from "@/lib/financials/types";
import { rowTrend } from "./statement-table";

const years = (from: number, n: number): Period[] => Array.from({ length: n }, (_, i) => ({ key: `FY${from + i}`, label: `FY${from + i}`, fy: from + i, end: `${from + i}-12-31` }));
const cell = (v: number) => ({ v }) as Cell;
const row = (vals: (number | null)[]): Row => ({ key: "x", label: "X", unit: "usd", cells: vals.map((v) => (v == null ? null : cell(v))) }) as Row;

describe("rowTrend", () => {
  const p = years(2017, 10);

  it("shows no CAGR when the newest years are empty", () => {
    expect(rowTrend(row([100, 110, 120, 130, 140, 150, 160, null, null, null]), p, "annual")).toBeNull();
  });

  it("covers the full span without naming it", () => {
    const t = rowTrend(row([100, 0, 0, 0, 0, 0, 0, 0, 0, 200].map((v, i) => (i === 0 || i === 9 ? v : 150))), p, "annual")!;
    expect(t.v).toBeCloseTo(Math.pow(2, 1 / 9) - 1, 10);
    expect(t.since).toBeNull();
  });

  it("names the first year when the row starts later than the table", () => {
    const t = rowTrend(row([null, null, null, null, null, 100, 110, 120, 130, 146.41]), p, "annual")!;
    expect(t.v).toBeCloseTo(0.1, 10);
    expect(t.since).toBe("FY2022");
  });

  it("shows no YoY when the newest quarter is empty", () => {
    const q: Period[] = [
      { key: "a", label: "Q3 FY25", fy: 2025, fq: 3, end: "2025-06-30" },
      { key: "b", label: "Q4 FY25", fy: 2025, fq: 4, end: "2025-09-30" },
      { key: "c", label: "Q1 FY26", fy: 2026, fq: 1, end: "2025-12-31" },
      { key: "d", label: "Q2 FY26", fy: 2026, fq: 2, end: "2026-03-31" },
      { key: "e", label: "Q3 FY26", fy: 2026, fq: 3, end: "2026-06-30" },
    ];
    expect(rowTrend(row([10, 11, 12, 13, 12]), q, "quarterly")?.v).toBeCloseTo(0.2, 10);
    expect(rowTrend(row([10, 11, 12, 13, null]), q, "quarterly")).toBeNull();
  });

  it("on Apple's fixture: interest expense, which stops before the newest year, has no CAGR", () => {
    const d = hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8")) as CompanyDataset);
    const inc = d.statements.annual.income;
    const r = inc.rows.find((x) => /interest expense/i.test(x.label));
    expect(r).toBeDefined();
    expect(r!.cells.at(-1)).toBeFalsy();
    expect(rowTrend(r!, inc.periods, "annual")).toBeNull();
    const rev = inc.rows.find((x) => x.key === "revenue")!;
    expect(rowTrend(rev, inc.periods, "annual")?.v).toBeGreaterThan(0);
  });
});
