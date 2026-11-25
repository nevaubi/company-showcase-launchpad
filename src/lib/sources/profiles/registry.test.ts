import { describe, expect, it } from "vitest";
import type { SourceColumn } from "../schema";
import {
  PROFILE_ENTRIES,
  defineProfile,
  locateField,
  measureOf,
  profileFor,
  profileStatus,
  requiredFields,
  sameAddress,
  unitOf,
  unmatchedFields,
} from "./index";
import type { ProfileDataset, ProfileEntry } from "./types";

/** A long table's dictionary in the form production stores every dictionary: positional keys, the headers as labels. */
const MER_FIELDS: SourceColumn[] = [
  { key: "col0001", label: "MSN", type: "string" },
  { key: "col0002", label: "YYYYMM", type: "string" },
  { key: "col0003", label: "Value", type: "string" },
  { key: "col0004", label: "Column_Order", type: "string" },
  { key: "col0005", label: "Description", type: "string" },
  { key: "col0006", label: "Unit", type: "string" },
];

const claims = (d: ProfileDataset) => d.source_id === "TEST_LONG";
const longEntry: ProfileEntry = {
  family: "test-long",
  claims,
  profile: () =>
    defineProfile(claims, {
      family: "test-long",
      period: { from: "dimension", format: "yyyymm" },
      measures: [{ field: "Value", label: "Value", unit: { from: "column", column: "Unit" }, markers: ["Not Available"] }],
      addressing: { by: "entity_id", where: [], scan: "key", rowsScanned: 700, note: "One key per series." },
      firstLook: "series",
      extraFields: ["Description"],
      proof: { snapshotId: "0".repeat(64), datasetId: "test", checked: "2026-11-25", documentation: [] },
    }),
};

describe("field lookup by label", () => {
  it("returns the position of the cell and the positional key", () => {
    expect(locateField(MER_FIELDS, "Value")).toEqual({ ok: true, index: 2, key: "col0003" });
  });
  it("refuses a label that is absent or carried twice", () => {
    expect(locateField(MER_FIELDS, "value")).toEqual({ ok: false, reason: "missing" });
    expect(locateField([...MER_FIELDS, { key: "col0007", label: "Unit" }], "Unit")).toEqual({ ok: false, reason: "repeated" });
  });
  it("never matches on the positional key", () => {
    expect(locateField(MER_FIELDS, "col0003")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("profile registry", () => {
  it("lists each family once", () => {
    const families = PROFILE_ENTRIES.map((e) => e.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it("derives every label a profile reads, so none goes unchecked", () => {
    const profile = longEntry.profile({ id: "x", source_id: "TEST_LONG" });
    expect(profile.requires).toEqual(["Value", "Unit", "Description"]);
    expect(
      requiredFields({
        period: { from: "fields", fields: ["yr", "period"], format: "yyyy-mm", compose: () => null },
        measures: [{ field: "index_sa", label: "Index", unit: { from: "constant", text: "Index", evidence: "https://example.gov" } }],
        where: ["frequency"],
      }),
    ).toEqual(["yr", "period", "index_sa", "frequency"]);
  });

  it("turns a profile on only for its family and only when every label is there once", () => {
    const dataset = { id: "x", source_id: "TEST_LONG" };
    expect(profileFor(dataset, MER_FIELDS, [longEntry])?.family).toBe("test-long");
    expect(profileFor({ id: "x", source_id: "OTHER" }, MER_FIELDS, [longEntry])).toBeNull();
    expect(profileStatus({ id: "x", source_id: null }, MER_FIELDS, [longEntry])).toEqual({ state: "none" });
  });

  it("turns itself off and says why when the publisher changes a header", () => {
    const renamed = MER_FIELDS.map((f) => (f.label === "Unit" ? { ...f, label: "Units" } : f));
    const status = profileStatus({ id: "x", source_id: "TEST_LONG" }, renamed, [longEntry]);
    expect(status.state).toBe("off");
    if (status.state !== "off") return;
    expect(status.family).toBe("test-long");
    expect(status.reason).toBe(
      "Charts are off for this version: the test-long profile reads fields this version does not carry as expected (field Unit not found).",
    );
    expect(unmatchedFields(["Value", "Unit"], renamed)).toEqual([{ field: "Unit", reason: "missing" }]);
    expect(profileFor({ id: "x", source_id: "TEST_LONG" }, renamed, [longEntry])).toBeNull();
  });

  it("refuses a profile without a measure", () => {
    expect(() =>
      defineProfile(claims, {
        family: "empty",
        period: { from: "dimension", format: "year" },
        measures: [],
        addressing: { by: null, where: [], scan: "table", rowsScanned: 1, note: "" },
        firstLook: "none",
        proof: { snapshotId: "", datasetId: "", checked: "", documentation: [] },
      }),
    ).toThrow("profile empty has no measure");
  });
});

describe("unit of a measure", () => {
  const profile = longEntry.profile({ id: "x", source_id: "TEST_LONG" });
  const value = measureOf(profile, "Value");

  it("finds a measure by its field label", () => {
    expect(value?.label).toBe("Value");
    expect(measureOf(profile, "Unit")).toBeNull();
  });

  it("reads a unit from the unit field of the same record, as written", () => {
    if (!value) throw new Error("no measure");
    expect(unitOf(value, MER_FIELDS, (label) => (label === "Unit" ? "Quadrillion Btu" : null))).toEqual({ ok: true, text: "Quadrillion Btu" });
    expect(unitOf(value, MER_FIELDS, () => "")).toEqual({ ok: false, reason: "the unit field Unit is empty in this record" });
    expect(unitOf(value, MER_FIELDS)).toEqual({ ok: false, reason: "the unit field Unit was not read" });
  });

  it("accepts a dictionary unit only when the dictionary states exactly the expected text", () => {
    const columns: SourceColumn[] = [
      { key: "col0001", label: "ASSET", type: "string", native_type: "number", unit: "USD thousands (monetary measures)" },
      { key: "col0002", label: "ROA", type: "string", native_type: "number" },
    ];
    expect(
      unitOf({ field: "ASSET", label: "Total assets", unit: { from: "dictionary", text: "USD thousands (monetary measures)" } }, columns),
    ).toEqual({ ok: true, text: "USD thousands (monetary measures)" });
    expect(unitOf({ field: "ASSET", label: "Total assets", unit: { from: "dictionary", text: "USD" } }, columns)).toEqual({
      ok: false,
      reason: 'the dictionary states "USD thousands (monetary measures)" for ASSET, not "USD"',
    });
    expect(unitOf({ field: "ROA", label: "Return on assets", unit: { from: "dictionary", text: "Percent" } }, columns)).toEqual({
      ok: false,
      reason: 'the dictionary states no unit for ROA, not "Percent"',
    });
  });

  it("carries a constant unit with its evidence", () => {
    expect(
      unitOf({ field: "x", label: "x", unit: { from: "constant", text: "Percent", evidence: "https://fred.stlouisfed.org/series/UNRATE" } }, []),
    ).toEqual({ ok: true, text: "Percent" });
  });
});

describe("series addresses", () => {
  it("compares addresses by what they select, not by how they are written", () => {
    expect(
      sameAddress(
        { by: "entity_id", key: "628", where: [{ field: "a", value: "1" }, { field: "b", value: "2" }] },
        { by: "entity_id", key: "628", where: [{ field: "b", value: "2" }, { field: "a", value: "1" }] },
      ),
    ).toBe(true);
    expect(sameAddress({ by: "entity_id", key: "628" }, { by: "entity_name", key: "628" })).toBe(false);
    expect(sameAddress({ where: [{ field: "MSN", value: "TETCBUS" }] }, { where: [{ field: "MSN", value: "TERCBUS" }] })).toBe(false);
  });
});
