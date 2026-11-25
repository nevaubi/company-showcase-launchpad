import { describe, expect, it } from "vitest";
import { csvSourceCell, sourcePageCsv } from "./export";
import type { SourceRecordPage } from "./schema";

describe("source page CSV", () => {
  it("neutralizes formula-like source text including leading control characters", () => {
    expect(csvSourceCell('=HYPERLINK("https://example.test")')).toBe(
      '"\'=HYPERLINK(""https://example.test"")"',
    );
    expect(csvSourceCell("\t@SUM(A1:A2)")).toBe('"\'\t@SUM(A1:A2)"');
    expect(csvSourceCell("-1+2")).toBe('"\'-1+2"');
    expect(csvSourceCell("+cmd|' /C calc'!A0")).toBe("\"'+cmd|' /C calc'!A0\"");
    expect(csvSourceCell("-SUM(1)")).toBe('"\'-SUM(1)"');
    expect(csvSourceCell(" -1,234")).toBe('"\' -1,234"');
  });

  it("leaves published signed figures and dash markers as they are (rev-app N2)", () => {
    for (const cell of ["-", "--", "-1,234", "-0.5%", "+1.2%", "+3"]) expect(csvSourceCell(cell), cell).toBe(`"${cell}"`);
  });

  it("retains negative numbers, exact precision and zero-padded native IDs", () => {
    expect(csvSourceCell("-12345678901234567890.5000")).toBe('"-12345678901234567890.5000"');
    expect(csvSourceCell("-1.25E-10")).toBe('"-1.25E-10"');
    expect(csvSourceCell("01001")).toBe('"01001"');
    expect(csvSourceCell("0")).toBe('"0"');
    expect(csvSourceCell(null)).toBe("");
    expect(csvSourceCell("")).toBe('""');
    expect(csvSourceCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it("exports only the received page and its projected native columns with row provenance", () => {
    const page: SourceRecordPage = {
      dataset_id: "fdic",
      snapshot_id: "snapshot-hash",
      total: 50000,
      nextCursor: 7,
      hasMore: true,
      columns: [
        { key: "col0", label: "CERT", type: "string" },
        { key: "col1", label: "ASSET", type: "string", native_type: "number", unit: "USD thousands (monetary measures)" },
      ],
      column_indices: [0, 1],
      rows: [
        {
          row_number: 7,
          values: ["00123", "-12345678901234567890.50"],
          entity_id: "00123",
          entity_name: "Bank",
          period: "20260930",
          geo_level: null,
          geo_code: null,
          geo_name: null,
          source_url: "https://api.fdic.gov/banks/financials?filters=CERT:123",
        },
      ],
    };
    const csv = sourcePageCsv(page, "https://www.fdic.gov/");
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"Source row","Snapshot ID","Source URL","CERT","ASSET"');
    expect(csv).toContain(
      '"7","snapshot-hash","https://api.fdic.gov/banks/financials?filters=CERT:123","00123","-12345678901234567890.50"',
    );
    expect(csv).not.toContain("50000");
  });
});
