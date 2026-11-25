import { describe, expect, it } from "vitest";
import {
  defaultSourceColumns,
  filterSourceColumns,
  formatNativeValue,
  nativeColumnCode,
  numericColumn,
  safeSourceHref,
  sourceAvailability,
} from "./presentation";
import type { SourceColumn, SourceSnapshotSummary } from "./schema";

const numeric: SourceColumn = {
  key: "ASSET",
  label: "Assets",
  type: "number",
  unit: "USD thousands",
  scale: 1000,
};

describe("native record presentation", () => {
  it("keeps reported zero, an empty cell and a null distinct", () => {
    expect(formatNativeValue("0", numeric)).toBe("0");
    expect(formatNativeValue("", numeric)).toBe('""');
    expect(formatNativeValue(null, numeric)).toBe("—");
  });

  it("groups numeric strings without changing source precision or applying their scale", () => {
    expect(formatNativeValue("12345678901234567890.50", numeric)).toBe(
      "12,345,678,901,234,567,890.50",
    );
    expect(formatNativeValue("-1050.000", numeric)).toBe("−1,050.000");
    expect(formatNativeValue("1.2E+9", numeric)).toBe("1.2E+9");
  });

  it("preserves native identifiers and suppression markers", () => {
    expect(formatNativeValue("01001", { key: "FIPS", label: "County", type: "string" })).toBe(
      "01001",
    );
    expect(formatNativeValue("01001", numeric)).toBe("01001");
    expect(formatNativeValue("(D)", numeric)).toBe("(D)");
    const cert = { key: "col0001", label: "CERT", type: "string", native_type: "Integer" };
    expect(numericColumn(cert)).toBe(false);
    expect(formatNativeValue("58122", cert)).toBe("58122");
    expect(nativeColumnCode(cert)).toBe("CERT");
  });

  it("finds an institution's identifying fields and financial lines in a wide native schema", () => {
    const cols = [
      { key: "UNUSED", label: "Extra", type: "number" },
      { key: "DEP", label: "Deposits", type: "number" },
      { key: "CERT", label: "Certificate", type: "string" },
      { key: "NAME", label: "Institution", type: "string" },
      { key: "REPDTE", label: "Report date", type: "date" },
      numeric,
    ];
    expect(defaultSourceColumns(cols, 5)).toEqual([3, 2, 4, 5, 1]);
    expect(filterSourceColumns(cols, "deposit").map((c) => c.index)).toEqual([1]);
    expect(filterSourceColumns(cols, "cert").map((c) => c.index)).toEqual([2]);
    expect(
      defaultSourceColumns(
        [
          { key: "col0000", label: "ASSET", type: "string" },
          { key: "col0001", label: "CERT", type: "string" },
          { key: "col0002", label: "NAME", type: "string" },
        ],
        3,
      ),
    ).toEqual([2, 1, 0]);
  });

  it("starts branch records with branch deposits and county fields rather than repeated bank assets", () => {
    const columns = [
      "ASSET",
      "DEPSUMBR",
      "CERT",
      "NAMEBR",
      "YEAR",
      "CNTYNAMB",
      "STALPBR",
      "STCNTYBR",
      "NAMEFULL",
    ].map((label, i) => ({ key: `col${i}`, label, type: "string" }));
    expect(defaultSourceColumns(columns)).toEqual([8, 3, 2, 4, 6, 5, 7, 1]);
  });

  it("does not call an uncollected, failed or partly loaded source ready", () => {
    const s: SourceSnapshotSummary = {
      id: "abc",
      status: "staging",
      expected_rows: 100,
      loaded_rows: 20,
      retrieved_at: null,
      published_at: null,
      coverage: {},
      quality: {},
    };
    expect(sourceAvailability(null)).toEqual({ label: "Registered", tone: "quiet", ready: false });
    expect(sourceAvailability(s)).toEqual({ label: "Loading", tone: "pending", ready: false });
    expect(sourceAvailability({ ...s, status: "failed" })).toEqual({
      label: "Needs attention",
      tone: "warning",
      ready: false,
    });
    expect(sourceAvailability({ ...s, status: "ready", loaded_rows: 100 })).toEqual({
      label: "Ready",
      tone: "ready",
      ready: true,
    });
  });

  it("only renders public HTTP source links", () => {
    expect(safeSourceHref("https://api.fdic.gov/banks/financials?filters=CERT%3A628")).toBe(
      "https://api.fdic.gov/banks/financials?filters=CERT%3A628",
    );
    expect(safeSourceHref("javascript:alert(1)")).toBeNull();
    expect(safeSourceHref(null)).toBeNull();
  });
});
