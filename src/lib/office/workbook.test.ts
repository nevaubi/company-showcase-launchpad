import { describe, expect, it } from "vitest";
import { blankSheet, chartData, fillRange, parseRange, shiftFormula, sortRange, writeBlock } from "./workbook";

describe("workbook ops", () => {
  it("parses ranges", () => {
    expect(parseRange("b2:a1")).toEqual({ c0: 0, r0: 0, c1: 1, r1: 1 });
  });
  it("shifts relative refs but not absolute or quoted ones", () => {
    expect(shiftFormula('=A1+$B$2+FU("AAPL","revenue","FY2024")', 0, 2)).toBe('=A3+$B$2+FU("AAPL","revenue","FY2024")');
  });
  it("sorts rows under a header, blanks last", () => {
    const sh = blankSheet();
    writeBlock(sh, "A1", [["Name", "Rev"], ["a", 5], ["b", ""], ["c", 9]]);
    sortRange(sh, parseRange("A1:B4"), 1, true, true, (r) => (sh.cells[r] ? Number(sh.cells[r]) : null));
    expect([sh.cells.A2, sh.cells.A3, sh.cells.A4]).toEqual(["c", "a", "b"]);
    expect(sh.cells.A1).toBe("Name");
  });
  it("fills formulas down", () => {
    const sh = blankSheet();
    writeBlock(sh, "C1", [["=A1*B1"]]);
    fillRange(sh, parseRange("C1:C3"), "down");
    expect(sh.cells.C3).toBe("=A3*B3");
  });
  it("builds chart rows with periods across and a named series", () => {
    const d = chartData(["Fiscal year", "FY24", "FY25"], [["Revenue", 10, 20]]);
    expect(d.names).toEqual(["Revenue"]);
    expect(d.rows).toEqual([{ label: "FY24", Revenue: 10 }, { label: "FY25", Revenue: 20 }]);
  });
  it("aligns unnamed series that skip the label header", () => {
    expect(chartData(["Year", "FY24", "FY25"], [[10, 20]]).rows).toEqual([{ label: "FY24", "Series 1": 10 }, { label: "FY25", "Series 1": 20 }]);
  });
});
