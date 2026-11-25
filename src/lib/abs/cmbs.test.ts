import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSET_COLUMNS,
  cmbsMetrics,
  cmbsRows,
  linkProperties,
  monthFirstDate,
  PROPERTY_COLUMNS,
  typed,
  type CmbsAssetRow,
  type CmbsPropertyRow,
} from "./cmbs";
import { METRICS } from "./metrics";
import { readAbsText, type AbsRecord } from "./xml";

const EXCERPT = readFileSync("src/test/fixtures/abs/cmbs-ex102-excerpt.xml", "utf8");
const MIGRATION = readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8");

function rowsOf(records: AbsRecord[]) {
  const assets: CmbsAssetRow[] = [];
  const properties: CmbsPropertyRow[] = [];
  for (const r of records) {
    const x = cmbsRows(r);
    assets.push(x.asset);
    properties.push(...x.properties);
  }
  linkProperties(assets, properties);
  return { assets, properties };
}
const record = (
  rec: number,
  fields: [string, string][],
  blocks: [string, string][][] = [],
): AbsRecord => ({
  rec,
  tag: "assets",
  fields,
  blocks: blocks.map((f) => ({ name: "property", fields: f })),
});

describe("abs commercial mortgage rows", () => {
  it("types a field only when its text spells that type, and says so when it does not", () => {
    expect(typed("num", "115000000.00000000")).toEqual({ value: "115000000.00000000", bad: false });
    expect(typed("num", " .03486000 ")).toEqual({ value: ".03486000", bad: false });
    expect(typed("num", "")).toEqual({ value: null, bad: false });
    expect(typed("num", "N/A")).toEqual({ value: null, bad: true });
    expect(typed("num", "3.89%")).toEqual({ value: null, bad: true });
    expect(typed("int", "120")).toEqual({ value: 120, bad: false });
    expect(typed("int", "120.00")).toEqual({ value: 120, bad: false });
    expect(typed("int", "120.5")).toEqual({ value: null, bad: true });
    expect(typed("int", "99999999999")).toEqual({ value: null, bad: true });
    expect(typed("date", "06-11-2024")).toEqual({ value: "2024-06-11", bad: false });
    expect(typed("date", "06/11/2024")).toEqual({ value: "2024-06-11", bad: false });
    expect(typed("date", "2024-06-11")).toEqual({ value: null, bad: true });
    expect(typed("date", "02-30-2024")).toEqual({ value: null, bad: true });
    expect(typed("date", "06-2024")).toEqual({ value: null, bad: true });
    expect(typed("bool", "true")).toEqual({ value: true, bad: false });
    expect(typed("bool", "0")).toEqual({ value: false, bad: false });
    expect(typed("bool", "Y")).toEqual({ value: null, bad: true });
    expect(typed("text", "  Midland Loan Services ")).toEqual({
      value: "Midland Loan Services",
      bad: false,
    });
    expect(typed("text", "   ")).toEqual({ value: null, bad: false });
    expect(monthFirstDate("02-29-2024")).toBe("2024-02-29");
    expect(monthFirstDate("02-29-2023")).toBeNull();
    expect(monthFirstDate("13-01-2024")).toBeNull();
  });

  it("maps a real excerpt: loans, the notes a loan was split into, and properties filed in records of their own", () => {
    const { assets, properties } = rowsOf(readAbsText(EXCERPT).records);
    expect(assets.map((a) => [a.rec, a.kind, a.asset_number])).toEqual([
      [1, "loan", "3"],
      [2, "loan", "3A"],
      [3, "loan", "3B"],
      [4, "loan", "26"],
      [5, "property", "26-001"],
      [6, "property", "26-002"],
    ]);
    const loan = assets[0];
    expect(loan).toMatchObject({
      asset_type_number: "Prospectus Loan ID",
      period_begin: "2024-05-14",
      period_end: "2024-06-11",
      original_loan_amount: "30000000.00",
      sched_end_balance: "30000000.00",
      actual_end_balance: "30000000.00",
      period_rate: "0.06844",
      payment_status_code: "0",
      interest_only: true,
      properties: 1,
      maturity_date: "2029-02-11",
      unparsed: {},
    });
    // fields without a column are kept word for word
    expect(loan.extra).toMatchObject({
      underwritingIndicator: "true",
      periodicPrincipalAndInterestPaymentSecuritizationAmount: "359310.00",
      graceDaysAllowedNumber: "0",
    });
    // a property-only record carries its period and nothing about a loan
    expect(assets[4]).toMatchObject({
      period_end: "2024-06-11",
      original_loan_amount: null,
      sched_end_balance: null,
      payment_status_code: null,
      extra: {},
      unparsed: {},
    });
    expect(
      properties.map((p) => [p.rec, p.seq, p.asset_number, p.loan_asset_number, p.link, p.name]),
    ).toEqual([
      [1, 1, "3", "3", "nested", "WESTERN DIGITAL MILPITAS CAMPUS"],
      [2, 1, "3A", "3A", "nested", "NA"],
      [3, 1, "3B", "3B", "nested", "NA"],
      [4, 1, "26", "26", "nested", "Oklahoma Texas Hotel Portfolio"],
      [5, 1, "26-001", "26", "number", "LA QUINTA INN BROWNWOOD"],
      [6, 1, "26-002", "26", "number", "HAMPTON INN OKLAHOMA CITY NE"],
    ]);
    expect(properties[0]).toMatchObject({
      city: "Milpitas",
      state: "CA",
      type_code: "MU",
      valuation_securitization: "197000000.00",
      occupancy_securitization: "1",
      year_built: 1991,
      tenant1_lease_end: "2039-01-01",
      extra: { defeasanceOptionStartDate: "05-11-2026" },
    });
    expect(properties[4]).toMatchObject({
      state: "TX",
      occupancy_securitization: "0.821",
      year_built: 2008,
    });
  });

  it("keeps unreadable text and repeated fields word for word instead of choosing a value", () => {
    const { asset, properties } = cmbsRows(
      record(
        1,
        [
          ["assetNumber", "5"],
          ["maturityDate", "2029-02-11"],
          ["originalLoanAmount", "1,000,000"],
          ["reportPeriodInterestRatePercentage", "0.05"],
          ["reportPeriodInterestRatePercentage", "5.00"],
          ["interestOnlyIndicator", "Y"],
          ["somethingNew", "kept"],
          ["somethingNew", "twice"],
        ],
        [
          [
            ["propertyName", "P"],
            ["yearBuiltNumber", "circa 1990"],
            ["newPropertyField", "x"],
          ],
        ],
      ),
    );
    expect(asset.kind).toBe("loan");
    expect([
      asset.maturity_date,
      asset.original_loan_amount,
      asset.period_rate,
      asset.interest_only,
    ]).toEqual([null, null, null, null]);
    expect(asset.unparsed).toEqual({
      maturityDate: "2029-02-11",
      originalLoanAmount: "1,000,000",
      reportPeriodInterestRatePercentage: ["0.05", "5.00"],
      interestOnlyIndicator: "Y",
    });
    expect(asset.extra).toEqual({ somethingNew: ["kept", "twice"] });
    expect(properties[0]).toMatchObject({
      name: "P",
      year_built: null,
      unparsed: { yearBuiltNumber: "circa 1990" },
      extra: { newPropertyField: "x" },
    });
  });

  it("refuses a record it cannot key or does not know", () => {
    expect(() => cmbsRows(record(3, [["originalLoanAmount", "1"]]))).toThrowError(
      /record 3 has no assetNumber/,
    );
    expect(() => cmbsRows(record(4, [["assetNumber", " "]]))).toThrowError(
      /record 4 has no assetNumber/,
    );
    expect(() =>
      cmbsRows(
        record(5, [
          ["assetNumber", "1"],
          ["assetNumber", "2"],
        ]),
      ),
    ).toThrowError(/more than one assetNumber/);
    expect(() =>
      cmbsRows({
        rec: 6,
        tag: "assets",
        fields: [["assetNumber", "1"]],
        blocks: [{ name: "tranche", fields: [] }],
      }),
    ).toThrowError(/<tranche> block/);
    expect(
      cmbsRows(
        record(7, [
          ["assetNumber", "1"],
          ["reportingPeriodEndDate", "06-11-2024"],
        ]),
      ).asset.kind,
    ).toBe("other");
  });

  it("ties a property record to the longest loan number it starts with, and leaves it untied when none fits", () => {
    const loan = (n: number, number: string) =>
      record(n, [
        ["assetNumber", number],
        ["originalLoanAmount", "1"],
      ]);
    const prop = (n: number, number: string) =>
      record(n, [["assetNumber", number]], [[["propertyName", number]]]);
    const { properties } = rowsOf([
      loan(1, "1"),
      loan(2, "12"),
      loan(3, "12A"),
      prop(4, "12.01"),
      prop(5, "1-002"),
      prop(6, "12A.01"),
      prop(7, "120.01"),
      prop(8, "2.01"),
      prop(9, "12B"),
    ]);
    expect(properties.map((p) => [p.asset_number, p.loan_asset_number, p.link])).toEqual([
      ["12.01", "12", "number"],
      ["1-002", "1", "number"],
      ["12A.01", "12A", "number"],
      ["120.01", "120.01", "none"],
      ["2.01", "2.01", "none"],
      ["12B", "12B", "none"],
    ]);
  });

  it("computes pool figures exactly and says how many loans each one covers", () => {
    const { assets, properties } = rowsOf(readAbsText(EXCERPT).records);
    const m = cmbsMetrics(assets, properties);
    const get = (metric: string, dim = "", bucket = "") =>
      m.find((r) => r.metric === metric && r.dim === dim && r.bucket === bucket);
    expect(get("records")).toMatchObject({ value: "6", unit: "count", n: 6 });
    expect(get("loans")).toMatchObject({ value: "4" });
    expect(get("property_records")).toMatchObject({ value: "2" });
    expect(get("properties")).toMatchObject({ value: "6" });
    // 30,000,000 + 28,000,000 + 5,000,000 + 10,000,000
    for (const k of [
      "original_balance",
      "securitization_balance",
      "begin_balance",
      "sched_end_balance",
      "actual_end_balance",
    ])
      expect(get(k), k).toMatchObject({ value: "73000000", unit: "usd", n: 4, n_missing: 0 });
    // (0.06844 x 63,000,000 + 0.07165 x 10,000,000) / 73,000,000
    expect(get("wa_period_rate")).toMatchObject({
      value: "0.068879726",
      unit: "as_filed",
      n: 4,
      n_missing: 0,
    });
    expect(get("loans", "payment_status", "0")).toMatchObject({ value: "4" });
    expect(get("sched_end_balance", "payment_status", "0")).toMatchObject({ value: "73000000" });
    expect(get("records", "period_end", "2024-06-11")).toMatchObject({ value: "6" });
    for (const r of m) expect(METRICS[r.metric].unit).toBe(r.unit);
    // every key is unique: the table's primary key is (load, metric, dim, bucket)
    expect(new Set(m.map((r) => `${r.metric}|${r.dim}|${r.bucket}`)).size).toBe(m.length);
  });

  it("leaves a figure empty rather than zero when no loan states the field, and counts what is missing", () => {
    const { assets, properties } = rowsOf([
      record(1, [
        ["assetNumber", "1"],
        ["originalLoanAmount", "100.00"],
        ["reportPeriodEndScheduledLoanBalanceAmount", "0.00"],
        ["reportPeriodInterestRatePercentage", "0.05"],
      ]),
      record(2, [
        ["assetNumber", "2"],
        ["originalLoanAmount", "200.00"],
      ]),
    ]);
    const m = cmbsMetrics(assets, properties);
    const get = (metric: string, dim = "", bucket = "") =>
      m.find((r) => r.metric === metric && r.dim === dim && r.bucket === bucket);
    expect(get("original_balance")).toMatchObject({ value: "300", n: 2, n_missing: 0 });
    expect(get("sched_end_balance")).toMatchObject({ value: "0", n: 1, n_missing: 1 });
    expect(get("actual_end_balance")).toMatchObject({ value: null, n: 0, n_missing: 2 });
    // a paid-off loan (zero balance) has no weight; nothing is left to average
    expect(get("wa_period_rate")).toMatchObject({ value: null, n: 0, n_missing: 2 });
    expect(get("loans", "payment_status", "(blank)")).toMatchObject({ value: "2" });
    expect(get("records", "period_end", "(blank)")).toMatchObject({ value: "2" });
  });

  it("names only columns the tables have, each once, and each source field once", () => {
    const table = (name: string) => {
      const start = MIGRATION.indexOf(`CREATE TABLE public.${name} (`);
      const body = MIGRATION.slice(start, MIGRATION.indexOf("\n);", start));
      return new Set([...body.matchAll(/^ {2}([a-z_0-9]+) /gm)].map((x) => x[1]));
    };
    for (const [specs, name, own] of [
      [
        ASSET_COLUMNS,
        "abs_cmbs_assets",
        ["load_id", "accession", "rec", "kind", "asset_number", "extra", "unparsed"],
      ],
      [
        PROPERTY_COLUMNS,
        "abs_cmbs_properties",
        [
          "load_id",
          "accession",
          "rec",
          "seq",
          "asset_number",
          "loan_asset_number",
          "link",
          "extra",
          "unparsed",
        ],
      ],
    ] as const) {
      const cols = table(name);
      expect(cols.size).toBeGreaterThan(20);
      const mapped = specs.map((s) => s[0]);
      expect(new Set(mapped).size, `${name} columns mapped once`).toBe(mapped.length);
      expect(new Set(specs.map((s) => s[1])).size, `${name} source fields mapped once`).toBe(
        specs.length,
      );
      for (const c of mapped) expect(cols.has(c), `${name}.${c}`).toBe(true);
      // and the table has no column the reader never fills
      expect(
        [...cols].filter((c) => !mapped.includes(c) && !(own as readonly string[]).includes(c)),
      ).toEqual([]);
    }
  });
});
