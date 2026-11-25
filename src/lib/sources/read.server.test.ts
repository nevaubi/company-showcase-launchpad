import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyReadError, knownMissing, readFieldCompleteness, readSnapshotStats, readSourceCrossSection, readSourceEntities,
  readSourceFacets, readSourceFind, readSourcePeriodRange, readSourceRecord, readSourceSeries, readSourceSeriesFields, resetReadState,
} from "./read.server";
import { FakeSourceDb, type FakeRow as Row } from "./read.fake";
import { crossSectionReadInput, entitiesReadInput, fieldCompleteness, findReadInput, recordReadInput, seriesReadInput } from "./read-types";

const H = (n: number) => n.toString(16).padStart(64, "0");
const S1 = H(1), S2 = H(2), S3 = H(3), STAGING = H(9);
const col = (key: string, label = key) => ({ key, label, type: "string" });
function snapshot(id: string, dataset: string, rows: number, columns: ReturnType<typeof col>[], dims: Record<string, number>, extra: Row = {}): Row {
  return {
    id, dataset_id: dataset, status: "ready", loaded_rows: rows, column_count: columns.length, published_at: "2026-11-25T05:30:00Z",
    retrieved_at: "2026-11-25T05:00:00Z", file_sha256: H(100), columns, ingest: { format: "csv", dimensions: dims }, quality: {}, ...extra,
  };
}
const rec = (snapshot_id: string, row_number: number, values: (string | null)[], dims: Row = {}): Row => ({
  snapshot_id, row_number, values, entity_id: null, entity_name: null, period: null, geo_level: null, geo_code: null, geo_name: null, source_url: null, ...dims,
});

let db: FakeSourceDb;
beforeEach(() => {
  resetReadState();
  // S1: a panel of 3 banks x 4 quarters (12 rows). S2: 2,500 rows, one series, no dimensions. S3: 60,000 rows (above the cell-filter cap).
  const panel: Row[] = [];
  let n = 0;
  for (const q of ["2025Q4", "2026Q1", "2026Q2", "2026Q3"])
    for (const [id, name] of [["628", "JPMorgan Chase Bank"], ["3510", "Bank of America"], ["7213", "Citibank"]])
      panel.push(rec(S1, ++n, [id, name, q, String(1000 + n), n % 4 === 0 ? "" : "NM"], { entity_id: id, entity_name: name, period: q }));
  const long: Row[] = Array.from({ length: 2500 }, (_, i) => rec(S2, i + 1, [`d${i + 1}`, String(i)]));
  const big: Row[] = Array.from({ length: 1200 }, (_, i) => rec(S3, i + 1, ["x", String(i)], { period: "2026-10", entity_id: String(i % 700), entity_name: `E${i % 700}` }));
  db = new FakeSourceDb({
    source_datasets: [
      { id: "fdic", latest_snapshot_id: S1 }, { id: "long", latest_snapshot_id: S2 }, { id: "big", latest_snapshot_id: S3 }, { id: "hidden", latest_snapshot_id: STAGING },
    ],
    source_snapshots: [
      snapshot(S1, "fdic", 12, [col("cert", "CERT"), col("name", "Institution"), col("repdte", "Report date"), col("asset", "Total assets"), col("flag")], { entity_id: 0, entity_name: 1, period: 2 },
        { quality: { blank_counts_by_column: [0, 0, 0, 0, 3] } }),
      snapshot(S2, "long", 2500, [col("date"), col("value")], {}),
      snapshot(S3, "big", 60_000, [col("a"), col("b")], { entity_id: 0, entity_name: 1, period: 2 }),
      { ...snapshot(STAGING, "hidden", 1, [col("a")], {}), status: "staging" },
    ],
    source_records: [...panel, ...long, ...big, rec(STAGING, 1, ["secret"])],
  });
});
const recordCalls = () => db.calls.filter(c => c.table === "source_records");

describe("readSourceRecord", () => {
  it("returns the whole record with the dictionary and the snapshot it read", async () => {
    const r = await readSourceRecord(db, { datasetId: "fdic", snapshotId: S1, row: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.record.values).toEqual(["3510", "Bank of America", "2026Q1", "1005", "NM"]);
    expect(r.data.record.period).toBe("2026Q1");
    expect(r.data.columns.map(c => c.key)).toEqual(["cert", "name", "repdte", "asset", "flag"]);
    expect(r.data.snapshot).toMatchObject({ datasetId: "fdic", snapshotId: S1, rows: 12, fields: 5, fileSha256: H(100) });
  });
  it("resolves the latest snapshot when none is pinned", async () => {
    const r = await readSourceRecord(db, { datasetId: "fdic", row: 1 });
    expect(r.ok && r.data.snapshot.snapshotId).toBe(S1);
  });
  it("answers not-found for a row outside the snapshot, another dataset's snapshot, and an unpublished one", async () => {
    expect(await readSourceRecord(db, { datasetId: "fdic", snapshotId: S1, row: 13 })).toMatchObject({ ok: false, reason: "not-found" });
    expect(await readSourceRecord(db, { datasetId: "long", snapshotId: S1, row: 1 })).toMatchObject({ ok: false, reason: "not-found" });
    expect(await readSourceRecord(db, { datasetId: "hidden", snapshotId: STAGING, row: 1 })).toMatchObject({ ok: false, reason: "not-found" });
    expect(await readSourceRecord(db, { datasetId: "hidden", row: 1 })).toMatchObject({ ok: false, reason: "not-found" });
  });
  it("reads the dictionary once per snapshot and process", async () => {
    await readSourceRecord(db, { datasetId: "fdic", snapshotId: S1, row: 1 });
    await readSourceRecord(db, { datasetId: "fdic", snapshotId: S1, row: 2 });
    const snaps = db.calls.filter(c => c.table === "source_snapshots");
    expect(snaps[0].columns).toContain("columns");
    expect(snaps[1].columns).not.toContain("columns");
  });
});

describe("readSourceSeries", () => {
  it("reads one entity's measure through the entity index, in file order", async () => {
    const r = await readSourceSeries(db, { datasetId: "fdic", snapshotId: S1, field: "asset", address: { by: "entity_id", key: "3510" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.points).toEqual([
      { row: 2, period: "2025Q4", text: "1002" }, { row: 5, period: "2026Q1", text: "1005" },
      { row: 8, period: "2026Q2", text: "1008" }, { row: 11, period: "2026Q3", text: "1011" },
    ]);
    expect(r.data.next).toBeNull();
    expect(r.data.field).toMatchObject({ key: "asset", label: "Total assets", position: 3 });
    expect(recordCalls()[0]).toMatchObject({ columns: "row_number,period,cell:values->>3", filters: ["snapshot_id=eq", "entity_id=eq", "row_number=gt"], orders: ["row_number.asc"] });
  });
  it("reads several fields of one series on the same selects, and skips the snapshot select for a snapshot the caller read", async () => {
    const r = await readSourceSeriesFields(db, { datasetId: "fdic", snapshotId: S1, fields: ["asset", 4, "repdte"], address: { by: "entity_id", key: "3510" } });
    expect(r.ok && r.data.points).toEqual([
      { row: 2, period: "2025Q4", cells: ["1002", "NM", "2025Q4"] }, { row: 5, period: "2026Q1", cells: ["1005", "NM", "2026Q1"] },
      { row: 8, period: "2026Q2", cells: ["1008", "", "2026Q2"] }, { row: 11, period: "2026Q3", cells: ["1011", "NM", "2026Q3"] },
    ]);
    expect(recordCalls()).toHaveLength(1);
    expect(recordCalls()[0].columns).toBe("row_number,period,c0:values->>3,c1:values->>4,c2:values->>2");
    if (!r.ok) return;
    const before = db.calls.length;
    const known = { ref: r.data.snapshot, columns: db.tables.source_snapshots[0].columns as never, ingest: db.tables.source_snapshots[0].ingest as never };
    const again = await readSourceSeriesFields(db, { datasetId: "fdic", snapshotId: S1, fields: [3], address: { by: "entity_id", key: "628" } }, known);
    expect(again.ok && again.data.points.map(p => p.cells[0])).toEqual(["1001", "1004", "1007", "1010"]);
    expect(db.calls.slice(before).map(c => c.table)).toEqual(["source_records"]);
    const cross = await readSourceCrossSection(db, { datasetId: "fdic", snapshotId: S1, field: 3 }, known);
    expect(cross.ok && cross.data.rows).toHaveLength(3);
    expect(db.calls.slice(before).some(c => c.table === "source_snapshots")).toBe(false);
    expect(await readSourceSeriesFields(db, { datasetId: "long", fields: [1], address: { whole: true } }, known)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await readSourceSeriesFields(db, { datasetId: "fdic", fields: [3, "asset"], address: { whole: true } })).toMatchObject({ ok: false, reason: "invalid" });
  });
  it("pages a long series in selects of at most 1,000 rows, five a call, and continues exactly", async () => {
    const first = await readSourceSeries(db, { datasetId: "long", field: 1, address: { whole: true }, limit: 1500 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.points).toHaveLength(1500);
    expect(first.data.next).toBe(1500);
    expect(recordCalls().map(c => c.limit)).toEqual([1000, 501]);
    const rest = await readSourceSeries(db, { datasetId: "long", field: 1, address: { whole: true }, after: 1500, limit: 5000 });
    expect(rest.ok && rest.data.points.map(p => p.row)).toEqual(Array.from({ length: 1000 }, (_, i) => 1501 + i));
    expect(rest.ok && rest.data.next).toBeNull();
    expect(recordCalls().every(c => c.limit !== null && c.limit <= 1000)).toBe(true);
  });
  it("says where to continue when a whole page ends the answer", async () => {
    const r = await readSourceSeries(db, { datasetId: "long", field: 1, address: { whole: true } });
    expect(r.ok && r.data.points).toHaveLength(1000);
    expect(r.ok && r.data.next).toBe(1000);
  });
  it("filters on cells only on snapshots of at most 50,000 rows", async () => {
    const small = await readSourceSeries(db, { datasetId: "fdic", field: "asset", address: { where: [{ field: "cert", value: "628" }] } });
    expect(small.ok && small.data.points.map(p => p.row)).toEqual([1, 4, 7, 10]);
    expect(small.ok && small.data.where).toEqual([{ position: 0, key: "cert", value: "628" }]);
    const big = await readSourceSeries(db, { datasetId: "big", field: 1, address: { by: "entity_id", key: "3", where: [{ field: 0, value: "x" }] } });
    expect(big).toMatchObject({ ok: false, reason: "invalid" });
    expect(!big.ok && big.message).toContain("60,000");
  });
  it("refuses a field outside the dictionary and a dimension the table does not fill", async () => {
    expect(await readSourceSeries(db, { datasetId: "fdic", field: 9, address: { whole: true } })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await readSourceSeries(db, { datasetId: "fdic", field: "nope", address: { whole: true } })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await readSourceSeries(db, { datasetId: "fdic", field: 3, address: { by: "geo_code", key: "06" } })).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("readSourceCrossSection", () => {
  it("takes the greatest period string by one backward probe and returns its rows", async () => {
    const r = await readSourceCrossSection(db, { datasetId: "fdic", field: "asset" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ period: "2026Q3", periodRule: "greatest", complete: true });
    expect(r.data.rows.map(x => [x.entityId, x.text])).toEqual([["628", "1010"], ["3510", "1011"], ["7213", "1012"]]);
    expect(recordCalls()[0]).toMatchObject({ filters: ["snapshot_id=eq", "period=not.is.null"], orders: ["period.desc", "row_number.desc"], limit: 1 });
  });
  it("marks a selection of more than 1,000 rows as incomplete", async () => {
    const r = await readSourceCrossSection(db, { datasetId: "big", field: 1, period: "2026-10" });
    expect(r.ok && r.data.rows).toHaveLength(1000);
    expect(r.ok && r.data).toMatchObject({ periodRule: "given", complete: false });
  });
});

describe("readSourcePeriodRange", () => {
  it("probes both ends of the period index", async () => {
    const r = await readSourcePeriodRange(db, { datasetId: "fdic" });
    expect(r.ok && r.data.range).toEqual({ first: { period: "2025Q4", row: 1 }, last: { period: "2026Q3", row: 12 } });
    expect(recordCalls()).toHaveLength(2);
  });
  it("is null without a period dimension, and reads no records then", async () => {
    const r = await readSourcePeriodRange(db, { datasetId: "long" });
    expect(r.ok && r.data.range).toBeNull();
    expect(recordCalls()).toHaveLength(0);
  });
});

describe("readSourceEntities", () => {
  it("lists the entities of the greatest period", async () => {
    const r = await readSourceEntities(db, { datasetId: "fdic" });
    expect(r.ok && r.data).toMatchObject({ period: "2026Q3", periodRule: "greatest", complete: true, rowsRead: 3 });
    expect(r.ok && r.data.entities).toEqual([
      { id: "628", name: "JPMorgan Chase Bank", row: 10 }, { id: "3510", name: "Bank of America", row: 11 }, { id: "7213", name: "Citibank", row: 12 },
    ]);
  });
  it("pages at most five selects and reports when more may exist", async () => {
    const r = await readSourceEntities(db, { datasetId: "big", period: "2026-10" });
    expect(r.ok && r.data.entities).toHaveLength(700);
    expect(r.ok && r.data).toMatchObject({ rowsRead: 1200, complete: true });
    expect(recordCalls().length).toBeLessThanOrEqual(5);
  });
  it("answers an empty list for a table without that dimension", async () => {
    const r = await readSourceEntities(db, { datasetId: "long", dimension: "geo" });
    expect(r.ok && r.data).toMatchObject({ entities: [], complete: true, rowsRead: 0 });
  });
});

describe("field completeness", () => {
  it("computes filled shares from the blank counts", async () => {
    const r = await readFieldCompleteness(db, { datasetId: "fdic" });
    expect(r.ok && r.data.fields?.[4]).toEqual({ position: 4, key: "flag", label: "flag", filled: 9, blank: 3, share: 0.75 });
    expect(recordCalls()).toHaveLength(0);
  });
  it("is null when the counts are missing or do not fit the dictionary", () => {
    const columns = [col("a"), col("b")];
    expect(fieldCompleteness({ columns, loaded_rows: 4, quality: {} })).toBeNull();
    expect(fieldCompleteness({ columns, loaded_rows: 4, quality: { blank_counts_by_column: [1] } })).toBeNull();
    expect(fieldCompleteness({ columns, loaded_rows: 4, quality: { blank_counts_by_column: [1, 5] } })).toBeNull();
    expect(fieldCompleteness({ columns, loaded_rows: 0, quality: { blank_counts_by_column: [0, 0] } })?.[0].share).toBe(0);
  });
});

describe("errors and the 0069 reads", () => {
  it("maps database errors to read failures", () => {
    expect(classifyReadError({ code: "PGRST202", message: "Could not find the function public.source_facets" }).reason).toBe("unavailable");
    expect(classifyReadError({ code: "42883", message: "function public.source_find(text) does not exist" }).reason).toBe("unavailable");
    expect(classifyReadError({ code: "57014", message: "canceling statement due to statement timeout" }).reason).toBe("timeout");
    expect(classifyReadError({ code: "22P02", message: "invalid input syntax" }).reason).toBe("invalid");
    expect(classifyReadError({ code: "XX000", message: "boom" })).toEqual({ reason: "error", message: "boom" });
  });
  it("turns a failing direct select into a failure value", async () => {
    db.failNext = { code: "57014", message: "canceling statement due to statement timeout" };
    expect(await readSourceRecord(db, { datasetId: "fdic", snapshotId: S1, row: 1 })).toMatchObject({ ok: false, reason: "timeout" });
  });
  it("remembers a missing function and stops asking", async () => {
    const first = await readSourceFacets(db, { datasetId: "fdic", dimension: "period" });
    expect(first).toMatchObject({ ok: false, reason: "unavailable" });
    expect(knownMissing("source_facets")).toBe(true);
    await readSourceFacets(db, { datasetId: "fdic", dimension: "period" });
    expect(db.rpcs).toHaveLength(1);
    expect(db.rpcs[0].args).toEqual({ _dataset_id: "fdic", _snapshot_id: null, _dimension: "period", _after: null, _contains: null, _limit: 200 });
    resetReadState();
    expect(knownMissing("source_facets")).toBe(false);
  });
  it("passes a good payload through and refuses a malformed one", async () => {
    const snapshotRef = { datasetId: "fdic", snapshotId: S1, rows: 12, fields: 5, publishedAt: null, retrievedAt: null, fileSha256: H(100) };
    db.rpcAnswer = fn => fn === "source_find"
      ? { data: { q: "bank", hits: [] }, error: null }
      : { data: { snapshot: snapshotRef, periodMin: "2025Q4" }, error: null };
    expect(await readSourceFind(db, { q: "bank" })).toEqual({ ok: true, data: { q: "bank", hits: [] } });
    expect((await readSnapshotStats(db, { datasetId: "fdic" })).ok).toBe(true);
    db.rpcAnswer = () => ({ data: { unexpected: true }, error: null });
    expect(await readSourceFacets(db, { datasetId: "fdic", dimension: "period" })).toMatchObject({ ok: false, reason: "error" });
    db.rpcAnswer = () => ({ data: null, error: null });
    expect(await readSnapshotStats(db, { datasetId: "nope" })).toMatchObject({ ok: false, reason: "not-found" });
  });
});

describe("inputs", () => {
  it("keeps the bounds", () => {
    const base = { datasetId: "fdic", field: 1, address: { whole: true } };
    expect(seriesReadInput.safeParse({ ...base, limit: 5000 }).success).toBe(true);
    expect(seriesReadInput.safeParse({ ...base, limit: 5001 }).success).toBe(false);
    expect(seriesReadInput.safeParse({ ...base, address: { whole: true, where: [{ field: 0, value: "x" }] } }).success).toBe(false);
    expect(seriesReadInput.safeParse({ ...base, address: { where: Array.from({ length: 5 }, () => ({ field: 0, value: "x" })) } }).success).toBe(false);
    expect(seriesReadInput.safeParse({ ...base, address: { by: "period", key: "x" } }).success).toBe(false);
    expect(recordReadInput.safeParse({ datasetId: "fdic", snapshotId: "ABC", row: 1 }).success).toBe(false);
    expect(recordReadInput.safeParse({ datasetId: "fdic", row: 0 }).success).toBe(false);
    expect(crossSectionReadInput.safeParse({ datasetId: "fdic", field: 16384 }).success).toBe(false);
    expect(entitiesReadInput.safeParse({ datasetId: "fdic", dimension: "plant" }).success).toBe(false);
    expect(findReadInput.safeParse({ q: "   " }).success).toBe(false);
  });
});
