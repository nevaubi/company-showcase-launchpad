import { describe, expect, it } from "vitest";
import { filedIndex, knownSince, priceAt, statementAsOf, ttmOf } from "./asof";
import type { Bar, Statement } from "@/lib/financials/types";

const filings = [
  { accn: "q1", form: "10-Q", filed: "2026-02-01", doc: "a" },
  { accn: "q2", form: "10-Q", filed: "2026-05-01", doc: "b" },
  { accn: "q3", form: "10-Q", filed: "2026-08-01", doc: "c" },
  { accn: "k", form: "10-K", filed: "2026-11-01", doc: "d" },
];
const filedOf = filedIndex(filings);
const cell = (v: number, accn: string, alts?: string[]) => ({ v, src: { accn, concept: "x", end: "2026", value: v }, alts });

const st: Statement = {
  periods: ["Q1", "Q2", "Q3", "Q4"].map((l, i) => ({ key: `P${i}`, label: l, fy: 2026, end: `2026-0${i + 1}-30` })),
  rows: [
    { key: "epsDiluted", label: "EPS", unit: "usdPerShare", cells: [cell(1, "q1"), cell(1, "q2"), cell(1, "q3"), cell(2, "k")] },
    { key: "revenue", label: "Revenue", unit: "usd", cells: [cell(10, "q2", ["q1"]), cell(11, "q2"), null, { v: 5 }] },
  ],
};

describe("point in time", () => {
  it("dates a cell by its earliest reporting filing", () => {
    expect(knownSince(cell(10, "q2", ["q1"]), filedOf)).toBe("2026-02-01");
    expect(knownSince({ v: 3, derived: { formula: "a-b", parts: [{ accn: "q1", concept: "a", end: "", value: 1, label: "a", sign: 1 }, { accn: "q3", concept: "b", end: "", value: 1, label: "b", sign: -1 }] } }, filedOf)).toBe("2026-08-01");
  });
  it("drops cells filed after the date and periods with nothing known", () => {
    const r = statementAsOf(st, filedOf, "2026-06-01");
    expect(r.statement.periods.map((p) => p.label)).toEqual(["Q1", "Q2"]);
    expect(r.dropped).toBe(2);
    expect(r.unverifiable).toBe(1);
  });
  it("TTM needs four consecutive known quarters", () => {
    expect(ttmOf(statementAsOf(st, filedOf, "2026-12-01").statement, "epsDiluted")).toEqual({ value: 5, periods: ["Q1", "Q2", "Q3", "Q4"] });
    expect(ttmOf(statementAsOf(st, filedOf, "2026-09-01").statement, "epsDiluted")).toBeNull();
  });
  it("takes the last close on or before the date", () => {
    const bars: Bar[] = [["2026-01-02", 1, 1, 1, 10, 10, 1], ["2026-01-05", 1, 1, 1, 11, 11, 1], ["2026-01-07", 1, 1, 1, 12, 12, 1]];
    expect(priceAt(bars, "2026-01-06")).toEqual({ date: "2026-01-05", close: 11 });
    expect(priceAt(bars, "2025-12-31")).toBeNull();
  });
});
