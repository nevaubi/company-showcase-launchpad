import { describe, expect, it } from "vitest";
import type { IrFact } from "./kpis";
import { buildPayload } from "./payload";

// Amazon Q3 2026 release (filed 2026-10-29), Segment Information: North America net sales and operating
// expenses, as stored (two lines named "North America" in one document):
// https://www.sec.gov/Archives/edgar/data/1018724/000101872426000038/amzn-20260930xex991.htm
const DOC = "d226b1f0-0000-4000-8000-000000000001";
const fact = (id: string, breakdown: string, metric: string, end: string, value: number, r: number, c: number, text: string): IrFact => ({
  id,
  document_id: DOC,
  document_kind: "press-release",
  category: "segment",
  metric,
  breakdown,
  parent: null,
  label: "North America",
  is_total: false,
  period_start: { "2026-03-31": "2026-01-01", "2026-09-30": "2026-07-01", "2025-09-30": "2025-07-01" }[end]!,
  period_end: end,
  months: 3,
  value,
  unit: "usd",
  accn: "0001018724-26-000038",
  doc: null,
  filed: "2026-10-29",
  method: "table",
  locator: { t: 3, r, c, text },
});
const FACTS: IrFact[] = [
  fact("a1", "Net sales by segment", "revenue", "2026-03-31", 104_143e6, 5, 2, "104,143"),
  fact("a2", "Net sales by segment", "revenue", "2026-09-30", 112_852e6, 5, 4, "112,852"),
  fact("a3", "Net sales by segment", "revenue", "2025-09-30", 106_267e6, 5, 6, "106,267"),
  fact("b1", "Operating expenses by segment", "cost", "2026-03-31", 95_876e6, 7, 2, "95,876"),
  fact("b2", "Operating expenses by segment", "cost", "2026-09-30", 104_129e6, 7, 4, "104,129"),
  fact("b3", "Operating expenses by segment", "cost", "2025-09-30", 101_032e6, 7, 6, "101,032"),
];

describe("rule 5 (a column read under the wrong period) needs the same printed figure (verb-11 AMZN)", () => {
  it("North America operating expenses 104,129 for Q3 2026 is not held because net sales were 104,143 in Q1", () => {
    const p = buildPayload("AMZN", FACTS);
    const opex = p.series.find((s) => s.k.startsWith("segment|cost|"))!;
    expect(opex.held?.q?.["2026-09-30"]).toBeUndefined();
    expect(opex.q["2026-09-30"]).toMatchObject({ v: 104_129e6, x: "104,129" });
    // Nor is net sales 104,143 for Q1 2026, held the other way round before.
    const sales = p.series.find((s) => s.k.startsWith("segment|revenue|"))!;
    expect(sales.held?.q?.["2026-03-31"]).toBeUndefined();
  });
  it("the same printed figure under another period is still held", () => {
    const slipped = FACTS.map((f) => (f.id === "b2" ? { ...f, value: 104_143e6, locator: { t: 3, r: 7, c: 4, text: "104,143" } } : f));
    const p = buildPayload("AMZN", slipped);
    const opex = p.series.find((s) => s.k.startsWith("segment|cost|"))!;
    expect(opex.held?.q?.["2026-09-30"]?.why).toMatch(/probably read under the wrong period/);
  });
});
