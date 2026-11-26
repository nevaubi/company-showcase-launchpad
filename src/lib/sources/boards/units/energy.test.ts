import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readNative } from "../../numbers";
import { measureOf, PROFILE_ENTRIES, profileFor, profileStatus, unitOf } from "../../profiles";
import { ENERGY_REFUSED, EGRID_STATE_MEASURES, NET_METERING_STATE_MEASURES } from "../../profiles/units/energy";
import type { SourceColumn } from "../../schema";
import { BOARDS, boardSpec, tileSpec } from "../specs";
import type { RankTileSpec, SeriesTileSpec } from "../types";
import { SPECS, UTILITIES_BOARD } from "./energy";
import { merKey, replayRankTile, replayTile, type EnergyFixtures } from "./energy-replay";

const FIXTURES = JSON.parse(readFileSync("src/lib/sources/boards/units/energy.fixtures.json", "utf8")) as EnergyFixtures;
const CHECKS = JSON.parse(readFileSync("src/lib/sources/boards/units/energy.checks.json", "utf8")) as {
  series: { table: string; snapshotId: string; msn: string; records: number; md5: string }[];
  states: Record<string, { snapshotId: string; places: number; fields: string[]; compared: number; equal: number }>;
  tiles: Record<string, { datasetId: string; snapshotId: string; asOf: string; figure: string; figureUnit: string; headline: string; rows: number[] }>;
};

const EGRID = "official_05_utilities_csv_egrid2023_st23_full_3993eec81f";
const NET_METERING = "official_05_utilities_csv_eia861_net_metering_2025_states_state_level_662ef5df39";
const dictionary = (id: string): SourceColumn[] => FIXTURES.dictionaries[id].columns;

describe("eGRID state profile", () => {
  it("claims only the eGRID2023 state table and turns on for its dictionary", () => {
    const profile = profileFor({ id: EGRID, source_id: "EPA_EGRID" }, dictionary(EGRID));
    expect(profile?.family).toBe("epa-egrid-state");
    expect(profile?.addressing.by).toBe("geo_code");
    expect(profileFor({ id: "official_05_utilities_csv_egrid2023_plnt23_full_964175ba0b", source_id: "EPA_EGRID" }, dictionary(EGRID))).toBeNull();
    expect(profileFor({ id: EGRID, source_id: "EIA_MER" }, dictionary(EGRID))).toBeNull();
  });

  it("turns off and names the field when EPA renames a code", () => {
    const columns = dictionary(EGRID).map((c) => (c.label === "STCO2RTA" ? { ...c, label: "STCO2RT" } : c));
    const status = profileStatus({ id: EGRID, source_id: "EPA_EGRID" }, columns);
    expect(status.state).toBe("off");
    if (status.state === "off") expect(status.reason).toContain("STCO2RTA");
  });

  it("states each unit as EPA prints it above the field, with the workbook as evidence", () => {
    for (const m of EGRID_STATE_MEASURES) {
      expect(m.unit.from).toBe("constant");
      if (m.unit.from !== "constant") continue;
      expect(["MWh", "lb/MWh", "tons", "MW"]).toContain(m.unit.text);
      expect(m.unit.evidence).toMatch(/^https:\/\/www\.epa\.gov\/.+egrid2023_data_rev2\.xlsx \(sheet ST23/);
      expect(m.unit.evidence).toContain(`"${m.label} (${m.unit.text})"`);
    }
    // the resource-mix fields hold fractions under a "percent" header: never a measure
    expect(EGRID_STATE_MEASURES.some((m) => /PR$/.test(m.field))).toBe(false);
  });
});

describe("EIA-861 net metering state profile", () => {
  const dataset = { id: NET_METERING, source_id: "EIA861_DISTRIBUTED" };

  it("reads the capacity unit from the dictionary and refuses any other", () => {
    const profile = profileFor(dataset, dictionary(NET_METERING));
    expect(profile?.family).toBe("eia861-net-metering-state");
    const capacity = profile ? measureOf(profile, "Photovoltaic | Capacity MW | Total") : null;
    expect(capacity ? unitOf(capacity, dictionary(NET_METERING)) : null).toEqual({ ok: true, text: "MW" });
    const kw = dictionary(NET_METERING).map((c) => (c.label === "Photovoltaic | Capacity MW | Total" ? { ...c, unit: "kW" } : c));
    expect(capacity ? unitOf(capacity, kw) : null).toMatchObject({ ok: false });
  });

  it("treats EIA's dot as a gap, never as zero", () => {
    for (const m of NET_METERING_STATE_MEASURES) expect(m.markers).toEqual(["."]);
    expect(readNative(".", { markers: ["."] }).kind).toBe("marker");
    expect(readNative("0", { markers: ["."] }).kind).toBe("number");
  });

  it("claims the state-level sheet only", () => {
    const utility = { id: "official_05_utilities_csv_eia861_net_metering_2025_states_utility_level_37e7f95d8e", source_id: "EIA861_DISTRIBUTED" };
    expect(profileFor(utility, dictionary(NET_METERING))).toBeNull();
  });
});

describe("refused families", () => {
  it("give a plain reason, and no family is both profiled and refused", () => {
    const profiled = new Set(PROFILE_ENTRIES.map((e) => e.family));
    for (const [source, reason] of Object.entries(ENERGY_REFUSED)) {
      expect(reason.length).toBeGreaterThan(30);
      expect(reason).not.toMatch(/—/);
      expect(profiled.has(source)).toBe(false);
    }
    expect(Object.keys(ENERGY_REFUSED)).not.toContain("EPA_EGRID");
    expect(Object.keys(ENERGY_REFUSED)).not.toContain("EIA_MER");
  });
});

describe("energy tiles", () => {
  it("each resolves to a reviewed profile and one of its measures", () => {
    for (const spec of SPECS.tiles) {
      const dict = FIXTURES.dictionaries[spec.datasetId];
      expect(dict, spec.id).toBeDefined();
      const profile = profileFor({ id: spec.datasetId, source_id: dict.sourceId }, dict.columns);
      expect(profile, spec.id).not.toBeNull();
      expect(profile ? measureOf(profile, spec.measure) : null, spec.id).not.toBeNull();
      expect(tileSpec(spec.id)).toBe(spec);
    }
  });

  it("pin each MER series by the description and unit its records state", () => {
    for (const spec of SPECS.tiles.filter((t): t is SeriesTileSpec => t.transform !== "rank" && t.transform !== "share")) {
      const key = merKey(spec);
      const series = key ? FIXTURES.mer[key] : undefined;
      expect(series, spec.id).toBeDefined();
      if (!series) continue;
      expect(spec.subjectCheck).toEqual({ field: "Description", value: series.description });
      expect(spec.unit).toBe(series.unit);
      // the latest stored records are in the fixture, and the series was proven whole on the same snapshot
      const proof = CHECKS.series.find((s) => s.snapshotId === series.snapshotId && s.msn === key?.split("|")[1]);
      expect(proof, spec.id).toBeDefined();
      expect(proof?.records).toBe(series.records);
      expect(series.rows[series.rows.length - 1][0]).toBeLessThanOrEqual(series.records * 20);
    }
  });

  it.each(SPECS.tiles.map((t) => [t.id, t] as const))("%s computes the figures checked on production", (id, spec) => {
    const result = replayTile(spec, FIXTURES);
    const check = CHECKS.tiles[id];
    expect(check).toBeDefined();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect({
      datasetId: spec.datasetId,
      snapshotId: result.refs.snapshotId,
      asOf: result.asOf,
      figure: result.figure,
      figureUnit: result.figureUnit,
      headline: result.headline,
      rows: result.refs.rows,
    }).toEqual(check);
    expect(result.headline).not.toMatch(/—/);
    expect(result.gaps.count).toBe(0);
  });

  it("rank a whole period: every place of the cross-section, each once", () => {
    for (const spec of SPECS.tiles.filter((t): t is RankTileSpec => t.transform === "rank")) {
      const result = replayRankTile(spec, FIXTURES, "profile");
      expect(result.ok, spec.id).toBe(true);
      if (!result.ok) continue;
      const places = spec.datasetId === EGRID ? 52 : 51;
      expect(result.derivation?.formula).toContain(`${places} records of ${spec.across.period}`);
      expect(result.headline).toContain(` in ${spec.across.period}.`);
      expect(result.points).toHaveLength(spec.across.top);
    }
  });

  it("refuse a record that states another unit or description", () => {
    const spec = tileSpec("generation-solar") as SeriesTileSpec;
    const key = merKey(spec) as string;
    const renamed: EnergyFixtures = { ...FIXTURES, mer: { ...FIXTURES.mer, [key]: { ...FIXTURES.mer[key], unit: "Billion Kilowatthours" } } };
    expect(replayTile(spec, renamed)).toMatchObject({ ok: false });
    const redefined: EnergyFixtures = { ...FIXTURES, mer: { ...FIXTURES.mer, [key]: { ...FIXTURES.mer[key], description: "Electricity Net Generation From Solar, Electric Power Sector" } } };
    expect(replayTile(spec, redefined)).toMatchObject({ ok: false });
  });
});

describe("energy boards", () => {
  it("fill Energy with 14 to 18 tiles and Power and utilities with 12 to 16", () => {
    const energy = boardSpec("04_energy");
    const utilities = boardSpec("05_utilities");
    expect(energy?.tiles.length).toBeGreaterThanOrEqual(14);
    expect(energy?.tiles.length).toBeLessThanOrEqual(18);
    expect(utilities?.title).toBe("Power and utilities");
    expect(utilities?.tiles.length).toBeGreaterThanOrEqual(12);
    expect(utilities?.tiles.length).toBeLessThanOrEqual(16);
    expect(UTILITIES_BOARD.tiles).toEqual(utilities?.tiles);
  });

  it("add two tiles to the landing board and define no board twice", () => {
    const library = boardSpec("library");
    for (const id of SPECS.boardTiles.library) expect(library?.tiles).toContain(id);
    expect(SPECS.boardTiles.library).toHaveLength(2);
    expect(BOARDS.filter((b) => b.id === "05_utilities")).toHaveLength(1);
  });

  it("proves every series the checks list against EIA's file, on the snapshot the fixtures name", () => {
    expect(CHECKS.series).toHaveLength(63);
    for (const s of CHECKS.series) {
      expect(s.snapshotId, `${s.table} ${s.msn}`).toMatch(/^[0-9a-f]{64}$/);
      expect(s.md5).toMatch(/^[0-9a-f]{32}$/);
    }
    for (const proof of Object.values(CHECKS.states)) expect(proof.equal).toBe(proof.compared);
  });
});
