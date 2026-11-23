import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { factsFromModel, type ModelOutput, type ModelRow } from "./extract-core";
import { inFullUnits, printedScale, screenRows, type ScreenRow } from "./scale-check";
import { parseNumber, type ParsedTable } from "./tables";

// Real stored facts (ir_kpi_facts, 20 Nov 2026), copied with the checksum method of
// fu/round2/TRANSFER.md; labels and cell text folded (non-ASCII → "?").
// group|document|t|r|c|label|parent|is_total|period_end|months|unit|value|cell text|category|metric|breakdown
interface Cell { g: string; doc: string; t: number; r: number; c: number; label: string; parent: string; total: boolean; end: string; months: number; unit: string; value: number; text: string; cat: string; met: string; bd: string }
const CELLS: Cell[] = readFileSync(path.resolve(__dirname, "../../test/fixtures/ir/scale-cells.folded.txt"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const f = l.split("|");
    return { g: f[0], doc: f[1], t: +f[2], r: +f[3], c: +f[4], label: f[5], parent: f[6], total: f[7] === "true", end: f[8], months: +f[9], unit: f[10], value: Number(f[11]), text: f[12], cat: f[13], met: f[14], bd: f[15] };
  });

/** How the reader parsed cells before this change: every space and currency sign removed first. */
const oldParse = (s: string) => Number(s.replace(/[$€£\s,%]/g, "").replace(/^\((.*)\)$/, "-$1"));
/** The scale the model chose for the stored row: stored value over the number the old parser read. */
const modelScale = (x: Cell) => (x.value === 0 ? 1e6 : [1, 1e3, 1e6, 1e9].find((s) => Math.abs(Math.abs(x.value / oldParse(x.text)) / s - 1) < 1e-6)!);

/** Rebuild the parsed table (only the cells the reader pointed at) and the model's answer from stored rows. */
function replay(cells: Cell[]): { tables: ParsedTable[]; out: ModelOutput } {
  const byT = new Map<number, Cell[]>();
  for (const x of cells) byT.set(x.t, [...(byT.get(x.t) ?? []), x]);
  const tables: ParsedTable[] = [];
  const out: ModelOutput = { tables: [] };
  for (const [t, list] of byT) {
    const rows: string[][] = [];
    for (const x of list) {
      while (rows.length <= x.r) rows.push([]);
      while (rows[x.r].length <= x.c) rows[x.r].push("");
      rows[x.r][x.c] = x.text;
    }
    tables[t] = { index: t, rows };
    const periods = [...new Set(list.map((x) => `${x.end}|${x.months}`))].map((k, p) => ({ p, period_start: "", period_end: k.split("|")[0], months: +k.split("|")[1] }));
    const pOf = (x: Cell) => periods.find((p) => p.period_end === x.end && p.months === x.months)!.p;
    const mrows = new Map<number, ModelRow>();
    for (const x of list) {
      const row = mrows.get(x.r) ?? { r: x.r, label: x.label, parent: x.parent, breakdown: x.bd, category: x.cat as ModelRow["category"], metric: x.met as ModelRow["metric"], unit: x.unit as ModelRow["unit"], scale: modelScale(x), is_total: x.total, cells: [] };
      row.cells.push({ c: x.c, p: pOf(x) });
      mrows.set(x.r, row);
    }
    out.tables.push({ t, periods, rows: [...mrows.values()] });
  }
  return { tables, out };
}
const group = (g: string, doc?: string) => CELLS.filter((x) => x.g === g && (!doc || x.doc === doc));

describe("parseNumber: one number per cell", () => {
  it("never reads two numbers glued in one cell (NVDA, GILD renditions)", () => {
    const glued = group("GLUE");
    expect(glued.length).toBe(11);
    for (const x of glued) expect(parseNumber(x.text), x.text).toBeNull();
    // stored before the fix: 3,650,035,082 × 10^6 and the like
    expect(oldParse("1,127 2,879")).toBe(11272879);
  });
  it("keeps single numbers, including a thousands separator followed by a stray space", () => {
    expect(parseNumber("2, 386,745")).toBe(2386745);
    expect(parseNumber("$ 12.5")).toBe(12.5);
    expect(parseNumber("(1,234)")).toBe(-1234);
    expect(parseNumber("$ (1,234)")).toBe(-1234);
    expect(parseNumber("68 %")).toBe(68);
    expect(parseNumber("23,634")).toBe(23634);
  });
  it("drops the glued cells at extraction instead of storing them", () => {
    const { tables, out } = replay(group("GLUE", "254d638c-cea6-4eac-b4a2-9e5247722047"));
    const { rows, rejected } = factsFromModel(out, tables, "2026-05-28");
    expect(rows).toHaveLength(0);
    expect(rejected).toBe(3);
  });
});

describe("cells already in full units are not scaled again", () => {
  it("CNA spreadsheet: $1,483,000,000 stays $1.483 billion, not $1.483 quadrillion", () => {
    const { tables, out } = replay(group("CNA"));
    const { rows } = factsFromModel(out, tables, "2026-02-09");
    const cmbs = rows.find((r) => r.label === "Asset-backed - CMBS")!;
    expect(cmbs.value).toBe(1_483_000_000);
    expect(rows.find((r) => r.label === "Total fixed maturity securities")!.value).toBe(43_402_000_000);
    expect(rows.every((r) => !r.locator.suspect)).toBe(true);
  });
  it("RKT spreadsheet: tax line $5 million, total revenue $701 million", () => {
    const { tables, out } = replay(group("RKT"));
    const { rows } = factsFromModel(out, tables, "2023-05-04");
    expect(rows.find((r) => r.label === "(Provision for) benefit from income taxes")!.value).toBe(5_000_000);
    expect(rows.find((r) => r.label === "Total revenue, net")!.value).toBe(701_000_000);
  });
  it("AIZ spreadsheet: GAAP net income $298.6 million", () => {
    const { tables, out } = replay(group("AIZ"));
    const { rows } = factsFromModel(out, tables, "2026-08-04");
    expect(rows.find((r) => r.label === "GAAP net income" && r.period_end === "2026-06-30" && r.months === 3)!.value).toBe(298_600_000);
  });
  it("tables in millions keep their scale (IP segment table; round thousands of debt)", () => {
    const ip = group("IP").filter((x) => x.t === 2);
    expect(inFullUnits(ip.map((x) => x.text), 1e6)).toBe(false);
    // A thousands table of round note amounts: scaled values stay far below $100 billion.
    expect(inFullUnits(["500,000", "750,000", "1,000,000", "250,000"], 1e3)).toBe(false);
  });
});

describe("scale words printed in the table", () => {
  it("beat a different scale chosen by the model", () => {
    const t: ParsedTable = { index: 0, rows: [["(In millions, except per share amounts)", "Q4 2025"], ["Net Sales", "6,006"]] };
    const out: ModelOutput = { tables: [{ t: 0, periods: [{ p: 0, period_start: "2025-10-01", period_end: "2025-12-31", months: 3 }], rows: [{ r: 1, label: "Net Sales", parent: "", breakdown: "Revenue", category: "product", metric: "revenue", unit: "usd", scale: 1e9, is_total: true, cells: [{ c: 1, p: 0 }] }] }] };
    expect(printedScale(t)).toBe(1e6);
    expect(factsFromModel(out, [t], "2026-01-29").rows[0].value).toBe(6_006_000_000);
  });
  it("are ignored when a table prints two different ones", () => {
    expect(printedScale({ index: 0, rows: [["$ in millions"], ["Volume (in thousands)"]] })).toBeNull();
  });
});

describe("screenRows marks figures the document contradicts", () => {
  const asRows = (cells: Cell[]): ScreenRow[] =>
    cells.map((x) => ({ label: x.label, parent: x.parent || null, is_total: x.total, period_end: x.end, months: x.months, value: x.value, unit: x.unit, locator: { t: x.t, r: x.r, c: x.c, text: x.text } }));
  it("IP: the summary table read in billions disagrees with the segment table in millions", () => {
    const rows = screenRows(asRows(group("IP")));
    const t0 = rows.filter((r) => r.locator.t === 0);
    const t2 = rows.filter((r) => r.locator.t === 2);
    expect(t0.every((r) => r.locator.suspect)).toBe(true);
    expect(t0.find((r) => r.label === "Net Sales" && r.months === 3 && r.period_end === "2025-12-31")!.locator.suspect).toMatch(/disagrees with another table.*Net Sales for the 3 months to 2025-12-31 as \$6 billion/);
    expect(t2.some((r) => r.locator.suspect)).toBe(false);
  });
  it("stored glued values read as more than any company reports", () => {
    const rows = screenRows(asRows(group("GLUE")));
    expect(rows.every((r) => /more than any company reports/.test(r.locator.suspect ?? ""))).toBe(true);
  });
  it("a line 900× its own total is suspect; assets under custody are not capped at $10 trillion", () => {
    const rows = screenRows<ScreenRow>([
      { label: "Total revenue", parent: null, is_total: true, period_end: "2025-12-31", months: 3, value: 5e9, unit: "usd", locator: { t: 1, r: 9, c: 2, text: "5,000" } },
      { label: "Fees", parent: "Total revenue", is_total: false, period_end: "2025-12-31", months: 3, value: 4.6e12, unit: "usd", locator: { t: 1, r: 3, c: 2, text: "4,600" } },
      { label: "Assets under custody and/or administration", parent: null, is_total: false, period_end: "2025-12-31", months: 0, value: 5.21e13, unit: "usd", locator: { t: 2, r: 1, c: 1, text: "52.1" } },
    ]);
    expect(rows[1].locator.suspect).toMatch(/its own total/);
    expect(rows[0].locator.suspect).toBeUndefined();
    expect(rows[2].locator.suspect).toBeUndefined();
  });
  it("AUM lines pass $10 trillion without a custody word in the label (BLK 'Long-term' $11.6 trillion)", () => {
    const rows = screenRows<ScreenRow>([
      { label: "Long-term", parent: "Total", is_total: false, period_end: "2025-12-31", months: 0, value: 1.1557889e13, unit: "usd", metric: "aum", breakdown: "AUM by client and product type", locator: { t: 3, r: 4, c: 2, text: "11,557,889" } },
    ]);
    expect(rows[0].locator.suspect).toBeUndefined();
  });
  it("leaves consistent documents untouched (same array back)", () => {
    const rows = asRows(group("CNA")).map((r) => ({ ...r, value: r.value / 1e6 }));
    expect(screenRows(rows)).toBe(rows);
  });
});
