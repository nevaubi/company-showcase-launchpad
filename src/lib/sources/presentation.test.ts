import { describe, expect, it } from "vitest";
import {
  defaultSourceColumns,
  filterSourceColumns,
  formatNativeValue,
  nativeColumnCode,
  numericColumn,
  safeSourceHref,
  sourceAvailability,
  sourceCoverageExceptions,
  sourceDescription,
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
  it.each([
    [
      "Complete retained FHFA master history across index types, flavors, frequencies and geographic levels. Keep all series-context fields; index bases and seasonal adjustments differ.",
      "186,031",
      "12",
    ],
    [
      "Complete retained source table with all original fields and records from this file.",
      "8,640",
      "6",
    ],
  ])("identifies generated counts as the original collection without changing scope: %s", (scope, rows, columns) => {
    expect(
      sourceDescription(`${scope} Retained table: ${rows} source rows and ${columns} columns.`),
    ).toBe(`${scope} Original collection: ${rows} source rows and ${columns} columns.`);
  });

  it("preserves count strings exactly, including zero and values beyond numeric precision", () => {
    expect(
      sourceDescription("Scope. Retained table: 0 source rows and 2,379 columns."),
    ).toBe("Scope. Original collection: 0 source rows and 2,379 columns.");
    expect(
      sourceDescription(
        "Scope. Retained table: 12,345,678,901,234,567,890 source rows and 6 columns.",
      ),
    ).toBe("Scope. Original collection: 12,345,678,901,234,567,890 source rows and 6 columns.");
  });

  it("leaves unknown wording, nonterminal counts and noncanonical suffixes untouched", () => {
    for (const description of [
      "",
      "Retained table: 8,640 source rows and 6 columns.",
      "Scope. Retained table: 8,640 source rows and 6 columns. Further source context.",
      "Scope. Retained table: 8640 source rows and 6 columns.",
      "Scope. Retained table: 08,640 source rows and 6 columns.",
      "Scope. Retained table: 8,64 source rows and 6 columns.",
      "Scope. Retained table: 8,640 source rows and 6.0 columns.",
      "Scope. Retained table: 8,640 records and 6 columns.",
      "Scope. retained table: 8,640 source rows and 6 columns.",
      "Scope. Retained table: 8,640 source rows and 6 columns.\n",
      "Scope. Original collection: 8,640 source rows and 6 columns.",
    ]) {
      expect(sourceDescription(description)).toBe(description);
    }
  });

  it("leaves explicitly scoped native adapter descriptions unchanged", () => {
    for (const description of [
      "All returned current-quarter fields from the 2,379-field reviewed FDIC baseline, retaining the 500 insured institutions selected at June 30, 2026. Requested fields that FDIC does not return are listed explicitly in snapshot coverage.",
      "Reported monthly revenue from the official TWSE response. Native Chinese fields and reported ROC month are preserved; exchange population completeness is not independently established.",
      "Reported monthly revenue from the official TPEx response. Native Chinese fields and reported ROC month are preserved; exchange population completeness is not independently established.",
    ]) {
      expect(sourceDescription(description)).toBe(description);
    }
  });

  it("discloses the exact certificates and requested fields absent from the FDIC response", () => {
    expect(
      sourceCoverageExceptions({
        cohort_size: 500,
        reporting_institutions: 496,
        missing_certificates: ["18221", "26484", "28710", "58629"],
        missing_institution_policy: "No imputation, successor substitution, or zero-fill.",
        requested_but_not_returned_fields: ["L_REPDTE"],
        omitted_field_policy: "An omitted column has no invented blank or null cells.",
      }),
    ).toEqual([
      {
        key: "missing_certificates",
        label: "Missing certificates (CERT)",
        values: ["18221", "26484", "28710", "58629"],
        policyKey: "missing_institution_policy",
        policy: "No imputation, successor substitution, or zero-fill.",
      },
      {
        key: "requested_but_not_returned_fields",
        label: "Requested fields not returned",
        values: ["L_REPDTE"],
        policyKey: "omitted_field_policy",
        policy: "An omitted column has no invented blank or null cells.",
      },
    ]);
  });

  it("preserves every declared identifier without scalar limits or numeric conversion", () => {
    const certificates = [
      "00001",
      "00002",
      "00003",
      "00004",
      "00005",
      "00006",
      "00007",
      "00008",
      "00009",
      "00010",
      "00011",
      "00012",
      "00013",
    ];
    const coverage = Object.freeze({ missing_certificates: Object.freeze(certificates) });
    const [exception] = sourceCoverageExceptions(coverage);
    expect(exception.values).toEqual(certificates);
    expect(exception.policy).toBeNull();
    expect(exception.values).not.toBe(certificates);
  });

  it("does not invent exceptions or policy text from counts, unrelated arrays or invalid metadata", () => {
    expect(
      sourceCoverageExceptions({
        cohort_size: 500,
        reporting_institutions: 496,
        periods: ["20260930"],
        missing_certificates: [],
        requested_but_not_returned_fields: ["L_REPDTE", null],
        omitted_field_policy: "Preserve the stored policy.",
      }),
    ).toEqual([]);
    expect(
      sourceCoverageExceptions({
        missing_certificates: [18221],
        requested_but_not_returned_fields: "L_REPDTE",
      }),
    ).toEqual([]);
    expect(
      sourceCoverageExceptions({
        requested_but_not_returned_fields: ["L_REPDTE"],
        omitted_field_policy: { text: "Not a declared policy string" },
      })[0].policy,
    ).toBeNull();
  });

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
