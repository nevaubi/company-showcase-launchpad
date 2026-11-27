import { describe, expect, it } from "vitest";
import { bankRevenueEvidence, type Breakdown, type CompFile, type BankRevenuePeriod } from "./groups";

const point = { accession: "source" } as BankRevenuePeriod;
const rows = [{ tk: "A" }, { tk: "B" }] as Breakdown["rows"];
const file = {
  bank_revenue: { A: { "2026Q3": point, "2026Q2": point, "2025Q3": point }, C: { "2026Q3": point } },
  bank_revenue_ttm: { B: { "2026Q3": { annual: point, current_ytd: point, prior_ytd: point, net_revenue: 12 } } },
} as unknown as CompFile;
const evidence = (metric: string) => bankRevenueEvidence(file, { rows, metric, q: "2026Q3" } as Breakdown);

describe("bank filing inputs", () => {
  it("matches only contributing companies and the two growth periods", () => {
    expect(evidence("rev_growth").map((r) => [r.ticker, r.parts.length])).toEqual([["A", 2]]);
    expect(evidence("ni_growth")).toEqual([]);
    expect(evidence("roe")).toEqual([]);
  });
  it("traces trailing quarters and the fiscal-year bridge separately", () => {
    expect(evidence("nm").map((r) => [r.ticker, r.parts.length, r.trailing])).toEqual([["A", 2, null], ["B", 3, 12]]);
  });
});
