import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSeriesTile, type CellInput, type TileContext } from "../../boards/compute";
import type { SeriesTileSpec } from "../../boards/types";
import type { SourceColumn } from "../../schema";
import { PROFILE_ENTRIES, profileFor, profileStatus, unitOf } from "../index";
import type { ProfileDataset } from "../types";
import {
  DS140_ENTRY,
  ERS_ANNUAL_ENTRY,
  ERS_FORECAST_ENTRY,
  MSHA_COUNT_ENTRY,
  MSHA_STATE_ENTRY,
  NHTSA_MAKER_ENTRY,
  NHTSA_YEAR_ENTRY,
  ds140Unit,
  ds140Workbook,
  forecastMonth,
} from "./industry";
import { DS140_TABLES } from "./industry-ds140";

/** Positional keys and the publisher's headers as labels, as production stores every dictionary. */
const fields = (labels: readonly string[], units: Record<string, string> = {}): SourceColumn[] =>
  labels.map((label, i) => ({ key: `col${String(i + 1).padStart(4, "0")}`, label, type: "string", ...(units[label] ? { unit: units[label] } : {}) }));

const CHECKS = JSON.parse(readFileSync("src/lib/sources/profiles/units/industry.checks.json", "utf8")) as {
  ds140: { listed: number; refused: Record<string, string>; compared: Record<string, { snapshotId: string; rows: number; md5: string }> };
  ers: { tables: Record<string, { rows: number; md5: string }> };
  msha: { snapshotId: string; rows: number; years: Record<string, { records: number; md5: string }>; mineCounts: { snapshotId: string; rows: number } };
  nhtsa: { byYear: { snapshotId: string; rows: number; equal: number; differ: Record<string, unknown> }; byMaker: { snapshotId: string } };
};

const ds140 = (id: string): ProfileDataset => ({ id: `official_07_materials_csv_${id}`, source_id: "USGS_DS140" });
const table = (fragment: string) => {
  const found = DS140_TABLES.filter((t) => t.id.includes(fragment));
  if (found.length !== 1) throw new Error(`${found.length} DS140 tables match ${fragment}`);
  return found[0];
};
const labelsOf = (t: (typeof DS140_TABLES)[number], extra: readonly string[] = []) => ["Year", ...t.measures.map((m) => m[0]), ...extra];

describe("USGS DS140 profile", () => {
  it("lists 121 tables, each once, with its checked snapshot", () => {
    expect(DS140_TABLES).toHaveLength(121);
    expect(CHECKS.ds140.listed).toBe(121);
    expect(new Set(DS140_TABLES.map((t) => t.id)).size).toBe(121);
    for (const t of DS140_TABLES) {
      expect(t.snapshotId).toMatch(/^[0-9a-f]{64}$/);
      expect(t.rows).toBeGreaterThan(0);
      expect(t.rows).toBeLessThanOrEqual(123);
      expect(t.measures.length).toBeGreaterThan(0);
      expect(ds140Workbook(t)).toMatch(/^https:\/\/d9-wret\.s3\.us-west-2\.amazonaws\.com\/assets\/palladium\/production\/.+\.xlsx$/);
      expect(t.statement).toContain(t.unit);
    }
  });

  it("names every table compared cell for cell with the snapshot the list holds", () => {
    const compared = Object.entries(CHECKS.ds140.compared);
    expect(compared.length).toBeGreaterThanOrEqual(30);
    for (const [id, check] of compared) {
      const t = DS140_TABLES.find((x) => x.id === id);
      expect(t, id).toBeDefined();
      expect(t!.snapshotId).toBe(check.snapshotId);
      expect(t!.rows).toBe(check.rows);
    }
    for (const id of Object.keys(CHECKS.ds140.refused)) expect(DS140_TABLES.some((t) => t.id === id)).toBe(false);
  });

  it("claims a listed table and applies only when the snapshot carries every label once", () => {
    const t = table("bismuth_2022");
    const d = ds140(t.id);
    expect(DS140_ENTRY.claims(d)).toBe(true);
    expect(DS140_ENTRY.claims({ ...d, source_id: "USGS_OTHER" })).toBe(false);
    expect(DS140_ENTRY.claims(ds140("ds140_titanium_minerals_2020_ilmenite_and_slag_607e18a81f"))).toBe(false);
    const profile = DS140_ENTRY.profile(d);
    expect(profile.applies(d, fields(labelsOf(t)))).toBe(true);
    expect(profile.applies(d, fields(labelsOf(t).filter((l) => l !== "Imports")))).toBe(false);
    expect(profile.applies(d, fields([...labelsOf(t), "Imports"]))).toBe(false);
    const status = profileStatus(d, fields(labelsOf(t).filter((l) => l !== "Imports")));
    expect(status.state).toBe("off");
  });

  it("reads each unit from the sheet: the statement, a unit in the header, or a basis in brackets", () => {
    const bismuth = DS140_ENTRY.profile(ds140(table("bismuth_2022").id));
    const unit = (field: string) => bismuth.measures.find((m) => m.field === field)?.unit;
    expect(unit("Production")).toMatchObject({ from: "constant", text: "metric tons (t) gross weight" });
    expect(unit("Unit value ($/t)")).toMatchObject({ from: "constant", text: "$/t" });
    expect(unit("Unit value (98$/t)")).toMatchObject({ from: "constant", text: "98$/t" });
    expect(unit("World mine production (metal content)")).toMatchObject({ from: "constant", text: "metric tons (t) metal content" });

    const lithium = DS140_ENTRY.profile(ds140(table("lithium_2021").id));
    expect(lithium.measures.map((m) => (m.unit.from === "constant" ? m.unit.text : ""))).toEqual([
      "metric tons (t) lithium",
      "metric tons (t) lithium",
      "metric tons (t) lithium",
      "metric tons (t) lithium",
      "$/t",
      "98$/t",
      "metric tons (t) gross weight",
      "metric tons (t) lithium content",
      "metric tons (t) lithium carbonate equivalent",
    ]);
    expect(ds140Unit({ unit: "metric tons" }, "%")).toBe("Percent");
    expect(ds140Unit({ unit: "metric tons" }, "usd")).toBe("$");
  });

  it("leaves out a column no statement covers and keeps the header's own unit for the rest", () => {
    const aluminum = table("aluminum_2021");
    expect(aluminum.measures.map((m) => m[0])).not.toContain("Employment");
    const profile = DS140_ENTRY.profile(ds140(aluminum.id));
    expect(profile.measures.find((m) => m.field === "Net import reliance (%)")?.unit).toMatchObject({ text: "Percent" });
    expect(profile.applies(ds140(aluminum.id), fields(labelsOf(aluminum, ["Employment"])))).toBe(true);
  });

  it("shows a cleaned label but reads the field as stored", () => {
    const antimony = DS140_ENTRY.profile(ds140(table("antimony_2019").id));
    const value = antimony.measures.find((m) => m.field === "Unit value  ($/t)");
    expect(value?.label).toBe("Unit value ($/t)");
    const vermiculite = DS140_ENTRY.profile(ds140(table("vermiculite_2022").id));
    expect(vermiculite.measures.find((m) => m.field === "World production2")?.label).toBe("World production");
  });

  it("draws a year series with the sheet's markers as gaps, never zeros", () => {
    const t = table("bismuth_2022");
    const profile = DS140_ENTRY.profile(ds140(t.id));
    const measure = profile.measures.find((m) => m.field === "Production")!;
    const spec: SeriesTileSpec = {
      id: "t",
      collection: "07_materials",
      datasetId: ds140(t.id).id,
      measure: "Imports",
      title: "Bismuth imports",
      subject: "Bismuth imports",
      verb: "were",
      unit: "metric tons (t) gross weight",
      decimals: 0,
      form: "line",
      transform: "level",
      headline: "level",
      series: { whole: true },
      window: 10,
      changeAs: "percent",
    };
    const context: TileContext = {
      datasetId: spec.datasetId,
      snapshotId: t.snapshotId,
      field: "Imports",
      unit: { from: "fixed", text: "metric tons (t) gross weight" },
      format: "year",
      cadence: "year",
      markers: measure.markers,
      grouping: "none",
    };
    const cells: CellInput[] = [
      { row: 120, period: "2019", text: "2340.0" },
      { row: 121, period: "2020", text: "W" },
      { row: 122, period: "2021", text: "1980.0" },
      { row: 123, period: "2022", text: "3090.0" },
    ];
    const result = computeSeriesTile(spec, context, cells);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headline).toBe("Bismuth imports were 3,090 metric tons (t) gross weight in 2022, 56.1% above 2021.");
    expect(result.gaps).toMatchObject({ count: 1, markers: 1 });
    expect(result.points.map((p) => p.value)).toEqual([2340, null, 1980, 3090]);
  });
});

describe("USDA ERS profiles", () => {
  const cpiAnnual: ProfileDataset = {
    id: "official_09_consumer_staples_raw_annual_percent_changes_in_selected_consumer_price_indexes_1974_through_2025_56b8bc80d1",
    source_id: "ERS_CPI_ANNUAL",
  };
  const ppiAnnual: ProfileDataset = {
    id: "official_09_consumer_staples_annual_percent_changes_in_selected_producer_price_indexes_1974_through_2025_normalized_c7b3c44268",
    source_id: "ERS_PPI_ANNUAL",
  };

  it("reads an annual change per item, the unit from the value header", () => {
    const profile = ERS_ANNUAL_ENTRY.profile(cpiAnnual);
    expect(profile.applies(cpiAnnual, fields(["Consumer Price Index item", "Year", "Percent change"]))).toBe(true);
    expect(profile.applies(cpiAnnual, fields(["Producer Price Index item", "Year", "Percent change"]))).toBe(false);
    expect(profile.measures[0].unit).toMatchObject({ from: "constant", text: "Percent" });
    expect(profile.defaultSeries?.(cpiAnnual)).toEqual({ where: [{ field: "Consumer Price Index item", value: "All food" }] });
    const ppi = ERS_ANNUAL_ENTRY.profile(ppiAnnual);
    expect(ppi.addressing.where).toEqual(["Producer Price Index item"]);
    expect(ppi.applies(ppiAnnual, fields(["Producer Price Index item", "Year", "Percent change"]))).toBe(true);
  });

  it("dates a forecast by the month its outlook was published", () => {
    expect(forecastMonth(["2026", "10"])).toEqual({ text: "2026-10", format: "yyyy-mm" });
    expect(forecastMonth(["2026", "7"])).toEqual({ text: "2026-07", format: "yyyy-mm" });
    expect(forecastMonth(["2026", "13"])).toBeNull();
    expect(forecastMonth(["2026", ""])).toBeNull();
    expect(forecastMonth([null, "3"])).toBeNull();
  });

  it("addresses a forecast series by item, year forecast and bound", () => {
    const history: ProfileDataset = { id: "official_09_consumer_staples_raw_historical_consumer_price_index_cpi_forecast_series_5ceebbebcd", source_id: "ERS_CPI_HISTORY" };
    const labels = ["Consumer Price Index item", "Month of forecast", "Year of forecast", "Year being forecast", "Attribute", "Forecast percent change"];
    const profile = ERS_FORECAST_ENTRY.profile(history);
    expect(profile.applies(history, fields(labels))).toBe(true);
    expect(profile.requires).toEqual(expect.arrayContaining(["Year of forecast", "Month of forecast", "Year being forecast", "Attribute"]));
    expect(profile.firstLook).toBe("none");
    expect(profile.defaultSeries?.(history)).toEqual({
      where: [
        { field: "Consumer Price Index item", value: "All food" },
        { field: "Year being forecast", value: "2026" },
        { field: "Attribute", value: "Midpoint of forecast interval" },
      ],
    });
    expect(ERS_FORECAST_ENTRY.claims({ id: "x", source_id: "ERS_CPI_OUTLOOK" })).toBe(false);
  });

  it("names every ERS snapshot the profiles were proven on in the checks", () => {
    for (const source of ["ERS_CPI_ANNUAL", "ERS_PPI_ANNUAL"] as const) {
      const p = ERS_ANNUAL_ENTRY.profile({ id: "x", source_id: source });
      expect(CHECKS.ers.tables[p.proof.snapshotId], source).toBeDefined();
      expect(CHECKS.ers.tables[p.proof.snapshotId].rows).toBe(p.addressing.rowsScanned);
    }
    for (const source of ["ERS_CPI_HISTORY", "ERS_PPI_HISTORY", "ERS_CPI_ARCHIVE", "ERS_PPI_ARCHIVE"] as const) {
      const p = ERS_FORECAST_ENTRY.profile({ id: "x", source_id: source });
      expect(CHECKS.ers.tables[p.proof.snapshotId], source).toBeDefined();
      expect(CHECKS.ers.tables[p.proof.snapshotId].rows).toBe(p.addressing.rowsScanned);
    }
  });
});

describe("MSHA state and subunit employment profile", () => {
  const dataset: ProfileDataset = { id: "official_07_materials_csv_employment_state_history_1a337a72d0", source_id: "MSHA_EMPLOYMENT" };
  const columns = fields(["CALENDAR_YR", "STATE_ABBR", "SUBUNIT_CD", "SUBUNIT_DESC", "ANNUAL_HRS", "AVG_ANNUAL_EMPL"], {
    ANNUAL_HRS: "employee-hours",
    AVG_ANNUAL_EMPL: "sum of subunit average employees",
  });

  it("claims only the state table and reads the hours' unit from the dictionary", () => {
    expect(MSHA_STATE_ENTRY.claims(dataset)).toBe(true);
    expect(MSHA_STATE_ENTRY.claims({ ...dataset, id: "official_07_materials_csv_materials_employment_2025_7523fc0753" })).toBe(false);
    const profile = profileFor(dataset, columns);
    expect(profile?.family).toBe("msha-state-subunit");
    expect(unitOf(profile!.measures[0], columns)).toEqual({ ok: true, text: "employee-hours" });
    const restated = columns.map((c) => (c.label === "ANNUAL_HRS" ? { ...c, unit: "hours" } : c));
    expect(unitOf(profile!.measures[0], restated)).toMatchObject({ ok: false });
    expect(unitOf(profile!.measures[1], columns)).toEqual({ ok: true, text: "average employees" });
  });

  it("addresses a state and subunit through the place index", () => {
    const profile = MSHA_STATE_ENTRY.profile(dataset);
    expect(profile.addressing).toMatchObject({ by: "geo_code", where: ["SUBUNIT_CD"], scan: "key" });
    expect(profile.defaultSeries?.(dataset)).toEqual({ by: "geo_code", key: "TX", where: [{ field: "SUBUNIT_CD", value: "03" }] });
    expect(profile.proof.snapshotId).toBe(CHECKS.msha.snapshotId);
    const records = Object.values(CHECKS.msha.years).reduce((sum, y) => sum + y.records, 0);
    expect(records).toBe(CHECKS.msha.rows);
  });
});

describe("MSHA mine register counts profile", () => {
  const dataset: ProfileDataset = { id: "official_07_materials_csv_materials_mine_status_counts_4d6148ba31", source_id: "MSHA_MINES" };
  const columns = fields(["STATE", "CURRENT_MINE_TYPE", "CURRENT_MINE_STATUS", "Mine count"], { "Mine count": "mine register records" });

  it("reads the count's unit from the dictionary and refuses another", () => {
    const profile = profileFor(dataset, columns);
    expect(profile?.family).toBe("msha-mine-counts");
    expect(unitOf(profile!.measures[0], columns)).toEqual({ ok: true, text: "mine register records" });
    expect(unitOf(profile!.measures[0], columns.map((c) => ({ ...c, unit: c.label === "Mine count" ? "mines" : c.unit })))).toMatchObject({ ok: false });
    expect(MSHA_COUNT_ENTRY.claims({ ...dataset, id: "official_07_materials_csv_mine_commodity_status_counts_e07c44fa6a" })).toBe(false);
  });

  it("was proven on the snapshot the checks name", () => {
    expect(MSHA_COUNT_ENTRY.profile(dataset).proof.snapshotId).toBe(CHECKS.msha.mineCounts.snapshotId);
    expect(CHECKS.msha.mineCounts.rows).toBe(MSHA_COUNT_ENTRY.profile(dataset).addressing.rowsScanned);
  });
});

describe("NHTSA recall campaign profiles", () => {
  const byYear: ProfileDataset = { id: "official_08_consumer_discretionary_recalls_year_d8884f5228", source_id: "NHTSA_RECALLS" };
  const byMaker: ProfileDataset = { id: "official_08_consumer_discretionary_recalls_manufacturer_year_7d2c6c8fd6", source_id: "NHTSA_RECALLS" };

  it("reads the year from its field and counts campaigns, one family per table", () => {
    const year = profileFor(byYear, fields(["Received year", "Distinct campaigns"]));
    expect(year?.family).toBe("nhtsa-recall-years");
    expect(year?.period).toEqual({ from: "field", field: "Received year", format: "year" });
    expect(year?.measures[0].unit).toMatchObject({ from: "constant", text: "recall campaigns" });
    const maker = profileFor(byMaker, fields(["Manufacturer", "Received year", "Distinct campaigns"]));
    expect(maker?.family).toBe("nhtsa-recall-makers");
    expect(maker?.defaultSeries?.(byMaker)).toEqual({ where: [{ field: "Manufacturer", value: "Ford Motor Company" }] });
    expect(profileFor(byMaker, fields(["Received year", "Distinct campaigns"]))).toBeNull();
    expect(NHTSA_YEAR_ENTRY.claims({ id: "official_08_consumer_discretionary_recall_campaigns_648e3d43d3", source_id: "NHTSA_RECALLS" })).toBe(false);
  });

  it("keeps the comparison with NHTSA's files beside the profile", () => {
    expect(CHECKS.nhtsa.byYear.equal + Object.keys(CHECKS.nhtsa.byYear.differ).length).toBe(CHECKS.nhtsa.byYear.rows);
    expect(NHTSA_YEAR_ENTRY.profile(byYear).proof.snapshotId).toBe(CHECKS.nhtsa.byYear.snapshotId);
    expect(NHTSA_MAKER_ENTRY.profile(byMaker).proof.snapshotId).toBe(CHECKS.nhtsa.byMaker.snapshotId);
  });
});

describe("registry", () => {
  it("lists the industry families once, after the core families", () => {
    const families = PROFILE_ENTRIES.map((e) => e.family);
    for (const f of ["usgs-ds140", "ers-annual-change", "ers-forecast", "msha-state-subunit", "msha-mine-counts", "nhtsa-recall-years", "nhtsa-recall-makers"]) expect(families.filter((x) => x === f)).toHaveLength(1);
  });

  it("gives each claimed dataset to one family only", () => {
    const samples: ProfileDataset[] = [
      ds140(DS140_TABLES[0].id),
      { id: "a", source_id: "ERS_CPI_ANNUAL" },
      { id: "b", source_id: "ERS_PPI_HISTORY" },
      { id: "official_07_materials_csv_employment_state_history_1a337a72d0", source_id: "MSHA_EMPLOYMENT" },
    ];
    for (const d of samples) expect(PROFILE_ENTRIES.filter((e) => e.claims(d)), d.id).toHaveLength(1);
  });
});
