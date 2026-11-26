import { describe, expect, it } from "vitest";
import { profileFor, unitOf } from "../../profiles";
import { ENTRIES } from "../../profiles/units/industry";
import { DS140_TABLES } from "../../profiles/units/industry-ds140";
import type { SourceColumn } from "../../schema";
import { composeProblems } from "../compose";
import { BOARDS, CORE_BOARDS, CORE_TILES } from "../specs";
import type { TileSeriesSpec, TileSpec } from "../types";
import { UNIT_SPECS } from "./index";
import { SPECS } from "./industry";

/** The dictionaries of the tables the tiles read, as production stores them (positional keys, the publisher's headers, units where stated). */
const field = (label: string, i: number, unit?: string): SourceColumn => ({ key: `col${String(i + 1).padStart(4, "0")}`, label, type: "string", ...(unit ? { unit } : {}) });
const dictionary = (labels: readonly string[], units: Record<string, string> = {}) => labels.map((l, i) => field(l, i, units[l]));

const SOURCE: Record<string, { source_id: string; columns: SourceColumn[] }> = {
  official_07_materials_csv_materials_mine_status_counts_4d6148ba31: {
    source_id: "MSHA_MINES",
    columns: dictionary(["STATE", "CURRENT_MINE_TYPE", "CURRENT_MINE_STATUS", "Mine count"], { "Mine count": "mine register records" }),
  },
  official_07_materials_csv_employment_state_history_1a337a72d0: {
    source_id: "MSHA_EMPLOYMENT",
    columns: dictionary(["CALENDAR_YR", "STATE_ABBR", "SUBUNIT_CD", "SUBUNIT_DESC", "ANNUAL_HRS", "AVG_ANNUAL_EMPL"], {
      ANNUAL_HRS: "employee-hours",
      AVG_ANNUAL_EMPL: "sum of subunit average employees",
    }),
  },
  official_08_consumer_discretionary_recalls_year_d8884f5228: { source_id: "NHTSA_RECALLS", columns: dictionary(["Received year", "Distinct campaigns"]) },
  official_08_consumer_discretionary_recalls_manufacturer_year_7d2c6c8fd6: {
    source_id: "NHTSA_RECALLS",
    columns: dictionary(["Manufacturer", "Received year", "Distinct campaigns"]),
  },
  official_09_consumer_staples_raw_annual_percent_changes_in_selected_consumer_price_indexes_1974_through_2025_56b8bc80d1: {
    source_id: "ERS_CPI_ANNUAL",
    columns: dictionary(["Consumer Price Index item", "Year", "Percent change"]),
  },
  official_09_consumer_staples_raw_annual_percent_changes_in_selected_producer_price_indexes_1974_through_2025_f0035409fd: {
    source_id: "ERS_PPI_ANNUAL",
    columns: dictionary(["Producer Price Index item", "Year", "Percent change"]),
  },
  official_09_consumer_staples_raw_historical_consumer_price_index_cpi_forecast_series_5ceebbebcd: {
    source_id: "ERS_CPI_HISTORY",
    columns: dictionary(["Consumer Price Index item", "Month of forecast", "Year of forecast", "Year being forecast", "Attribute", "Forecast percent change"]),
  },
};
for (const t of DS140_TABLES)
  SOURCE[`official_07_materials_csv_ds140_${t.id}`] = { source_id: "USGS_DS140", columns: dictionary(["Year", ...t.measures.map((m) => m[0])]) };

/** Every series a tile reads: its own measure, or each line's. */
function reads(spec: TileSpec): { datasetId: string; measure: string; unit: string; matches: string[] }[] {
  if (spec.transform === "records") return [];
  const one = (l?: TileSeriesSpec) => ({
    datasetId: l?.datasetId ?? spec.datasetId,
    measure: l?.measure ?? spec.measure,
    unit: l?.unit ?? spec.unit,
    matches: l && "where" in l.series && l.series.where ? l.series.where.map((m) => m.field) : [],
  });
  if (spec.form === "compare") return spec.lines.map(one);
  if (spec.form === "mix") return [spec.whole, ...spec.parts].map(one);
  if (spec.form === "curve") return spec.categories.map(one);
  return [one()];
}

describe("industry tiles", () => {
  it("compose with every other unit's specs without a problem", () => {
    expect(composeProblems(CORE_TILES, CORE_BOARDS, UNIT_SPECS).filter((p) => p.unit === "industry")).toEqual([]);
  });

  // COMMON6: a collection board holds at most 18 tiles, in sections
  it("give Materials and mining a board of 12 to 18 tiles, each in a section", () => {
    const board = BOARDS.find((b) => b.id === "07_materials");
    expect(board?.title).toBe("Materials and mining");
    expect(board!.tiles.length).toBeGreaterThanOrEqual(12);
    expect(board!.tiles.length).toBeLessThanOrEqual(18);
    for (const id of board!.tiles) expect(SPECS.tiles.find((t) => t.id === id)?.section, id).toBeTruthy();
  });

  it("keep every collection board within 18 tiles", () => {
    for (const b of BOARDS) if (b.id !== "library") expect(b.tiles.length, b.id).toBeLessThanOrEqual(18);
  });

  it("read only measures of a profiled family, in the unit the profile states", () => {
    for (const spec of SPECS.tiles) {
      for (const r of reads(spec)) {
        const source = SOURCE[r.datasetId];
        expect(source, `${spec.id}: ${r.datasetId}`).toBeDefined();
        const profile = profileFor({ id: r.datasetId, source_id: source.source_id }, source.columns);
        expect(profile, spec.id).not.toBeNull();
        expect(ENTRIES.some((e) => e.family === profile!.family), spec.id).toBe(true);
        const measure = profile!.measures.find((m) => m.field === r.measure);
        expect(measure, `${spec.id}: ${r.measure}`).toBeDefined();
        expect(unitOf(measure!, source.columns, () => null), spec.id).toEqual({ ok: true, text: r.unit });
        for (const f of r.matches) expect(source.columns.some((c) => c.label === f), `${spec.id}: ${f}`).toBe(true);
      }
    }
  });

  it("count records only through an indexed dimension of the table", () => {
    const counts = SPECS.tiles.filter((t) => t.transform === "records");
    expect(counts.length).toBeGreaterThan(0);
    for (const t of counts) expect("dimension" in t.per ? t.per.dimension : null, t.id).toBe("geo_code");
  });

  it("name a map's places by the place dimension and fix every field that makes a state appear once", () => {
    for (const t of SPECS.tiles) {
      if (t.transform === "records" || t.form !== "map") continue;
      expect(t.across.by, t.id).toBe("geo_code");
      expect(t.across.where?.length ?? 0, t.id).toBeGreaterThan(0);
    }
  });

  it("add two tiles to the landing board", () => {
    expect(SPECS.boardTiles.library).toHaveLength(2);
    for (const id of SPECS.boardTiles.library) expect(SPECS.tiles.some((t) => t.id === id)).toBe(true);
  });

  it("write titles, subjects and notes without em dashes", () => {
    for (const t of SPECS.tiles) for (const text of [t.title, t.subject, t.note ?? ""]) expect(text.includes("—"), t.id).toBe(false);
  });
});
