/**
 * Server reads of official datasets (unit `reads`). Two kinds:
 *
 * A. Direct, bounded selects on `source_datasets`, `source_snapshots` and `source_records` with the signed-in
 *    member's own client; row-level security (migration 0068) decides visibility on every call. Every select on
 *    `source_records` names one snapshot, then an indexed equality, a row range or a period-ordered probe, and a
 *    limit of at most 1,000; one call issues at most five such selects; a filter on a cell inside `values` runs
 *    only on a snapshot of at most 50,000 rows (COMMON4b section 2). Single cells are read as `values->>N`.
 * B. Functions of migration 0069, used when present. A missing function is reported as `unavailable` and
 *    remembered for ten minutes per server process, so a page does not probe it on every call.
 *
 * Nothing here parses, rescales or infers a cell: the publisher's strings go out as stored.
 */
import type { SourceColumn, SourceDimension, SourceIngest, SourceRecord } from "./schema";
import {
  READ_LIMITS, readFail, readOk,
  type SourceCellMatch, type SourceCrossRow, type SourceCrossSection, type SourceCrossSectionQueryInput,
  type SourceEntities, type SourceEntitiesQueryInput, type SourceEntity, type SourceFacets, type SourceFacetsQueryInput,
  type SourceFieldCompleteness, type SourceFieldCompletenessQueryInput, type SourceFieldInfo, type SourceFind,
  type SourceFindQueryInput, type SourcePeriodRange, type SourcePeriodRangeQueryInput, type SourcePeriodRule,
  type SourcePoint, type SourceRead, type SourceReadFailure, type SourceRecordQueryInput, type SourceRecordRead,
  type SourceResolvedMatch, type SourceSeries, type SourceSeriesQueryInput, type SourceSnapshotRef,
  type SourceSnapshotStats, type SourceSnapshotStatsQueryInput, fieldCompleteness,
} from "./read-types";

// ---------------------------------------------------------------- client shape

export type PgError = { message: string; code?: string | null; details?: string | null; hint?: string | null };
export type PgResult = { data: unknown; error: PgError | null };
/** The subset of the PostgREST builder these reads use. The real client is the caller's user-scoped Supabase client. */
export interface SourceSelect extends PromiseLike<PgResult> {
  eq(column: string, value: string | number): SourceSelect;
  gt(column: string, value: string | number): SourceSelect;
  not(column: string, operator: "is", value: null): SourceSelect;
  order(column: string, options: { ascending: boolean }): SourceSelect;
  limit(count: number): SourceSelect;
}
export type SourceTable = "source_datasets" | "source_snapshots" | "source_records";
export type SourceDirectClient = {
  from(table: SourceTable): { select(columns: string): SourceSelect };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<PgResult>;
};

// ---------------------------------------------------------------- errors

type Failure = { reason: SourceReadFailure; message: string };
/** Maps a PostgREST or Postgres error to a read failure. */
export function classifyReadError(error: PgError): Failure {
  const code = error.code ?? "";
  const message = error.message || "The database did not answer";
  if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(message))
    return { reason: "unavailable", message: "This read needs a database update that is not applied yet" };
  if (code === "PGRST205" || code === "42P01" || /could not find the table/i.test(message))
    return { reason: "unavailable", message: "This read needs a database update that is not applied yet" };
  if (code === "57014" || /statement timeout|canceling statement/i.test(message))
    return { reason: "timeout", message: "The database stopped this read after its time limit" };
  if (code === "22P02" || code === "22023" || code === "22003" || code === "PGRST100" || code === "PGRST103")
    return { reason: "invalid", message };
  if (code === "P0002" || /not found/i.test(message)) return { reason: "not-found", message };
  return { reason: "error", message };
}
const failWith = <T>(f: Failure): SourceRead<T> => readFail<T>(f.reason, f.message);
class ReadStop extends Error {
  constructor(readonly failure: Failure) { super(failure.message); }
}
const stop = (reason: SourceReadFailure, message: string): never => { throw new ReadStop({ reason, message }); };
async function rows(query: PromiseLike<PgResult>): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw new ReadStop(classifyReadError(error));
  if (data == null) return [];
  if (!Array.isArray(data)) stop("error", "The database answered in an unexpected shape");
  return data as Record<string, unknown>[];
}
/** Runs a read body; a ReadStop becomes its failure, anything else an `error`. */
async function guarded<T>(body: () => Promise<T>): Promise<SourceRead<T>> {
  try {
    return readOk(await body());
  } catch (e) {
    if (e instanceof ReadStop) return failWith<T>(e.failure);
    return readFail<T>("error", e instanceof Error ? e.message : "The read failed");
  }
}

// ---------------------------------------------------------------- snapshot metadata (immutable once published)

type Dictionary = { columns: SourceColumn[]; ingest: SourceIngest };
type SnapshotMeta = { ref: SourceSnapshotRef; dict: Dictionary; quality?: Record<string, unknown> | null };
const DICT_BUDGET = 24 * 1024 * 1024;
const dictionaries = new Map<string, Dictionary & { weight: number }>();
let dictWeight = 0;
function rememberDictionary(id: string, dict: Dictionary) {
  const weight = JSON.stringify(dict.columns).length + 512;
  if (weight > DICT_BUDGET / 4 || dictionaries.has(id)) return;
  dictionaries.set(id, { ...dict, weight });
  dictWeight += weight;
  for (const [key, value] of dictionaries) {
    if (dictWeight <= DICT_BUDGET) break;
    dictionaries.delete(key);
    dictWeight -= value.weight;
  }
}
function cachedDictionary(id: string): Dictionary | null {
  const hit = dictionaries.get(id);
  if (!hit) return null;
  dictionaries.delete(id);
  dictionaries.set(id, hit);
  return hit;
}

const SNAP_COLUMNS = "id,dataset_id,loaded_rows,column_count,published_at,retrieved_at,file_sha256";
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);

/**
 * The published snapshot of a dataset: the given one (it must belong to the dataset) or the dataset's latest.
 * One or two selects by primary key; the dictionary comes from the process cache when this snapshot was read before.
 */
async function snapshotMeta(db: SourceDirectClient, datasetId: string, snapshotId: string | undefined, opts: { quality?: boolean } = {}): Promise<SnapshotMeta> {
  let id = snapshotId;
  if (!id) {
    const found = await rows(db.from("source_datasets").select("id,latest_snapshot_id").eq("id", datasetId).limit(1));
    id = str(found[0]?.latest_snapshot_id) ?? undefined;
    if (!id) stop("not-found", "No published dataset with this id");
  }
  const cached = cachedDictionary(id!);
  const select = SNAP_COLUMNS + (cached ? "" : ",columns,ingest") + (opts.quality ? ",quality" : "");
  const found = await rows(db.from("source_snapshots").select(select).eq("id", id!).eq("dataset_id", datasetId).eq("status", "ready").limit(1));
  const row = found[0];
  if (!row) stop("not-found", "No published snapshot with this id for this dataset");
  const dict = cached ?? { columns: (row.columns ?? []) as SourceColumn[], ingest: (row.ingest ?? {}) as SourceIngest };
  if (!Array.isArray(dict.columns)) stop("error", "The snapshot's field dictionary is not a list");
  if (!cached) rememberDictionary(id!, dict);
  const ref: SourceSnapshotRef = {
    datasetId, snapshotId: id!, publishedAt: str(row.published_at), retrievedAt: str(row.retrieved_at),
    fileSha256: str(row.file_sha256) ?? "", rows: num(row.loaded_rows), fields: num(row.column_count),
  };
  if (!Number.isFinite(ref.rows) || !Number.isFinite(ref.fields)) stop("error", "The snapshot's counts are not numbers");
  return { ref, dict, quality: opts.quality ? ((row.quality ?? null) as Record<string, unknown> | null) : undefined };
}

/** Whether the snapshot fills a dimension (by a column, a constant or, for the period, a composite). */
export function hasDimension(ingest: SourceIngest, name: SourceDimension): boolean {
  return ingest.dimensions?.[name] !== undefined || ingest.constants?.[name] !== undefined || (name === "period" && !!ingest.composites?.period);
}

function resolveField(columns: SourceColumn[], field: number | string): SourceFieldInfo {
  const position = typeof field === "number" ? field : columns.findIndex(c => c.key === field);
  if (!Number.isInteger(position) || position < 0 || position >= columns.length)
    stop("invalid", typeof field === "number" ? `Field position ${field} is outside the dictionary of ${columns.length} fields` : `No field with key "${field}" in this snapshot`);
  return { ...columns[position], position };
}
function resolveMatches(meta: SnapshotMeta, where: SourceCellMatch[] | undefined): SourceResolvedMatch[] {
  if (!where?.length) return [];
  if (where.length > READ_LIMITS.cellFilters) stop("invalid", `At most ${READ_LIMITS.cellFilters} cell filters`);
  if (meta.ref.rows > READ_LIMITS.cellFilterRows)
    stop("invalid", `A filter on a cell needs a snapshot of at most ${READ_LIMITS.cellFilterRows.toLocaleString("en-US")} rows; this one has ${meta.ref.rows.toLocaleString("en-US")}`);
  return where.map(m => {
    const f = resolveField(meta.dict.columns, m.field);
    return { position: f.position, key: f.key, value: m.value };
  });
}
const cellPath = (position: number) => `values->>${position}`;
function records(db: SourceDirectClient, snapshotId: string, columns: string, where: SourceResolvedMatch[]): SourceSelect {
  let q = db.from("source_records").select(columns).eq("snapshot_id", snapshotId);
  for (const m of where) q = q.eq(cellPath(m.position), m.value);
  return q;
}
const rowNumber = (r: Record<string, unknown>): number => {
  const n = num(r.row_number);
  if (!Number.isSafeInteger(n) || n < 1) stop("error", "A record came back without a row number");
  return n;
};

/** The greatest period string of a snapshot: one backward probe of the period index. */
async function greatestPeriod(db: SourceDirectClient, snapshotId: string): Promise<{ period: string; row: number } | null> {
  const found = await rows(db.from("source_records").select("row_number,period").eq("snapshot_id", snapshotId).not("period", "is", null)
    .order("period", { ascending: false }).order("row_number", { ascending: false }).limit(1));
  const r = found[0];
  return r && typeof r.period === "string" ? { period: r.period, row: rowNumber(r) } : null;
}
async function choosePeriod(db: SourceDirectClient, meta: SnapshotMeta, given: string | undefined): Promise<{ period: string | null; rule: SourcePeriodRule }> {
  if (given !== undefined) return { period: given, rule: "given" };
  if (!hasDimension(meta.dict.ingest, "period")) return { period: null, rule: "none" };
  const top = await greatestPeriod(db, meta.ref.snapshotId);
  return top ? { period: top.period, rule: "greatest" } : { period: null, rule: "none" };
}

// ---------------------------------------------------------------- A. direct reads

const RECORD_COLUMNS = "row_number,values,entity_id,entity_name,period,geo_level,geo_code,geo_name,source_url";

/** One whole record with every field, and the dictionary. Two selects by primary key. */
export function readSourceRecord(db: SourceDirectClient, input: SourceRecordQueryInput): Promise<SourceRead<SourceRecordRead>> {
  return guarded(async () => {
    const meta = await snapshotMeta(db, input.datasetId, input.snapshotId);
    if (input.row < 1 || input.row > meta.ref.rows) stop("not-found", `Row ${input.row} is outside this snapshot of ${meta.ref.rows} rows`);
    const found = await rows(db.from("source_records").select(RECORD_COLUMNS).eq("snapshot_id", meta.ref.snapshotId).eq("row_number", input.row).limit(1));
    const r = found[0];
    if (!r) stop("not-found", `Row ${input.row} is not readable in this snapshot`);
    const record: SourceRecord = {
      row_number: rowNumber(r), values: (Array.isArray(r.values) ? r.values : []) as (string | null)[],
      entity_id: str(r.entity_id), entity_name: str(r.entity_name), period: str(r.period), geo_level: str(r.geo_level),
      geo_code: str(r.geo_code), geo_name: str(r.geo_name), source_url: str(r.source_url),
    };
    return { snapshot: meta.ref, columns: meta.dict.columns, record };
  });
}

export const SERIES_DEFAULT_LIMIT = 1000;
export const SERIES_MAX_LIMIT = READ_LIMITS.page * READ_LIMITS.pages;

/**
 * One measure over one series, in file order. Each select reads at most 1,000 rows after `after` through the
 * dimension's index (or the primary key), at most five selects a call. `next` is null when the series ended in this
 * answer; otherwise it is the row to continue after (the following answer can be empty when the series ends exactly
 * at a page boundary).
 */
export function readSourceSeries(db: SourceDirectClient, input: SourceSeriesQueryInput): Promise<SourceRead<SourceSeries>> {
  return guarded(async () => {
    const meta = await snapshotMeta(db, input.datasetId, input.snapshotId);
    const field = resolveField(meta.dict.columns, input.field);
    const a = input.address;
    let address: SourceSeries["address"] = null;
    let where: SourceResolvedMatch[] = [];
    if ("by" in a) {
      if (!hasDimension(meta.dict.ingest, a.by)) stop("invalid", `This table has no ${a.by.replace("_", " ")}`);
      address = { by: a.by, key: a.key };
      where = resolveMatches(meta, a.where);
    } else if ("whole" in a) address = { whole: true };
    else {
      if (!a.where.length) stop("invalid", "A series by cells needs at least one cell filter");
      where = resolveMatches(meta, a.where);
    }
    const limit = Math.min(Math.max(1, input.limit ?? SERIES_DEFAULT_LIMIT), SERIES_MAX_LIMIT);
    const points: SourcePoint[] = [];
    let after = input.after ?? 0;
    let next: number | null = null;
    for (let page = 0; page < READ_LIMITS.pages; page++) {
      const remaining = limit - points.length;
      const ask = Math.min(READ_LIMITS.page, remaining + 1);
      let q = records(db, meta.ref.snapshotId, `row_number,period,cell:${cellPath(field.position)}`, where);
      if (address && "by" in address) q = q.eq(address.by, address.key);
      const got = await rows(q.gt("row_number", after).order("row_number", { ascending: true }).limit(ask));
      for (const r of got.slice(0, remaining)) points.push({ row: rowNumber(r), period: str(r.period), text: str(r.cell) });
      if (got.length > remaining) { next = points[points.length - 1]?.row ?? after; break; }
      if (got.length < ask) { next = null; break; }
      after = points[points.length - 1]?.row ?? after;
      if (points.length >= limit) { next = after; break; }
      next = after;
    }
    return { snapshot: meta.ref, field, address, where, points, next };
  });
}

/** One measure across the rows of one period (the greatest period string when none is given), at most 1,000 rows. */
export function readSourceCrossSection(db: SourceDirectClient, input: SourceCrossSectionQueryInput): Promise<SourceRead<SourceCrossSection>> {
  return guarded(async () => {
    const meta = await snapshotMeta(db, input.datasetId, input.snapshotId);
    const field = resolveField(meta.dict.columns, input.field);
    const where = resolveMatches(meta, input.where);
    const { period, rule } = await choosePeriod(db, meta, input.period);
    const select = `row_number,entity_id,entity_name,geo_code,geo_name,cell:${cellPath(field.position)}`;
    const base = () => {
      const q = records(db, meta.ref.snapshotId, select, where);
      return period === null ? q : q.eq("period", period);
    };
    const got = await rows(base().order("row_number", { ascending: true }).limit(READ_LIMITS.page));
    const out: SourceCrossRow[] = got.map(r => ({
      row: rowNumber(r), entityId: str(r.entity_id), entityName: str(r.entity_name),
      geoCode: str(r.geo_code), geoName: str(r.geo_name), text: str(r.cell),
    }));
    let complete = got.length < READ_LIMITS.page;
    if (!complete) {
      const more = await rows(base().gt("row_number", out[out.length - 1].row).order("row_number", { ascending: true }).limit(1));
      complete = more.length === 0;
    }
    return { snapshot: meta.ref, field, period, periodRule: rule, where, rows: out, complete };
  });
}

/** Least and greatest period strings: two probes of the period index. */
export function readSourcePeriodRange(db: SourceDirectClient, input: SourcePeriodRangeQueryInput): Promise<SourceRead<SourcePeriodRange>> {
  return guarded(async () => {
    const meta = await snapshotMeta(db, input.datasetId, input.snapshotId);
    if (!hasDimension(meta.dict.ingest, "period")) return { snapshot: meta.ref, range: null };
    const [least, top] = await Promise.all([
      rows(db.from("source_records").select("row_number,period").eq("snapshot_id", meta.ref.snapshotId).not("period", "is", null)
        .order("period", { ascending: true }).order("row_number", { ascending: true }).limit(1)),
      greatestPeriod(db, meta.ref.snapshotId),
    ]);
    const first = least[0];
    if (!first || typeof first.period !== "string" || !top) return { snapshot: meta.ref, range: null };
    return { snapshot: meta.ref, range: { first: { period: first.period, row: rowNumber(first) }, last: top } };
  });
}

/**
 * Distinct entities (or places) for pickers, at most 1,000, from at most five pages of 1,000 rows. With a period
 * (given, or the greatest string), the rows of that period in file order; without one, the dimension's own index
 * in key order, skipping to the next key after each page.
 */
export function readSourceEntities(db: SourceDirectClient, input: SourceEntitiesQueryInput): Promise<SourceRead<SourceEntities>> {
  return guarded(async () => {
    const meta = await snapshotMeta(db, input.datasetId, input.snapshotId);
    const dimension = input.dimension ?? "entity";
    const [idCol, nameCol] = dimension === "geo" ? (["geo_code", "geo_name"] as const) : (["entity_id", "entity_name"] as const);
    const hasId = hasDimension(meta.dict.ingest, idCol);
    const hasName = hasDimension(meta.dict.ingest, nameCol);
    const empty = { snapshot: meta.ref, dimension, period: null, periodRule: "none" as SourcePeriodRule, entities: [], rowsRead: 0, complete: true };
    if (!hasId && !hasName) return empty;
    const { period, rule } = await choosePeriod(db, meta, input.period);
    const keyCol = hasId ? idCol : nameCol;
    const seen = new Map<string, SourceEntity>();
    let rowsRead = 0;
    let complete = false;
    let after: number | string | null = null;
    for (let page = 0; page < READ_LIMITS.pages && seen.size < READ_LIMITS.page; page++) {
      let q = db.from("source_records").select(`row_number,${idCol},${nameCol}`).eq("snapshot_id", meta.ref.snapshotId);
      if (period !== null) {
        q = q.eq("period", period);
        if (after !== null) q = q.gt("row_number", after);
        q = q.order("row_number", { ascending: true });
      } else {
        q = after === null ? q.not(keyCol, "is", null) : q.gt(keyCol, after);
        q = q.order(keyCol, { ascending: true }).order("row_number", { ascending: true });
      }
      const got = await rows(q.limit(READ_LIMITS.page));
      rowsRead += got.length;
      for (const r of got) {
        const id = str(r[idCol]);
        const name = str(r[nameCol]);
        const key = hasId ? `i${id}` : `n${name}`;
        if (!seen.has(key) && seen.size < READ_LIMITS.page) seen.set(key, { id: hasId ? id : null, name, row: rowNumber(r) });
      }
      if (got.length < READ_LIMITS.page) { complete = true; break; }
      const last = got[got.length - 1];
      after = period !== null ? rowNumber(last) : str(last[keyCol]);
      if (after === null) break;
    }
    return { snapshot: meta.ref, dimension, period, periodRule: rule, entities: [...seen.values()], rowsRead, complete };
  });
}

/** Filled share per field from the snapshot's own blank counts; no records are read. */
export function readFieldCompleteness(db: SourceDirectClient, input: SourceFieldCompletenessQueryInput): Promise<SourceRead<SourceFieldCompleteness>> {
  return guarded(async () => {
    const meta = await snapshotMeta(db, input.datasetId, input.snapshotId, { quality: true });
    return { snapshot: meta.ref, fields: fieldCompleteness({ columns: meta.dict.columns, loaded_rows: meta.ref.rows, quality: meta.quality }) };
  });
}

// ---------------------------------------------------------------- B. reads that need migration 0069

const MISSING_TTL_MS = 10 * 60_000;
const missing = new Map<string, number>();
/** Whether a 0069 function was found missing in the last ten minutes (for screens that want to skip asking). */
export function knownMissing(fn: string, now = Date.now()): boolean {
  const at = missing.get(fn);
  return at !== undefined && now - at < MISSING_TTL_MS;
}
/** Test hook: forget missing functions and cached dictionaries. */
export function resetReadState() {
  missing.clear();
  dictionaries.clear();
  dictWeight = 0;
}
async function callNew<T>(db: SourceDirectClient, fn: string, args: Record<string, unknown>, check: (v: unknown) => v is T): Promise<SourceRead<T>> {
  if (knownMissing(fn)) return readFail("unavailable", "This read needs a database update that is not applied yet");
  let result: PgResult;
  try {
    result = await db.rpc(fn, args);
  } catch (e) {
    return readFail("error", e instanceof Error ? e.message : "The read failed");
  }
  if (result.error) {
    const f = classifyReadError(result.error);
    if (f.reason === "unavailable") missing.set(fn, Date.now());
    return failWith(f);
  }
  missing.delete(fn);
  if (result.data == null) return readFail("not-found", "No published dataset or snapshot by this address");
  if (!check(result.data)) return readFail("error", `${fn} answered in an unexpected shape`);
  return readOk(result.data);
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSnapshotRef = (v: unknown) => isObj(v) && typeof v.snapshotId === "string" && typeof v.rows === "number";
const isFacets = (v: unknown): v is SourceFacets => isObj(v) && isSnapshotRef(v.snapshot) && Array.isArray(v.values) && typeof v.complete === "boolean";
const isFind = (v: unknown): v is SourceFind => isObj(v) && typeof v.q === "string" && Array.isArray(v.hits);
const isStats = (v: unknown): v is SourceSnapshotStats => isObj(v) && isSnapshotRef(v.snapshot) && "periodMin" in v;

export const FACETS_DEFAULT_LIMIT = 200;
export const FIND_DEFAULT_LIMIT = 50;

/** Distinct values of one dimension with row counts (0069 `source_facets`). */
export function readSourceFacets(db: SourceDirectClient, input: SourceFacetsQueryInput): Promise<SourceRead<SourceFacets>> {
  return callNew(db, "source_facets", {
    _dataset_id: input.datasetId, _snapshot_id: input.snapshotId ?? null, _dimension: input.dimension,
    _after: input.after ?? null, _contains: input.contains || null, _limit: input.limit ?? FACETS_DEFAULT_LIMIT,
  }, isFacets);
}
/** Catalogue search including field labels (0069 `source_find`). */
export function readSourceFind(db: SourceDirectClient, input: SourceFindQueryInput): Promise<SourceRead<SourceFind>> {
  return callNew(db, "source_find", { _q: input.q, _limit: input.limit ?? FIND_DEFAULT_LIMIT }, isFind);
}
/** Period range and distinct counts computed by the worker (0069 `source_get_snapshot_stats`). */
export function readSnapshotStats(db: SourceDirectClient, input: SourceSnapshotStatsQueryInput): Promise<SourceRead<SourceSnapshotStats>> {
  return callNew(db, "source_get_snapshot_stats", { _dataset_id: input.datasetId, _snapshot_id: input.snapshotId ?? null }, isStats);
}
