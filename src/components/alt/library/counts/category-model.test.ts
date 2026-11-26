import { describe, expect, it } from "vitest";
import type { FieldRole } from "@/lib/sources/fields";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import { categoryCandidates, categoryCaption, categoryCharts, countFields, isCategorical, samePartition, type FieldCounts } from "./category-model";

const col = (key: string, title?: string): SourceColumn => ({ key, label: key, type: "string", ...(title ? { title } : {}) });
const fill = (position: number, filled: number, blank: number): SourceFieldFill => ({ position, key: `f${position}`, label: `f${position}`, filled, blank, share: filled / (filled + blank) });

describe("categoryCandidates", () => {
  const columns = ["id", "name", "type", "code", "amount", "date", "note", "flag", "status"].map((k) => col(k));
  const roles: FieldRole[] = ["identifier", "text", "unknown", "code", "quantity", "date", "text", "code", "unknown"];
  const fills = [fill(0, 100, 0), fill(1, 100, 0), fill(2, 100, 0), fill(3, 30, 70), fill(4, 100, 0), fill(5, 100, 0), fill(6, 5, 95), fill(7, 0, 100), fill(8, 90, 10)];

  it("skips dimensions, quantities, identifiers, dates and fields with fewer than 10 values, and puts well filled fields first", () => {
    expect(categoryCandidates(columns, { dimensions: { entity_name: 1 } }, roles, fills)).toEqual([2, 8, 3]);
  });

  it("skips the parts of a composed period and stops at the maximum", () => {
    expect(categoryCandidates(columns, { dimensions: {}, composites: { period: { indices: [2, 3], separator: "-", format: "year_month" } } }, roles, fills)).toEqual([1, 8]);
    expect(categoryCandidates(columns, { dimensions: {} }, roles, fills, 2)).toEqual([1, 2]);
  });

  it("takes fields in dictionary order when no blank counts are stored", () => {
    expect(categoryCandidates(columns, { dimensions: {} }, roles, null)).toEqual([1, 2, 3, 6, 7, 8]);
  });
});

describe("countFields", () => {
  it("counts stored strings exactly, blanks and nulls apart, ties in code-point order", () => {
    const rows = [
      { row: 4, cells: ["N", "b"] },
      { row: 1, cells: ["A", ""] },
      { row: 2, cells: ["N", null] },
      { row: 3, cells: ["A", "a"] },
      { row: 5, cells: ["N ", "a"] },
    ];
    const [first, second] = countFields([7, 9], rows, 2);
    expect(first).toEqual({
      position: 7, filled: 5, blank: 0, missing: 0, distinct: 3,
      top: [{ value: "A", rows: 2, row: 1 }, { value: "N", rows: 2, row: 2 }],
      otherRows: 1, otherValues: 1, numeric: false,
    });
    // nine numbers and one marker: a field of numbers
    const [series] = countFields([0], [...Array.from({ length: 9 }, (_, i) => ({ row: i + 1, cells: [String(i)] })), { row: 10, cells: ["ND"] }]);
    expect(series.numeric).toBe(true);
    expect(second).toMatchObject({ filled: 3, blank: 1, missing: 1, distinct: 2, top: [{ value: "a", rows: 2, row: 3 }, { value: "b", rows: 1, row: 4 }] });
  });
});

const counts = (over: Partial<FieldCounts>): FieldCounts => ({ position: 0, filled: 100, blank: 0, missing: 0, distinct: 3, top: [{ value: "x", rows: 60, row: 1 }, { value: "y", rows: 30, row: 2 }, { value: "z", rows: 10, row: 3 }], otherRows: 0, otherValues: 0, numeric: false, ...over });

describe("isCategorical", () => {
  it("takes few values that repeat", () => {
    expect(isCategorical(counts({}))).toBe(true);
  });
  it("refuses fewer than 10 filled records, one value, identifiers and long tails", () => {
    expect(isCategorical(counts({ filled: 9 }))).toBe(false);
    expect(isCategorical(counts({ distinct: 1, top: [{ value: "x", rows: 100, row: 1 }] }))).toBe(false);
    // 2,462 records and 800 application numbers: one value per three records
    expect(isCategorical(counts({ filled: 2462, distinct: 800 }))).toBe(false);
    // Orange Book exclusivity codes: 487 codes in 2,462 records, the ten most common hold 58%
    expect(isCategorical(counts({ filled: 2462, distinct: 487, top: [{ value: "NCE", rows: 1431, row: 14 }] }))).toBe(true);
    // 200 values in 5,000 records, but the ten most common hold only 30%
    expect(isCategorical(counts({ filled: 5000, distinct: 200, top: Array.from({ length: 10 }, (_, i) => ({ value: `v${i}`, rows: 150, row: i + 1 })) }))).toBe(false);
    expect(isCategorical(counts({ filled: 5000, distinct: 200, top: Array.from({ length: 10 }, (_, i) => ({ value: `v${i}`, rows: 250, row: i + 1 })) }))).toBe(true);
  });
  it("takes a field of numbers only with at most 12 values", () => {
    // a Z.1 series: 50 values in 305 quarters, zero in 214 of them
    expect(isCategorical(counts({ filled: 305, distinct: 50, numeric: true, top: [{ value: "0", rows: 214, row: 2 }] }))).toBe(false);
    expect(isCategorical(counts({ filled: 1012, distinct: 7, numeric: true, top: [{ value: "2", rows: 762, row: 2 }] }))).toBe(true);
  });
});

describe("categoryCharts", () => {
  const columns = [col("Appl_Type", "Application type"), col("Exclusivity_Code"), col("Appl_No")];
  it("draws the ten most common values and all other values, titled from the dictionary", () => {
    // ten values hold 1,775 of 2,462 records (72%), fifteen more hold the other 687
    const top = Array.from({ length: 10 }, (_, i) => ({ value: `C${i}`, rows: 200 - i * 5, row: i + 1 }));
    const charts = categoryCharts(
      [
        counts({ position: 2, filled: 2462, distinct: 900 }),
        counts({ position: 1, filled: 2462, blank: 3, distinct: 25, top, otherRows: 687, otherValues: 15 }),
        counts({ position: 0, filled: 2462, distinct: 2, top: [{ value: "N", rows: 2400, row: 1 }, { value: "A", rows: 62, row: 40 }] }),
      ],
      columns,
    );
    expect(charts.map((c) => c.title)).toEqual(["Application type", "Exclusivity_Code"]);
    expect(charts[0]).toMatchObject({ code: "Appl_Type", caption: "2 values in 2,462 records." });
    expect(charts[0].bars[0]).toEqual({ key: "v:N", label: "N", value: 2400, text: "2,400", row: 1, title: "Application type N: 2,400 records. Opens the first, record 1." });
    expect(charts[1].bars).toHaveLength(11);
    expect(charts[1].bars[10]).toMatchObject({ key: "other", label: "All other values", sub: "15 values", value: 687, row: null });
    expect(charts[1].caption).toBe("25 values in 2,462 records; the 10 most common hold 72%; empty in 3.");
  });

  it("draws a code and its name once, and names the twin in the caption", () => {
    const sector = counts({ position: 0, filled: 1012, blank: 1, distinct: 3, top: [{ value: "2", rows: 762, row: 2 }, { value: "1", rows: 203, row: 1 }, { value: "4", rows: 47, row: 143 }] });
    const name = counts({ position: 1, filled: 1012, blank: 1, distinct: 3, top: [{ value: "IPP Non-CHP", rows: 762, row: 2 }, { value: "Electric Utility", rows: 203, row: 1 }, { value: "Commercial", rows: 47, row: 143 }] });
    const flags = counts({ position: 2, filled: 1012, blank: 1, distinct: 3, top: [{ value: "Y", rows: 762, row: 3 }, { value: "N", rows: 203, row: 1 }, { value: "U", rows: 47, row: 143 }] });
    expect(samePartition(sector, name)).toBe(true);
    expect(samePartition(sector, flags)).toBe(false);
    const charts = categoryCharts([name, sector, flags], [col("Sector Name"), col("Sector"), col("Flag")]);
    expect(charts.map((c) => c.title)).toEqual(["Sector Name", "Flag"]);
    expect(charts[0].caption).toBe("3 values in 1,012 records; empty in 1. Sector gives the same counts.");
  });

  it("stops at six charts", () => {
    const many = Array.from({ length: 8 }, (_, i) => counts({ position: i, top: [{ value: "x", rows: 60, row: i + 1 }, { value: "y", rows: 40, row: 20 + i }] }));
    expect(categoryCharts(many, Array.from({ length: 8 }, (_, i) => col(`f${i}`)))).toHaveLength(6);
  });

  it("says when every record is in the ten", () => {
    expect(categoryCaption(counts({ blank: 0, missing: 2 }))).toBe("3 values in 100 records; empty in 2.");
  });
});
