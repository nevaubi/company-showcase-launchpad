import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERIES_SURE_LIMIT } from "../read-types";
import type { SourceColumn } from "../schema";
import { FRED_REFUSED, FRED_SERIES, fredSeries, heldFor } from "./fred";
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
 * and for each profiled series the snapshot it was proven on and the values check of its last 24 rows. The
 * fred2 check of 26 Nov 2026 adds, for the 23 it profiled, the retrieval time, a check of every stored row
 * (`whole`), for a series over 4,999 rows the last 4,999 (`window`), and for the rebased series FRED's page
 * fetched again (`pageNow`).
 */
type FredPage = { unit: string; adjustment: string; frequency: string; title: string };
type FredDatasetFact = {
  datasetId: string;
  latestSnapshotId: string;
  latestRows: number;
  retrievedAt: string;
  catalogue: { unit: string; frequency: string; adjustment: string };
  page: FredPage;
  pageNow?: FredPage & { updated: string; retrievedAt: string };
  listedAt?: string;
};
type Window = { rows: [number, number]; periods: [string, string]; equal: number; of: number; empty: number; null: number };
type FredCheck = {
  snapshotId: string;
  rows: number;
  retrievedAt?: string;
  values: Window | null;
  whole?: Window & { ordered: boolean };
  window?: Window;
  dates?: { weekday: string; apartDays: number; of: number };
  by: string;
};
const FRED_FACTS = JSON.parse(readFileSync("src/lib/sources/profiles/fred.checks.json", "utf8")) as {
  datasets: Record<string, FredDatasetFact>;
  checks: Record<string, FredCheck>;
};

/** FRED's "Frequency:" as the cadence a profile declares; null for a frequency no FRED profile reads. */
function cadenceOfFrequency(frequency: string): { cadence: Cadence; weekEnding?: string; asOf?: string } | null {
  if (frequency === "Monthly" || frequency === "Monthly, End of Period") return { cadence: "month" };
  if (frequency === "Quarterly") return { cadence: "quarter" };
  if (frequency === "Daily" || frequency === "Daily, 7-Day") return { cadence: "day" };
  const week = /^Weekly, Ending (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.exec(frequency);
  if (week) return { cadence: "week", weekEnding: week[1] };
  // a level as of one weekday is that day's figure, not a week's: it is dated by its own day
  const asOf = /^Weekly, As of (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.exec(frequency);
  return asOf ? { cadence: "day", asOf: asOf[1] } : null;
}

/** A FRED series file's dictionary as production stores it. */
const fredColumns = (code: string): SourceColumn[] => [
  { key: "col0001", label: "observation_date", type: "string" },
  { key: "col0002", label: code, type: "string" },
];

const plusYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

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
    // the unit as FRED's page states it; the page fetched again where FRED changed the unit after the first retrieval
    const page = fact.pageNow ?? fact.page;
    expect(s.unit).toBe(page.unit);
    expect(s.adjustment).toBe(page.adjustment);
    expect(s.title).toBe(page.title);
    expect(fact.catalogue.frequency).toBe(page.frequency);
    if (s.retrievedFrom) {
      // the store's catalogue was retrieved with the earlier snapshot, on the old unit; only the unit differs
      expect(fact.pageNow).toBeDefined();
      expect(fact.catalogue.unit).not.toBe(s.unit);
      expect(fact.catalogue.adjustment).toBe(`${fact.catalogue.unit} , ${s.adjustment}`);
    } else {
      // equal to the store's catalogue row retrieved with the data
      expect(s.unit).toBe(fact.catalogue.unit);
      expect(fact.catalogue.adjustment).toBe(`${s.unit} , ${s.adjustment}`);
    }
    const expected: { cadence: Cadence; weekEnding?: string; asOf?: string } = { cadence: s.cadence };
    if (s.weekEnding) expected.weekEnding = s.weekEnding;
    if (s.asOf) expected.asOf = s.asOf;
    expect(cadenceOfFrequency(page.frequency)).toEqual(expected);
    if (check.values) {
      expect(check.values.of).toBe(24);
      expect(check.values.equal).toBe(check.values.of);
      expect(check.values.rows).toEqual([check.rows - 23, check.rows]);
    }
    if (check.whole) {
      expect(check.whole.rows).toEqual([1, check.rows]);
      expect(check.whole.of).toBe(check.rows);
      expect(check.whole.equal).toBe(check.rows);
      expect(check.whole.ordered).toBe(true);
    }
    const dataset = { id: s.datasetId, source_id: `FRED_${code}`, retrievedAt: check.retrievedAt ?? fact.retrievedAt };
    const status = profileStatus(dataset, fredColumns(code));
    expect(status.state).toBe("on");
    if (status.state !== "on") return;
    expect(status.profile.cadence).toBe(s.cadence);
    expect(status.profile.proof).toMatchObject({ snapshotId: s.snapshotId, datasetId: s.datasetId });
    const measure = measureOf(status.profile, code);
    expect(measure?.label).toBe(s.title);
    expect(measure ? unitOf(measure, fredColumns(code)) : null).toEqual({ ok: true, text: s.unit });
    // a first look reads the whole series, or the latest rows of one that is longer than a read holds
    if (s.rows <= SERIES_SURE_LIMIT) expect(status.profile.addressing).toMatchObject({ scan: "table", rowsScanned: s.rows });
    else expect(status.profile.addressing).toMatchObject({ scan: "latest", rowsScanned: SERIES_SURE_LIMIT });
  });

  it("refuses for a plain reason and gives no profile to every series it lists as refused", () => {
    for (const [code, reason] of Object.entries(FRED_REFUSED)) {
      const fact = FRED_FACTS.datasets[code];
      expect(fact).toBeDefined();
      expect(reason.length).toBeGreaterThan(40);
      expect(reason).not.toMatch(/\u2014/);
      const dataset = { id: fact.datasetId, source_id: `FRED_${code}` };
      expect(fredSeries(dataset)).toBeNull();
      expect(profileStatus(dataset, fredColumns(code))).toEqual({ state: "none" });
    }
  });

  it("decides every FRED series file of the store: profiled or refused, never both", () => {
    const profiled = new Set(FRED_SERIES.map((s) => s.code));
    const codes = Object.keys(FRED_FACTS.datasets);
    expect(codes).toHaveLength(119);
    for (const code of codes) expect(Number(profiled.has(code)) + Number(code in FRED_REFUSED)).toBe(1);
    for (const code of [...profiled, ...Object.keys(FRED_REFUSED)]) expect(codes).toContain(code);
    expect(Object.keys(FRED_REFUSED)).toEqual([]);
  });

  it("reads a daily series longer than a first look holds from its end, and its latest 4,999 rows cover ten years", () => {
    const long = FRED_SERIES.filter((s) => s.rows > SERIES_SURE_LIMIT);
    expect(long.map((s) => s.code).sort()).toEqual(["DEXCHUS", "DEXJPUS", "DEXUSEU", "DFF", "DTWEXBGS"]);
    expect(SERIES_SURE_LIMIT).toBe(4999);
    for (const s of long) {
      const check = FRED_FACTS.checks[s.code];
      expect(s.cadence).toBe("day");
      // every row in date order: the last rows of the file are its latest observations
      expect(check.whole?.ordered).toBe(true);
      expect(check.window).toBeDefined();
      if (!check.window) continue;
      expect(check.window.rows).toEqual([s.rows - SERIES_SURE_LIMIT + 1, s.rows]);
      expect(check.window.equal).toBe(SERIES_SURE_LIMIT);
      expect(check.window.of).toBe(SERIES_SURE_LIMIT);
      expect(plusYears(check.window.periods[0], 10) <= check.window.periods[1]).toBe(true);
    }
  });

  it("dates WALCL by its own day, the level as of each Wednesday, never as a week ending", () => {
    const walcl = FRED_SERIES.find((s) => s.code === "WALCL");
    expect(walcl).toMatchObject({ cadence: "day", asOf: "Wednesday" });
    expect(walcl?.weekEnding).toBeUndefined();
    expect(FRED_FACTS.datasets.WALCL.page.frequency).toBe("Weekly, As of Wednesday");
    expect(FRED_FACTS.checks.WALCL.dates).toEqual({ weekday: "Wednesday", apartDays: 7, of: FRED_FACTS.checks.WALCL.rows });
    const status = profileStatus({ id: FRED_FACTS.datasets.WALCL.datasetId, source_id: "FRED_WALCL" }, fredColumns("WALCL"));
    expect(status.state === "on" && status.profile.cadence).toBe("day");
  });

  it("draws a rebased index only from snapshots retrieved on its new base", () => {
    const rebased = FRED_SERIES.filter((s) => s.retrievedFrom);
    expect(rebased.map((s) => s.code).sort()).toEqual(
      ["INDPRO", "IPG311A2S", "IPG322S", "IPG325S", "IPG332S", "IPG333S", "IPG3361T3S", "IPG3364S", "IPMAN"],
    );
    for (const s of rebased) {
      const fact = FRED_FACTS.datasets[s.code];
      const check = FRED_FACTS.checks[s.code];
      expect(s.unit).toBe("Index 2022=100");
      expect(fact.catalogue.unit).toBe("Index 2017=100");
      expect(fact.pageNow?.unit).toBe("Index 2022=100");
      // FRED's update (CST) came after the store's first retrieval and before the checked one
      expect(fact.pageNow?.updated).toMatch(/^Nov 24, 2026 11:0[5-8] AM CST$/);
      expect(s.retrievedFrom).toBe(check.retrievedAt);
      expect(Date.parse(s.retrievedFrom ?? "")).toBeGreaterThan(Date.parse("2026-11-24T17:08:00Z"));
      expect(check.whole?.equal).toBe(check.rows);
      const columns = fredColumns(s.code);
      const at = (retrievedAt: string | null | undefined) => profileStatus({ id: s.datasetId, source_id: `FRED_${s.code}`, retrievedAt }, columns).state;
      expect(at(s.retrievedFrom)).toBe("on");
      expect(at("2026-11-27T06:00:00.123456+00:00")).toBe("on");
      // the first retrieval, on the 2017 base, and a snapshot whose retrieval is not known get no chart
      expect(at("2026-11-24T09:58:23Z")).toBe("none");
      expect(at(new Date(Date.parse(s.retrievedFrom ?? "") - 1000).toISOString())).toBe("none");
      expect(at(null)).toBe("none");
      expect(at(undefined)).toBe("none");
      expect(at("not a time")).toBe("none");
    }
    expect(heldFor({}, null)).toBe(true);
  });

  it("profiles the series FRED revised after the first retrieval on the snapshots retrieved after the revision", () => {
    for (const code of ["ALTSALES", "AMDMTI", "AMDMVS", "CCSA", "HTRUCKSSAAR", "NEWORDER", "PCEDG", "PCES"]) {
      const s = FRED_SERIES.find((x) => x.code === code);
      const check = FRED_FACTS.checks[code];
      expect(s?.snapshotId).toBe(check.snapshotId);
      expect(check.retrievedAt?.startsWith("2026-11-26")).toBe(true);
      expect(check.whole?.equal).toBe(check.rows);
      expect(s?.retrievedFrom).toBeUndefined();
    }
  });
});
