import { describe, expect, it } from "vitest";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import { fillCaption, fillCells, fillLegend, fillPct } from "./fill-model";

const col = (key: string, title?: string): SourceColumn => ({ key, label: key, type: "string", ...(title ? { title } : {}) });
const f = (position: number, filled: number, blank: number): SourceFieldFill => ({ position, key: `k${position}`, label: `k${position}`, filled, blank, share: filled + blank ? filled / (filled + blank) : 0 });

describe("fill cells", () => {
  const columns = [col("CERT", "FDIC certificate"), col("NAME"), col("ASSET"), col("NOTE"), col("OLD")];
  const fills = [f(0, 500, 0), f(1, 499, 1), f(2, 300, 200), f(3, 2, 498), f(4, 0, 500)];

  it("puts each field in its band and says its counts", () => {
    const cells = fillCells(fills, columns);
    expect(cells.map((c) => c.band)).toEqual([0, 1, 2, 3, 4]);
    expect(cells[0]).toMatchObject({ title: "FDIC certificate", code: "CERT", tip: "FDIC certificate (CERT): a value in 500 of 500 records, 100%" });
    expect(cells[1].tip).toBe("NAME: a value in 499 of 500 records, 99.8%");
    expect(cells[1].code).toBeNull();
  });

  it("counts fields per band and says the two ends", () => {
    const cells = fillCells(fills, columns);
    expect(fillLegend(cells).map((l) => l.fields)).toEqual([1, 1, 1, 1, 1]);
    expect(fillCaption(cells)).toBe("5 fields; 1 filled in every record, 1 empty in every record.");
    expect(fillCaption(fillCells([f(0, 3, 0)], columns))).toBe("1 field; every one filled in every record.");
    expect(fillCaption(fillCells([f(2, 3, 1)], columns))).toBe("1 field; none filled in every record.");
  });

  it("writes shares without rounding a field to full or empty", () => {
    expect(fillPct(0.99996)).toBe(">99.9%");
    expect(fillPct(0.00001)).toBe("<0.1%");
    expect(fillPct(0)).toBe("0.0%");
  });
});
