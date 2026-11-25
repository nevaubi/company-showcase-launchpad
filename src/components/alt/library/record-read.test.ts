import { describe, expect, it } from "vitest";
import {
  containsPattern,
  orValue,
  readError,
  readRecord,
  readRecordPage,
  readVersions,
  recordSelect,
  type RecordDims,
  type RecordPageQuery,
} from "./record-read";
import { fakeReadClient, parseOr } from "./record-read.fake";

const S = "a".repeat(64);
const OTHER = "b".repeat(64);

/** A bank-quarter panel: 4 certificates x 6 quarters, file sorted by certificate then quarter. */
function panel() {
  const rows: Record<string, unknown>[] = [];
  const certs = ["628", "3510", "7213", "33124"];
  const quarters = ["20250331", "20250630", "20250930", "20251231", "20260331", "20260630"];
  let n = 0;
  for (const cert of certs)
    for (const q of quarters) {
      n += 1;
      rows.push({
        snapshot_id: S,
        row_number: n,
        values: [cert, q, cert === "628" ? "JPMORGAN CHASE BANK NA" : `BANK ${cert}`, String(n * 1000), n % 5 === 0 ? null : ""],
        entity_id: cert,
        entity_name: cert === "628" ? "JPMORGAN CHASE BANK NA" : `BANK ${cert}`,
        period: q,
        geo_level: null,
        geo_code: null,
        geo_name: null,
        source_url: "https://api.fdic.gov/banks/financials",
      });
    }
  rows.push({ ...rows[0], snapshot_id: OTHER });
  return rows;
}

const dims: RecordDims = { entityId: true, entityName: true, geoCode: false, geoName: false, period: true };
const q = (over: Partial<RecordPageQuery>): RecordPageQuery => ({
  snapshotId: S,
  total: 24,
  dims,
  order: "file",
  filter: {},
  columns: [0, 1, 3],
  limit: 5,
  ...over,
});

describe("records in file order", () => {
  it("reads the first page, projects only the asked fields, and says where the next page starts", async () => {
    const db = fakeReadClient({ source_records: panel() });
    const page = await readRecordPage(db, q({}));
    expect(page.rows.map((r) => r.row)).toEqual([1, 2, 3, 4, 5]);
    expect(page.rows[0].cells).toEqual(["628", "20250331", "1000"]);
    expect(page).toMatchObject({ next: 5, previous: null, scan: null });
    expect(recordSelect([0, 3])).toBe("row_number,entity_id,entity_name,period,geo_level,geo_code,geo_name,source_url,c0:values->>0,c3:values->>3");
  });

  it("goes back from any page without a remembered trail (rev-app M3)", async () => {
    const db = fakeReadClient({ source_records: panel() });
    // a link that starts at row 10: Previous must show rows 5 to 9, not jump to the start
    const linked = await readRecordPage(db, q({ after: 9 }));
    expect(linked.rows.map((r) => r.row)).toEqual([10, 11, 12, 13, 14]);
    expect(linked.previous).toBe(10);
    const back = await readRecordPage(db, q({ before: linked.previous! }));
    expect(back.rows.map((r) => r.row)).toEqual([5, 6, 7, 8, 9]);
    expect(back).toMatchObject({ previous: 5, next: 9 });
    const start = await readRecordPage(db, q({ before: 5 }));
    expect(start.rows.map((r) => r.row)).toEqual([1, 2, 3, 4]);
    expect(start.previous).toBeNull();
  });

  it("filters by an entity id or name with one or-list, and probes before saying there is a previous page", async () => {
    const db = fakeReadClient({ source_records: panel() });
    const page = await readRecordPage(db, q({ filter: { entity: "3510" }, after: 6 }));
    expect(page.rows.map((r) => r.row)).toEqual([7, 8, 9, 10, 11]);
    // rows 1 to 6 belong to another certificate: no previous page
    expect(page.previous).toBeNull();
    expect(page.next).toBe(11);
    const byName = await readRecordPage(db, q({ filter: { entity: "JPMORGAN CHASE BANK NA" } }));
    expect(byName.rows.map((r) => r.row)).toEqual([1, 2, 3, 4, 5]);
  });

  it("an empty page past the end offers the rows before it", async () => {
    const db = fakeReadClient({ source_records: panel() });
    const page = await readRecordPage(db, q({ after: 40 }));
    expect(page).toMatchObject({ rows: [], next: null, previous: 41 });
  });
});

describe("records newest first", () => {
  it("orders by period, then row number, both descending, and pages across a period boundary", async () => {
    const db = fakeReadClient({ source_records: panel() });
    const first = await readRecordPage(db, q({ order: "new" }));
    expect(first.rows.map((r) => [r.period, r.row])).toEqual([
      ["20260630", 24],
      ["20260630", 18],
      ["20260630", 12],
      ["20260630", 6],
      ["20260331", 23],
    ]);
    expect(first.previous).toBeNull();
    const second = await readRecordPage(db, q({ order: "new", after: first.next! }));
    expect(second.rows.map((r) => r.row)).toEqual([17, 11, 5, 22, 16]);
    expect(db.calls.length).toBeLessThanOrEqual(1 + 3);
    const back = await readRecordPage(db, q({ order: "new", before: second.previous! }));
    expect(back.rows.map((r) => r.row)).toEqual(first.rows.map((r) => r.row));
    expect(back.previous).toBeNull();
  });

  it("keeps an entity filter while ordering by period", async () => {
    const db = fakeReadClient({ source_records: panel() });
    const page = await readRecordPage(db, q({ order: "new", filter: { entity: "628" }, limit: 3 }));
    expect(page.rows.map((r) => r.period)).toEqual(["20260630", "20260331", "20251231"]);
    const next = await readRecordPage(db, q({ order: "new", filter: { entity: "628" }, limit: 3, after: page.next! }));
    expect(next.rows.map((r) => r.period)).toEqual(["20250930", "20250630", "20250331"]);
    expect(next.next).toBeNull();
  });

  it("refuses a cursor that is not a record of this version", async () => {
    const db = fakeReadClient({ source_records: panel() });
    await expect(readRecordPage(db, q({ order: "new", after: 999 }))).rejects.toMatchObject({ reason: "not-found" });
  });
});

describe("name search", () => {
  const big = (total: number, matches: Record<number, string>) => {
    const rows = Array.from({ length: total }, (_, i) => ({
      snapshot_id: S,
      row_number: i + 1,
      values: [String(i + 1)],
      entity_id: String(i + 1),
      entity_name: matches[i + 1] ?? "Other bank",
      period: "2026",
      geo_level: null,
      geo_code: null,
      geo_name: null,
      source_url: null,
    }));
    return () => rows;
  };

  it("reads at most 50,000 rows a press, in windows, and says how far it got", async () => {
    const rows = big(60_000, { 55_000: "First Citizens Bank" });
    const db = fakeReadClient({ source_records: rows });
    const query = q({ total: 60_000, filter: { q: "citizens" }, columns: [0] });
    const first = await readRecordPage(db, query);
    expect(first.rows).toEqual([]);
    expect(first.scan).toEqual({ from: 1, to: 50_000, complete: false });
    expect(first.next).toBe(50_000);
    expect(db.calls.length).toBe(5);
    const second = await readRecordPage(db, { ...query, after: first.next! });
    expect(second.rows.map((r) => r.entityName)).toEqual(["First Citizens Bank"]);
    expect(second.scan).toEqual({ from: 50_001, to: 60_000, complete: true });
    expect(second.next).toBeNull();
  }, 20_000);

  it("stops at a full page inside a window and continues after the last record shown", async () => {
    const matches: Record<number, string> = {};
    for (let i = 1; i <= 8; i += 1) matches[i * 3] = `Citizens ${i}`;
    const db = fakeReadClient({ source_records: big(30, matches) });
    const query = q({ total: 30, filter: { q: "CITIZENS" }, columns: [0] });
    const page = await readRecordPage(db, query);
    expect(page.rows.map((r) => r.row)).toEqual([3, 6, 9, 12, 15]);
    expect(page.next).toBe(15);
    expect(page.scan).toEqual({ from: 1, to: 15, complete: false });
    const rest = await readRecordPage(db, { ...query, after: 15 });
    expect(rest.rows.map((r) => r.row)).toEqual([18, 21, 24]);
    expect(rest.scan?.complete).toBe(true);
    const back = await readRecordPage(db, { ...query, after: undefined, before: 18 });
    expect(back.rows.map((r) => r.row)).toEqual([3, 6, 9, 12, 15]);
  });

  it("treats the reader's % and _ as letters and quotes the or-list", () => {
    expect(containsPattern("50%_x")).toBe("*50\\%\\_x*");
    expect(orValue('a,b"c\\')).toBe('"a,b\\"c\\\\"');
    expect(parseOr(`entity_name.ilike.${orValue("*a, (b)*")},geo_name.eq.x`)).toEqual([
      { column: "entity_name", op: "ilike", value: "*a, (b)*" },
      { column: "geo_name", op: "eq", value: "x" },
    ]);
  });
});

describe("one record, the period range and the versions", () => {
  it("reads one whole record of the named snapshot only", async () => {
    const db = fakeReadClient({ source_records: panel() });
    const record = await readRecord(db, S, 1);
    expect(record?.values).toEqual(["628", "20250331", "JPMORGAN CHASE BANK NA", "1000", ""]);
    expect(await readRecord(db, S, 999)).toBeNull();
  });

  it("lists versions newest first with the size and parts of each file", async () => {
    const db = fakeReadClient({
      source_snapshots: [
        { id: "1".repeat(64), dataset_id: "d", status: "ready", file_sha256: "f1", retrieved_at: "2026-11-24T10:00:00Z", published_at: "2026-11-25T05:47:00Z", expected_rows: 10, loaded_rows: 10, created_at: "x", coverage: {} },
        { id: "2".repeat(64), dataset_id: "d", status: "ready", file_sha256: "f2", retrieved_at: "2026-11-25T09:00:00Z", published_at: "2026-11-25T12:27:00Z", expected_rows: 12, loaded_rows: 12, created_at: "y", coverage: { refresh_provenance: { family: "fred" } } },
        { id: "3".repeat(64), dataset_id: "other", status: "ready", file_sha256: "f3", retrieved_at: null, published_at: "2026-11-25T13:00:00Z", expected_rows: 1, loaded_rows: 1, created_at: "z", coverage: {} },
      ],
      source_files: [
        { sha256: "f1", bytes: 1000, content_type: "text/csv", verified_at: null, chunks: [{ index: 0 }] },
        { sha256: "f2", bytes: 2000, content_type: "text/csv", verified_at: null, chunks: [{ index: 0 }, { index: 1 }] },
      ],
    });
    const versions = await readVersions(db, "d");
    expect(versions.map((v) => [v.id[0], v.rows, v.parts, v.bytes, v.refreshFamily])).toEqual([
      ["2", 12, 2, 2000, "fred"],
      ["1", 10, 1, 1000, null],
    ]);
  });

  it("names a statement timeout as such", () => {
    expect(readError({ message: "canceling statement due to statement timeout", code: "57014" }).reason).toBe("timeout");
    expect(readError({ message: "permission denied" }).reason).toBe("error");
  });
});
