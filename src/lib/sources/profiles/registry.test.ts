import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERIES_SURE_LIMIT } from "../read-types";
import type { SourceColumn } from "../schema";
import { FRED_REFUSED, FRED_SERIES, fredSeries } from "./fred";
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
import type { Cadence, ProfileDataset, ProfileEntry } from "./types";

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
    expect(sameAddress({ whole: true }, { whole: true })).toBe(true);
    expect(sameAddress({ whole: true }, { where: [] })).toBe(false);
  });
});

/**
 * What production and FRED said when each FRED profile was checked (fred.checks.json): every FRED series
 * file of the store with its latest snapshot and its row in the store's series catalogue, FRED's series page,
 * and for each profiled series the snapshot it was proven on and the values check of its last 24 rows.
 */
type FredDatasetFact = {
  datasetId: string;
  latestSnapshotId: string;
  latestRows: number;
  retrievedAt: string;
  catalogue: { unit: string; frequency: string; adjustment: string };
  page: { unit: string; adjustment: string; frequency: string; title: string };
};
type FredCheck = {
  snapshotId: string;
  rows: number;
  values: { rows: [number, number]; periods: [string, string]; equal: number; of: number; empty: number; null: number } | null;
  by: string;
};
const FRED_FACTS = JSON.parse(readFileSync("src/lib/sources/profiles/fred.checks.json", "utf8")) as {
  datasets: Record<string, FredDatasetFact>;
  checks: Record<string, FredCheck>;
};

/** FRED's "Frequency:" as the cadence a profile declares; null for a frequency no FRED profile reads. */
function cadenceOfFrequency(frequency: string): { cadence: Cadence; weekEnding?: string } | null {
  if (frequency === "Monthly" || frequency === "Monthly, End of Period") return { cadence: "month" };
  if (frequency === "Quarterly") return { cadence: "quarter" };
  const week = /^Weekly, Ending (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.exec(frequency);
  return week ? { cadence: "week", weekEnding: week[1] } : null;
}

/** A FRED series file's dictionary as production stores it. */
const fredColumns = (code: string): SourceColumn[] => [
  { key: "col0001", label: "observation_date", type: "string" },
  { key: "col0002", label: code, type: "string" },
];

describe("FRED series profiles", () => {
  it("lists each series once and none that was refused", () => {
    const codes = FRED_SERIES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of Object.keys(FRED_REFUSED)) expect(codes).not.toContain(code);
  });

  it.each(FRED_SERIES.map((s) => [s.code, s] as const))("%s: unit, cadence and ids as production and FRED state them", (code, s) => {
    const fact = FRED_FACTS.datasets[code];
    const check = FRED_FACTS.checks[code];
    expect(fact).toBeDefined();
    expect(check).toBeDefined();
    expect(s.datasetId).toBe(fact.datasetId);
    expect(s.snapshotId).toBe(check.snapshotId);
    expect(s.rows).toBe(check.rows);
    // the unit as FRED's page states it, equal to the store's catalogue row retrieved with the data
    expect(s.unit).toBe(fact.page.unit);
    expect(s.unit).toBe(fact.catalogue.unit);
    expect(s.adjustment).toBe(fact.page.adjustment);
    expect(fact.catalogue.adjustment).toBe(`${s.unit} , ${s.adjustment}`);
    expect(fact.catalogue.frequency).toBe(fact.page.frequency);
    expect(cadenceOfFrequency(fact.page.frequency)).toEqual(s.weekEnding ? { cadence: s.cadence, weekEnding: s.weekEnding } : { cadence: s.cadence });
    // a first look reads the whole series
    expect(s.rows).toBeLessThanOrEqual(SERIES_SURE_LIMIT);
    if (check.values) {
      expect(check.values.of).toBe(24);
      expect(check.values.equal).toBe(check.values.of);
      expect(check.values.rows).toEqual([check.rows - 23, check.rows]);
    }
    const status = profileStatus({ id: s.datasetId, source_id: `FRED_${code}` }, fredColumns(code));
    expect(status.state).toBe("on");
    if (status.state !== "on") return;
    expect(status.profile.cadence).toBe(s.cadence);
    expect(status.profile.proof).toMatchObject({ snapshotId: s.snapshotId, datasetId: s.datasetId });
    const measure = measureOf(status.profile, code);
    expect(measure?.label).toBe(s.title);
    expect(measure ? unitOf(measure, fredColumns(code)) : null).toEqual({ ok: true, text: s.unit });
  });

  it.each(Object.entries(FRED_REFUSED))("%s is refused for a plain reason and gets no profile", (code, reason) => {
    const fact = FRED_FACTS.datasets[code];
    expect(fact).toBeDefined();
    expect(reason.length).toBeGreaterThan(40);
    expect(reason).not.toMatch(/\u2014/);
    const dataset = { id: fact.datasetId, source_id: `FRED_${code}` };
    expect(fredSeries(dataset)).toBeNull();
    expect(profileStatus(dataset, fredColumns(code))).toEqual({ state: "none" });
  });

  it("refuses a rebased index only where the catalogue and FRED's page disagree on the base", () => {
    const rebased = Object.entries(FRED_REFUSED).filter(([, reason]) => /Index 2022=100/.test(reason));
    expect(rebased.map(([code]) => code).sort()).toEqual(
      ["INDPRO", "IPG311A2S", "IPG322S", "IPG325S", "IPG332S", "IPG333S", "IPG3361T3S", "IPG3364S", "IPMAN"],
    );
    for (const [code] of rebased) {
      expect(FRED_FACTS.datasets[code].catalogue.unit).toBe("Index 2017=100");
      expect(FRED_FACTS.datasets[code].page.unit).toBe("Index 2022=100");
    }
  });

  it("refuses a series longer than a first look reads, with its row count", () => {
    const long = Object.entries(FRED_REFUSED).filter(([, reason]) => /a first look reads at most 4,999 records/.test(reason));
    expect(long.map(([code]) => code).sort()).toEqual(["DEXCHUS", "DEXJPUS", "DEXUSEU", "DFF", "DTWEXBGS"]);
    expect(SERIES_SURE_LIMIT).toBe(4999);
    for (const [code, reason] of long) {
      const fact = FRED_FACTS.datasets[code];
      expect(fact.latestRows).toBeGreaterThan(SERIES_SURE_LIMIT);
      expect(reason).toContain(`${fact.page.frequency} series of ${fact.latestRows.toLocaleString("en-US")} rows`);
    }
  });

  it("decides every FRED series file of the store: profiled or refused, never both", () => {
    const profiled = new Set(FRED_SERIES.map((s) => s.code));
    const codes = Object.keys(FRED_FACTS.datasets);
    expect(codes).toHaveLength(119);
    for (const code of codes) expect(Number(profiled.has(code)) + Number(code in FRED_REFUSED)).toBe(1);
    for (const code of [...profiled, ...Object.keys(FRED_REFUSED)]) expect(codes).toContain(code);
  });

  it("refuses a series FRED revised after the retrieval until a refreshed snapshot is checked", () => {
    const revised = Object.entries(FRED_REFUSED).filter(([, reason]) => /FRED updated the series on 25 Nov 2026/.test(reason));
    expect(revised.map(([code]) => code).sort()).toEqual(["ALTSALES", "AMDMTI", "AMDMVS", "CCSA", "HTRUCKSSAAR", "NEWORDER", "PCEDG", "PCES"]);
    for (const [code] of revised) {
      const fact = FRED_FACTS.datasets[code];
      expect(fact.retrievedAt.startsWith("2026-11-24")).toBe(true);
      // the unit is not the reason: catalogue and page agree
      expect(fact.catalogue.unit).toBe(fact.page.unit);
    }
  });

  it("refuses WALCL because FRED dates it as a Wednesday level, not a week ending", () => {
    expect(FRED_FACTS.datasets.WALCL.page.frequency).toBe("Weekly, As of Wednesday");
    expect(cadenceOfFrequency(FRED_FACTS.datasets.WALCL.page.frequency)).toBeNull();
    expect(FRED_REFUSED.WALCL).toContain("As of Wednesday");
  });
});
