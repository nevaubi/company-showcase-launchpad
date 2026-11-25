import { describe, expect, it } from "vitest";
import {
  fdicFieldBlocks,
  fdicFinancialsUrl,
  joinFdicFieldBlocks,
  inspectFdicCsvBlock,
  parseFdicCsv,
  parseFdicDictionaryFields,
  parseFdicIdentityPage,
  validateFdicCohort,
  writeFdicCsv,
} from "../../scripts/lib/fdic-native";

const date = "20260930";
const columns = ["CERT", "REPDTE", "ID", "ASSET", "DEP", "NAME"];
const row = (cert: string, fields: Record<string, string> = {}) => ({
  CERT: cert,
  REPDTE: date,
  ID: `${cert}_${date}`,
  ...fields,
});
const identityPayload = (rows = [row("14"), row("110")]) => ({
  meta: { total: 2, index: { name: "risview_reviewed", createTimestamp: "2026-11-19T16:41:28Z" } },
  data: rows.map((data) => ({ data: { ...data, CERT: Number(data.CERT) }, score: 0 })),
});

describe("FDIC native field collection", () => {
  it("bounds native field blocks and repeats only the real join fields", () => {
    expect(fdicFieldBlocks(columns, 4)).toEqual([
      ["CERT", "REPDTE", "ASSET", "DEP"],
      ["CERT", "REPDTE", "NAME"],
    ]);
    expect(() => fdicFieldBlocks([...columns, "ASSET"], 4)).toThrow(/duplicate/i);
    expect(() => fdicFieldBlocks(["CERT", "ASSET"], 4)).toThrow(/REPDTE/);
    expect(() => fdicFieldBlocks(columns, 251)).toThrow(/250/);
  });

  it("uses the official format switch and a bounded, exact cohort/quarter filter", () => {
    const url = new URL(
      fdicFinancialsUrl({
        certs: ["14", "110"],
        reportDate: date,
        fields: ["CERT", "REPDTE", "ASSET"],
        offset: 2,
        limit: 2,
        format: "csv",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://api.fdic.gov/banks/financials");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("filters")).toBe("CERT:(14 OR 110) AND REPDTE:20260930");
    expect(url.searchParams.get("sort_by")).toBe("CERT");
    expect(url.searchParams.get("offset")).toBe("2");
    expect(() =>
      fdicFinancialsUrl({
        certs: ["14 OR *"],
        reportDate: date,
        fields: ["CERT"],
        offset: 0,
        limit: 2,
        format: "csv",
      }),
    ).toThrow(/certificate/i);
    expect(() =>
      fdicFinancialsUrl({
        certs: ["14"],
        reportDate: "20261125",
        fields: ["CERT"],
        offset: 0,
        limit: 2,
        format: "csv",
      }),
    ).toThrow(/quarter/i);
  });

  it("reads the actual alphabetized API CSV header without number coercion", () => {
    const csv =
      '"ASSET","CERT","ID","NAME","REPDTE"\n9007199254740993123.0040,14,"14_20260930","Bank, A","20260930"\n-0.000000000000001,110,"110_20260930","Bank ""B""","20260930"';
    const rows = parseFdicCsv(csv, ["CERT", "REPDTE", "NAME", "ASSET"]);
    expect(rows[0]).toEqual(row("14", { ASSET: "9007199254740993123.0040", NAME: "Bank, A" }));
    expect(rows[1].ASSET).toBe("-0.000000000000001");
    expect(rows[1].NAME).toBe('Bank "B"');
  });

  it("distinguishes source zero, empty, and suppression strings", () => {
    const rows = parseFdicCsv("CERT,REPDTE,ID,ASSET,DEP,NAME\n14,20260930,14_20260930,0,,N/A\n", [
      "CERT",
      "REPDTE",
      "ASSET",
      "DEP",
      "NAME",
    ]);
    expect(rows[0]).toEqual(row("14", { ASSET: "0", DEP: "", NAME: "N/A" }));
  });

  it("rejects absent, duplicate, unexpected, or ragged native columns", () => {
    expect(() =>
      parseFdicCsv("CERT,REPDTE,ID\n14,20260930,x", ["CERT", "REPDTE", "ASSET"]),
    ).toThrow(/ASSET/);
    expect(() => parseFdicCsv("CERT,REPDTE,ID,CERT\n14,20260930,x,14", ["CERT", "REPDTE"])).toThrow(
      /duplicate/i,
    );
    expect(() =>
      parseFdicCsv("CERT,REPDTE,ID,UNREVIEWED\n14,20260930,x,1", ["CERT", "REPDTE"]),
    ).toThrow(/unexpected/i);
    expect(() => parseFdicCsv("CERT,REPDTE,ID\n14,20260930", ["CERT", "REPDTE"])).toThrow(/width/i);
  });

  it("records an omitted current-quarter column without inventing a cell", () => {
    const result = inspectFdicCsvBlock("CERT,ID,NAME,REPDTE\n14,14_20260930,BANK A,20260930", [
      "CERT",
      "REPDTE",
      "L_REPDTE",
      "NAME",
    ]);
    expect(result.omittedFields).toEqual(["L_REPDTE"]);
    expect(result.returnedFields).toEqual(["CERT", "ID", "NAME", "REPDTE"]);
    expect(Object.hasOwn(result.rows[0], "L_REPDTE")).toBe(false);
    expect(() => inspectFdicCsvBlock("CERT,NAME\n14,BANK A", ["CERT", "REPDTE", "NAME"])).toThrow(
      /identity|ID|REPDTE/,
    );
  });

  it("verifies omissions using every identity and rejects even one returned JSON value", () => {
    const payload = identityPayload();
    expect(parseFdicIdentityPage(payload, ["14", "110"], date, 0, 500).rows).toHaveLength(2);
    const withExplicitNull = {
      ...payload,
      data: [{ data: { ...row("14"), L_REPDTE: null } }, { data: row("110") }],
    };
    expect(() => parseFdicIdentityPage(withExplicitNull, ["14", "110"], date, 0, 500)).toThrow(
      /field/i,
    );
  });

  it("reads only native property names from the verified official dictionary layout", () => {
    const yaml =
      "type: object\nproperties:\n  data:\n    type: object\n    properties:\n      CERT:\n        type: number\n      L_REPDTE:\n        type: string\n        x-source-mapping:\n          - field: L_REPDTE\n";
    expect([...parseFdicDictionaryFields(yaml)]).toEqual(["CERT", "L_REPDTE"]);
    expect(() => parseFdicDictionaryFields("<html>blocked</html>")).toThrow(/dictionary/i);
  });

  it("joins shuffled blocks only on CERT + REPDTE and retains source ID", () => {
    const blocks = [
      [
        row("110", { ASSET: "1e+21", DEP: "001.00" }),
        row("14", { ASSET: "9007199254740993", DEP: "-4.500" }),
      ],
      [row("14", { NAME: "BANK A" }), row("110", { NAME: "BANK B" })],
    ];
    expect(joinFdicFieldBlocks(blocks, columns, [row("14"), row("110")], date)).toEqual([
      ["14", date, "14_20260930", "9007199254740993", "-4.500", "BANK A"],
      ["110", date, "110_20260930", "1e+21", "001.00", "BANK B"],
    ]);
  });

  it("fails when a block drops, duplicates, or introduces an institution", () => {
    const expected = [row("14"), row("110")];
    expect(() =>
      joinFdicFieldBlocks(
        [[row("14", { ASSET: "1" })]],
        ["CERT", "REPDTE", "ID", "ASSET"],
        expected,
        date,
      ),
    ).toThrow(/key set|missing/i);
    expect(() => joinFdicFieldBlocks([[row("14"), row("14")]], columns, expected, date)).toThrow(
      /duplicate/i,
    );
    expect(() => joinFdicFieldBlocks([[row("14"), row("111")]], columns, expected, date)).toThrow(
      /unexpected|key set/i,
    );
  });

  it("never merges a different quarter, conflicting ID, or overlapping value", () => {
    expect(() =>
      joinFdicFieldBlocks(
        [[row("14", { REPDTE: "20260630" })]],
        ["CERT", "REPDTE", "ID"],
        [row("14")],
        date,
      ),
    ).toThrow(/period|quarter/i);
    expect(() =>
      joinFdicFieldBlocks(
        [[row("14", { ID: "different" })]],
        ["CERT", "REPDTE", "ID"],
        [row("14")],
        date,
      ),
    ).toThrow(/conflict/i);
    expect(() =>
      joinFdicFieldBlocks(
        [[row("14", { ASSET: "1" })], [row("14", { ASSET: "2" })]],
        ["CERT", "REPDTE", "ID", "ASSET"],
        [row("14")],
        date,
      ),
    ).toThrow(/conflict/i);
  });

  it("requires every baseline column before returning an assembled record", () => {
    expect(() =>
      joinFdicFieldBlocks([[row("14", { ASSET: "1" })]], columns, [row("14")], date),
    ).toThrow(/DEP|NAME/);
  });

  it("validates identity-only JSON metadata and cannot round-trip financial values through JSON", () => {
    const page = parseFdicIdentityPage(identityPayload(), ["14", "110"], date, 0, 2);
    expect(page.total).toBe(2);
    expect(page.indexName).toBe("risview_reviewed");
    expect(page.rows.map((r) => r.CERT)).toEqual(["14", "110"]);
    expect(() =>
      parseFdicIdentityPage(
        identityPayload([row("14", { ASSET: "123" })]),
        ["14", "110"],
        date,
        0,
        2,
      ),
    ).toThrow(/identity|field/i);
  });

  it("detects pagination truncation, repeated pages, and invalid totals", () => {
    expect(() =>
      parseFdicIdentityPage(identityPayload([row("14")]), ["14", "110"], date, 0, 2),
    ).toThrow(/page|count/i);
    expect(() =>
      parseFdicIdentityPage(identityPayload([row("14"), row("14")]), ["14", "110"], date, 0, 2),
    ).toThrow(/duplicate/i);
    expect(() =>
      parseFdicIdentityPage(
        { ...identityPayload(), meta: { total: 3, index: { name: "x" } } },
        ["14", "110"],
        date,
        0,
        2,
      ),
    ).toThrow(/total/i);
    const noIndex = { ...identityPayload(), meta: { total: 2 } };
    expect(() => parseFdicIdentityPage(noIndex, ["14", "110"], date, 0, 2)).toThrow(/index/i);
  });

  it("writes an assembled CSV with exact source text, including embedded newlines", () => {
    const values = [
      ["14", date, "14_20260930", "9007199254740993123.0040", "-0.500", 'Bank "A"\ncontinued'],
    ];
    const csv = writeFdicCsv(columns, values);
    expect(
      parseFdicCsv(
        csv,
        columns.filter((c) => c !== "ID"),
      )[0],
    ).toEqual(row("14", { ASSET: values[0][3], DEP: "-0.500", NAME: values[0][5] }));
  });

  it("accepts only the reviewed fixed June 2026 500-certificate cohort", () => {
    const certs = Array.from({ length: 500 }, (_, i) => i + 1);
    const cohort = {
      report_date: "20260630",
      certs,
      selection: "Reviewed fixed cohort",
      original_sha256: "a".repeat(64),
    };
    expect(validateFdicCohort(cohort).certs).toHaveLength(500);
    expect(() => validateFdicCohort({ ...cohort, report_date: "20260930" })).toThrow(/cohort/i);
    expect(() => validateFdicCohort({ ...cohort, certs: certs.slice(1) })).toThrow(/500/);
    expect(() => validateFdicCohort({ ...cohort, certs: [...certs.slice(1), 500] })).toThrow(
      /duplicate/i,
    );
  });
});
