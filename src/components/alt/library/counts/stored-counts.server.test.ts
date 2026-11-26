import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb, type FakeRow as Row } from "@/lib/sources/read.fake";
import { readCategoryCounts, resetCountsCache, STORED_MISSING_MS, type FieldCountsClient, type FieldCountsSelect } from "./counts.server";

const H = (n: number) => n.toString(16).padStart(64, "0");
const SMALL = H(1), BIG = H(2);
const col = (key: string) => ({ key, label: key, type: "string" });
const snapshot = (id: string, dataset: string, rows: number, width: number): Row => ({
  id, dataset_id: dataset, status: "ready", loaded_rows: rows, column_count: width, published_at: "2026-11-25T06:08:17Z",
  retrieved_at: "2026-11-24T10:14:39Z", file_sha256: H(100), columns: Array.from({ length: width }, (_, i) => col(`f${i}`)), ingest: { format: "csv", dimensions: {} }, quality: {},
});
const rec = (snapshot_id: string, row_number: number, values: (string | null)[]): Row => ({
  snapshot_id, row_number, values, entity_id: null, entity_name: null, period: null, geo_level: null, geo_code: null, geo_name: null, source_url: null,
});
/** A stored row of a field of `records` records with two values. */
const stored = (snapshot_id: string, position: number, records: number, over: Record<string, unknown> = {}) => ({
  snapshot_id, position, filled: records, blank: 0, missing: 0, numeric_rows: 0, value_cap: 1000, distinct_values: 2, capped: null,
  top: [["Moody's", records - 10, 3], ["S&P", 10, 1]], other_rows: 0, other_values: 0, computed_at: "2026-11-26T08:10:00+00:00", ...over,
});

/** The stored counts table as PostgREST answers it: eq, in and limit applied; or one error for every call. */
class FakeCounts implements FieldCountsClient {
  calls: { columns: string; filters: string[]; limit: number | null }[] = [];
  constructor(public rows: Record<string, unknown>[], public error: { code?: string; message: string } | null = null) {}
  from(table: "source_field_counts") {
    if (table !== "source_field_counts") throw new Error(`unexpected table ${table}`);
    return {
      select: (columns: string) => {
        const call = { columns, filters: [] as string[], limit: null as number | null };
        this.calls.push(call);
        const tests: ((r: Record<string, unknown>) => boolean)[] = [];
        const builder: FieldCountsSelect = {
          eq: (c, v) => (call.filters.push(`${c}=eq`), tests.push((r) => r[c] === v), builder),
          in: (c, vs) => (call.filters.push(`${c}=in`), tests.push((r) => vs.includes(r[c] as never)), builder),
          limit: (n) => ((call.limit = n), builder),
          then: (ok, fail) =>
            Promise.resolve(this.error ? { data: null, error: this.error } : { data: this.rows.filter((r) => tests.every((t) => t(r))).slice(0, call.limit ?? undefined), error: null }).then(ok, fail),
        };
        return builder;
      },
    };
  }
}

let db: FakeSourceDb;
beforeEach(() => {
  resetCountsCache();
  db = new FakeSourceDb({
    source_datasets: [{ id: "small", latest_snapshot_id: SMALL }, { id: "nrsro", latest_snapshot_id: BIG }],
    source_snapshots: [snapshot(SMALL, "small", 30, 3), snapshot(BIG, "nrsro", 99413, 6)],
    source_records: Array.from({ length: 30 }, (_, i) => rec(SMALL, i + 1, [String(i), i < 20 ? "A" : "B", "x"])),
  });
});

describe("readCategoryCounts with stored field counts", () => {
  it("answers a large snapshot from its stored counts in one select of at most 25 rows, and reads no record", async () => {
    const counts = new FakeCounts([stored(BIG, 2, 99413), stored(BIG, 4, 99413), stored(BIG, 5, 99413, { distinct_values: null, capped: "values", top: [], other_rows: 99413, other_values: null })]);
    const r = await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [4, 2] }, counts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.fields.map((f) => f.position)).toEqual([4, 2]);
    expect(r.data.fields[0]).toMatchObject({ filled: 99413, distinct: 2, top: [{ value: "Moody's", rows: 99403, row: 3 }, { value: "S&P", rows: 10, row: 1 }] });
    expect(r.data.counted).toEqual({ from: "stored", records: 99413, computedAt: "2026-11-26T08:10:00+00:00" });
    expect(r.data.capped).toEqual([]);
    expect(r.data.snapshot).toMatchObject({ snapshotId: BIG, rows: 99413, fields: 6 });
    expect(counts.calls).toEqual([{ columns: expect.stringContaining("top"), filters: ["snapshot_id=eq", "position=in"], limit: 3 }]);
    expect(db.calls.filter((c) => c.table === "source_records")).toHaveLength(0);
  });

  it("names the fields asked for that were not counted value by value", async () => {
    const counts = new FakeCounts([stored(BIG, 1, 99413, { distinct_values: null, capped: "values", top: [], other_rows: 99413, other_values: null }), stored(BIG, 5, 99413)]);
    const r = await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [1] }, counts);
    expect(r.ok && r.data.capped).toEqual([{ position: 1, filled: 99413, blank: 0, missing: 0, cap: 1000, reason: "values" }]);
    expect(r.ok && r.data.fields).toEqual([]);
  });

  it("refuses a large snapshot whose counts are absent, incomplete or do not add up, before reading any record", async () => {
    for (const rows of [[], [stored(BIG, 2, 99413)], [stored(BIG, 2, 99413), stored(BIG, 5, 99412)]]) {
      resetCountsCache();
      const r = await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [2] }, new FakeCounts(rows));
      expect(r).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(db.calls.filter((c) => c.table === "source_records")).toHaveLength(0);
  });

  it("answers a small snapshot from its stored counts, unless a field asked for was capped there", async () => {
    const counts = new FakeCounts([stored(SMALL, 1, 30), stored(SMALL, 2, 30, { distinct_values: null, capped: "values", top: [], other_rows: 30, other_values: null })]);
    const r = await readCategoryCounts(db, { datasetId: "small", snapshotId: SMALL, fields: [1] }, counts);
    expect(r.ok && r.data.counted).toMatchObject({ from: "stored" });
    expect(db.calls.filter((c) => c.table === "source_records")).toHaveLength(0);
    const whole = await readCategoryCounts(db, { datasetId: "small", snapshotId: SMALL, fields: [1, 2] }, counts);
    expect(whole.ok && whole.data.counted).toEqual({ from: "records", records: 30 });
    expect(whole.ok && whole.data.fields.map((f) => f.position)).toEqual([1, 2]);
    expect(db.calls.filter((c) => c.table === "source_records")).toHaveLength(1);
  });

  it("counts a small snapshot's records as before when it has no stored counts, and says so", async () => {
    const r = await readCategoryCounts(db, { datasetId: "small", snapshotId: SMALL, fields: [1] }, new FakeCounts([]));
    expect(r.ok && r.data.fields[0]).toMatchObject({ filled: 30, top: [{ value: "A", rows: 20, row: 1 }, { value: "B", rows: 10, row: 21 }] });
    expect(r.ok && r.data.counted).toEqual({ from: "records", records: 30 });
    expect(db.calls.filter((c) => c.table === "source_records")).toHaveLength(1);
  });

  it("falls back while the table is missing, remembers it ten minutes, then looks again", async () => {
    const counts = new FakeCounts([], { code: "PGRST205", message: "Could not find the table 'public.source_field_counts' in the schema cache" });
    const t = 1_000_000;
    expect(await readCategoryCounts(db, { datasetId: "small", snapshotId: SMALL, fields: [1] }, counts, t)).toMatchObject({ ok: true });
    expect(await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [1] }, counts, t + 1000)).toMatchObject({ ok: false, reason: "invalid" });
    expect(counts.calls).toHaveLength(1);
    counts.error = null;
    counts.rows = [stored(BIG, 1, 99413), stored(BIG, 5, 99413)];
    expect(await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [1] }, counts, t + STORED_MISSING_MS)).toMatchObject({ ok: true });
    expect(counts.calls).toHaveLength(2);
  });

  it("counts a small snapshot's records when the stored read fails, and passes the failure on for a large one", async () => {
    const failing = new FakeCounts([], { code: "57014", message: "canceling statement due to statement timeout" });
    expect(await readCategoryCounts(db, { datasetId: "small", snapshotId: SMALL, fields: [1] }, failing)).toMatchObject({ ok: true });
    expect(await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [1] }, failing)).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("keeps a stored answer for the life of the process, as a counted one", async () => {
    const counts = new FakeCounts([stored(BIG, 2, 99413), stored(BIG, 5, 99413)]);
    await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [2] }, counts);
    await readCategoryCounts(db, { datasetId: "nrsro", snapshotId: BIG, fields: [2] }, counts);
    expect(counts.calls).toHaveLength(1);
  });
});
