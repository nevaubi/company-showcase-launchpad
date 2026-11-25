import { describe, expect, it } from "vitest";
import { validateSourceFile, validateSourceRow, projectSourceRow, recordInput } from "./validation";

const hash = "a".repeat(64);
const file = { sha256: hash, bytes: 3, content_type: "text/csv", chunks: [{ index: 0, path: `official/objects/${hash}`, sha256: hash, bytes: 3 }], provenance: {} };

describe("official source boundaries", () => {
  it("accepts only content-addressed chunks within the 32 MiB limit and exact full-file length", () => {
    expect(validateSourceFile(file)).toEqual(file);
    expect(() => validateSourceFile({ ...file, bytes: 4 })).toThrow(/length|bytes/i);
    expect(() => validateSourceFile({ ...file, chunks: [{ ...file.chunks[0], path: "ops/private.json" }] })).toThrow(/path/i);
    expect(() => validateSourceFile({ ...file, bytes: 33554433, chunks: [{ ...file.chunks[0], bytes: 33554433 }] })).toThrow(/32 MiB|chunk/i);
  });
  it("keeps zeros, leading zeros, blanks, suppression codes and native periods exactly", () => {
    const row = { row_number: 1, values: ["000123", "0", "", "(D)", "2026Q3", null] };
    expect(validateSourceRow(row, 6).values).toEqual(["000123", "0", "", "(D)", "2026Q3", null]);
    expect(() => validateSourceRow({ ...row, values: ["000123", 0] }, 2)).toThrow(/string|null/i);
    expect(() => validateSourceRow(row, 5)).toThrow(/width/i);
  });
  it("uses declared positions for dimensions without trimming or parsing values", () => {
    const row = projectSourceRow(["000123", "  Native bank  ", "FY 2026", "0", ""], 8, {
      format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1,
      dimensions: { entity_id: 0, entity_name: 1, period: 2 }, constants: { geo_level: "county" },
    });
    expect(row).toMatchObject({ row_number: 8, entity_id: "000123", entity_name: "  Native bank  ", period: "FY 2026", geo_level: "county", values: ["000123", "  Native bank  ", "FY 2026", "0", ""] });
  });
  it("rejects oversized pages and invalid projections before a database call", () => {
    expect(() => recordInput.parse({ datasetId: "financials/fdic", limit: 101 })).toThrow();
    expect(() => recordInput.parse({ datasetId: "financials/fdic", after: -1 })).toThrow();
    expect(() => recordInput.parse({ datasetId: "financials/fdic", columns: [0, 0] })).toThrow();
    expect(recordInput.parse({ datasetId: "financials/fdic", period: "2026Q3", q: "Bank, Inc.%" }).q).toBe("Bank, Inc.%");
  });
  it("derives only explicitly declared month and county indexes while keeping source cells", () => {
    const ingest = { format: "csv" as const, encoding: "utf-8" as const, delimiter: ",", header_rows: 1,
      dimensions: { geo_code: 2 }, composites: { period: { indices: [0,1] as [number,number], separator: "-", format: "year_month" as const } }, geo_code_format: "county_fips_5" as const };
    const r = projectSourceRow(["2026","1","1095"],1,ingest);
    expect(r).toMatchObject({ period:"2026-01", geo_code:"01095", values:["2026","1","1095"] });
    expect(projectSourceRow(["2026","12","Autauga"],2,ingest).geo_code).toBeNull();
    expect(()=>projectSourceRow(["2026","13","1095"],3,ingest)).toThrow(/year_month/);
  });
});
