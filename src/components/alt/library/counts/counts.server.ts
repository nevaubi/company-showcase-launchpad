/**
 * Server reads of unit counts, with the member's own client (row-level security applies):
 *
 * - `readCategoryCounts`: the values of up to eight fields counted over every record of a snapshot of at most 5,000
 *   rows. One select of the snapshot by key, then the series read of several fields (`readSourceSeriesFields`: at
 *   most five selects of 1,000 rows, one `values->>N` path per field). Only the counts go back. A larger snapshot is
 *   refused before any record is read, and a read that did not reach every record is refused after it: a part is
 *   never counted as the whole.
 * - `readTablePeriods`: the period range of every dataset's current snapshot from `source_snapshot_stats` (0069),
 *   through `source_datasets` with the current snapshot embedded. At most three selects of 1,000 dataset rows on
 *   small tables; `source_records` is never read.
 *
 * Both answer `SourceRead<T>` and keep their answers in the server process: a snapshot is immutable, so counts are
 * kept until the process ends (400 at most); the period ranges ten minutes.
 */
import { readSourceSeriesFields, type SourceDirectClient, type SourceSnapshotKnown, classifyReadError } from "@/lib/sources/read.server";
import { readFail, readOk, type SourceRead, type SourceSnapshotRef } from "@/lib/sources/read-types";
import type { SourceColumn, SourceIngest } from "@/lib/sources/schema";
import { CATEGORY_FIELDS_MAX, CATEGORY_READ_ROWS, countFields, type FieldCounts } from "./category-model";

export type CategoryCountsInput = { datasetId: string; snapshotId: string; fields: number[] };
export type CategoryCounts = { snapshot: SourceSnapshotRef; fields: FieldCounts[] };

const SNAPSHOT_SELECT = "id,dataset_id,loaded_rows,column_count,published_at,retrieved_at,file_sha256,columns,ingest";
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);

const COUNTS_LIMIT = 400;
const counted = new Map<string, CategoryCounts>();
const countFlight = new Map<string, Promise<SourceRead<CategoryCounts>>>();

/** Test hook: forget every kept answer. */
export function resetCountsCache() {
  counted.clear();
  countFlight.clear();
  periods = null;
  periodsFlight = null;
}

async function countOnce(db: SourceDirectClient, input: CategoryCountsInput): Promise<SourceRead<CategoryCounts>> {
  const fields = input.fields;
  if (!fields.length || fields.length > CATEGORY_FIELDS_MAX || new Set(fields).size !== fields.length)
    return readFail("invalid", `A count takes 1 to ${CATEGORY_FIELDS_MAX} different fields`);
  let found: { data: unknown; error: { message: string; code?: string | null } | null };
  try {
    found = await db.from("source_snapshots").select(SNAPSHOT_SELECT).eq("id", input.snapshotId).eq("dataset_id", input.datasetId).eq("status", "ready").limit(1);
  } catch (e) {
    return readFail("error", e instanceof Error ? e.message : "The read failed");
  }
  if (found.error) {
    const f = classifyReadError(found.error);
    return readFail(f.reason, f.message);
  }
  const row = Array.isArray(found.data) ? (found.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return readFail("not-found", "No published snapshot with this id for this dataset");
  const rows = num(row.loaded_rows);
  const width = num(row.column_count);
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(width) || !Array.isArray(row.columns)) return readFail("error", "The snapshot's counts are not numbers");
  if (rows > CATEGORY_READ_ROWS)
    return readFail("invalid", `Values are counted only on snapshots of at most ${CATEGORY_READ_ROWS.toLocaleString("en-US")} rows; this one has ${rows.toLocaleString("en-US")}`);
  const known: SourceSnapshotKnown = {
    ref: {
      datasetId: input.datasetId,
      snapshotId: input.snapshotId,
      publishedAt: str(row.published_at),
      retrievedAt: str(row.retrieved_at),
      fileSha256: str(row.file_sha256) ?? "",
      rows,
      fields: width,
    },
    columns: row.columns as SourceColumn[],
    ingest: (row.ingest && typeof row.ingest === "object" ? row.ingest : {}) as SourceIngest,
  };
  if (rows === 0) return readOk({ snapshot: known.ref, fields: countFields(fields, []) });
  const read = await readSourceSeriesFields(db, { datasetId: input.datasetId, snapshotId: input.snapshotId, fields, address: { whole: true }, limit: CATEGORY_READ_ROWS }, known);
  if (!read.ok) return read;
  if (read.data.points.length !== rows)
    return readFail("error", `The read reached ${read.data.points.length.toLocaleString("en-US")} of ${rows.toLocaleString("en-US")} records; a part is not counted`);
  return readOk({ snapshot: known.ref, fields: countFields(fields, read.data.points) });
}

/** Counts of the values of up to eight fields over every record of one small snapshot. */
export function readCategoryCounts(db: SourceDirectClient, input: CategoryCountsInput): Promise<SourceRead<CategoryCounts>> {
  const key = `${input.datasetId}|${input.snapshotId}|${input.fields.join(",")}`;
  const hit = counted.get(key);
  if (hit) return Promise.resolve(readOk(hit));
  let flight = countFlight.get(key);
  if (!flight) {
    flight = countOnce(db, input)
      .then((answer) => {
        if (answer.ok) {
          counted.set(key, answer.data);
          if (counted.size > COUNTS_LIMIT) counted.delete(counted.keys().next().value as string);
        }
        return answer;
      })
      .finally(() => countFlight.delete(key));
    countFlight.set(key, flight);
  }
  return flight;
}

// ---------------------------------------------------------------- period ranges of the library

/** One dataset: its id, the least and greatest period strings of its current snapshot, and how many periods. */
export type TablePeriod = { id: string; first: string | null; last: string | null; periods: number | null };
/**
 * As sent: `[id, first, last, periods]`, an id of the usual form `official_<rest>` as `<rest>` and any other as
 * `=<id>`. A period end longer than 40 characters is a note, not a period: both ends go as null and `periods` as -1.
 */
export type TablePeriodsWire = { rows: [string, string | null, string | null, number | null][]; builtAt: string };

export const TABLE_PERIODS_SELECT =
  "id,latest_snapshot_id,latest:source_snapshots!source_datasets_latest_fk(id,stats:source_snapshot_stats(period_min,period_max,periods))";
const PERIODS_TTL_MS = 10 * 60_000;
const PERIOD_PAGES = 3;
const PAGE = 1000;
const NOTE_LENGTH = 40;
let periods: { at: number; wire: TablePeriodsWire } | null = null;
let periodsFlight: Promise<SourceRead<TablePeriodsWire>> | null = null;

const packId = (id: string) => (id.startsWith("official_") && id.length > 9 && id[9] !== "=" ? id.slice(9) : `=${id}`);
export const unpackId = (id: string) => (id.startsWith("=") ? id.slice(1) : `official_${id}`);

/** The stats row of an embedded snapshot: PostgREST gives a one-to-one embed as an object (older versions as a list). */
function statsOf(latest: unknown): Record<string, unknown> | null {
  if (!latest || typeof latest !== "object") return null;
  const s = (latest as Record<string, unknown>).stats;
  if (Array.isArray(s)) return (s[0] as Record<string, unknown> | undefined) ?? null;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : null;
}

/** Packs the dataset rows of the select (pure, for tests). */
export function packTablePeriods(rows: readonly Record<string, unknown>[], builtAt: string): TablePeriodsWire {
  const out: TablePeriodsWire["rows"] = [];
  for (const r of rows) {
    const id = str(r.id);
    if (!id) continue;
    const latest = r.latest && typeof r.latest === "object" ? (r.latest as Record<string, unknown>) : null;
    // the embed must be the dataset's current snapshot; anything else is not this dataset's range
    if (!latest || str(latest.id) !== str(r.latest_snapshot_id)) continue;
    const stats = statsOf(latest);
    const first = str(stats?.period_min);
    const last = str(stats?.period_max);
    const count = num(stats?.periods);
    if ((first && first.length > NOTE_LENGTH) || (last && last.length > NOTE_LENGTH)) out.push([packId(id), null, null, -1]);
    else out.push([packId(id), first, last, Number.isSafeInteger(count) ? count : null]);
  }
  return { rows: out, builtAt };
}

export function unpackTablePeriods(wire: TablePeriodsWire): Map<string, TablePeriod & { note: boolean }> {
  return new Map(
    wire.rows.map(([id, first, last, count]) => {
      const full = unpackId(id);
      return [full, { id: full, first, last, periods: count === -1 ? null : count, note: count === -1 }];
    }),
  );
}

async function periodsOnce(db: SourceDirectClient, now: number): Promise<SourceRead<TablePeriodsWire>> {
  const all: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (let page = 0; page < PERIOD_PAGES; page++) {
    let q = db.from("source_datasets").select(TABLE_PERIODS_SELECT);
    if (after !== null) q = q.gt("id", after);
    let answer: { data: unknown; error: { message: string; code?: string | null } | null };
    try {
      answer = await q.order("id", { ascending: true }).limit(PAGE);
    } catch (e) {
      return readFail("error", e instanceof Error ? e.message : "The read failed");
    }
    if (answer.error) {
      const f = classifyReadError(answer.error);
      return readFail(f.reason, f.message);
    }
    const got = Array.isArray(answer.data) ? (answer.data as Record<string, unknown>[]) : [];
    all.push(...got);
    if (got.length < PAGE) {
      const wire = packTablePeriods(all, new Date(now).toISOString());
      periods = { at: now, wire };
      return readOk(wire);
    }
    after = str(got[got.length - 1].id);
    if (after === null) break;
  }
  return readFail("error", `More than ${(PERIOD_PAGES * PAGE).toLocaleString("en-US")} datasets; the period ranges are not read in part`);
}

/** The period range of every dataset's current snapshot, kept ten minutes. */
export function readTablePeriods(db: SourceDirectClient, now = Date.now()): Promise<SourceRead<TablePeriodsWire>> {
  if (periods && now - periods.at < PERIODS_TTL_MS) return Promise.resolve(readOk(periods.wire));
  if (!periodsFlight) periodsFlight = periodsOnce(db, now).finally(() => (periodsFlight = null));
  return periodsFlight;
}
