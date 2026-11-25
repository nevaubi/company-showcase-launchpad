/**
 * Computes a board on the server: for each tile, the dataset's published snapshot, its profile, the rows
 * of the tile's series through the direct reads of `read.server.ts` (bounded selects with the member's own
 * client), then `compute.ts`. A computed tile is kept in this process per snapshot: a snapshot is immutable,
 * so the figures of a pinned snapshot never change; only the dataset's pointer to its latest snapshot is
 * looked up again after ten minutes.
 */
import { describeDataset } from "../catalog";
import { addressMatches, addressRefusal, cadenceOf, locateField, measureOf, profileStatus, unitOf } from "../profiles";
import type { MeasureSpec, Profile, SeriesAddress } from "../profiles/types";
import { readSourceCrossSection, readSourceSeries, type SourceDirectClient } from "../read.server";
import type { SourceCellMatch, SourceSeriesAddress } from "../read-types";
import type { SourceColumn } from "../schema";
import { computeRankTile, computeSeriesTile, type CellInput, type RankCellInput, type TileContext } from "./compute";
import { boardSpec, tileSpec } from "./specs";
import type { Board, BoardRead, BoardTile, RankTileSpec, SeriesTileSpec, TileResult, TileSource, TileSpec } from "./types";

type DatasetMeta = {
  dataset: { id: string; source_id: string | null; name: string; sector: string; agency: string; source_url: string | null; grain: string };
  snapshot: { id: string; columns: SourceColumn[]; retrievedAt: string | null; publishedAt: string | null; rows: number };
};

type Outcome = { tile: BoardTile } | { refused: { id: string; title: string; reason: string } };

const META_TTL_MS = 10 * 60_000;
const TILE_CACHE_LIMIT = 400;
/** Series longer than this are not read for a tile (five pages of 1,000 rows per call). */
const SERIES_ROW_LIMIT = 5000;

const metaCache = new Map<string, { at: number; meta: DatasetMeta }>();
const tileCache = new Map<string, Outcome>();

/** Forgets every cached dataset pointer and tile (tests). */
export function resetBoardCache() {
  metaCache.clear();
  tileCache.clear();
}

class TileStop extends Error {}
const stop = (reason: string): never => {
  throw new TileStop(reason);
};

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function datasetMeta(db: SourceDirectClient, datasetId: string, now: number): Promise<DatasetMeta> {
  const hit = metaCache.get(datasetId);
  if (hit && now - hit.at < META_TTL_MS) return hit.meta;
  const ds = await db
    .from("source_datasets")
    .select("id,source_id,latest_snapshot_id,name,sector,agency,source_url,grain")
    .eq("id", datasetId)
    .limit(1);
  if (ds.error) stop(`The dataset could not be read (${ds.error.message}).`);
  const row = Array.isArray(ds.data) ? (ds.data[0] as Record<string, unknown> | undefined) : undefined;
  const snapshotId = text(row?.latest_snapshot_id);
  if (!row || !snapshotId) stop("The dataset has no published snapshot.");
  const sn = await db
    .from("source_snapshots")
    .select("id,dataset_id,columns,retrieved_at,published_at,loaded_rows")
    .eq("id", snapshotId as string)
    .eq("dataset_id", datasetId)
    .eq("status", "ready")
    .limit(1);
  if (sn.error) stop(`The snapshot could not be read (${sn.error.message}).`);
  const snap = Array.isArray(sn.data) ? (sn.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!snap || !Array.isArray(snap.columns)) stop("The published snapshot has no field dictionary.");
  const meta: DatasetMeta = {
    dataset: {
      id: datasetId,
      source_id: text(row!.source_id),
      name: text(row!.name) ?? datasetId,
      sector: text(row!.sector) ?? "",
      agency: text(row!.agency) ?? "",
      source_url: text(row!.source_url),
      grain: text(row!.grain) ?? "",
    },
    snapshot: {
      id: snapshotId as string,
      columns: snap!.columns as SourceColumn[],
      retrievedAt: text(snap!.retrieved_at),
      publishedAt: text(snap!.published_at),
      rows: typeof snap!.loaded_rows === "number" ? snap!.loaded_rows : Number(snap!.loaded_rows),
    },
  };
  metaCache.set(datasetId, { at: now, meta });
  return meta;
}

function sourceOf(meta: DatasetMeta): TileSource {
  const entry = describeDataset({ ...meta.dataset, rows: meta.snapshot.rows, retrieved_at: meta.snapshot.retrievedAt });
  const publisher = entry.publisher.via ? `${entry.publisher.short} via ${entry.publisher.via}` : entry.publisher.short;
  return {
    datasetId: meta.dataset.id,
    snapshotId: meta.snapshot.id,
    publisher,
    table: entry.title,
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

/** Every point of one field for one address, in file order, at most SERIES_ROW_LIMIT rows. */
async function readField(
  db: SourceDirectClient,
  meta: DatasetMeta,
  field: number,
  address: SourceSeriesAddress,
): Promise<Map<number, { period: string | null; text: string | null }>> {
  const out = new Map<number, { period: string | null; text: string | null }>();
  const read = await readSourceSeries(db, {
    datasetId: meta.dataset.id,
    snapshotId: meta.snapshot.id,
    field,
    address,
    limit: SERIES_ROW_LIMIT,
  });
  if (!read.ok) stop(read.reason === "unavailable" ? "The series read is not available yet." : read.message);
  if (read.ok && read.data.next !== null) stop(`The series has more than ${SERIES_ROW_LIMIT.toLocaleString("en-US")} records; a tile reads at most that many.`);
  if (read.ok) for (const p of read.data.points) out.set(p.row, { period: p.period, text: p.text });
  return out;
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
  const extra = new Map<number, Map<number, { period: string | null; text: string | null }>>();
  const want = new Set<number>();
  if (measure.unit.from === "column") want.add(position(columns, measure.unit.column));
  if (spec.subjectCheck) want.add(position(columns, spec.subjectCheck.field));
  if (profile.period.from === "field") want.add(position(columns, profile.period.field));
  if (profile.period.from === "fields") for (const f of profile.period.fields) want.add(position(columns, f));
  for (const m of local) want.add(m.position);
  want.delete(measureAt);

  const values = await readField(db, meta, measureAt, read);
  for (const at of want) extra.set(at, await readField(db, meta, at, read));
  const cellAt = (at: number, row: number) => (at === measureAt ? values.get(row)?.text ?? null : extra.get(at)?.get(row)?.text ?? null);

  const cells: CellInput[] = [];
  for (const [row, point] of values) {
    if (local.some((m) => cellAt(m.position, row) !== m.value)) continue;
    let period = point.period;
    if (profile.period.from === "field") period = cellAt(position(columns, profile.period.field), row);
    if (profile.period.from === "fields") {
      const composed = profile.period.compose(profile.period.fields.map((f) => cellAt(position(columns, f), row)));
      period = composed ? composed.text : null;
    }
    cells.push({
      row,
      period,
      text: point.text,
      unit: measure.unit.from === "column" ? cellAt(position(columns, measure.unit.column), row) : undefined,
      check: spec.subjectCheck ? cellAt(position(columns, spec.subjectCheck.field), row) : undefined,
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
  });
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

function boardTile(spec: TileSpec, source: TileSource, result: TileResult): BoardTile {
  return {
    id: spec.id,
    title: spec.title,
    form: spec.form,
    transform: spec.transform,
    note: spec.note,
    selection: spec.transform === "rank" ? { across: spec.across } : { series: spec.series },
    source,
    result,
  };
}

async function computeTile(db: SourceDirectClient, spec: TileSpec, now: number): Promise<Outcome> {
  try {
    const meta = await datasetMeta(db, spec.datasetId, now);
    const key = `${spec.id}:${meta.snapshot.id}`;
    const cached = tileCache.get(key);
    if (cached) return cached;
    const status = profileStatus(meta.dataset, meta.snapshot.columns);
    if (status.state === "none") stop("No reviewed profile covers this table.");
    if (status.state === "off") stop(status.reason);
    const profile = (status as { profile: Profile }).profile;
    const measure = measureOf(profile, spec.measure);
    if (!measure) stop(`${spec.measure} is not a measure of the ${profile.family} profile.`);
    let result: TileResult;
    if (spec.transform === "rank") {
      const context = contextFor(profile, measure!, meta, "day");
      result = computeRankTile(spec, context, await rankCells(db, meta, measure!, spec));
    } else if (spec.transform === "share") {
      result = { ok: false, reason: "Share tiles are not served by this board." };
    } else {
      const context = contextFor(profile, measure!, meta);
      result = computeSeriesTile(spec, context, await seriesCells(db, meta, profile, measure!, spec));
    }
    const outcome: Outcome = result.ok
      ? { tile: boardTile(spec, sourceOf(meta), result) }
      : { refused: { id: spec.id, title: spec.title, reason: result.reason } };
    tileCache.set(key, outcome);
    if (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value as string);
    return outcome;
  } catch (error) {
    const reason = error instanceof TileStop ? error.message : "The tile could not be computed.";
    return { refused: { id: spec.id, title: spec.title, reason } };
  }
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
