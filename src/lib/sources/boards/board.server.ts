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
import type { MeasureSpec, Profile, SeriesAddress } from "../profiles/types";
import { readSourceCrossSection, readSourceSeriesFields, type SourceDirectClient, type SourceSnapshotKnown } from "../read.server";
import { SERIES_SURE_LIMIT, type SourceCellMatch, type SourceSeriesAddress } from "../read-types";
import type { SourceColumn, SourceIngest } from "../schema";
import { computeRankTile, computeSeriesTile, isClassicSpec, type CellInput, type RankCellInput, type TileContext } from "./compute";
import { boardSpec, tileSpec } from "./specs";
import type {
  Board,
  BoardRead,
  BoardTile,
  RankTileSpec,
  SeriesTileSpec,
  ShareTileSpec,
  TileResult,
  TileSeriesSpec,
  TileSource,
  TileSpec,
} from "./types";

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
  };
}

async function seriesCells(
  db: SourceDirectClient,
  meta: DatasetMeta,
  profile: Profile,
  measure: MeasureSpec,
  spec: SeriesTileSpec,
): Promise<CellInput[]> {
  const columns = meta.snapshot.columns;
  const refusal = addressRefusal(profile, spec.series);
  if (refusal) stop(refusal);
  const { read, local } = readAddress(columns, spec.series);
  const measureAt = position(columns, measure.field);
  const want = new Set<number>();
  if (measure.unit.from === "column") want.add(position(columns, measure.unit.column));
  if (spec.subjectCheck) want.add(position(columns, spec.subjectCheck.field));
  if (profile.period.from === "field") want.add(position(columns, profile.period.field));
  if (profile.period.from === "fields") for (const f of profile.period.fields) want.add(position(columns, f));
  for (const m of local) want.add(m.position);
  want.delete(measureAt);

  // the measure and every field beside it on the same selects
  const fields = [measureAt, ...want];
  const got = await readSourceSeriesFields(db, { datasetId: meta.dataset.id, snapshotId: meta.snapshot.id, fields, address: read, limit: SERIES_ROW_LIMIT }, known(meta));
  if (!got.ok) stop(got.reason === "unavailable" ? "The series read is not available yet." : got.message);
  const series = got.ok ? got.data : null;
  if (!series) return [];
  if (series.next !== null) stop(`The series has more than ${SERIES_ROW_LIMIT.toLocaleString("en-US")} records; a tile reads at most that many.`);
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
      check: spec.subjectCheck ? cellAt(position(columns, spec.subjectCheck.field)) : undefined,
    });
  }
  return cells;
}

async function rankCells(db: SourceDirectClient, meta: DatasetMeta, measure: MeasureSpec, spec: RankTileSpec): Promise<RankCellInput[]> {
  const read = await readSourceCrossSection(db, {
    datasetId: meta.dataset.id,
    snapshotId: meta.snapshot.id,
    field: position(meta.snapshot.columns, measure.field),
    period: spec.across.period === "latest" ? undefined : spec.across.period,
  }, known(meta));
  if (!read.ok) stop(read.reason === "unavailable" ? "The cross-section read is not available yet." : read.message);
  const data = read.ok ? read.data : null;
  if (!data) return [];
  if (!data.complete) stop("The period has more than 1,000 records; a part is never ranked as the whole.");
  if (data.periodRule === "none") stop("The table has no period dimension to rank one period by.");
  return data.rows.map((r) => {
    const key = spec.across.by === "entity_id" ? r.entityId : spec.across.by === "entity_name" ? r.entityName : spec.across.by === "geo_code" ? r.geoCode : r.geoName;
    return { row: r.row, key: key ?? `row ${r.row}`, name: r.entityName ?? r.geoName, period: data.period, text: r.text };
  });
}

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

const refusedBy = (spec: TileSpec, error: unknown): Outcome => ({
  refused: { id: spec.id, title: spec.title, reason: error instanceof TileStop ? error.message : "The tile could not be computed." },
});

/** Computes one tile on a dataset's snapshot and keeps the outcome; never rejects. */
async function buildTile(db: SourceDirectClient, spec: TileSpec, meta: DatasetMeta, key: string): Promise<Outcome> {
  try {
    if (!isClassicSpec(spec)) stop("This chart form is computed by the next version of the boards.");
    const classic = spec as SeriesTileSpec | ShareTileSpec | RankTileSpec;
    const status = profileStatus(meta.dataset, meta.snapshot.columns);
    if (status.state === "none") stop("No reviewed profile covers this table.");
    if (status.state === "off") stop(status.reason);
    const profile = (status as { profile: Profile }).profile;
    const measure = measureOf(profile, classic.measure);
    if (!measure) stop(`${classic.measure} is not a measure of the ${profile.family} profile.`);
    let result: TileResult;
    if (classic.transform === "rank") {
      const context = contextFor(profile, measure!, meta, "day");
      result = computeRankTile(classic, context, await rankCells(db, meta, measure!, classic));
    } else if (classic.transform === "share") {
      result = { ok: false, reason: "Share tiles are not served by this board." };
    } else {
      const context = contextFor(profile, measure!, meta);
      result = computeSeriesTile(classic, context, await seriesCells(db, meta, profile, measure!, classic));
    }
    const outcome: Outcome = result.ok
      ? { tile: boardTile(spec, sourceOf(meta), result) }
      : { refused: { id: spec.id, title: spec.title, reason: result.reason } };
    tileCache.set(key, outcome);
    if (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value as string);
    return outcome;
  } catch (error) {
    return refusedBy(spec, error);
  }
}

async function computeTile(db: SourceDirectClient, spec: TileSpec, now: number): Promise<Outcome> {
  let meta: DatasetMeta;
  try {
    meta = await sharedMeta(db, spec.datasetId, now);
  } catch (error) {
    return refusedBy(spec, error);
  }
  const key = `${spec.id}:${meta.snapshot.id}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  let flight = tileFlight.get(key);
  if (!flight) {
    flight = buildTile(db, spec, meta, key).finally(() => tileFlight.delete(key));
    tileFlight.set(key, flight);
  }
  return flight;
}

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

/** One board, every tile computed or refused with its reason. */
export async function readBoard(db: SourceDirectClient, id: string, now = Date.now()): Promise<BoardRead> {
  const board = boardSpec(id);
  if (!board) return { ok: false, reason: "not-found", message: `No board ${id}.` };
  const specs = board.tiles.map((t) => tileSpec(t)).filter((t): t is TileSpec => t !== null);
  const outcomes = await pooled(specs, 3, (spec) => computeTile(db, spec, now));
  const data: Board = {
    id: board.id,
    title: board.title,
    tiles: outcomes.flatMap((o) => ("tile" in o ? [o.tile] : [])),
    refused: outcomes.flatMap((o) => ("refused" in o ? [o.refused] : [])),
    computedAt: new Date(now).toISOString(),
  };
  return { ok: true, data };
}
