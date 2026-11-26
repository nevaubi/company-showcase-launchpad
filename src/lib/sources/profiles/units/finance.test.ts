import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SourceColumn } from "../../schema";
import { addressRefusal, profileFor, profileStatus, unitOf } from "../index";
import type { ProfileDataset } from "../types";
import {
  ENTRIES,
  FED_H8_ENTRY,
  FED_Z1_SECTORS_ENTRY,
  FED_Z1_TABLE_ENTRY,
  H8_FIXED,
  H8_MONTHLY_DATASET,
  H8_MONTHLY_SERIES,
  H8_MONTHLY_SNAPSHOT,
  H8_UNIT,
  OFR_MMF_DATASET,
  OFR_MMF_ENTRY,
  OFR_MMF_SNAPSHOT,
  Z1_OUTSTANDING_NSA,
  Z1_SECTORS_DATASET,
  Z1_SECTORS_SNAPSHOT,
  Z1_TABLES,
  Z1_UNIT,
  h8Series,
  ofrSeries,
  z1Sector,
} from "./finance";

type Check = { storedMd5: string; publisherMd5: string; equal: boolean; compared: number };
const FACTS = JSON.parse(readFileSync("src/lib/sources/profiles/units/finance.checks.json", "utf8")) as {
  checked: string;
  h8: { datasetId: string; snapshotId: string; rows: number; storedUnit: string; storedMultiplier: string; series: Record<string, Check & { description: string; UNIT: string; UNIT_MULT: string; CURRENCY: string; SA: string }> };
  z1Sectors: { datasetId: string; snapshotId: string; rows: number; series: Record<string, Check & { description: string; unitAndBasis: string }> };
  z1Tables: Record<string, { records: number; storedMd5: string; publisherMd5: string; equal: boolean; series: Record<string, { description: string; unitAndBasis: string }> }>;
  ofr: { datasetId: string; snapshotId: string; rows: number; totalChildren: string[]; monthsPartsEqualTotal: number; months: number; series: Record<string, Check & { unit: { name: string; magnitude: number } }> };
};

/** A dictionary as production stores it: positional keys, the publisher's headers as labels, every type "string". */
const columns = (...labels: string[]): SourceColumn[] => labels.map((label, i) => ({ key: `col${String(i + 1).padStart(4, "0")}`, label, type: "string" }));

const H8_COLUMNS = columns("series", "description", "date", "value_native", "status", "unit", "unit_multiplier");
const Z1_SECTOR_COLUMNS = columns("table", "series_id", "description", "period", "value_native", "source_value_or_flag", "unit_and_basis");
const OFR_COLUMNS = columns("mnemonic", "date", "value_native", "unit");

const h8: ProfileDataset = { id: H8_MONTHLY_DATASET, source_id: "FED_H8" };
const z1s: ProfileDataset = { id: Z1_SECTORS_DATASET, source_id: "FED_Z1" };
const ofr: ProfileDataset = { id: OFR_MMF_DATASET, source_id: "OFR_STFM" };

describe("finance profile families", () => {
  it("lists each family once and claims only the tables that were checked", () => {
    const families = ENTRIES.map((e) => e.family);
    expect(new Set(families).size).toBe(families.length);
    expect(FED_H8_ENTRY.claims(h8)).toBe(true);
    // the other H.8 tables (the 983,033-record observations file has no indexed series key) are not claimed
    expect(FED_H8_ENTRY.claims({ id: "official_01_financials_data_fed_h8_complete_native_observations_76de662a76", source_id: "FED_H8" })).toBe(false);
    expect(FED_H8_ENTRY.claims({ id: H8_MONTHLY_DATASET, source_id: "FRED_H8" })).toBe(false);
    expect(FED_Z1_SECTORS_ENTRY.claims(z1s)).toBe(true);
    expect(FED_Z1_TABLE_ENTRY.claims(z1s)).toBe(false);
    expect(FED_Z1_TABLE_ENTRY.claims({ id: "official_01_financials_data_fed_z1_native_tables_csv_f1_t_d9f851f9ee", source_id: "FED_Z1" })).toBe(false);
    for (const t of Z1_TABLES) expect(FED_Z1_TABLE_ENTRY.claims({ id: t.datasetId, source_id: "FED_Z1" })).toBe(true);
    expect(OFR_MMF_ENTRY.claims(ofr)).toBe(true);
    expect(OFR_MMF_ENTRY.claims({ id: "official_01_financials_data_ofr_all_five_datasets_complete_timeseries_a2c31c8c80", source_id: "OFR_STFM" })).toBe(false);
  });

  it("turns on for the production dictionaries through the registry, and off when a header changes", () => {
    expect(profileFor(h8, H8_COLUMNS)?.family).toBe("fed-h8");
    expect(profileFor(z1s, Z1_SECTOR_COLUMNS)?.family).toBe("fed-z1-sectors");
    expect(profileFor(ofr, OFR_COLUMNS)?.family).toBe("ofr-mmf");
    const renamed = columns("series", "description", "date", "value", "status", "unit", "unit_multiplier");
    const off = profileStatus(h8, renamed);
    expect(off.state).toBe("off");
    if (off.state === "off") expect(off.reason).toContain("value_native");
    // a table the store lists twice under one label is not read
    expect(profileStatus(ofr, columns("mnemonic", "date", "value_native", "unit", "unit")).state).toBe("off");
  });

  it("reads every label it depends on, the unit fields included", () => {
    expect([...FED_H8_ENTRY.profile(h8).requires].sort()).toEqual(["date", "description", "series", "unit", "unit_multiplier", "value_native"]);
    expect([...FED_Z1_SECTORS_ENTRY.profile(z1s).requires].sort()).toEqual(["description", "period", "series_id", "unit_and_basis", "value_native"]);
    expect([...OFR_MMF_ENTRY.profile(ofr).requires].sort()).toEqual(["date", "mnemonic", "unit", "value_native"]);
  });
});

describe("H.8 monthly headline balances", () => {
  const profile = FED_H8_ENTRY.profile(h8);

  it("is the snapshot that was checked, every record equal to the Board's package", () => {
    expect(profile.proof).toMatchObject({ datasetId: FACTS.h8.datasetId, snapshotId: FACTS.h8.snapshotId, checked: FACTS.checked });
    expect(H8_MONTHLY_SNAPSHOT).toBe(FACTS.h8.snapshotId);
    expect(profile.addressing.rowsScanned).toBe(FACTS.h8.rows);
    const compared = Object.values(FACTS.h8.series).reduce((n, s) => n + s.compared, 0);
    expect(compared).toBe(FACTS.h8.rows);
    for (const s of Object.values(FACTS.h8.series)) expect(s.storedMd5).toBe(s.publisherMd5);
  });

  it("states millions of dollars because the Board states currency USD with multiplier 1,000,000 for every series", () => {
    expect(Object.keys(FACTS.h8.series).sort()).toEqual(H8_MONTHLY_SERIES.map((s) => s.code).sort());
    for (const s of H8_MONTHLY_SERIES) {
      const fact = FACTS.h8.series[s.code];
      expect([fact.UNIT, fact.UNIT_MULT, fact.CURRENCY, fact.SA]).toEqual(["Currency", "1000000", "USD", "NSA"]);
      expect(s.description).toBe(fact.description);
    }
    expect(unitOf(profile.measures[0], H8_COLUMNS)).toEqual({ ok: true, text: H8_UNIT });
    // the record's own fields must say the same, or the record is not drawn
    expect(H8_FIXED).toEqual([
      { field: "unit", value: FACTS.h8.storedUnit },
      { field: "unit_multiplier", value: FACTS.h8.storedMultiplier },
    ]);
  });

  it("refuses a series address that does not fix the currency and multiplier", () => {
    expect(addressRefusal(profile, h8Series("B1151NCBDM"))).toBeNull();
    expect(addressRefusal(profile, { where: [{ field: "series", value: "B1151NCBDM" }] })).toContain("unit");
    expect(profile.defaultSeries?.(h8)).toEqual(h8Series("B1151NCBDM"));
  });
});

describe("Z.1 financial-sector balance histories", () => {
  const profile = FED_Z1_SECTORS_ENTRY.profile(z1s);

  it("is the snapshot that was checked, all 39 series equal to the Board's csv files", () => {
    expect(profile.proof).toMatchObject({ datasetId: FACTS.z1Sectors.datasetId, snapshotId: Z1_SECTORS_SNAPSHOT });
    expect(Z1_SECTORS_SNAPSHOT).toBe(FACTS.z1Sectors.snapshotId);
    const series = Object.values(FACTS.z1Sectors.series);
    expect(series).toHaveLength(39);
    expect(series.reduce((n, s) => n + s.compared, 0)).toBe(FACTS.z1Sectors.rows);
    for (const s of series) expect(s.storedMd5).toBe(s.publisherMd5);
  });

  it("draws only the series whose dictionary entry is the unit and basis it states", () => {
    const drawn = Object.entries(FACTS.z1Sectors.series).filter(([, s]) => s.unitAndBasis === Z1_OUTSTANDING_NSA);
    const left = Object.entries(FACTS.z1Sectors.series).filter(([, s]) => s.unitAndBasis !== Z1_OUTSTANDING_NSA);
    expect(drawn).toHaveLength(36);
    expect(left.map(([k]) => k).sort()).toEqual(["LM554090005.Q", "LM564090005.Q", "LM654090000.Q"]);
    expect(Z1_OUTSTANDING_NSA.startsWith(`${Z1_UNIT};`)).toBe(true);
    expect(addressRefusal(profile, z1Sector("FL634090005.Q"))).toBeNull();
    expect(addressRefusal(profile, { by: "entity_id", key: "FL634090005.Q" })).toContain("unit_and_basis");
  });
});

describe("Z.1 release tables", () => {
  it.each(Z1_TABLES.map((t) => [t.table, t] as const))("%s: every cell equal to the Board's file, each series as its dictionary states it", (_, table) => {
    const code = table.table.split(" ")[0].replace(/\./g, "_");
    const fact = FACTS.z1Tables[code];
    expect(fact).toBeDefined();
    expect(fact.storedMd5).toBe(fact.publisherMd5);
    expect(fact.records).toBe(305);
    const dataset = { id: table.datasetId, source_id: "FED_Z1" };
    const profile = FED_Z1_TABLE_ENTRY.profile(dataset);
    expect(profile.proof.snapshotId).toBe(table.snapshotId);
    expect(profile.measures[0].field).toBe(table.first);
    for (const s of table.series) {
      const entry = fact.series[s.code];
      expect(entry, s.code).toBeDefined();
      expect(entry.description).toBe(s.description);
      expect(entry.unitAndBasis).toBe(table.basis);
      // the unit is the dictionary's own first words: "Millions of dollars; ..." or "Percent growth rate, ..."
      expect(entry.unitAndBasis.startsWith(s.unit)).toBe(true);
    }
    const dictionary = columns("date", ...table.series.map((s) => s.code));
    expect(profileFor(dataset, dictionary)?.family).toBe("fed-z1-table");
    expect(profileFor(dataset, columns("date", ...table.series.slice(1).map((s) => s.code)))).toBeNull();
  });
});

describe("OFR money market fund monthly data", () => {
  const profile = OFR_MMF_ENTRY.profile(ofr);

  it("is the snapshot that was checked, every compared series equal to OFR's API", () => {
    expect(profile.proof).toMatchObject({ datasetId: FACTS.ofr.datasetId, snapshotId: OFR_MMF_SNAPSHOT });
    expect(OFR_MMF_SNAPSHOT).toBe(FACTS.ofr.snapshotId);
    for (const s of Object.values(FACTS.ofr.series)) expect(s.storedMd5).toBe(s.publisherMd5);
  });

  it("reads the unit from each record, as OFR names it, in dollars", () => {
    expect(profile.measures[0].unit).toEqual({ from: "column", column: "unit" });
    for (const s of Object.values(FACTS.ofr.series)) {
      expect(s.unit.magnitude).toBe(0);
      expect(["USD", "Percent"]).toContain(s.unit.name);
    }
    expect(unitOf(profile.measures[0], OFR_COLUMNS, (label) => (label === "unit" ? "USD" : null))).toEqual({ ok: true, text: "USD" });
  });

  it("knows the five parts OFR lists for the total, and they add up to it in every month", () => {
    expect(FACTS.ofr.totalChildren).toEqual(["MMF-MMF_T_TOT-M", "MMF-MMF_AG_TOT-M", "MMF-MMF_BRA_TOT-M", "MMF-MMF_RP_TOT-M", "MMF-MMF_OA_TOT-M"]);
    expect(FACTS.ofr.monthsPartsEqualTotal).toBe(FACTS.ofr.months);
    expect(profile.defaultSeries?.(ofr)).toEqual(ofrSeries("MMF-MMF_TOT-M"));
  });
});
