/**
 * Tier 2 of the first look, pure: what to read for a profile's measure and series, and how the reads become the
 * cells that `src/lib/sources/boards/compute.ts` turns into a chart. The same rules as the board tiles
 * (`board.server.ts`): fields by label checked against the snapshot, field matches beside an indexed key applied
 * after the read, periods composed from fields where the profile says so, units only as the profile establishes
 * them. Nothing here is read twice or guessed.
 */
import type { CellInput, RankCellInput, TileContext } from "@/lib/sources/boards/compute";
import type { RankTileSpec, SeriesTileSpec } from "@/lib/sources/boards/types";
import {
  addressMatches,
  addressRefusal,
  cadenceOf,
  locateField,
  unitOf,
  type MeasureSpec,
  type Profile,
  type SeriesAddress,
} from "@/lib/sources/profiles";
import type { SourceCrossSection, SourcePoint, SourceSeriesAddress } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import type { LookState } from "./dataset-search";

export type SeriesPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** The address the series read takes. */
      read: SourceSeriesAddress;
      /** The measure's position. */
      measureAt: number;
      /** Every position to read with that address: the measure first, then period, unit and match fields. */
      positions: number[];
      /** Field matches applied to the rows after the read (beside an indexed key). */
      local: { position: number; value: string }[];
    };

function at(columns: readonly SourceColumn[], label: string): number | string {
  const found = locateField(columns, label);
  return found.ok ? found.index : `The field ${label} is ${found.reason === "missing" ? "not in" : "carried twice by"} this version.`;
}

/** The reads one series view needs, or why it cannot be drawn. */
export function seriesPlan(profile: Profile, columns: readonly SourceColumn[], measure: MeasureSpec, address: SeriesAddress): SeriesPlan {
  const refusal = addressRefusal(profile, address);
  if (refusal) return { ok: false, reason: refusal };
  const measureAt = at(columns, measure.field);
  if (typeof measureAt === "string") return { ok: false, reason: measureAt };
  const want: number[] = [];
  const add = (label: string): string | null => {
    const p = at(columns, label);
    if (typeof p === "string") return p;
    if (p !== measureAt && !want.includes(p)) want.push(p);
    return null;
  };
  const local: { position: number; value: string }[] = [];
  let read: SourceSeriesAddress;
  if ("whole" in address) read = { whole: true };
  else {
    const matches = addressMatches(address);
    for (const m of matches) {
      const p = at(columns, m.field);
      if (typeof p === "string") return { ok: false, reason: p };
      if ("by" in address) {
        local.push({ position: p, value: m.value });
        if (p !== measureAt && !want.includes(p)) want.push(p);
      }
    }
    read = "by" in address ? { by: address.by, key: address.key } : { where: matches.map((m) => ({ field: at(columns, m.field) as number, value: m.value })) };
  }
  for (const label of measure.unit.from === "column" ? [measure.unit.column] : []) {
    const r = add(label);
    if (r) return { ok: false, reason: r };
  }
  if (profile.period.from === "field") {
    const r = add(profile.period.field);
    if (r) return { ok: false, reason: r };
  }
  if (profile.period.from === "fields")
    for (const f of profile.period.fields) {
      const r = add(f);
      if (r) return { ok: false, reason: r };
    }
  return { ok: true, read, measureAt, positions: [measureAt, ...want], local };
}

/** Joins the reads of one plan into cells, row by row, in file order. */
export function seriesCells(profile: Profile, columns: readonly SourceColumn[], measure: MeasureSpec, plan: Extract<SeriesPlan, { ok: true }>, reads: Map<number, SourcePoint[]>): CellInput[] {
  const byPos = new Map<number, Map<number, SourcePoint>>();
  for (const [pos, points] of reads) byPos.set(pos, new Map(points.map((p) => [p.row, p])));
  const cell = (pos: number, row: number) => byPos.get(pos)?.get(row)?.text ?? null;
  const out: CellInput[] = [];
  for (const point of reads.get(plan.measureAt) ?? []) {
    if (plan.local.some((m) => cell(m.position, point.row) !== m.value)) continue;
    let period = point.period;
    if (profile.period.from === "field") period = cell(locateIndex(columns, profile.period.field), point.row);
    if (profile.period.from === "fields") {
      const composed = profile.period.compose(profile.period.fields.map((f) => cell(locateIndex(columns, f), point.row)));
      period = composed ? composed.text : null;
    }
    out.push({
      row: point.row,
      period,
      text: point.text,
      unit: measure.unit.from === "column" ? cell(locateIndex(columns, measure.unit.column), point.row) : undefined,
    });
  }
  return out;
}

function locateIndex(columns: readonly SourceColumn[], label: string): number {
  const found = locateField(columns, label);
  return found.ok ? found.index : -1;
}

/** The context a tile computation needs, or why the unit cannot be established. */
export function tileContext(
  profile: Profile,
  measure: MeasureSpec,
  datasetId: string,
  snapshotId: string,
  columns: readonly SourceColumn[],
): { ok: true; context: TileContext; unit: string | null } | { ok: false; reason: string } {
  let unit: TileContext["unit"];
  let text: string | null = null;
  if (measure.unit.from === "column") unit = { from: "column" };
  else {
    const reading = unitOf(measure, columns);
    if (!reading.ok) return { ok: false, reason: `The unit cannot be established: ${reading.reason}.` };
    unit = { from: "fixed", text: reading.text };
    text = reading.text;
  }
  return {
    ok: true,
    unit: text,
    context: {
      datasetId,
      snapshotId,
      field: measure.field,
      unit,
      format: profile.period.format,
      cadence: cadenceOf(profile),
      markers: measure.markers,
      grouping: measure.grouping,
    },
  };
}

/** A level view of one series as a tile spec, so the board's computation draws it. */
export function levelSpec(datasetId: string, collection: string, measure: MeasureSpec, address: SeriesAddress, unit: string): SeriesTileSpec {
  return {
    id: `look:${datasetId}`,
    collection,
    datasetId,
    measure: measure.field,
    subject: measure.label,
    unit,
    form: "line",
    transform: "level",
    headline: "level",
    series: address,
    window: 100_000,
  } as SeriesTileSpec;
}

/** A ranking of one period across entities or places as a tile spec. */
export function rankSpec(datasetId: string, collection: string, measure: MeasureSpec, by: "entity_id" | "entity_name" | "geo_code" | "geo_name", unit: string, top: number): RankTileSpec {
  return {
    id: `look-rank:${datasetId}`,
    collection,
    datasetId,
    measure: measure.field,
    subject: measure.label,
    unit,
    form: "ranked-bars",
    transform: "rank",
    headline: "rank",
    across: { by, period: "latest", top },
  } as RankTileSpec;
}

/** Cross-section rows as rank cells, keyed by the profile's dimension. */
export function rankCells(cross: SourceCrossSection, by: "entity_id" | "entity_name" | "geo_code" | "geo_name"): RankCellInput[] {
  return cross.rows.map((r) => {
    const key = by === "entity_id" ? r.entityId : by === "entity_name" ? r.entityName : by === "geo_code" ? r.geoCode : r.geoName;
    return { row: r.row, key: key ?? `row ${r.row}`, name: r.entityName ?? r.geoName, period: cross.period, text: r.text };
  });
}

/**
 * The series a view opens on: the address the look state names (a key of the profile's indexed dimension, or a
 * value of its first match field, with the profile's fixed fields), else the profile's default.
 */
export function chosenAddress(profile: Profile, datasetId: string, sourceId: string | null, look: LookState | undefined): SeriesAddress | null {
  const fallback = profile.defaultSeries?.({ id: datasetId, source_id: sourceId }) ?? null;
  const key = look?.s;
  if (!key) return fallback;
  const fixed = profile.fixed ?? [];
  if (profile.addressing.by) return { by: profile.addressing.by, key, where: fixed.length ? fixed : undefined } as SeriesAddress;
  const field = profile.addressing.where[0];
  if (field) return { where: [{ field, value: key }, ...fixed] };
  return fallback;
}

/** The measure the look state names by label, else the profile's first. */
export function chosenMeasure(profile: Profile, look: LookState | undefined): MeasureSpec {
  return profile.measures.find((m) => m.field === look?.m) ?? profile.measures[0];
}

/** Points of the last N years of a dated series ("all": every point). */
export function lastYears<T extends { date?: string }>(points: readonly T[], range: "5y" | "10y" | "all"): T[] {
  if (range === "all" || !points.length) return [...points];
  const last = points[points.length - 1].date;
  if (!last) return [...points];
  const years = range === "5y" ? 5 : 10;
  const from = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
  return points.filter((p) => !p.date || p.date > from);
}
