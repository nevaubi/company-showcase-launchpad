import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb, type FakeRow as Row } from "@/lib/sources/read.fake";
import type { PgResult, SourceDirectClient, SourceSelect } from "@/lib/sources/read.server";
import type { SourceFacets, SourceRead } from "@/lib/sources/read-types";
import { readCategoryCounts, readTablePeriods, resetCountsCache, TABLE_PERIODS_SELECT } from "./counts.server";
import { packTablePeriods, unpackTablePeriods } from "./wire";
import { readAllFacets } from "./queries";

const H = (n: number) => n.toString(16).padStart(64, "0");
const SMALL = H(1), WIDE = H(2), BIG = H(3);
const col = (key: string) => ({ key, label: key, type: "string" });
const snapshot = (id: string, dataset: string, rows: number, columns: ReturnType<typeof col>[]): Row => ({
  id, dataset_id: dataset, status: "ready", loaded_rows: rows, column_count: columns.length, published_at: "2026-11-25T05:30:00Z",
  retrieved_at: "2026-11-25T05:00:00Z", file_sha256: H(100), columns, ingest: { format: "csv", dimensions: {} }, quality: {},
});
const rec = (snapshot_id: string, row_number: number, values: (string | null)[]): Row => ({
  snapshot_id, row_number, values, entity_id: null, entity_name: null, period: null, geo_level: null, geo_code: null, geo_name: null, source_url: null,
});

let db: FakeSourceDb;
beforeEach(() => {
  resetCountsCache();
  // SMALL: 2,462 rows, an application type of two values and a code of 25 values. BIG: 60,000 rows, never read.
  const types = ["N", "A"];
  const small = Array.from({ length: 2462 }, (_, i) => rec(SMALL, i + 1, [String(10000 + (i % 800)), i % 31 === 0 ? types[1] : types[0], `C${i % 25}`, i % 500 === 0 ? "" : "x"]));
  const wide = Array.from({ length: 5000 }, (_, i) => rec(WIDE, i + 1, [String(i % 3)]));
  db = new FakeSourceDb({
    source_datasets: [{ id: "ob", latest_snapshot_id: SMALL }, { id: "wide", latest_snapshot_id: WIDE }, { id: "big", latest_snapshot_id: BIG }],
    source_snapshots: [
      snapshot(SMALL, "ob", 2462, [col("Appl_No"), col("Appl_Type"), col("Exclusivity_Code"), col("Note")]),
      snapshot(WIDE, "wide", 5000, [col("k")]),
      snapshot(BIG, "big", 60000, [col("a")]),
    ],
    source_records: [...small, ...wide],
  });
});

describe("readCategoryCounts", () => {
  it("counts every record of a small snapshot in at most five selects of 1,000 rows, one path per field", async () => {
    const r = await readCategoryCounts(db, { datasetId: "ob", snapshotId: SMALL, fields: [1, 2, 3] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [type, code, note] = r.data.fields;
    expect(type).toMatchObject({ position: 1, filled: 2462, distinct: 2, top: [{ value: "N", rows: 2382, row: 2 }, { value: "A", rows: 80, row: 1 }] });
    expect(code).toMatchObject({ position: 2, distinct: 25, otherValues: 15 });
    expect(code.top[0]).toEqual({ value: "C0", rows: 99, row: 1 });
    expect(note).toMatchObject({ blank: 5, filled: 2457, distinct: 1 });
    const reads = db.calls.filter((c) => c.table === "source_records");
    expect(reads).toHaveLength(3);
    expect(reads.every((c) => (c.limit ?? 0) <= 1000 && c.filters.some((f) => f.startsWith("snapshot_id")))).toBe(true);
    expect(reads[0].columns).toBe("row_number,c0:values->>1,c1:values->>2,c2:values->>3");
    expect(r.data.snapshot).toMatchObject({ snapshotId: SMALL, rows: 2462, fields: 4 });
  });

  it("reads a snapshot of exactly 5,000 rows whole and keeps the answer", async () => {
    const r = await readCategoryCounts(db, { datasetId: "wide", snapshotId: WIDE, fields: [0] });
    expect(r.ok && r.data.fields[0].filled).toBe(5000);
    const calls = db.calls.length;
    await readCategoryCounts(db, { datasetId: "wide", snapshotId: WIDE, fields: [0] });
    expect(db.calls.length).toBe(calls);
  });

  it("refuses a larger snapshot before reading any record, and a wrong snapshot", async () => {
    const r = await readCategoryCounts(db, { datasetId: "big", snapshotId: BIG, fields: [0] });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(db.calls.filter((c) => c.table === "source_records")).toHaveLength(0);
    expect(await readCategoryCounts(db, { datasetId: "ob", snapshotId: BIG, fields: [0] })).toMatchObject({ ok: false, reason: "not-found" });
    expect(await readCategoryCounts(db, { datasetId: "ob", snapshotId: SMALL, fields: [1, 1] })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await readCategoryCounts(db, { datasetId: "ob", snapshotId: SMALL, fields: [9] })).toMatchObject({ ok: false, reason: "invalid" });
  });
});

/** A client that answers the dataset select of the period ranges from pages of rows, and records what it was asked. */
function datasetPages(pages: Row[][]): SourceDirectClient & { asked: string[] } {
  const asked: string[] = [];
  let call = 0;
  const select = (columns: string): SourceSelect => {
    asked.push(columns);
    const answer: PgResult = { data: pages[call++] ?? [], error: null };
    const self: SourceSelect = {
      eq: () => self, gt: () => self, lt: () => self, not: () => self, order: () => self, limit: () => self,
      then: (ok, bad) => Promise.resolve(answer).then(ok, bad),
    };
    return self;
  };
  return { asked, from: () => ({ select }), rpc: () => Promise.resolve({ data: null, error: null }) };
}

describe("table periods", () => {
  it("packs each dataset's current range, drops a range of another snapshot and a note in place of a period", () => {
    const rows: Row[] = [
      { id: "official_04_energy_coal", latest_snapshot_id: "s1", latest: { id: "s1", stats: { period_min: "2000", period_max: "2026", periods: 27 } } },
      { id: "official_05_utilities_notes", latest_snapshot_id: "s2", latest: { id: "s2", stats: [{ period_min: "Note- Meters for the Behind the Meter utilities are not counted", period_max: "x", periods: 2 }] } },
      { id: "fred_unrate", latest_snapshot_id: "s3", latest: { id: "s3", stats: null } },
      { id: "official_moved", latest_snapshot_id: "s4", latest: { id: "s9", stats: { period_min: "1", period_max: "2", periods: 2 } } },
    ];
    const wire = packTablePeriods(rows, "2026-11-26T04:00:00.000Z");
    expect(wire.rows).toEqual([
      ["04_energy_coal", "2000", "2026", 27],
      ["05_utilities_notes", null, null, -1],
      ["=fred_unrate", null, null, null],
    ]);
    const map = unpackTablePeriods(wire);
    expect(map.get("official_04_energy_coal")).toEqual({ id: "official_04_energy_coal", first: "2000", last: "2026", periods: 27, note: false });
    expect(map.get("official_05_utilities_notes")?.note).toBe(true);
    expect(map.get("fred_unrate")?.periods).toBeNull();
  });

  it("reads pages of 1,000 datasets with the embedded statistics and keeps the answer ten minutes", async () => {
    const page = (from: number, n: number): Row[] =>
      Array.from({ length: n }, (_, i) => ({ id: `official_t${String(from + i).padStart(5, "0")}`, latest_snapshot_id: `s${from + i}`, latest: { id: `s${from + i}`, stats: { period_min: "2001", period_max: "2002", periods: 2 } } }));
    const client = datasetPages([page(0, 1000), page(1000, 56)]);
    const r = await readTablePeriods(client, 1_000);
    expect(r.ok && r.data.rows).toHaveLength(1056);
    expect(client.asked).toEqual([TABLE_PERIODS_SELECT, TABLE_PERIODS_SELECT]);
    await readTablePeriods(client, 1_000 + 9 * 60_000);
    expect(client.asked).toHaveLength(2);
  });

  it("refuses to answer in part when there are more datasets than three pages", async () => {
    const many = Array.from({ length: 3 }, (_, p) => Array.from({ length: 1000 }, (_, i) => ({ id: `official_${p}_${String(i).padStart(4, "0")}`, latest_snapshot_id: "s", latest: { id: "s", stats: null } })));
    const r = await readTablePeriods(datasetPages(many), 5_000);
    expect(r).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("readAllFacets", () => {
  const ref = { datasetId: "d", snapshotId: H(5), publishedAt: null, retrievedAt: null, fileSha256: H(6), rows: 600000, fields: 3 };
  const answer = (values: string[], complete: boolean, nextAfter: string | null): SourceRead<SourceFacets> => ({
    ok: true,
    data: { snapshot: ref, dimension: "period", values: values.map((value) => ({ value, label: null, rows: 1, exact: true })), complete, nextAfter },
  });

  it("follows the pages in value order until one is complete", async () => {
    const asked: (string | undefined)[] = [];
    const pages = [answer(["2001", "2002"], false, "2002"), answer(["2003"], true, null)];
    const r = await readAllFacets(async (after) => {
      asked.push(after);
      return pages[asked.length - 1];
    });
    expect(asked).toEqual([undefined, "2002"]);
    expect(r).toMatchObject({ ok: true, data: { complete: true, pages: 2 } });
    expect(r.ok && r.data.values.map((v) => v.value)).toEqual(["2001", "2002", "2003"]);
  });

  it("stops at five pages, and keeps what it read when a later page fails", async () => {
    let i = 0;
    const r = await readAllFacets(async () => answer([String(2000 + i)], false, String(2000 + i++)));
    expect(r).toMatchObject({ ok: true, data: { complete: false, pages: 5 } });
    const failing = await readAllFacets(async (after) => (after ? { ok: false, reason: "timeout", message: "cut" } : answer(["a"], false, "a")));
    expect(failing).toMatchObject({ ok: true, data: { complete: false, pages: 1 } });
    const none = await readAllFacets(async () => ({ ok: false, reason: "unavailable", message: "no 0069" }));
    expect(none).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
