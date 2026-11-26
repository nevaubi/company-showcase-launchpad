/**
 * Server reads of unit counts, with the member's own client (row-level security applies):
 *
 * - `readCategoryCounts`: the values of up to 24 fields counted over every record of a snapshot. One select of the
 *   snapshot by key; then, at any size, one select of the field counts stored with the snapshot (`source_field_counts`,
 *   migration 0070: the fields asked for and the snapshot's last field, at most 25 rows by primary key), used when
 *   they are complete and add up (`stored-counts.ts`) and, on a snapshot of at most 5,000 rows, no field asked for was
 *   capped there. Otherwise, on a snapshot of at most 5,000 rows, the records in file order by row number: at most
 *   five selects of 1,000 rows, one `values->>N` path per field. Only the counts go back, with where they come from
 *   (`counted`). A larger snapshot without stored counts is refused before any record is read, and a read that did not
 *   reach every record is refused after it: a part is never counted as the whole.
 *   While the table of 0070 is missing (PostgREST PGRST205, Postgres 42P01) the read is as before; the server
 *   remembers that for ten minutes and then looks again.
 * - `readTablePeriods`: the period range of every dataset's current snapshot from `source_snapshot_stats` (0069),
 *   through `source_datasets` with the current snapshot embedded. At most three selects of 1,000 dataset rows on
 *   small tables; `source_records` is never read.
 *
 * Both answer `SourceRead<T>` and keep their answers in the server process: a snapshot is immutable, so counts are
 * kept until the process ends (400 at most); the period ranges ten minutes.
 */
import { classifyReadError, type PgResult, type SourceDirectClient } from "@/lib/sources/read.server";
import { READ_LIMITS, readFail, readOk, type SourceRead, type SourceSnapshotRef } from "@/lib/sources/read-types";
import { CATEGORY_FIELDS_MAX, CATEGORY_READ_ROWS, countFields } from "./category-model";
import { FIELD_COUNTS_SELECT, storedCounts, storedPositions } from "./stored-counts";
import { packTablePeriods, type CategoryCounts, type CategoryCountsInput, type TablePeriodsWire } from "./wire";

export type { CategoryCounts, CategoryCountsInput, TablePeriod, TablePeriodsWire } from "./wire";


const SNAPSHOT_SELECT = "id,dataset_id,loaded_rows,column_count,published_at,retrieved_at,file_sha256";
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);

const COUNTS_LIMIT = 400;
const counted = new Map<string, CategoryCounts>();
const countFlight = new Map<string, Promise<SourceRead<CategoryCounts>>>();

/** The part of the PostgREST builder the stored counts read uses; the real client is the caller's own. */
export interface FieldCountsSelect extends PromiseLike<PgResult> {
  eq(column: string, value: string | number): FieldCountsSelect;
  in(column: string, values: readonly (string | number)[]): FieldCountsSelect;
  limit(count: number): FieldCountsSelect;
}
export type FieldCountsClient = { from(table: "source_field_counts"): { select(columns: string): FieldCountsSelect } };

/** How long a missing table of 0070 is taken as missing before the read looks for it again. */
export const STORED_MISSING_MS = 10 * 60_000;
let storedMissingAt: number | null = null;
const tableMissing = (error: { code?: string | null } | null) => error?.code === "PGRST205" || error?.code === "42P01";

/** Test hook: forget every kept answer. */
export function resetCountsCache() {
  counted.clear();
  countFlight.clear();
  periods = null;
  periodsFlight = null;
  storedMissingAt = null;
}

async function countOnce(db: SourceDirectClient, input: CategoryCountsInput, stored: FieldCountsClient | undefined, now: number): Promise<SourceRead<CategoryCounts>> {
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
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(width)) return readFail("error", "The snapshot's counts are not numbers");
  if (fields.some((f) => f >= width)) return readFail("invalid", `A field position is outside the dictionary of ${width} fields`);
  const ref: SourceSnapshotRef = {
    datasetId: input.datasetId,
    snapshotId: input.snapshotId,
    publishedAt: str(row.published_at),
    retrievedAt: str(row.retrieved_at),
    fileSha256: str(row.file_sha256) ?? "",
    rows,
    fields: width,
  };
  // the counts stored with the snapshot, at any size: one select by primary key of at most 25 rows
  if (stored && (storedMissingAt === null || now - storedMissingAt >= STORED_MISSING_MS)) {
    const asked = storedPositions(fields, width);
    let answer: PgResult;
    try {
      answer = await stored.from("source_field_counts").select(FIELD_COUNTS_SELECT).eq("snapshot_id", input.snapshotId).in("position", asked).limit(asked.length);
    } catch (e) {
      answer = { data: null, error: { message: e instanceof Error ? e.message : "The read failed" } };
    }
    if (answer.error && tableMissing(answer.error)) storedMissingAt = now;
    else if (answer.error) {
      // the records can still be counted on a small snapshot; a large one has no other way
      if (rows > CATEGORY_READ_ROWS) {
        const f = classifyReadError(answer.error);
        return readFail(f.reason, f.message);
      }
    } else {
      storedMissingAt = null;
      const kept = storedCounts(Array.isArray(answer.data) ? answer.data : [], fields, width, rows);
      // A small snapshot is read whole when a field asked for was capped: its records give exact counts of every
      // value, so stored counts never show less than the request-time read did.
      if (kept && (rows > CATEGORY_READ_ROWS || kept.capped.length === 0))
        return readOk({ snapshot: ref, fields: kept.fields, capped: kept.capped, counted: { from: "stored", records: rows, computedAt: kept.computedAt } });
    }
  }
  if (rows > CATEGORY_READ_ROWS)
    return readFail(
      "invalid",
      `Values are counted on request only on snapshots of at most ${CATEGORY_READ_ROWS.toLocaleString("en-US")} rows, and this one of ${rows.toLocaleString("en-US")} has no stored field counts`,
    );
  // every record in file order: at most five selects of 1,000 rows, each field one `values->>N` path
  const select = `row_number,${fields.map((f, i) => `c${i}:values->>${f}`).join(",")}`;
  const read: { row: number; cells: (string | null)[] }[] = [];
  let after = 0;
  for (let page = 0; page < READ_LIMITS.pages && read.length < rows; page++) {
    let answer: { data: unknown; error: { message: string; code?: string | null } | null };
    try {
      answer = await db.from("source_records").select(select).eq("snapshot_id", input.snapshotId).gt("row_number", after).order("row_number", { ascending: true }).limit(READ_LIMITS.page);
    } catch (e) {
      return readFail("error", e instanceof Error ? e.message : "The read failed");
    }
    if (answer.error) {
      const f = classifyReadError(answer.error);
      return readFail(f.reason, f.message);
    }
    const got = Array.isArray(answer.data) ? (answer.data as Record<string, unknown>[]) : [];
    for (const r of got) {
      const n = num(r.row_number);
      if (!Number.isSafeInteger(n) || n < 1) return readFail("error", "A record came back without a row number");
      read.push({ row: n, cells: fields.map((_, i) => str(r[`c${i}`])) });
    }
    if (got.length < READ_LIMITS.page) break;
    after = read[read.length - 1].row;
  }
  if (read.length !== rows)
    return readFail("error", `The read reached ${read.length.toLocaleString("en-US")} of ${rows.toLocaleString("en-US")} records; a part is not counted`);
  return readOk({ snapshot: ref, fields: countFields(fields, read), capped: [], counted: { from: "records", records: rows } });
}

/**
 * Counts of the values of up to 24 fields over every record of one snapshot: from the counts stored with it when
 * `stored` is given and they are there, otherwise from the records of a snapshot of at most 5,000 rows.
 */
export function readCategoryCounts(db: SourceDirectClient, input: CategoryCountsInput, stored?: FieldCountsClient, now = Date.now()): Promise<SourceRead<CategoryCounts>> {
  const key = `${input.datasetId}|${input.snapshotId}|${input.fields.join(",")}`;
  const hit = counted.get(key);
  if (hit) return Promise.resolve(readOk(hit));
  let flight = countFlight.get(key);
  if (!flight) {
    flight = countOnce(db, input, stored, now)
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

export const TABLE_PERIODS_SELECT =
  "id,latest_snapshot_id,latest:source_snapshots!source_datasets_latest_fk(id,stats:source_snapshot_stats(period_min,period_max,periods))";
const PERIODS_TTL_MS = 10 * 60_000;
const PERIOD_PAGES = 3;
const PAGE = 1000;
let periods: { at: number; wire: TablePeriodsWire } | null = null;
let periodsFlight: Promise<SourceRead<TablePeriodsWire>> | null = null;

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
