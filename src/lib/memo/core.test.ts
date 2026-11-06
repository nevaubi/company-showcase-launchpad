import { describe, expect, it } from "vitest";
import { buildMemo, margin } from "./core";
import type { CompanyDataset } from "@/lib/financials/types";

const st = (rows: Record<string, (number | null)[]>, sourced = true) => ({
  periods: ["FY2023", "FY2024", "FY2025"].map((l, i) => ({ key: l, label: l, fy: 2023 + i, end: `${2023 + i}-12-31` })),
  rows: Object.entries(rows).map(([key, vals]) => ({
    key, label: key, unit: "usd",
    cells: vals.map((v, i) => v == null ? null : { v, ...(sourced ? { src: { accn: `A-${i}`, concept: `us-gaap:${key}`, end: `${2023 + i}-12-31`, value: v } } : {}) }),
  })),
});
const data = (sourced = true) => ({
  statements: { annual: { income: st({ revenue: [100, 120, 150], grossProfit: [40, 60, 75] }, sourced), balance: st({}), cashflow: st({}) } },
}) as unknown as CompanyDataset;

describe("memo", () => {
  it("footnotes every value and computes growth and margin", () => {
    const m = buildMemo(data(), 5);
    const rev = m.lines.find((l) => l.key === "revenue")!;
    expect(rev.growth[1]).toBeCloseTo(0.2);
    expect(rev.growth[2]).toBeCloseTo(0.25);
    expect(m.notes).toHaveLength(6);
    expect(margin(m, "grossProfit")[2]).toBeCloseTo(0.5);
  });
  it("drops numbers without a source", () => {
    expect(buildMemo(data(false)).lines).toHaveLength(0);
  });
  it("keeps only the requested number of years", () => {
    expect(buildMemo(data(), 2).periods.map((p) => p.label)).toEqual(["FY2024", "FY2025"]);
  });
});
