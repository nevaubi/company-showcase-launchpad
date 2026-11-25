/**
 * Bounded direct reads of one snapshot's records with the member's own client (row level security applies:
 * policies "Members read published source ..." of migration 0068). Every read of `source_records` names one
 * `snapshot_id` and is served by an index: the primary key (snapshot_id, row_number) for row ranges, the period
 * index (snapshot_id, period, row_number) for newest-first order, the entity and place indexes for filters.
 * Single fields are read as `values->>N`; the whole `values` array only for one record. At most 25 rows a page,
 * at most five calls a page. Values are the stored strings: nothing is parsed here.
 *
 * Why not `source_query_records`: it can only read in file order, and its free-text test reads the whole
 * snapshot when matches are rare (rev-app M4). Here a name search reads at most 50,000 rows a press, in windows
 * of 10,000 by row number, and says how far it got.
 */

export type ReadErrorReason = "timeout" | "not-found" | "error";
export class ReadError extends Error {
  constructor(
    public reason: ReadErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "ReadError";
  }
}

type PgError = { message: string; code?: string };
type Answer = { data: unknown; error: PgError | null };

/** The part of the Supabase query builder these reads use. The app's client satisfies it. */
export interface Select extends PromiseLike<Answer> {
  select(columns: string): Select;
  eq(column: string, value: string | number): Select;
  neq(column: string, value: string | number): Select;
  gt(column: string, value: string | number): Select;
  lt(column: string, value: string | number): Select;
  gte(column: string, value: string | number): Select;
  lte(column: string, value: string | number): Select;
  in(column: string, values: readonly (string | number)[]): Select;
  not(column: string, operator: string, value: unknown): Select;
  or(filters: string): Select;
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Select;
  limit(count: number): Select;
  abortSignal(signal: AbortSignal): Select;
}
export interface ReadClient {
  from(table: string): Select;
}

export const PAGE_SIZE = 25;
/** Rows a name search reads per call, and calls per press. */
export const SCAN_WINDOW = 10_000;
export const SCAN_CALLS = 5;

export type RecordOrder = "new" | "file";
export type RecordFilter = { entity?: string; geography?: string; period?: string; q?: string };
/** Which dimensions the snapshot fills (from `ingest.dimensions`, `constants` and `composites`). */
export type RecordDims = { entityId: boolean; entityName: boolean; geoCode: boolean; geoName: boolean; period: boolean };

export type RecordRow = {
  row: number;
  /** Cells of the requested positions, in request order. */
  cells: (string | null)[];
  entityId: string | null;
  entityName: string | null;
  period: string | null;
  geoLevel: string | null;
  geoCode: string | null;
  geoName: string | null;
  sourceUrl: string | null;
};

export type RecordPage = {
  /** In display order. */
  rows: RecordRow[];
  /** Cursor of the next page (`after`), or null at the end. */
  next: number | null;
  /** Cursor of the previous page (`before`), or null at the start. */
  previous: number | null;
  /** For a name search: the row numbers read by this request and whether the snapshot is read to its end. */
  scan: { from: number; to: number; complete: boolean } | null;
};

export type RecordPageQuery = {
  snapshotId: string;
  /** Rows in the snapshot (`loaded_rows`). */
  total: number;
  dims: RecordDims;
  order: RecordOrder;
  filter: RecordFilter;
  after?: number;
  before?: number;
  columns: readonly number[];
  limit?: number;
  signal?: AbortSignal;
};

const DIMENSIONS = "row_number,entity_id,entity_name,period,geo_level,geo_code,geo_name,source_url";

export function recordSelect(columns: readonly number[]): string {
  return [DIMENSIONS, ...columns.map((c) => `c${c}:values->>${c}`)].join(",");
}

/**
 * A value inside a PostgREST `or=(...)` list. Double quotes protect commas, dots and parentheses; a quote or a
 * backslash inside is escaped with a backslash.
 */
export function orValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A substring pattern for `ilike`: the reader's % and _ are literal, * stays a wildcard. */
export function containsPattern(text: string): string {
  return `*${text.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`)}*`;
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toRow(raw: Record<string, unknown>, columns: readonly number[]): RecordRow {
  const row = raw.row_number;
  if (typeof row !== "number" || !Number.isSafeInteger(row)) throw new ReadError("error", "A record came back without its row number.");
  return {
    row,
    cells: columns.map((c) => text(raw[`c${c}`])),
    entityId: text(raw.entity_id),
    entityName: text(raw.entity_name),
    period: text(raw.period),
    geoLevel: text(raw.geo_level),
    geoCode: text(raw.geo_code),
    geoName: text(raw.geo_name),
    sourceUrl: text(raw.source_url),
  };
}

export function readError(error: PgError): ReadError {
  if (error.code === "57014" || /statement timeout|canceling statement/i.test(error.message))
    return new ReadError("timeout", "The database took too long to answer this read.");
  return new ReadError("error", error.message || "The read failed.");
}

async function rows(q: Select): Promise<Record<string, unknown>[]> {
  const { data, error } = await q;
  if (error) throw readError(error);
  if (!Array.isArray(data)) throw new ReadError("error", "Unexpected answer from the database.");
  return data as Record<string, unknown>[];
}

/** Indexed equality filters for entity, place and period; the name search is added by the scan. */
function filtered(q: Select, dims: RecordDims, filter: RecordFilter): Select {
  let out = q;
  if (filter.entity) {
    if (dims.entityId && dims.entityName) out = out.or(`entity_id.eq.${orValue(filter.entity)},entity_name.eq.${orValue(filter.entity)}`);
    else if (dims.entityName) out = out.eq("entity_name", filter.entity);
    else out = out.eq("entity_id", filter.entity);
  }
  if (filter.geography) {
    if (dims.geoCode && dims.geoName) out = out.or(`geo_code.eq.${orValue(filter.geography)},geo_name.eq.${orValue(filter.geography)}`);
    else if (dims.geoName) out = out.eq("geo_name", filter.geography);
    else out = out.eq("geo_code", filter.geography);
  }
  if (filter.period) out = out.eq("period", filter.period);
  return out;
}

/** Dimensions a name search looks in: names first, identifiers where the snapshot has no names. */
export function searchColumns(dims: RecordDims): string[] {
  const cols: string[] = [];
  if (dims.entityName) cols.push("entity_name");
  if (dims.geoName) cols.push("geo_name");
  if (dims.entityId) cols.push("entity_id");
  if (dims.geoCode) cols.push("geo_code");
  return cols;
}

export const canSearchNames = (dims: RecordDims) => searchColumns(dims).length > 0;

type Ctx = { db: ReadClient; query: RecordPageQuery; limit: number };

function base(ctx: Ctx): Select {
  const { db, query } = ctx;
  let q = db.from("source_records").select(recordSelect(query.columns)).eq("snapshot_id", query.snapshotId);
  q = filtered(q, query.dims, query.filter);
  return query.signal ? q.abortSignal(query.signal) : q;
}

async function exists(ctx: Ctx, edit: (q: Select) => Select): Promise<boolean> {
  const { db, query } = ctx;
  let q = filtered(db.from("source_records").select("row_number").eq("snapshot_id", query.snapshotId), query.dims, query.filter);
  if (query.signal) q = q.abortSignal(query.signal);
  return (await rows(edit(q).limit(1))).length > 0;
}

const hasFilter = (f: RecordFilter) => !!(f.entity || f.geography || f.period);

/** File order: one call, plus one probe in the other direction when a filter makes row numbers sparse. */
async function fileOrder(ctx: Ctx): Promise<RecordPage> {
  const { query, limit } = ctx;
  const filter = hasFilter(query.filter);
  if (query.before !== undefined) {
    const before = query.before;
    const got = (await rows(base(ctx).lt("row_number", before).order("row_number", { ascending: false }).limit(limit + 1))).map((r) =>
      toRow(r, query.columns),
    );
    const page = got.slice(0, limit).reverse();
    const later = filter ? await exists(ctx, (p) => p.gte("row_number", before)) : before <= query.total;
    return {
      rows: page,
      previous: got.length > limit ? page[0].row : null,
      next: later ? (page.length ? page[page.length - 1].row : before - 1) : null,
      scan: null,
    };
  }
  const after = query.after ?? 0;
  const got = (await rows(base(ctx).gt("row_number", after).order("row_number", { ascending: true }).limit(limit + 1))).map((r) =>
    toRow(r, query.columns),
  );
  const page = got.slice(0, limit);
  const earlier = after === 0 ? false : filter ? await exists(ctx, (p) => p.lte("row_number", after)) : true;
  return {
    rows: page,
    next: got.length > limit ? page[page.length - 1].row : null,
    previous: earlier ? (page.length ? page[0].row : after + 1) : null,
    scan: null,
  };
}

/** The period of one record (primary key probe); found is false when the record is not in this snapshot. */
async function periodOf(ctx: Ctx, row: number): Promise<{ found: boolean; period: string | null }> {
  const { db, query } = ctx;
  let q = db.from("source_records").select("row_number,period").eq("snapshot_id", query.snapshotId).eq("row_number", row);
  if (query.signal) q = q.abortSignal(query.signal);
  const got = await rows(q.limit(1));
  return got.length ? { found: true, period: text(got[0].period) } : { found: false, period: null };
}

/**
 * Newest first: period descending, then row number descending; rows without a period are left out (they are
 * in file order). A page is at most three calls: the period of the cursor row, the rest of that period, then
 * the periods beyond it.
 */
async function newestOrder(ctx: Ctx): Promise<RecordPage> {
  const { query, limit } = ctx;
  const take = limit + 1;
  const read = async (q: Select, n: number) => (await rows(q.limit(n))).map((r) => toRow(r, query.columns));
  const backward = query.before !== undefined;
  const cursorRow = backward ? query.before : query.after;
  if (!cursorRow) {
    const got = await read(base(ctx).not("period", "is", null).order("period", { ascending: false }).order("row_number", { ascending: false }), take);
    const page = got.slice(0, limit);
    return { rows: page, next: got.length > limit ? page[page.length - 1].row : null, previous: null, scan: null };
  }
  const at = await periodOf(ctx, cursorRow);
  if (!at.found || at.period === null) throw new ReadError("not-found", `Record ${cursorRow} is not in this version, or has no period.`);
  const p = at.period;
  // inside the cursor's period, rows that come later in this order have smaller numbers
  let got = backward
    ? await read(base(ctx).eq("period", p).gt("row_number", cursorRow).order("row_number", { ascending: true }), take)
    : await read(base(ctx).eq("period", p).lt("row_number", cursorRow).order("row_number", { ascending: false }), take);
  if (got.length < take) {
    const beyond = backward
      ? base(ctx).gt("period", p).order("period", { ascending: true }).order("row_number", { ascending: true })
      : base(ctx).lt("period", p).order("period", { ascending: false }).order("row_number", { ascending: false });
    got = got.concat(await read(beyond, take - got.length));
  }
  const page = got.slice(0, limit);
  if (backward) {
    page.reverse();
    return { rows: page, previous: got.length > limit ? page[0].row : null, next: page.length ? page[page.length - 1].row : null, scan: null };
  }
  return { rows: page, next: got.length > limit ? page[page.length - 1].row : null, previous: page.length ? page[0].row : null, scan: null };
}

/**
 * Name search in file order, read in windows of row numbers so that no call reads more than SCAN_WINDOW rows.
 * Stops at a full page, at the end of the snapshot, or after SCAN_CALLS windows; `scan` says how far it read.
 */
async function nameSearch(ctx: Ctx): Promise<RecordPage> {
  const { query, limit } = ctx;
  const cols = searchColumns(query.dims);
  if (!cols.length) throw new ReadError("error", "This table has no names to search.");
  const pattern = containsPattern(query.filter.q ?? "");
  const expr = cols.map((c) => `${c}.ilike.${orValue(pattern)}`).join(",");
  const take = limit + 1;
  const backward = query.before !== undefined;
  const found: RecordRow[] = [];
  // inclusive bounds of the window being read, and the last row number known to be read
  let lo = backward ? Math.max(1, query.before! - SCAN_WINDOW) : (query.after ?? 0) + 1;
  let hi = backward ? query.before! - 1 : Math.min(query.total, lo + SCAN_WINDOW - 1);
  const start = backward ? hi : lo;
  let reached = backward ? hi + 1 : lo - 1;
  for (let call = 0; call < SCAN_CALLS && lo <= hi; call += 1) {
    const sel = base(ctx).or(expr).gte("row_number", lo).lte("row_number", hi).order("row_number", { ascending: !backward });
    found.push(...(await rows(sel.limit(take - found.length))).map((r) => toRow(r, query.columns)));
    if (found.length >= take) {
      reached = found[found.length - 1].row;
      break;
    }
    reached = backward ? lo : hi;
    if (backward) {
      hi = lo - 1;
      lo = Math.max(1, hi - SCAN_WINDOW + 1);
    } else {
      lo = hi + 1;
      hi = Math.min(query.total, lo + SCAN_WINDOW - 1);
    }
  }
  const full = found.length > limit;
  const page = found.slice(0, limit);
  if (backward) {
    page.reverse();
    const previous = full ? page[0].row : reached > 1 ? reached : null;
    return {
      rows: page,
      previous,
      next: page.length ? page[page.length - 1].row : query.before! - 1,
      scan: { from: full ? page[0].row : reached, to: start, complete: !full && reached <= 1 },
    };
  }
  const next = full ? page[page.length - 1].row : reached < query.total ? reached : null;
  const after = query.after ?? 0;
  return {
    rows: page,
    next,
    previous: after > 0 ? (page.length ? page[0].row : after + 1) : null,
    scan: { from: start, to: full ? page[page.length - 1].row : reached, complete: !full && reached >= query.total },
  };
}

export async function readRecordPage(db: ReadClient, query: RecordPageQuery): Promise<RecordPage> {
  if (!query.columns.length) throw new ReadError("error", "Choose at least one field.");
  const ctx: Ctx = { db, query, limit: Math.min(query.limit ?? PAGE_SIZE, 100) };
  if (query.filter.q) return nameSearch(ctx);
  if (query.order === "new" && query.dims.period) return newestOrder(ctx);
  return fileOrder(ctx);
}

/** One whole record: every cell of the stored row. */
export type WholeRecord = Omit<RecordRow, "cells"> & { values: (string | null)[] };

export async function readRecord(db: ReadClient, snapshotId: string, row: number, signal?: AbortSignal): Promise<WholeRecord | null> {
  let q = db.from("source_records").select(`${DIMENSIONS},values`).eq("snapshot_id", snapshotId).eq("row_number", row);
  if (signal) q = q.abortSignal(signal);
  const got = await rows(q.limit(1));
  if (!got.length) return null;
  const raw = got[0];
  const values = raw.values;
  if (!Array.isArray(values) || !values.every((v) => v === null || typeof v === "string"))
    throw new ReadError("error", "The stored record is not a list of strings.");
  const { cells: _cells, ...dims } = toRow(raw, []);
  return { ...dims, values: values as (string | null)[] };
}

/** Every published snapshot of a dataset with its file facts, newest first (at most 50). */
export type SnapshotVersion = {
  id: string;
  fileSha256: string;
  retrievedAt: string | null;
  publishedAt: string | null;
  rows: number;
  expectedRows: number;
  createdAt: string | null;
  refreshFamily: string | null;
  bytes: number | null;
  parts: number | null;
  contentType: string | null;
  verifiedAt: string | null;
};

export async function readVersions(db: ReadClient, datasetId: string, signal?: AbortSignal): Promise<SnapshotVersion[]> {
  let q = db
    .from("source_snapshots")
    .select("id,file_sha256,retrieved_at,published_at,expected_rows,loaded_rows,created_at,refresh:coverage->refresh_provenance->>family")
    .eq("dataset_id", datasetId)
    .eq("status", "ready");
  if (signal) q = q.abortSignal(signal);
  const snaps = await rows(q.order("published_at", { ascending: false, nullsFirst: false }).limit(50));
  const hashes = [...new Set(snaps.map((s) => text(s.file_sha256)).filter((h): h is string => !!h))];
  const files = new Map<string, Record<string, unknown>>();
  if (hashes.length) {
    let f = db.from("source_files").select("sha256,bytes,content_type,verified_at,chunks").in("sha256", hashes);
    if (signal) f = f.abortSignal(signal);
    for (const file of await rows(f.limit(hashes.length))) files.set(String(file.sha256), file);
  }
  return snaps.map((s) => {
    const file = files.get(String(s.file_sha256));
    const chunks = file?.chunks;
    return {
      id: String(s.id),
      fileSha256: String(s.file_sha256),
      retrievedAt: text(s.retrieved_at),
      publishedAt: text(s.published_at),
      rows: Number(s.loaded_rows),
      expectedRows: Number(s.expected_rows),
      createdAt: text(s.created_at),
      refreshFamily: text(s.refresh),
      bytes: typeof file?.bytes === "number" ? file.bytes : null,
      parts: Array.isArray(chunks) ? chunks.length : null,
      contentType: text(file?.content_type),
      verifiedAt: text(file?.verified_at),
    };
  });
}

/** The stored row of another dataset (a parent) and when its latest file was retrieved: two primary key selects. */
export type DatasetBrief = {
  id: string;
  name: string;
  sector: string;
  agency: string;
  source_id: string | null;
  source_url: string | null;
  grain: string;
  latestSnapshotId: string | null;
  retrievedAt: string | null;
  publishedAt: string | null;
};

export async function readDatasetBrief(db: ReadClient, datasetId: string, signal?: AbortSignal): Promise<DatasetBrief | null> {
  let q = db.from("source_datasets").select("id,name,sector,agency,source_id,source_url,grain,latest_snapshot_id").eq("id", datasetId);
  if (signal) q = q.abortSignal(signal);
  const got = await rows(q.limit(1));
  if (!got.length) return null;
  const d = got[0];
  const latest = text(d.latest_snapshot_id);
  let retrievedAt: string | null = null;
  let publishedAt: string | null = null;
  if (latest) {
    let s = db.from("source_snapshots").select("id,retrieved_at,published_at").eq("id", latest);
    if (signal) s = s.abortSignal(signal);
    const snap = await rows(s.limit(1));
    retrievedAt = text(snap[0]?.retrieved_at);
    publishedAt = text(snap[0]?.published_at);
  }
  return {
    id: String(d.id),
    name: text(d.name) ?? "",
    sector: text(d.sector) ?? "",
    agency: text(d.agency) ?? "",
    source_id: text(d.source_id),
    source_url: text(d.source_url),
    grain: text(d.grain) ?? "",
    latestSnapshotId: latest,
    retrievedAt,
    publishedAt,
  };
}
