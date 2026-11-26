/**
 * Computes a board on the server: for each tile, the dataset's published snapshot, its profile, the rows
 * of the tile's series through the direct reads of `read.server.ts` (bounded selects with the member's own
 * client), then `compute.ts`. A computed tile is kept in this process per snapshot: a snapshot is immutable,
 * so the figures of a pinned snapshot never change; only the dataset's pointer to its latest snapshot is
 * looked up again after ten minutes.
 *
 * Cost of a cold tile: one select for the dataset with its snapshot and dictionary (the latest-snapshot
 * relation), then the pages of one series read that carries the measure and every field beside it, or a
 * cross-section. The dictionary is read once and handed to the reads. Callers that ask for the same dataset
 * or tile at the same time share one read and one computation.
 */
import { describeDataset } from "../catalog";
import { addressMatches, addressRefusal, cadenceOf, locateField, measureOf, profileStatus, unitOf } from "../profiles";
import type { FieldMatch, IndexedDimension, MeasureSpec, Profile, SeriesAddress } from "../profiles/types";
import { parsePeriod, type PeriodFormat } from "../periods";
import { hasDimension, readSourceFacets, readSourceSeriesFields, type SourceDirectClient, type SourceSnapshotKnown } from "../read.server";
import { READ_LIMITS, SERIES_SURE_LIMIT, type SourceCellMatch, type SourceFacets, type SourceSeriesAddress } from "../read-types";
import type { SourceColumn, SourceIngest } from "../schema";
import { computeRankTile, computeSeriesTile, periodId, yearEarlierId, type CellInput, type RankCellInput, type TileContext, type WholeTable } from "./compute";
import {
  computeCompareTile,
  computeCurveTile,
  computeDistributionTile,
  computeMapTile,
  computeMixTile,
  computeRecordsTile,
  computeStatTile,
  yearEarlierText,
  type CountInput,
  type LineInput,
} from "./compute-forms";
import { boardSpec, tileSpec } from "./specs";
import type { Board, BoardRead, BoardTile, Cadence, CrossSpec, SeriesTileSpec, TileResult, TileSeriesSpec, TileSource, TileSpec } from "./types";

type DatasetMeta = {
  dataset: { id: string; source_id: string | null; name: string; sector: string; agency: string; source_url: string | null; grain: string };
  snapshot: { id: string; columns: SourceColumn[]; ingest: SourceIngest; retrievedAt: string | null; publishedAt: string | null; rows: number; fields: number; fileSha256: string };
};

type Outcome = { tile: BoardTile } | { refused: { id: string; title: string; reason: string } };

const META_TTL_MS = 10 * 60_000;
const TILE_CACHE_LIMIT = 400;
/** Series longer than this are not read for a tile (five pages of 1,000 rows per call, one row kept to tell the end). */
const SERIES_ROW_LIMIT = SERIES_SURE_LIMIT;

const metaCache = new Map<string, { at: number; meta: DatasetMeta }>();
const tileCache = new Map<string, Outcome>();
/** Reads and computations in progress, shared by callers that ask for the same dataset or tile meanwhile. */
const metaFlight = new Map<string, Promise<DatasetMeta>>();
const tileFlight = new Map<string, Promise<Outcome>>();

/** Forgets every cached dataset pointer and tile (tests). */
export function resetBoardCache() {
  metaCache.clear();
  tileCache.clear();
  metaFlight.clear();
  tileFlight.clear();
}

class TileStop extends Error {}
const stop = (reason: string): never => {
  throw new TileStop(reason);
};

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

const DATASET_COLUMNS = "id,source_id,latest_snapshot_id,name,sector,agency,source_url,grain";
const SNAPSHOT_COLUMNS = "id,dataset_id,status,columns,ingest,retrieved_at,published_at,loaded_rows,column_count,file_sha256";
/** The dataset with its published snapshot and that snapshot's dictionary, in one select. */
export const BOARD_DATASET_SELECT = `${DATASET_COLUMNS},latest:source_snapshots!source_datasets_latest_fk(${SNAPSHOT_COLUMNS})`;

const count = (v: unknown): number => (typeof v === "number" ? v : Number(v));

function datasetOf(datasetId: string, row: Record<string, unknown>): DatasetMeta["dataset"] {
  return {
    id: datasetId,
    source_id: text(row.source_id),
    name: text(row.name) ?? datasetId,
    sector: text(row.sector) ?? "",
    agency: text(row.agency) ?? "",
    source_url: text(row.source_url),
    grain: text(row.grain) ?? "",
  };
}

async function datasetRow(db: SourceDirectClient, datasetId: string, columns: string): Promise<Record<string, unknown> | undefined> {
  const ds = await db.from("source_datasets").select(columns).eq("id", datasetId).limit(1);
  if (ds.error) stop(`The dataset could not be read (${ds.error.message}).`);
  return Array.isArray(ds.data) ? (ds.data[0] as Record<string, unknown> | undefined) : undefined;
}

/**
 * The dataset and its published snapshot with the dictionary: one select. After ten minutes the pointer alone is
 * read again (one small select) and the dictionary kept while the pointer names the same snapshot.
 */
async function datasetMeta(db: SourceDirectClient, datasetId: string, now: number): Promise<DatasetMeta> {
  const stale = metaCache.get(datasetId);
  if (stale) {
    const row = await datasetRow(db, datasetId, DATASET_COLUMNS);
    if (!row || !text(row.latest_snapshot_id)) stop("The dataset has no published snapshot.");
    if (text(row!.latest_snapshot_id) === stale.meta.snapshot.id) {
      const meta: DatasetMeta = { dataset: datasetOf(datasetId, row!), snapshot: stale.meta.snapshot };
      metaCache.set(datasetId, { at: now, meta });
      return meta;
    }
  }
  const row = await datasetRow(db, datasetId, BOARD_DATASET_SELECT);
  const snapshotId = text(row?.latest_snapshot_id);
  if (!row || !snapshotId) stop("The dataset has no published snapshot.");
  const snap = row!.latest && typeof row!.latest === "object" ? (row!.latest as Record<string, unknown>) : undefined;
  if (!snap || snap.id !== snapshotId || snap.dataset_id !== datasetId || snap.status !== "ready") stop("The dataset has no published snapshot.");
  if (!Array.isArray(snap!.columns)) stop("The published snapshot has no field dictionary.");
  const meta: DatasetMeta = {
    dataset: datasetOf(datasetId, row!),
    snapshot: {
      id: snapshotId as string,
      columns: snap!.columns as SourceColumn[],
      ingest: (snap!.ingest && typeof snap!.ingest === "object" ? snap!.ingest : {}) as SourceIngest,
      retrievedAt: text(snap!.retrieved_at),
      publishedAt: text(snap!.published_at),
      rows: count(snap!.loaded_rows),
      fields: count(snap!.column_count),
      fileSha256: text(snap!.file_sha256) ?? "",
    },
  };
  metaCache.set(datasetId, { at: now, meta });
  return meta;
}

/** `datasetMeta` with one read in flight per dataset; a fresh cached pointer answers without a select. */
function sharedMeta(db: SourceDirectClient, datasetId: string, now: number): Promise<DatasetMeta> {
  const hit = metaCache.get(datasetId);
  if (hit && now - hit.at < META_TTL_MS) return Promise.resolve(hit.meta);
  let flight = metaFlight.get(datasetId);
  if (!flight) {
    flight = datasetMeta(db, datasetId, now).finally(() => metaFlight.delete(datasetId));
    metaFlight.set(datasetId, flight);
  }
  return flight;
}

/** The snapshot as the reads take it, so they do not select it or its dictionary again. */
function known(meta: DatasetMeta): SourceSnapshotKnown {
  const s = meta.snapshot;
  return {
    ref: { datasetId: meta.dataset.id, snapshotId: s.id, publishedAt: s.publishedAt, retrievedAt: s.retrievedAt, fileSha256: s.fileSha256, rows: s.rows, fields: s.fields },
    columns: s.columns,
    ingest: s.ingest,
  };
}

function sourceOf(meta: DatasetMeta): TileSource {
  const entry = describeDataset({ ...meta.dataset, rows: meta.snapshot.rows, retrieved_at: meta.snapshot.retrievedAt });
  const publisher = entry.publisher.via ? `${entry.publisher.short} via ${entry.publisher.via}` : entry.publisher.short;
  // "FDIC, Current quarter, June 2026 cohort" under the publisher "FDIC" reads "FDIC, FDIC, ...": say it once.
  const short = entry.publisher.short;
  const table = entry.title.startsWith(`${short}, `) ? entry.title.slice(short.length + 2) : entry.title;
  return {
    datasetId: meta.dataset.id,
    snapshotId: meta.snapshot.id,
    publisher,
    table,
    code: entry.code,
    retrievedAt: meta.snapshot.retrievedAt,
    publishedAt: meta.snapshot.publishedAt,
  };
}

function position(columns: readonly SourceColumn[], label: string): number {
  const found = locateField(columns, label);
  if (!found.ok) stop(`The field ${label} is ${found.reason === "missing" ? "not in" : "carried twice by"} this version.`);
  return (found as { index: number }).index;
}

/** The reads' address for a profile address: labels become positions; field matches beside a key are applied here. */
function readAddress(columns: readonly SourceColumn[], address: SeriesAddress): { read: SourceSeriesAddress; local: { position: number; value: string }[] } {
  if ("whole" in address) return { read: { whole: true }, local: [] };
  const matches = addressMatches(address).map((m) => ({ position: position(columns, m.field), value: m.value }));
  if ("by" in address) return { read: { by: address.by, key: address.key }, local: matches };
  const where: SourceCellMatch[] = matches.map((m) => ({ field: m.position, value: m.value }));
  return { read: { where }, local: [] };
}

function contextFor(profile: Profile, measure: MeasureSpec, meta: DatasetMeta, cadence = cadenceOf(profile)): TileContext {
  let unit: TileContext["unit"];
  if (measure.unit.from === "column") unit = { from: "column" };
  else {
    const reading = unitOf(measure, meta.snapshot.columns);
    if (!reading.ok) stop(`The unit cannot be established: ${reading.reason}.`);
    unit = { from: "fixed", text: (reading as { text: string }).text };
  }
  return {
    datasetId: meta.dataset.id,
    snapshotId: meta.snapshot.id,
    field: measure.field,
    unit,
    format: profile.period.format,
    cadence,
    markers: measure.markers,
    grouping: measure.grouping,
    padding: measure.padding,
  };
}

/** A whole-snapshot series of a profile that reads its latest rows (a FRED daily file) reads this many from the end. */
function lastRows(profile: Profile, address: SeriesAddress, window: number): number | undefined {
  return profile.addressing.scan === "latest" && "whole" in address ? Math.max(1, Math.min(SERIES_ROW_LIMIT, window)) : undefined;
}

/**
 * The records of one series as cells: the measure and every field beside it (its unit column, a subject check, the
 * fields of a composed period, the field matches applied after a keyed read) on the same selects.
 */
async function lineCells(
  db: SourceDirectClient,
  meta: DatasetMeta,
  profile: Profile,
  measure: MeasureSpec,
  address: SeriesAddress,
  check: FieldMatch | undefined,
  last: number | undefined,
): Promise<CellInput[]> {
  const columns = meta.snapshot.columns;
  const refusal = addressRefusal(profile, address);
  if (refusal) stop(refusal);
  const { read, local } = readAddress(columns, address);
  const measureAt = position(columns, measure.field);
  const want = new Set<number>();
  if (measure.unit.from === "column") want.add(position(columns, measure.unit.column));
  if (check) want.add(position(columns, check.field));
  if (profile.period.from === "field") want.add(position(columns, profile.period.field));
  if (profile.period.from === "fields") for (const f of profile.period.fields) want.add(position(columns, f));
  for (const m of local) want.add(m.position);
  want.delete(measureAt);

  // the measure and every field beside it on the same selects
  const fields = [measureAt, ...want];
  const got = await readSourceSeriesFields(
    db,
    { datasetId: meta.dataset.id, snapshotId: meta.snapshot.id, fields, address: read, limit: last ?? SERIES_ROW_LIMIT, ...(last !== undefined ? { last } : {}) },
    known(meta),
  );
  if (!got.ok) stop(got.reason === "unavailable" ? "The series read is not available yet." : got.message);
  const series = got.ok ? got.data : null;
  if (!series) return [];
  if (series.next !== null && last === undefined) stop(`The series has more than ${SERIES_ROW_LIMIT.toLocaleString("en-US")} records; a tile reads at most that many.`);
  const slot = new Map(fields.map((at, i) => [at, i] as const));
  const cells: CellInput[] = [];
  for (const point of series.points) {
    const cellAt = (at: number) => point.cells[slot.get(at) ?? -1] ?? null;
    if (local.some((m) => cellAt(m.position) !== m.value)) continue;
    let period = point.period;
    if (profile.period.from === "field") period = cellAt(position(columns, profile.period.field));
    if (profile.period.from === "fields") {
      const composed = profile.period.compose(profile.period.fields.map((f) => cellAt(position(columns, f))));
      period = composed ? composed.text : null;
    }
    cells.push({
      row: point.row,
      period,
      text: cellAt(measureAt),
      unit: measure.unit.from === "column" ? cellAt(position(columns, measure.unit.column)) : undefined,
      check: check ? cellAt(position(columns, check.field)) : undefined,
    });
  }
  if (series.points.length > 0 && cells.length === 0 && local.length)
    stop(`None of the ${series.points.length.toLocaleString("en-US")} records read has ${addressMatches(address).map((m) => `${m.field} "${m.value}"`).join(" and ")}.`);
  return cells;
}

// ---------------------------------------------------------------- cross-sections

/** Pages of one period (or of a whole small table) a cross-section reads at most, of 1,000 records each. */
export const CROSS_PAGES = 5;
/** Probes of the period index a "latest" period takes at most, from the greatest period string down. */
export const LATEST_PROBES = 5;

/** A period of the index that is not of the declared format: its text and the records that carry it. */
export type SkippedPeriod = { period: string; records: number; atLeast: boolean };

export type CrossRead = {
  /** The period read, as stored; null for a whole table. */
  period: string | null;
  cells: RankCellInput[];
  /** Greater period strings passed over because they are not of the declared format, with their records counted. */
  skipped: SkippedPeriod[];
  /** True when the whole table was read (a snapshot without a period dimension). */
  table: boolean;
  /** The period the fields composed, for a profile whose period is composed (the records' `period` holds its text). */
  composed?: { text: string; format: PeriodFormat; cadence: Cadence };
};

const cellPath = (at: number) => `values->>${at}`;
const rowOf = (r: Record<string, unknown>) => (typeof r.row_number === "number" ? r.row_number : Number(r.row_number));

async function selectRows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Record<string, unknown>[]> {
  const got = await q;
  if (got.error) stop(`The records could not be read (${got.error.message}).`);
  return Array.isArray(got.data) ? (got.data as Record<string, unknown>[]) : [];
}

/**
 * The greatest period of the index that is of the declared format: probes from the greatest period string down,
 * passing over strings that do not parse (a publisher's footer stored as a record), each counted with one select of
 * its records. A format whose strings do not sort as their dates (text) has no latest period.
 */
export async function latestParsedPeriod(
  db: SourceDirectClient,
  snapshotId: string,
  format: PeriodFormat,
): Promise<{ period: string; skipped: SkippedPeriod[] }> {
  if (format === "text") stop("The period of this table is text: no period is the latest.");
  const skipped: SkippedPeriod[] = [];
  let below: string | null = null;
  for (let probe = 0; probe < LATEST_PROBES; probe += 1) {
    let q = db.from("source_records").select("row_number,period").eq("snapshot_id", snapshotId).not("period", "is", null);
    if (below !== null) q = q.lt("period", below);
    const found = await selectRows(q.order("period", { ascending: false }).order("row_number", { ascending: false }).limit(1));
    const value = typeof found[0]?.period === "string" ? (found[0].period as string) : null;
    if (value === null) break;
    if (parsePeriod(value, format)) return { period: value, skipped };
    const of = await selectRows(db.from("source_records").select("row_number").eq("snapshot_id", snapshotId).eq("period", value).order("row_number", { ascending: true }).limit(READ_LIMITS.page));
    skipped.push({ period: value, records: of.length, atLeast: of.length >= READ_LIMITS.page });
    below = value;
  }
  stop(
    skipped.length
      ? `No period of the declared format (${format}) among the ${skipped.length} greatest periods of the index (${skipped.map((s) => `"${s.period.slice(0, 40)}"`).join(", ")}).`
      : "The table has no period to read.",
  );
  throw new Error("unreachable");
}

/**
 * One period across entities or places, or a whole small table, in at most five selects of 1,000 records in row
 * order, complete only when it ends inside them. Field matches filter inside the select on a snapshot of at most
 * 50,000 records and after the read above that. `fields` are read beside the measure (`values->>N` paths).
 */
/**
 * A period composed from fields of the record (FHFA: the store's period is the year, the quarter or month is a field):
 * the fields' positions and the profile's compose. The period index is then read as years.
 */
export type ComposedPeriod = {
  positions: readonly number[];
  compose(cells: readonly (string | null)[]): { text: string; format: PeriodFormat } | null;
  /** Keep only the records of this composed period (its identity under the cadence), for a year-earlier read. */
  pick?: { id: string; cadence: Cadence };
};

const cadenceOfComposed = (format: PeriodFormat): Cadence => (format === "quarter" ? "quarter" : format === "year" ? "year" : format === "yyyy-mm" || format === "yyyymm" ? "month" : "day");

export async function crossRead(
  db: SourceDirectClient,
  meta: { snapshotId: string; rows: number; columns: readonly SourceColumn[]; ingest: SourceIngest },
  across: CrossSpec,
  fields: readonly number[],
  format: PeriodFormat | null,
  composed?: ComposedPeriod,
): Promise<CrossRead> {
  const table = across.period === "table";
  const periodic = hasDimension(meta.ingest, "period");
  let period: string | null = null;
  let skipped: SkippedPeriod[] = [];
  if (table) {
    if (periodic) stop("The table has periods; a whole table is read only when it has none.");
  } else if (!periodic) {
    stop("The table has no period dimension; a tile reads a whole small table with the period \"table\".");
  } else if (across.period === "latest") {
    const probe = composed ? "year" : format;
    if (!probe) stop("The period format of this table is not declared, so no period is the latest.");
    ({ period, skipped } = await latestParsedPeriod(db, meta.snapshotId, probe!));
  } else period = across.period;

  const matches = (across.where ?? []).map((m) => ({ position: position(meta.columns, m.field), value: m.value }));
  const inSelect = meta.rows <= READ_LIMITS.cellFilterRows;
  const labelAt = across.labelWith ? position(meta.columns, across.labelWith) : null;
  const extra = [...new Set([...fields, ...(inSelect ? [] : matches.map((m) => m.position)), ...(composed?.positions ?? []), ...(labelAt !== null ? [labelAt] : [])])];
  const select = `row_number,period,entity_id,entity_name,geo_code,geo_name${extra.map((at, i) => `,c${i}:${cellPath(at)}`).join("")}`;
  const slot = new Map(extra.map((at, i) => [at, `c${i}`] as const));
  const base = () => {
    let q = db.from("source_records").select(select).eq("snapshot_id", meta.snapshotId);
    if (period !== null) q = q.eq("period", period);
    if (inSelect) for (const m of matches) q = q.eq(cellPath(m.position), m.value);
    return q;
  };
  const got: Record<string, unknown>[] = [];
  let after = 0;
  let complete = false;
  for (let page = 0; page < CROSS_PAGES; page += 1) {
    const rows = await selectRows(base().gt("row_number", after).order("row_number", { ascending: true }).limit(READ_LIMITS.page));
    got.push(...rows);
    if (rows.length < READ_LIMITS.page) {
      complete = true;
      break;
    }
    after = rowOf(rows[rows.length - 1]);
  }
  if (!complete) {
    const more = await selectRows(base().gt("row_number", after).order("row_number", { ascending: true }).limit(1));
    if (more.length > 0)
      stop(`${table ? "The table" : `The period ${period}`} has more than ${(CROSS_PAGES * READ_LIMITS.page).toLocaleString("en-US")} records; a part is never ranked or drawn as the whole.`);
  }
  const key = (r: Record<string, unknown>) => {
    const v = across.by === "entity_id" ? r.entity_id : across.by === "entity_name" ? r.entity_name : across.by === "geo_code" ? r.geo_code : r.geo_name;
    return typeof v === "string" ? v : null;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const cells: (RankCellInput & { composed?: { text: string; format: PeriodFormat } | null })[] = [];
  for (const r of got) {
    if (!inSelect && matches.some((m) => str(r[slot.get(m.position)!]) !== m.value)) continue;
    const row = rowOf(r);
    const made = composed ? composed.compose(composed.positions.map((at) => str(r[slot.get(at)!]))) : undefined;
    const stored = str(r.entity_name) ?? str(r.geo_name);
    const qualifier = labelAt !== null ? str(r[slot.get(labelAt)!]) : null;
    cells.push({
      row,
      key: key(r) ?? `row ${row}`,
      // "Harrison, MO": a qualifier only beside a stored name, so a name from a state code stays the state's
      name: stored && qualifier && qualifier.trim() ? `${stored}, ${qualifier.trim()}` : stored,
      period: made ? made.text : made === null ? null : str(r.period),
      text: fields.length ? str(r[slot.get(fields[0])!]) : null,
      unit: fields.length > 1 ? str(r[slot.get(fields[1])!]) : undefined,
      check: fields.length > 2 ? str(r[slot.get(fields[2])!]) : undefined,
      ...(composed ? { composed: made ?? null } : {}),
    });
  }
  if (!composed) return { period, cells, skipped, table };

  // One composed period: the greatest of the year read (latest), the one picked (a year earlier), or the only one.
  const unplaced = cells.filter((c) => !c.composed);
  if (unplaced.length) skipped = [...skipped, { period: `${period ?? ""}, without a period the fields compose`, records: unplaced.length, atLeast: false }];
  const placed = cells.filter((c) => c.composed).map((c) => ({ c, parsed: parsePeriod(c.composed!.text, c.composed!.format) }));
  const ok = placed.filter((x): x is { c: (typeof cells)[number]; parsed: NonNullable<typeof x.parsed> } => x.parsed !== null);
  if (!ok.length) stop(`No record of ${period ?? "the table"} has a period the fields compose.`);
  let keepText: string;
  if (composed.pick) {
    const hit = ok.find((x) => periodId(x.parsed.start, composed.pick!.cadence) === composed.pick!.id);
    if (!hit) stop(`No record of ${period} is of the period a year earlier.`);
    keepText = hit!.c.composed!.text;
  } else if (across.period === "latest") {
    keepText = ok.reduce((best, x) => (x.parsed.order > best.parsed.order ? x : best), ok[0]).c.composed!.text;
  } else {
    const texts = [...new Set(ok.map((x) => x.c.composed!.text))];
    if (texts.length > 1) stop(`The records of ${period} hold ${texts.length} periods (${texts.slice(0, 4).join(", ")}); a field match must name one.`);
    keepText = texts[0];
  }
  const kept = ok.filter((x) => x.c.composed!.text === keepText).map((x) => x.c);
  const keptFormat = kept[0].composed!.format;
  return { period, cells: kept.map(({ composed: _c, ...rest }) => rest), skipped, table, composed: { text: keepText, format: keptFormat, cadence: cadenceOfComposed(keptFormat) } };
}

/** The composed period of a profile whose period is made of fields, for a cross-section read. */
function composedOf(profile: Profile, meta: DatasetMeta): ComposedPeriod | undefined {
  if (profile.period.from !== "fields") return undefined;
  const p = profile.period;
  return { positions: p.fields.map((f) => position(meta.snapshot.columns, f)), compose: (cells) => p.compose(cells) };
}

/** The measure, its unit column and a subject check as the fields of a cross-section, in that order. */
function crossFields(meta: DatasetMeta, measure: MeasureSpec, check: FieldMatch | undefined): number[] {
  const out = [position(meta.snapshot.columns, measure.field)];
  const unitAt = measure.unit.from === "column" ? position(meta.snapshot.columns, measure.unit.column) : null;
  const checkAt = check ? position(meta.snapshot.columns, check.field) : null;
  if (unitAt !== null || checkAt !== null) out.push(unitAt ?? out[0]);
  if (checkAt !== null) out.push(checkAt);
  return out;
}

/** A cross-section's cells with the unit and check cells only where the profile and the spec read them. */
function crossCells(read: CrossRead, measure: MeasureSpec, check: FieldMatch | undefined): RankCellInput[] {
  return read.cells.map((c) => ({ ...c, unit: measure.unit.from === "column" ? c.unit : undefined, check: check ? c.check : undefined }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-24T09:58:23Z" as "24 Nov 2026" (UTC): the day the stored copy was retrieved. */
export function retrievedDay(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

function wholeTable(meta: DatasetMeta, read: CrossRead): WholeTable | undefined {
  return read.table ? { retrieved: retrievedDay(meta.snapshot.retrievedAt) ?? "an unknown day" } : undefined;
}

/** The caption a tile adds when "latest" passed over periods that are not of the declared format. */
function skippedNote(skipped: readonly SkippedPeriod[]): string | null {
  if (!skipped.length) return null;
  return skipped
    .map((s) => `${s.atLeast ? "At least " : ""}${s.records.toLocaleString("en-US")} ${s.records === 1 && !s.atLeast ? "record" : "records"} whose period reads "${s.period.slice(0, 60)}" ${s.records === 1 && !s.atLeast ? "is" : "are"} not of the declared format and left out.`)
    .join(" ");
}

// ---------------------------------------------------------------- counts

/** Facet calls a count tile pages through at most (each up to 1,000 values and the function's own scan cap). */
export const FACET_PAGES = 5;

/**
 * The store's counts of one indexed dimension, paged by value (`nextAfter`) through at most five calls of 1,000 values:
 * complete only when the last call is, and exact only where every value is.
 */
async function facetCounts(db: SourceDirectClient, meta: DatasetMeta, dimension: IndexedDimension | "period"): Promise<CountInput> {
  const values: SourceFacets["values"] = [];
  let after: string | undefined;
  for (let page = 0; page < FACET_PAGES; page += 1) {
    const got = await readSourceFacets(db, { datasetId: meta.dataset.id, snapshotId: meta.snapshot.id, dimension, limit: READ_LIMITS.page, ...(after !== undefined ? { after } : {}) });
    if (!got.ok) stop(got.reason === "unavailable" ? "The store's counts are not available yet." : got.message);
    const data = (got as { data: SourceFacets }).data;
    values.push(...data.values);
    if (data.complete || data.nextAfter === null) return { from: "facets", values, complete: data.complete || data.nextAfter === null };
    after = data.nextAfter;
  }
  return { from: "facets", values, complete: false };
}

async function cellCounts(db: SourceDirectClient, meta: DatasetMeta, field: string): Promise<CountInput> {
  if (meta.snapshot.rows > SERIES_ROW_LIMIT)
    stop(`The table has ${meta.snapshot.rows.toLocaleString("en-US")} records; a count by a cell reads a whole table of at most ${SERIES_ROW_LIMIT.toLocaleString("en-US")}.`);
  const at = position(meta.snapshot.columns, field);
  const got = await readSourceSeriesFields(db, { datasetId: meta.dataset.id, snapshotId: meta.snapshot.id, fields: [at], address: { whole: true }, limit: SERIES_ROW_LIMIT }, known(meta));
  if (!got.ok) stop(got.reason === "unavailable" ? "The table read is not available yet." : got.message);
  const data = (got as { data: { points: { cells: (string | null)[] }[]; next: number | null } }).data;
  if (data.next !== null) stop(`The table has more than ${SERIES_ROW_LIMIT.toLocaleString("en-US")} records.`);
  return { from: "cells", cells: data.points.map((p) => p.cells[0] ?? null) };
}

// ---------------------------------------------------------------- tiles

/** The rows behind a tile's chart, for its "Open records" link. */
export function selectionOf(spec: TileSpec): BoardTile["selection"] {
  if (spec.transform === "records") return { records: spec.per };
  if (spec.transform === "rank") return { across: spec.across };
  if (spec.form === "map" || spec.form === "distribution") return { across: spec.across };
  const line = (l: TileSeriesSpec) => ({ datasetId: l.datasetId ?? spec.datasetId, series: l.series });
  if (spec.form === "compare") return { lines: spec.lines.map(line) };
  if (spec.form === "mix") return { lines: [line(spec.whole), ...spec.parts.map(line)] };
  if (spec.form === "curve") return { lines: spec.categories.map(line) };
  return { series: spec.series };
}

/** The datasets a tile reads: its own first, then those its series name, each once. */
export function datasetsOf(spec: TileSpec): string[] {
  const ids = [spec.datasetId];
  const add = (l: TileSeriesSpec) => {
    const id = l.datasetId ?? spec.datasetId;
    if (!ids.includes(id)) ids.push(id);
  };
  if (spec.transform !== "records" && spec.form === "compare") spec.lines.forEach(add);
  if (spec.transform !== "records" && spec.form === "mix") [spec.whole, ...spec.parts].forEach(add);
  if (spec.transform !== "records" && spec.form === "curve") spec.categories.forEach(add);
  return ids;
}

function boardTile(spec: TileSpec, source: TileSource, result: TileResult): BoardTile {
  return {
    id: spec.id,
    title: spec.title,
    form: spec.form,
    transform: spec.transform,
    note: spec.note,
    ...(spec.section ? { section: spec.section } : {}),
    ...(spec.size ? { size: spec.size } : {}),
    selection: selectionOf(spec),
    source,
    result,
  };
}

/** The profile and measure a tile reads on one dataset, or a stop with the reason. */
function profiled(meta: DatasetMeta, field: string): { profile: Profile; measure: MeasureSpec } {
  const status = profileStatus({ ...meta.dataset, retrievedAt: meta.snapshot.retrievedAt }, meta.snapshot.columns);
  if (status.state === "none") stop("No reviewed profile covers this table.");
  if (status.state === "off") stop(status.reason);
  const profile = (status as { profile: Profile }).profile;
  const measure = measureOf(profile, field);
  if (!measure) stop(`${field} is not a measure of the ${profile.family} profile.`);
  return { profile, measure: measure! };
}

/** One series of a multi-series tile: its dataset's profile, context and cells. */
async function lineInput(db: SourceDirectClient, metas: Map<string, DatasetMeta>, spec: TileSpec & { datasetId: string; measure: string }, line: TileSeriesSpec, window: number): Promise<LineInput> {
  const meta = metas.get(line.datasetId ?? spec.datasetId)!;
  const { profile, measure } = profiled(meta, line.measure ?? spec.measure);
  const context = contextFor(profile, measure, meta);
  return { context, cells: await lineCells(db, meta, profile, measure, line.series, line.subjectCheck, lastRows(profile, line.series, window)) };
}

async function computeOne(db: SourceDirectClient, spec: TileSpec, metas: Map<string, DatasetMeta>): Promise<TileResult> {
  const meta = metas.get(spec.datasetId)!;
  if (spec.transform === "records") {
    const per = spec.per;
    const input = "field" in per ? await cellCounts(db, meta, per.field) : await facetCounts(db, meta, per.dimension);
    return computeRecordsTile(spec, input, { datasetId: meta.dataset.id, snapshotId: meta.snapshot.id, retrieved: retrievedDay(meta.snapshot.retrievedAt) });
  }
  if (spec.form === "compare") {
    const lines: LineInput[] = [];
    for (const line of spec.lines) lines.push(await lineInput(db, metas, spec, line, spec.window));
    return computeCompareTile(spec, lines);
  }
  if (spec.form === "mix") {
    const whole = await lineInput(db, metas, spec, spec.whole, spec.window);
    const parts: LineInput[] = [];
    for (const part of spec.parts) parts.push(await lineInput(db, metas, spec, part, spec.window));
    return computeMixTile(spec, whole, parts);
  }
  if (spec.form === "curve") {
    const categories: LineInput[] = [];
    for (const c of spec.categories) categories.push(await lineInput(db, metas, spec, c, ALL_ROWS));
    return computeCurveTile(spec, categories);
  }
  const { profile, measure } = profiled(meta, spec.measure);
  if (spec.form === "map" || spec.form === "distribution" || spec.transform === "rank") {
    // the profile's cadence names the period ("in Oct 2026"); a report date that does not open its period names the day
    const context = contextFor(profile, measure, meta, cadenceOf(profile));
    const fields = crossFields(meta, measure, spec.subjectCheck);
    const snap = { snapshotId: meta.snapshot.id, rows: meta.snapshot.rows, columns: meta.snapshot.columns, ingest: meta.snapshot.ingest };
    const format = profile.period.from === "dimension" ? profile.period.format : null;
    const composed = composedOf(profile, meta);
    const read = await crossRead(db, snap, spec.across, fields, format, composed);
    const cells = crossCells(read, measure, spec.subjectCheck);
    const table = wholeTable(meta, read);
    // a composed period is read in its own format and cadence ("Q2 2026")
    const ctx = read.composed ? { ...context, format: read.composed.format, cadence: read.composed.cadence } : context;
    let result: TileResult;
    if (spec.transform === "rank") result = computeRankTile(spec, ctx, cells, table);
    else if (spec.form === "distribution") result = computeDistributionTile(spec, ctx, cells, table);
    else {
      let earlier: RankCellInput[] | null = null;
      if (spec.transform === "change-12m") {
        if (read.composed && composed) {
          // the year before in the store's period (the year), the same field matches, the composed period a year earlier
          const parsed = parsePeriod(read.composed.text, read.composed.format);
          const id = parsed ? yearEarlierId(parsed.start, read.composed.cadence) : null;
          if (!id || read.period === null || !/^\d{4}$/.test(read.period)) stop("The period a year earlier cannot be found for this composed period.");
          const prior = await crossRead(db, snap, { ...spec.across, period: String(Number(read.period) - 1) }, fields, format, { ...composed, pick: { id: id!, cadence: read.composed.cadence } });
          earlier = crossCells(prior, measure, spec.subjectCheck);
        } else {
          const before = read.period === null || !format ? null : yearEarlierText(read.period, format, context.cadence);
          if (!before) stop(`The period a year before ${read.period ?? "this one"} cannot be written in the declared format.`);
          earlier = crossCells(await crossRead(db, snap, { ...spec.across, period: before! }, fields, format), measure, spec.subjectCheck);
        }
      }
      result = computeMapTile(spec, ctx, cells, earlier, table);
    }
    const note = skippedNote(read.skipped);
    return result.ok && note ? { ...result, sourceNote: [result.sourceNote, note].filter(Boolean).join(" ") } : result;
  }
  const context = contextFor(profile, measure, meta);
  if (spec.form === "stat") {
    const window = spec.window ?? 24;
    return computeStatTile(spec, context, await lineCells(db, meta, profile, measure, spec.series, spec.subjectCheck, lastRows(profile, spec.series, window)));
  }
  if (spec.transform === "share") return { ok: false, reason: "Share tiles are not served by this board." };
  const series = spec as SeriesTileSpec;
  return computeSeriesTile(series, context, await lineCells(db, meta, profile, measure, series.series, series.subjectCheck, lastRows(profile, series.series, series.window)));
}

/** Reading a curve's categories in whole: each is short (a FRED monthly file) or read from its end. */
const ALL_ROWS = SERIES_ROW_LIMIT;

class BudgetSpent extends Error {}

/** The selects one board request may send cold (COMMON6): tiles past it are deferred to another request. */
export const BOARD_READ_BUDGET = 40;

type Meter = { used: number; limit: number };

/** The caller's client, counting every select and call; past the limit a read stops the tile (it is deferred). */
function metered(db: SourceDirectClient, meter: Meter): SourceDirectClient {
  const spend = () => {
    if (meter.used >= meter.limit) throw new BudgetSpent("budget");
    meter.used += 1;
  };
  return {
    from: (table) => ({
      select: (columns) => {
        spend();
        return db.from(table).select(columns);
      },
    }),
    rpc: (fn, args) => {
      spend();
      return db.rpc(fn, args);
    },
  };
}

/** The most selects a tile's reads take, from what the cache knows before any is sent. */
export function estimateSelects(spec: TileSpec, metas: Map<string, DatasetMeta | undefined>): number {
  const pages = (rows: number | undefined) => (rows === undefined ? CROSS_PAGES : Math.min(CROSS_PAGES, Math.floor(rows / READ_LIMITS.page) + 1));
  let total = 0;
  for (const id of datasetsOf(spec)) if (!metas.get(id)) total += 1;
  const rowsOf = (id: string) => metas.get(id)?.snapshot.rows;
  if (spec.transform === "records") return total + ("field" in spec.per ? pages(rowsOf(spec.datasetId)) : 1);
  // a probe of the period index and one page, typically; a change map reads a second period
  if (spec.transform === "rank" || spec.form === "map" || spec.form === "distribution") return total + 3 + (spec.form === "map" && spec.transform === "change-12m" ? 3 : 0);
  const lines = spec.form === "compare" ? spec.lines : spec.form === "mix" ? [spec.whole, ...spec.parts] : spec.form === "curve" ? spec.categories : null;
  if (lines) return total + lines.reduce((s, l) => s + pages(rowsOf(l.datasetId ?? spec.datasetId)), 0);
  return total + pages(rowsOf(spec.datasetId));
}

/** Computes one tile on its datasets' snapshots and keeps the outcome per snapshot; deferred when the budget runs out. */
async function computeTile(db: SourceDirectClient, spec: TileSpec, now: number): Promise<Outcome | "deferred"> {
  const metas = new Map<string, DatasetMeta>();
  try {
    for (const id of datasetsOf(spec)) metas.set(id, await sharedMeta(db, id, now));
  } catch (error) {
    if (error instanceof BudgetSpent) return "deferred";
    return refusedBy(spec, error);
  }
  const key = `${spec.id}:${[...metas.values()].map((m) => m.snapshot.id).join(",")}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  let flight = tileFlight.get(key);
  if (!flight) {
    flight = (async (): Promise<Outcome> => {
      try {
        const result = await computeOne(db, spec, metas);
        const lead = metas.get(spec.datasetId)!;
        const source = sourceOf(lead);
        const also = [...metas.values()].filter((m) => m !== lead).map((m) => {
          const s = sourceOf(m);
          return { datasetId: s.datasetId, table: s.table, ...(s.code ? { code: s.code } : {}) };
        });
        const outcome: Outcome = result.ok
          ? { tile: boardTile(spec, also.length ? { ...source, also } : source, result) }
          : { refused: { id: spec.id, title: spec.title, reason: result.reason } };
        tileCache.set(key, outcome);
        if (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value as string);
        return outcome;
      } catch (error) {
        if (error instanceof BudgetSpent) throw error;
        return refusedBy(spec, error);
      }
    })().finally(() => tileFlight.delete(key));
    tileFlight.set(key, flight);
  }
  try {
    return await flight;
  } catch (error) {
    if (error instanceof BudgetSpent) return "deferred";
    return refusedBy(spec, error);
  }
}

const refusedBy = (spec: TileSpec, error: unknown): Outcome => ({
  refused: { id: spec.id, title: spec.title, reason: error instanceof TileStop ? error.message : "The tile could not be computed." },
});

/** Runs `work` over `items` with at most `width` at a time, keeping the order of `items` in the answer. */
async function pooled<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * One board, or the tiles of it named in `tiles` (a section loading as it scrolls into view), every tile computed,
 * refused with its reason, or deferred: a request sends at most `BOARD_READ_BUDGET` selects, a tile starts only while
 * its estimated reads fit what is left, and a tile whose reads would pass the budget is left for the next request
 * (the client asks again; tiles computed so far are kept per snapshot). A tile that cannot fit even a fresh budget is
 * refused.
 */
export async function readBoard(db: SourceDirectClient, id: string, now = Date.now(), tiles?: readonly string[], budget = BOARD_READ_BUDGET): Promise<BoardRead> {
  const board = boardSpec(id);
  if (!board) return { ok: false, reason: "not-found", message: `No board ${id}.` };
  if (tiles && tiles.some((t) => !board.tiles.includes(t))) return { ok: false, reason: "invalid", message: `A tile asked for is not on board ${id}.` };
  const wanted = tiles ? board.tiles.filter((t) => tiles.includes(t)) : board.tiles;
  const specs = wanted.map((t) => tileSpec(t)).filter((t): t is TileSpec => t !== null);
  const data = await readTiles(db, specs, now, budget);
  return { ok: true, data: { ...data, id: board.id, title: board.title } };
}

/** Tiles of any spec (a board's, or a test's) under one read budget, in their order. */
export async function readTiles(db: SourceDirectClient, specs: readonly TileSpec[], now = Date.now(), budget = BOARD_READ_BUDGET): Promise<Board> {
  const meter: Meter = { used: 0, limit: budget };
  const client = metered(db, meter);
  let reserved = 0;
  const outcomes = await pooled(specs, 3, async (spec): Promise<Outcome | "deferred"> => {
    const fresh = new Map(datasetsOf(spec).map((d) => {
      const hit = metaCache.get(d);
      return [d, hit && now - hit.at < META_TTL_MS ? hit.meta : undefined] as const;
    }));
    const estimate = estimateSelects(spec, fresh);
    const startedEmpty = meter.used + reserved === 0;
    if (!startedEmpty && meter.used + reserved + estimate > meter.limit) return "deferred";
    reserved += estimate;
    try {
      const outcome = await computeTile(client, spec, now);
      if (outcome === "deferred" && startedEmpty) return { refused: { id: spec.id, title: spec.title, reason: `The tile needs more than ${budget} reads.` } };
      return outcome;
    } finally {
      reserved -= estimate;
    }
  });
  const data: Board = {
    id: "tiles",
    title: "",
    tiles: outcomes.flatMap((o) => (o !== "deferred" && "tile" in o ? [o.tile] : [])),
    refused: outcomes.flatMap((o) => (o !== "deferred" && "refused" in o ? [o.refused] : [])),
    computedAt: new Date(now).toISOString(),
  };
  const deferred = specs.filter((_, i) => outcomes[i] === "deferred").map((s) => s.id);
  if (deferred.length) data.deferred = deferred;
  return data;
}

// ---------------------------------------------------------------- first looks

export type LookCrossInput = {
  datasetId: string;
  snapshotId: string;
  /** The measure's field label (the profile's). */
  field: string;
  by: IndexedDimension;
  period: "latest" | "table" | string;
  where?: FieldMatch[];
};

export type LookCross = {
  snapshotId: string;
  /** The period read as the records state it (a composed period's text, "2026Q2"), or null for a whole table. */
  period: string | null;
  /** The format that period is written in, for the view's labels. */
  format: PeriodFormat | null;
  table: boolean;
  cells: RankCellInput[];
  skipped: SkippedPeriod[];
  retrieved: string | null;
};

/**
 * One period of a table for a table page's ranking or map, read as a rank tile reads it: the greatest period of the
 * profile's format when "latest", up to five pages, complete or refused. The dataset's profile must apply.
 */
export async function readLookCross(db: SourceDirectClient, input: LookCrossInput, now = Date.now()): Promise<{ ok: true; data: LookCross } | { ok: false; reason: string }> {
  try {
    const meta = await sharedMeta(db, input.datasetId, now);
    if (meta.snapshot.id !== input.snapshotId) stop("The snapshot asked for is not the published one.");
    const { profile, measure } = profiled(meta, input.field);
    const format = profile.period.from === "dimension" ? profile.period.format : null;
    const snap = { snapshotId: meta.snapshot.id, rows: meta.snapshot.rows, columns: meta.snapshot.columns, ingest: meta.snapshot.ingest };
    const read = await crossRead(db, snap, { by: input.by, period: input.period, where: input.where }, crossFields(meta, measure, undefined), format, composedOf(profile, meta));
    return {
      ok: true,
      data: {
        snapshotId: meta.snapshot.id,
        period: read.composed?.text ?? read.period,
        format: read.composed?.format ?? format,
        table: read.table,
        cells: crossCells(read, measure, undefined),
        skipped: read.skipped,
        retrieved: retrievedDay(meta.snapshot.retrievedAt),
      },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof TileStop ? error.message : "The period could not be read." };
  }
}
