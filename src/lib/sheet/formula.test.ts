import { describe, expect, it } from "vitest";
import { FormulaError, Sheet, formatValue, referencedSymbols, type SheetContext } from "./formula";

function sheet(cells: Record<string, string>, extra: Partial<SheetContext> = {}) {
  return new Sheet({ get: (r) => cells[r], ...extra });
}
const code = (v: unknown) => (v instanceof FormulaError ? v.code : v);

describe("sheet formula engine", () => {
  it("sums a range and ignores blanks and text", () => {
    const s = sheet({ A1: "10", A2: "20", A3: "", A4: "note", A5: "=SUM(A1:A4)" });
    expect(s.value("A5")).toBe(30);
  });

  it("parses thousands separators and percentages in typed values", () => {
    const s = sheet({ A1: "1,250", A2: "12.5%", A3: "=A1*A2" });
    expect(s.value("A1")).toBe(1250);
    expect(s.value("A2")).toBeCloseTo(0.125);
    expect(s.value("A3")).toBeCloseTo(156.25);
  });

  it("computes the hyperscaler capex QoQ change the demo sheet relies on", () => {
    const s = sheet({ B2: "15804", C2: "27834", D2: "14276", B3: "16745", C3: "25019", D3: "17197", E2: "=SUM(B2:D2)", E3: "=SUM(B3:D3)", F3: "=E3/E2-1" });
    expect(s.value("E2")).toBe(57914);
    expect(s.value("E3")).toBe(58961);
    expect(formatValue(s.value("F3"), "pct")).toBe("1.8%");
  });

  it("returns #DIV/0! for division by zero and GROWTH from zero", () => {
    const s = sheet({ A1: "5", A2: "0", A3: "=A1/A2", A4: "=GROWTH(A1,A2)" });
    expect(code(s.value("A3"))).toBe("#DIV/0!");
    expect(code(s.value("A4"))).toBe("#DIV/0!");
  });

  it("computes CAGR and rejects non-positive inputs", () => {
    const s = sheet({ A1: "=CAGR(100,121,2)", A2: "=CAGR(0,121,2)" });
    expect(s.value("A1")).toBeCloseTo(0.1);
    expect(code(s.value("A2"))).toBe("#NUM!");
  });

  it("flags circular references instead of looping", () => {
    const s = sheet({ A1: "=B1+1", B1: "=A1+1" });
    expect(code(s.value("A1"))).toBe("#CYCLE!");
  });

  it("resolves FU() through the data context with the requested scale", () => {
    const calls: string[] = [];
    const s = sheet(
      { A1: '=FU("NVDA","revenue","Q2 FY27")' },
      {
        fu: (t, m, p) => {
          calls.push(`${t}|${m}|${p}`);
          return 96_221_000_000;
        },
      },
    );
    expect(s.value("A1")).toBe(96_221_000_000);
    expect(calls).toEqual(["NVDA|revenue|Q2 FY27"]);
  });

  it("lists tickers referenced by FU() and PRICE() for prefetching", () => {
    expect(referencedSymbols({ A1: '=FU("aapl","revenue","FY2025")', A2: '=PRICE("NVDA")*2', A3: "plain" })).toEqual({ fu: ["AAPL"], price: ["NVDA"] });
  });
});
