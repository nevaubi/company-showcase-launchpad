import { describe, expect, it } from "vitest";
import { factsFromModel, type ModelOutput, type ModelRow } from "./extract-core";
import { parseTables, tableAbove } from "./tables";

// NVIDIA, third quarter fiscal 2027 release (filed 2026-11-17), cut down to the title lines and the first
// rows of its income statement (table 3) and balance sheet (table 4), markup as printed:
// https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/q3fy27pr.htm
// The income statement's scale line is printed above the table; the balance sheet's inside it.
const NVDA = `<html><body>
<div style="margin-bottom:9pt"><font>Features, pricing, availability and specifications are subject to change without notice.</font></div>
<table><tr><td>Revenue for the third quarter was $115.8 billion, up 103% from a year ago.</td></tr></table>
<hr style="page-break-after:always">
<div style="margin-bottom:3pt;text-align:center"><font style="font-weight:700">NVIDIA CORPORATION </font></div>
<div style="margin-bottom:3pt;text-align:center"><font style="font-weight:700">CONDENSED CONSOLIDATED STATEMENTS OF INCOME</font></div>
<div style="margin-bottom:3pt;text-align:center"><font>(In millions, except per share data)</font></div>
<div style="text-align:center"><font>(Unaudited)</font></div>
<table>
<tr><td></td><td></td><td></td><td>Three Months Ended</td><td></td><td>Nine Months Ended</td></tr>
<tr><td></td><td></td><td></td><td>October 25,</td><td></td><td>October 26,</td><td></td><td>October 25,</td><td></td><td>October 26,</td></tr>
<tr><td></td><td></td><td></td><td>2026</td><td></td><td>2025</td><td></td><td>2026</td><td></td><td>2025</td></tr>
<tr><td>Revenue</td><td>$</td><td>115,844</td><td></td><td></td><td>$</td><td>57,006</td><td></td><td></td><td>$</td><td>293,681</td><td></td><td></td><td>$</td><td>147,811</td><td></td></tr>
<tr><td></td><td>Research and development</td><td>7,454</td><td></td><td></td><td>4,705</td><td></td><td></td><td>20,829</td><td></td><td></td><td>12,985</td><td></td></tr>
<tr><td>Diluted</td><td>$</td><td>2.81</td><td></td><td></td><td>$</td><td>1.30</td></tr>
</table>
<hr style="page-break-after:always">
<table>
<tr><td>NVIDIA CORPORATION</td><td></td></tr>
<tr><td>CONDENSED CONSOLIDATED BALANCE SHEETS</td><td></td></tr>
<tr><td>(In millions)</td><td></td></tr>
<tr><td></td><td>Cash and cash equivalents</td><td>$</td><td>29,089</td><td></td><td></td><td>$</td><td>10,605</td><td></td><td></td></tr>
<tr><td></td><td></td><td>Total assets</td><td>$</td><td>372,188</td><td></td><td></td><td>$</td><td>206,803</td><td></td><td></td></tr>
</table>
</body></html>`;

const row = (r: number, label: string, cells: [number, number][], o: Partial<ModelRow> = {}): ModelRow => ({ r, label, parent: "", breakdown: "", category: "cost", metric: "expense", unit: "usd", scale: 1, is_total: false, cells: cells.map(([c, p]) => ({ c, p })), ...o });
const Q = [
  { p: 0, period_start: "2026-07-27", period_end: "2026-10-25", months: 3 },
  { p: 1, period_start: "2025-07-28", period_end: "2025-10-26", months: 3 },
];
const B = [
  { p: 0, period_start: "", period_end: "2026-10-25", months: 0 },
  { p: 1, period_start: "", period_end: "2026-01-25", months: 0 },
];

describe("a scale line printed in the title lines above a table (NVDA Q3 FY27)", () => {
  const tables = parseTables(NVDA);
  it("parseTables keeps its tables and indexes; the lines above each table are kept beside them", () => {
    expect(tables.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(Object.keys(tables[1])).toEqual(["index", "rows"]);
    expect(tableAbove(tables[1]).slice(-3)).toEqual(["CONDENSED CONSOLIDATED STATEMENTS OF INCOME", "(In millions, except per share data)", "(Unaudited)"]);
    expect(tableAbove(tables[0])).toEqual(["Features, pricing, availability and specifications are subject to change without notice."]);
    expect(tableAbove(tables[2])).toEqual([]);
  });
  it("stores research and development as $7,454 million although the model said scale 1", () => {
    const out: ModelOutput = {
      tables: [
        { t: 1, periods: Q, rows: [row(3, "Revenue", [[2, 0], [6, 1]], { category: "product", metric: "revenue" }), row(4, "Research and development", [[2, 0], [5, 1]]), row(5, "Diluted", [[2, 0], [6, 1]], { unit: "usdPerShare", category: "kpi", metric: "other" })] },
        { t: 2, periods: B, rows: [row(3, "Cash and cash equivalents", [[3, 0], [7, 1]], { category: "balance", metric: "assets" }), row(4, "Total assets", [[4, 0], [8, 1]], { category: "balance", metric: "assets", is_total: true })] },
      ],
    };
    const { rows } = factsFromModel(out, tables, "2026-11-17");
    const v = (label: string) => rows.filter((r) => r.label === label).map((r) => r.value);
    expect(v("Research and development")).toEqual([7_454_000_000, 4_705_000_000]);
    expect(v("Revenue")).toEqual([115_844_000_000, 57_006_000_000]);
    expect(v("Total assets")).toEqual([372_188_000_000, 206_803_000_000]);
    expect(v("Cash and cash equivalents")).toEqual([29_089_000_000, 10_605_000_000]);
    expect(v("Diluted")).toEqual([2.81, 1.3]);
  });
  it("a per-share line the model calls usd keeps its printed value ('except per share data')", () => {
    const out: ModelOutput = { tables: [{ t: 1, periods: Q, rows: [row(5, "Diluted net income per share", [[2, 0], [6, 1]])] }] };
    expect(factsFromModel(out, tables, "2026-11-17").rows.map((r) => r.value)).toEqual([2.81, 1.3]);
  });
  it("the table's own scale words outrank the lines above it", () => {
    const html = `<p>(In thousands)</p><table><tr><td>(In millions)</td><td>Q3 2026</td></tr><tr><td>Net sales</td><td>6,006</td></tr></table>`;
    const t = parseTables(html);
    const out: ModelOutput = { tables: [{ t: 0, periods: Q, rows: [row(1, "Net sales", [[1, 0]], { category: "product", metric: "revenue" })] }] };
    expect(factsFromModel(out, t, "2026-11-17").rows[0].value).toBe(6_006_000_000);
  });
  it("a sentence above the table is not a scale line", () => {
    const html = `<p>Revenue grew strongly in the quarter, and all amounts in this release are shown in millions of dollars unless we say otherwise, as in prior quarters.</p><table><tr><td>Net sales</td><td>6,006</td></tr></table>`;
    const out: ModelOutput = { tables: [{ t: 0, periods: Q, rows: [row(0, "Net sales", [[1, 0]], { scale: 1e3 })] }] };
    expect(factsFromModel(out, parseTables(html), "2026-11-17").rows[0].value).toBe(6_006_000);
  });
  it("text above that names two scales, or none, leaves the model's scale", () => {
    const two = parseTables(`<p>Amounts in thousands, except where stated in millions ($ in millions)</p><p>(in thousands)</p><table><tr><td>Net sales</td><td>6,006</td></tr></table>`);
    const out: ModelOutput = { tables: [{ t: 0, periods: Q, rows: [row(0, "Net sales", [[1, 0]], { scale: 1e3 })] }] };
    expect(factsFromModel(out, two, "2026-11-17").rows[0].value).toBe(6_006_000);
    const none = parseTables(`<p>Selected figures</p><table><tr><td>Net sales</td><td>6,006</td></tr></table>`);
    expect(factsFromModel(out, none, "2026-11-17").rows[0].value).toBe(6_006_000);
  });
});
