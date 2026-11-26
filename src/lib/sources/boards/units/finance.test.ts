import { describe, expect, it } from "vitest";
import type { SourceColumn } from "../../schema";
import { measureOf, profileFor } from "../../profiles/index";
import type { Profile } from "../../profiles/types";
import { FDIC_FAILURES_DATASET, H8_MONTHLY_DATASET, NCUA_CORE_DATASET, OFR_MMF_DATASET, Z1_SECTORS_DATASET, Z1_TABLES } from "../../profiles/units/finance";
import { computeSeriesTile, isSeriesSpec, type CellInput, type TileContext } from "../compute";
import { readerFigure, scaleUnitOf } from "../scale";
import { parseDecimal } from "../decimal";
import { boardSpec, tileSpec } from "../specs";
import type { SeriesTileSpec, TileSeriesSpec, TileSpec } from "../types";
import { FINANCE_BOARD_TILES, SPECS } from "./finance";

const columns = (...labels: string[]): SourceColumn[] => labels.map((label, i) => ({ key: `col${String(i + 1).padStart(4, "0")}`, label, type: "string" }));
/** A dictionary whose listed fields state a unit, as production's do for the NCUA and FDIC tables. */
const withUnits = (fields: SourceColumn[], unit: string, labels: readonly string[]) => fields.map((c) => (labels.includes(c.label) ? { ...c, unit } : c));

/** The production dictionaries of the tables the tiles read (labels as stored, every type "string"). */
const DICTIONARIES: Record<string, { sourceId: string; fields: SourceColumn[] }> = {
  [H8_MONTHLY_DATASET]: { sourceId: "FED_H8", fields: columns("series", "description", "date", "value_native", "status", "unit", "unit_multiplier") },
  [Z1_SECTORS_DATASET]: { sourceId: "FED_Z1", fields: columns("table", "series_id", "description", "period", "value_native", "source_value_or_flag", "unit_and_basis") },
  [OFR_MMF_DATASET]: { sourceId: "OFR_STFM", fields: columns("mnemonic", "date", "value_native", "unit") },
  ...Object.fromEntries(Z1_TABLES.map((t) => [t.datasetId, { sourceId: "FED_Z1", fields: columns("date", ...t.series.map((s) => s.code)) }])),
  [NCUA_CORE_DATASET]: {
    sourceId: "NCUA_CALL",
    fields: withUnits(
      columns("asset_rank_in_package", "CU_NUMBER", "CU_NAME", "CYCLE_DATE", "JOIN_NUMBER", "RSSD", "CU_TYPE", "CITY", "STATE", "YEAR_OPENED", "assets_USD", "shares_and_deposits_USD", "loans_and_leases_USD", "members"),
      "USD",
      ["assets_USD", "shares_and_deposits_USD", "loans_and_leases_USD"],
    ),
  },
  [FDIC_FAILURES_DATASET]: {
    sourceId: "FDIC_FAILURES",
    fields: withUnits(
      columns("CERT", "NAME", "CITY", "PSTALP", "FAILDATE", "FAILYR", "RESTYPE", "RESTYPE1", "QBFASSET", "QBFDEP", "COST", "BIDNAME", "BIDSTATE", "FIN"),
      "USD thousands",
      ["QBFASSET", "QBFDEP", "COST"],
    ),
  },
};

function profileOf(datasetId: string): Profile {
  const d = DICTIONARIES[datasetId];
  expect(d, datasetId).toBeDefined();
  const profile = profileFor({ id: datasetId, source_id: d.sourceId }, d.fields);
  expect(profile, datasetId).not.toBeNull();
  return profile as Profile;
}

/** The unit a measure states for a tile: the profile's constant, or for a unit column the units OFR states. */
function unitsOf(profile: Profile, field: string): string[] {
  const measure = measureOf(profile, field);
  expect(measure, `${profile.family} ${field}`).not.toBeNull();
  const unit = measure!.unit;
  return unit.from === "column" ? ["USD", "Percent"] : [unit.text];
}

/** Every series a tile reads, with its dataset, measure and unit. */
function readsOf(spec: TileSpec): { datasetId: string; measure: string; unit: string }[] {
  if (spec.transform === "records") return [];
  const one = (l: TileSeriesSpec) => ({ datasetId: l.datasetId ?? spec.datasetId, measure: l.measure ?? spec.measure, unit: l.unit ?? spec.unit });
  if (spec.form === "compare") return spec.lines.map(one);
  if (spec.form === "mix") return [spec.whole, ...spec.parts].map(one);
  if (spec.form === "curve") return spec.categories.map(one);
  return [{ datasetId: spec.datasetId, measure: spec.measure, unit: spec.unit }];
}

describe("finance tiles", () => {
  it("defines each tile once, and every tile it places exists", () => {
    const ids = SPECS.tiles.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [board, tiles] of Object.entries(SPECS.boardTiles)) {
      expect(boardSpec(board), board).not.toBeNull();
      for (const t of tiles) expect(tileSpec(t), t).not.toBeNull();
    }
  });

  it("fills the Banks and funds board to between 14 and 18 tiles, every tile of this unit under a section", () => {
    const board = boardSpec("01_financials");
    expect(board).not.toBeNull();
    expect(board!.tiles.length).toBeGreaterThanOrEqual(14);
    expect(board!.tiles.length).toBeLessThanOrEqual(18);
    for (const id of FINANCE_BOARD_TILES) {
      expect(board!.tiles).toContain(id);
      expect(tileSpec(id)?.section, id).toBeTruthy();
    }
  });

  it("reads only measures of a reviewed profile, in the unit that profile states", () => {
    for (const spec of SPECS.tiles) {
      for (const read of readsOf(spec)) {
        const profile = profileOf(read.datasetId);
        expect(unitsOf(profile, read.measure), `${spec.id} ${read.measure}`).toContain(read.unit);
      }
    }
  });

  it("writes every money unit of its tiles in a reader scale, the stored figure as filed beneath it", () => {
    for (const unit of ["Millions of dollars", "USD", "USD thousands"]) expect(scaleUnitOf(unit), unit).not.toBeNull();
    const assets = readerFigure("Millions of dollars", parseDecimal("26009483.7")!, "26,009,483.7");
    expect(assets).toMatchObject({ figure: "$26.01 trillion", filed: "26,009,483.7 Millions of dollars as filed" });
    expect(readerFigure("USD", parseDecimal("8473378242355.38")!, "8,473,378,242,355.38")?.figure).toBe("$8.473 trillion");
    expect(readerFigure("USD thousands", parseDecimal("18744254.463")!, "18,744,254")?.figure).toBe("$18.74 billion");
  });

  it("counts records only of tables of the collection, and says records, not a measure", () => {
    const counts = SPECS.tiles.filter((t) => t.transform === "records");
    expect(counts.length).toBeGreaterThan(0);
    for (const t of counts) {
      expect(t.collection).toBe("01_financials");
      expect(`${t.title} ${t.subject}`).not.toMatch(/dollars|USD|assets were|percent/i);
    }
  });
});

/** Real cells of the production snapshots (finance report: each set's md5 equals the same md5 computed in SQL). */
const H8_TOTAL_ASSETS: [number, string, string][] = [
  [1598, "2025-10-31", "24407047.9"], [1599, "2025-11-30", "24501457.4"], [1600, "2025-12-31", "24702261.8"], [1601, "2026-01-31", "24771074.5"],
  [1602, "2026-02-28", "24920322.4"], [1603, "2026-03-31", "25122065.9"], [1604, "2026-04-30", "25280602.7"], [1605, "2026-05-31", "25476088.8"],
  [1606, "2026-06-30", "25578748.4"], [1607, "2026-07-31", "25660990.7"], [1608, "2026-08-31", "25695283.6"], [1609, "2026-09-30", "25826949.5"],
  [1610, "2026-10-31", "26009483.7"],
];
const Z1_CREDIT_UNIONS: [number, string, string][] = [
  [10976, "2025:Q2", "2338469"], [10977, "2025:Q3", "2358699"], [10978, "2025:Q4", "2383111"], [10979, "2026:Q1", "2430826"], [10980, "2026:Q2", "2445321"],
];
const Z1_NET_WORTH: [number, string, string][] = [
  [301, "2025:Q2", "175246515"], [302, "2025:Q3", "180509163"], [303, "2025:Q4", "182274207"], [304, "2026:Q1", "183067096"], [305, "2026:Q2", "195870496"],
];
const OFR_REPO_YIELD: [number, string, string][] = [
  [6330, "2025-10-31", "4.15"], [6331, "2025-11-30", "4.08"], [6332, "2025-12-31", "3.82"], [6333, "2026-01-31", "3.67"], [6334, "2026-02-28", "3.67"],
  [6335, "2026-03-31", "3.67"], [6336, "2026-04-30", "3.65"], [6337, "2026-05-31", "3.62"], [6338, "2026-06-30", "3.65"], [6339, "2026-07-31", "3.65"],
  [6340, "2026-08-31", "3.67"], [6341, "2026-09-30", "3.89"], [6342, "2026-10-31", "3.94"],
];

function seriesTile(id: string): SeriesTileSpec {
  const spec = tileSpec(id);
  if (!spec || !isSeriesSpec(spec)) throw new Error(`${id} is not a series tile`);
  return spec;
}

const contextFor = (spec: SeriesTileSpec, unit: TileContext["unit"], monthly: boolean): TileContext => ({
  datasetId: spec.datasetId,
  snapshotId: "proof",
  field: spec.measure,
  unit,
  format: monthly ? "iso-date" : "quarter",
  cadence: monthly ? "month" : "quarter",
  grouping: "none",
});

const toCells = (rows: [number, string, string][], extra: Partial<CellInput> = {}): CellInput[] => rows.map(([row, period, text]) => ({ row, period, text, ...extra }));

describe("finance series tiles on production cells", () => {
  it("bank total assets: the latest month and the same month a year earlier", () => {
    const spec = seriesTile("banks-total-assets");
    const cells = toCells(H8_TOTAL_ASSETS, { check: "Total assets, all commercial banks, not seasonally adjusted" });
    const r = computeSeriesTile(spec, contextFor(spec, { from: "fixed", text: "Millions of dollars" }, true), cells);
    expect(r.ok && r.headline).toBe("Total assets of all commercial banks were 26,009,483.7 Millions of dollars in Oct 2026, 6.6% above Oct 2025.");
    expect(r.ok && r.refs.rows).toEqual([1610, 1598]);
  });

  it("bank total assets: a record with another series description refuses the tile", () => {
    const spec = seriesTile("banks-total-assets");
    const cells = toCells(H8_TOTAL_ASSETS, { check: "Total assets, all commercial banks, seasonally adjusted" });
    const r = computeSeriesTile(spec, contextFor(spec, { from: "fixed", text: "Millions of dollars" }, true), cells);
    expect(r.ok).toBe(false);
  });

  it("credit unions' total financial assets: the quarter a year earlier", () => {
    const spec = seriesTile("credit-unions-financial-assets");
    const cells = toCells(Z1_CREDIT_UNIONS, { check: "Credit unions; total financial assets" });
    const r = computeSeriesTile(spec, contextFor(spec, { from: "fixed", text: "Millions of dollars" }, false), cells);
    expect(r.ok && r.headline).toBe("Total financial assets of credit unions were 2,445,321 Millions of dollars in Q2 2026, 4.6% above Q2 2025.");
  });

  it("household net worth", () => {
    const spec = seriesTile("household-net-worth");
    const r = computeSeriesTile(spec, contextFor(spec, { from: "fixed", text: "Millions of dollars" }, false), toCells(Z1_NET_WORTH));
    expect(r.ok && r.headline).toBe("The net worth of households and nonprofit organizations was 195,870,496 Millions of dollars in Q2 2026, 11.8% above Q2 2025.");
  });

  it("the median repo yield moves in percentage points, its unit read from the record", () => {
    const spec = seriesTile("mmf-repo-yield");
    const r = computeSeriesTile(spec, contextFor(spec, { from: "column" }, true), toCells(OFR_REPO_YIELD, { unit: "Percent" }));
    expect(r.ok && r.headline).toBe("The median yield money market funds received on repurchase agreements was 3.94% in Oct 2026, 0.21 percentage points below Oct 2025.");
    // a record that states a volume refuses a yield tile
    const mixed = toCells(OFR_REPO_YIELD, { unit: "Percent" });
    mixed[3] = { ...mixed[3], unit: "USD" };
    expect(computeSeriesTile(spec, contextFor(spec, { from: "column" }, true), mixed).ok).toBe(false);
  });
});
