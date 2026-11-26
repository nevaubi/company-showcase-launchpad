/**
 * Replays the energy tiles on stored rows kept as fixtures (`energy.fixtures.json`) the way `../board.server.ts`
 * computes them on production: the dataset's profile from the registry, the measure and its unit, the cells of the
 * series or of the cross-section, then `../compute.ts`. Pure: the caller passes the parsed fixtures. Used by the
 * unit's tests and by the production check written in the energy report.
 */
import { cadenceOf, measureOf, profileStatus, unitOf } from "../../profiles";
import type { Cadence, MeasureSpec, Profile } from "../../profiles/types";
import type { SourceColumn } from "../../schema";
import { computeRankTile, computeSeriesTile, isRankSpec, isSeriesSpec, type CellInput, type RankCellInput, type TileContext } from "../compute";
import type { RankTileSpec, SeriesTileSpec, TileResult, TileSpec } from "../types";

/** One MER series: its records as [row number, period as stored, value as stored], the unit and description of every record. */
export type MerSeriesFixture = {
  table: string;
  snapshotId: string;
  /** Records of the series in the snapshot; `rows` holds the latest of them. */
  records: number;
  unit: string;
  description: string;
  rows: [number, string, string][];
};

/** One period's records of a table as the cross-section read returns them, with the cells of `fields`. */
export type CrossFixture = {
  snapshotId: string;
  fields: string[];
  rows: {
    row: number;
    entityId: string | null;
    entityName: string | null;
    geoCode: string | null;
    geoName: string | null;
    period: string | null;
    cells: (string | null)[];
  }[];
};

export type EnergyFixtures = {
  about: string;
  /** Keyed by `${datasetId}|${MSN}`. */
  mer: Record<string, MerSeriesFixture>;
  /** Keyed by dataset id. */
  rank: Record<string, CrossFixture>;
  /** The dictionary entries the profiles read, as production stores them (positional keys, the publisher's labels). */
  dictionaries: Record<string, { sourceId: string; columns: SourceColumn[] }>;
  /**
   * Records per value of an indexed dimension, counted on production inside one snapshot (the count tiles), keyed by
   * dataset id; the values sum to the snapshot's rows.
   */
  counts?: Record<string, { snapshotId: string; retrievedAt: string; rows: number; dimension: "period" | "geo_code"; values: { value: string; rows: number }[] }>;
  /**
   * Every record of a small table with the cells a count tile reads, keyed by dataset id: [row number, cell] in row
   * order, the cell at `positions` and, where `geo` names that field, also the record's indexed place.
   */
  cells?: Record<string, { snapshotId: string; positions: Record<string, number>; geo?: string; rows: [number, string | null][] }>;
};

type Resolved = { ok: true; profile: Profile; measure: MeasureSpec; columns: SourceColumn[] } | { ok: false; reason: string };

function resolve(spec: SeriesTileSpec | RankTileSpec, fixtures: EnergyFixtures): Resolved {
  const dictionary = fixtures.dictionaries[spec.datasetId];
  if (!dictionary) return { ok: false, reason: `No dictionary for ${spec.datasetId} in the fixtures.` };
  const status = profileStatus({ id: spec.datasetId, source_id: dictionary.sourceId }, dictionary.columns);
  if (status.state === "none") return { ok: false, reason: "No reviewed profile covers this table." };
  if (status.state === "off") return { ok: false, reason: status.reason };
  const measure = measureOf(status.profile, spec.measure);
  if (!measure) return { ok: false, reason: `${spec.measure} is not a measure of the ${status.profile.family} profile.` };
  return { ok: true, profile: status.profile, measure, columns: dictionary.columns };
}

function contextOf(profile: Profile, measure: MeasureSpec, datasetId: string, snapshotId: string, columns: SourceColumn[], cadence: Cadence): TileContext | string {
  let unit: TileContext["unit"];
  if (measure.unit.from === "column") unit = { from: "column" };
  else {
    const reading = unitOf(measure, columns);
    if (!reading.ok) return `The unit cannot be established: ${reading.reason}.`;
    unit = { from: "fixed", text: reading.text };
  }
  return { datasetId, snapshotId, field: measure.field, unit, format: profile.period.format, cadence, markers: measure.markers, grouping: measure.grouping };
}

/** The MSN a MER tile's address fixes. */
export function merKey(spec: SeriesTileSpec): string | null {
  const where = "where" in spec.series && spec.series.where ? spec.series.where : [];
  const msn = where.find((m) => m.field === "MSN");
  return msn ? `${spec.datasetId}|${msn.value}` : null;
}

/** A series tile on its fixture rows, the cells shaped as the board's series read shapes them. */
export function replaySeriesTile(spec: SeriesTileSpec, fixtures: EnergyFixtures): TileResult {
  const resolved = resolve(spec, fixtures);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const key = merKey(spec);
  const series = key ? fixtures.mer[key] : undefined;
  if (!series) return { ok: false, reason: `No fixture rows for ${key ?? spec.id}.` };
  const context = contextOf(resolved.profile, resolved.measure, spec.datasetId, series.snapshotId, resolved.columns, cadenceOf(resolved.profile));
  if (typeof context === "string") return { ok: false, reason: context };
  const cells: CellInput[] = series.rows.map(([row, period, text]) => ({
    row,
    period,
    text,
    unit: resolved.measure.unit.from === "column" ? series.unit : undefined,
    check: spec.subjectCheck ? series.description : undefined,
  }));
  return computeSeriesTile(spec, context, cells);
}

/**
 * A rank tile on its fixture cross-section. `cadence` is the cadence the board computes rankings with: "day", as
 * `board.server.ts` passes it today, unless a caller asks for the profile's own.
 */
export function replayRankTile(spec: RankTileSpec, fixtures: EnergyFixtures, cadence: Cadence | "profile" = "day"): TileResult {
  const resolved = resolve(spec, fixtures);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const table = fixtures.rank[spec.datasetId];
  if (!table) return { ok: false, reason: `No fixture cross-section for ${spec.datasetId}.` };
  const at = table.fields.indexOf(spec.measure);
  if (at === -1) return { ok: false, reason: `The fixture cross-section does not carry ${spec.measure}.` };
  const context = contextOf(
    resolved.profile,
    resolved.measure,
    spec.datasetId,
    table.snapshotId,
    resolved.columns,
    cadence === "profile" ? cadenceOf(resolved.profile) : cadence,
  );
  if (typeof context === "string") return { ok: false, reason: context };
  const periods = table.rows.map((r) => r.period).filter((p): p is string => p !== null);
  const period = spec.across.period === "latest" ? periods.reduce((a, b) => (b > a ? b : a), "") : spec.across.period;
  const by = spec.across.by;
  const cells: RankCellInput[] = table.rows
    .filter((r) => r.period === period)
    .map((r) => {
      const key = by === "entity_id" ? r.entityId : by === "entity_name" ? r.entityName : by === "geo_code" ? r.geoCode : r.geoName;
      return { row: r.row, key: key ?? `row ${r.row}`, name: r.entityName ?? r.geoName, period: r.period, text: r.cells[at] ?? null };
    });
  return computeRankTile(spec, context, cells);
}

/** An energy tile of one series or one ranking on its fixtures; the other forms are replayed by their own tests. */
export function replayTile(spec: TileSpec, fixtures: EnergyFixtures): TileResult {
  if (isRankSpec(spec)) return replayRankTile(spec, fixtures);
  if (isSeriesSpec(spec)) return replaySeriesTile(spec, fixtures);
  return { ok: false, reason: `The ${spec.form} form is replayed with the boards' own compute of that form.` };
}
