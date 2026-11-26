import { describe, expect, it } from "vitest";
import { factsFromModel, type ModelOutput } from "./extract-core";
import { opensParenthesis, parseNumber, parseRowCell, type ParsedTable } from "./tables";

// ServiceNow, third quarter 2026 release, table 4 (rows as parseTables reads them):
// https://www.sec.gov/Archives/edgar/data/1373715/000137371526000092/erq3fy26.htm
// The gross loss margin prints "(32.5" in one cell and "%)" in the next.
const NOW_ROWS: Record<number, string[]> = {
  1: ["", "Third Quarter 2026 GAAP Results", "Third Quarter 2026 Non-GAAP Results (1)", "", ""],
  2: ["", "Amount ($ millions)", "Year/Year Growth (%)", "Amount ($ millions) (2)", "Year/Year Growth (%)", "", ""],
  3: ["Subscription revenues", "$", "3,988", "", "21", "%", "$", "3,990", "", "20.5", "%", "", ""],
  16: ["Subscription gross profit", "$", "2,934", "", "73.5", "%", "$", "3,198", "", "80", "%", "", ""],
  17: ["Professional services and other gross loss", "$", "(39)", "", "(32.5", "%)", "$", "(23)", "", "(20", "%)", "", ""],
  18: ["Total gross profit", "$", "2,895", "", "70.5", "%", "$", "3,175", "", "77.5", "%", "", ""],
};
const nowTable = (): ParsedTable => {
  const rows: string[][] = [];
  for (let r = 0; r <= 18; r++) rows.push(NOW_ROWS[r] ?? []);
  return { index: 4, rows };
};
const period = [{ p: 0, period_start: "2026-07-01", period_end: "2026-09-30", months: 3 }];
const marginOut = (cells: number[], r = 17): ModelOutput => ({
  tables: [
    {
      t: 4,
      periods: period,
      rows: [{ r, label: "Professional services and other gross margin", parent: "", breakdown: "", category: "kpi", metric: "margin", unit: "pct", scale: 1, is_total: false, cells: cells.map((c) => ({ c, p: 0 })) }],
    },
  ],
});

describe("a parenthesis closed in the next cell", () => {
  it("NOW 3Q26 gross loss margins (32.5 | %) and (20 | %) are negative", () => {
    const t = nowTable();
    expect(parseRowCell(t.rows[17], 4)).toBe(-32.5);
    expect(parseRowCell(t.rows[17], 9)).toBe(-20);
    const tables: ParsedTable[] = [];
    tables[4] = t;
    const { rows, rejected } = factsFromModel(marginOut([4, 9]), tables, "2026-10-29");
    expect(rejected).toBe(0);
    expect(rows.map((r) => r.value)).toEqual([-32.5, -20]);
    expect(rows.map((r) => r.locator.text)).toEqual(["(32.5", "(20"]);
  });
  it("keeps the positive margins of the other rows and the same-cell (39) amount", () => {
    const t = nowTable();
    expect(parseRowCell(t.rows[16], 4)).toBe(73.5);
    expect(parseRowCell(t.rows[17], 2)).toBe(-39);
    expect(parseRowCell(t.rows[18], 9)).toBe(77.5);
  });
  it("Workiva-style money row: (1,234 | ) is minus 1,234, also after a currency cell and empty cells", () => {
    expect(parseRowCell(["Net loss", "$", "(1,234", ")", "$", "567", ""], 2)).toBe(-1234);
    expect(parseRowCell(["Net loss", "$", "(1,234", "", " ", ")", "567"], 2)).toBe(-1234);
    expect(parseRowCell(["Net loss", "$ (1,234", ")%"], 1)).toBe(-1234);
  });
  it("a same-cell (1,234) row is unchanged", () => {
    const row = ["Operating loss", "$", "(1,234)", "", "$", "(987)", ""];
    expect(parseRowCell(row, 2)).toBe(-1234);
    expect(parseRowCell(row, 5)).toBe(-987);
    expect(parseRowCell(row, 2)).toBe(parseNumber("(1,234)"));
  });
  it("an opening parenthesis nothing closes is rejected, never stored positive", () => {
    expect(parseRowCell(["Margin", "(32.5", "", "41.0", "%"], 1)).toBeNull();
    expect(parseRowCell(["Margin", "(32.5"], 1)).toBeNull();
    expect(parseRowCell(["Margin", "(32.5", "n/m"], 1)).toBeNull();
    const t: ParsedTable = { index: 0, rows: [["", "Q3 2026"], ["Margin", "(32.5", "", "41.0"]] };
    const out: ModelOutput = { tables: [{ ...marginOut([1], 1).tables[0], t: 0 }] };
    const { rows, rejected } = factsFromModel(out, [t], "2026-10-29");
    expect(rows).toHaveLength(0);
    expect(rejected).toBe(1);
  });
  it("a footnote (1) beside a figure does not turn the figure negative", () => {
    const row = ["Revenue", "(1)", "1,234", "", "1,100"];
    expect(parseRowCell(row, 2)).toBe(1234);
    expect(parseRowCell(row, 4)).toBe(1100);
    expect(opensParenthesis("(1)")).toBe(false);
  });
  it("a text cell (in millions is never a number", () => {
    expect(parseRowCell(["(in millions", ")", "2026"], 0)).toBeNull();
    expect(opensParenthesis("(in millions")).toBe(false);
  });
  it("opensParenthesis: one number after an opening parenthesis and no closing one", () => {
    expect(opensParenthesis("(32.5")).toBe(true);
    expect(opensParenthesis("$ (1,234")).toBe(true);
    expect(opensParenthesis("(12.5%")).toBe(true);
    expect(opensParenthesis("(1,234)")).toBe(false);
    expect(opensParenthesis("32.5")).toBe(false);
    expect(opensParenthesis("(1,127 2,879")).toBe(false);
    expect(opensParenthesis("(")).toBe(false);
  });
});
