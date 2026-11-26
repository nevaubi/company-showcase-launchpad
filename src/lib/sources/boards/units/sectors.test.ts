import { describe, expect, it } from "vitest";
import { addressRefusal, measureOf, PROFILE_ENTRIES } from "../../profiles";
import type { Profile, ProfileDataset, SeriesAddress } from "../../profiles/types";
import { composeProblems } from "../compose";
import { BOARDS, CORE_BOARDS, CORE_TILES, TILES } from "../specs";
import type { TileSpec } from "../types";
import { UNIT_SPECS } from "./index";
import { FACET_TILES, LIVE_TILES, PENDING_BOARD_TILES, SECTOR_BOARD_ORDER, SECTOR_TILES, SPECS } from "./sectors";

/** The registered source id of every dataset a measure tile of this unit reads. */
const SOURCE_ID: Readonly<Record<string, string | null>> = {
  official_11_real_estate_national_and_state_c21c1607a1: "FHFA_MASTER",
  official_11_real_estate_hpi_at_county_fc7641108a: "FHFA_COUNTY",
  official_11_real_estate_hpi_at_county_latest_4e3ee0764a: "FHFA_COUNTY",
  official_02_technology_csv_twse_tech_revenue_922c8b713b: "TWSE_MONTHLY",
  official_02_technology_csv_tpex_tech_revenue_fdf5c543f2: "TPEX_MONTHLY",
  official_02_technology_csv_wb_tech_annual_full_7471fc676b: null,
  official_02_technology_csv_wb_tech_annual_22be3f4568: null,
  official_03_healthcare_csv_partd_overall_annual_654675dedc: "CMS_PARTD_2024",
  official_03_healthcare_csv_fda_original_by_year_b0807c7bff: null,
};

function profileOf(datasetId: string): Profile {
  const dataset: ProfileDataset = { id: datasetId, source_id: SOURCE_ID[datasetId] ?? null };
  const entry = PROFILE_ENTRIES.find((e) => e.claims(dataset));
  if (!entry) throw new Error(`no family claims ${datasetId}`);
  return entry.profile(dataset);
}

/** The unit a profile states for a measure: its constant text or the dictionary text it requires. */
function profileUnit(profile: Profile, field: string): string | null {
  const measure = measureOf(profile, field);
  if (!measure) return null;
  return measure.unit.from === "column" ? null : measure.unit.text;
}

/** The series a measure tile reads, with the unit each must carry. */
function readsOf(spec: TileSpec): { datasetId: string; measure: string; unit: string; series: SeriesAddress | null }[] {
  if (spec.transform === "records") return [];
  if (spec.form === "compare")
    return spec.lines.map((l) => ({ datasetId: l.datasetId ?? spec.datasetId, measure: l.measure ?? spec.measure, unit: l.unit ?? spec.unit, series: l.series }));
  if (spec.form === "mix") return [];
  if (spec.form === "curve") return [];
  if (spec.transform === "rank" || spec.form === "map" || spec.form === "distribution") {
    // a cross-section's field matches must fix what the profile's unit depends on, as a series address's do
    const where = spec.across.where;
    return [{ datasetId: spec.datasetId, measure: spec.measure, unit: spec.unit, series: where?.length ? { where } : null }];
  }
  return [{ datasetId: spec.datasetId, measure: spec.measure, unit: spec.unit, series: "series" in spec ? spec.series : null }];
}

const MINE = SECTOR_TILES;

describe("sectors tiles and boards", () => {
  it("compose without a problem", () => {
    expect(composeProblems(CORE_TILES, CORE_BOARDS, UNIT_SPECS).filter((p) => p.unit === "sectors")).toEqual([]);
  });

  it("put only tiles the engine of this branch computes on a board, and hold the rest as pending", () => {
    const ids = new Set(MINE.map((t) => t.id));
    for (const id of LIVE_TILES) {
      expect(ids.has(id)).toBe(true);
      expect(FACET_TILES.has(id), id).toBe(false);
    }
    for (const id of FACET_TILES) {
      const spec = MINE.find((t) => t.id === id);
      expect(spec?.transform === "records" && "dimension" in spec.per, id).toBe(true);
    }
    for (const [board, pending] of Object.entries(PENDING_BOARD_TILES)) {
      for (const id of pending) {
        expect(ids.has(id), `${board}: ${id}`).toBe(true);
        expect(LIVE_TILES.has(id)).toBe(false);
      }
    }
    const listed = new Set(BOARDS.flatMap((b) => b.tiles));
    for (const t of MINE) {
      if (listed.has(t.id)) expect(LIVE_TILES.has(t.id), t.id).toBe(true);
    }
    // every tile defined is placed on one of the unit's boards, live or pending
    const placed = new Set(Object.entries(SECTOR_BOARD_ORDER).flatMap(([board, list]) => (board === "library" ? [] : list)));
    expect([...ids].filter((id) => !placed.has(id))).toEqual([]);
  });

  it("keep every collection board within 18 tiles once the pending tiles land, and Housing at 12 or more of them", () => {
    for (const board of BOARDS) {
      const pending = PENDING_BOARD_TILES[board.id] ?? [];
      expect(board.tiles.length + pending.length, board.id).toBeLessThanOrEqual(18);
    }
    const housing = BOARDS.find((b) => b.id === "11_real_estate");
    expect(housing).toBeDefined();
    expect((housing?.tiles.length ?? 0) + PENDING_BOARD_TILES["11_real_estate"].length).toBeGreaterThanOrEqual(12);
  });

  it("give every tile a section and plain text: no em dash, sentence case titles", () => {
    for (const t of MINE) {
      expect(t.section, t.id).toBeTruthy();
      const texts = [t.title, t.subject, t.note ?? ""];
      for (const text of texts) expect(text.includes("—"), `${t.id}: ${text}`).toBe(false);
      expect(t.title[0], t.id).toBe(t.title[0].toUpperCase());
    }
  });

  it("draw each measure in the unit its reviewed profile states, on an address the profile allows", () => {
    for (const t of MINE) {
      for (const read of readsOf(t)) {
        const profile = profileOf(read.datasetId);
        expect(profileUnit(profile, read.measure), `${t.id}: ${read.measure}`).toBe(read.unit);
        if (read.series) expect(addressRefusal(profile, read.series), t.id).toBeNull();
      }
    }
  });

  it("are all defined once among every tile of every unit, and give the boards only live tiles", () => {
    const others = TILES.filter((t) => !SPECS.tiles.includes(t)).map((t) => t.id);
    for (const t of MINE) expect(others.includes(t.id), t.id).toBe(false);
    expect(new Set(MINE.map((t) => t.id)).size).toBe(MINE.length);
    expect(SPECS.tiles.every((t) => LIVE_TILES.has(t.id))).toBe(true);
  });
});
