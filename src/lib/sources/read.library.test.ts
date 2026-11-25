import { beforeEach, describe, expect, it } from "vitest";
import { describeDataset } from "./catalog";
import { FakeSourceDb, type FakeRow } from "./read.fake";
import { buildLibrary, LIBRARY_TTL_MS, readLibraryWire, resetReadState, type LibraryDatasetRow, type LibrarySnapshotRow } from "./read.server";
import { packLibraryRows, unpackLibrary } from "./read-types";

const H = (n: number) => n.toString(16).padStart(64, "0");
const dataset = (id: string, name: string, sector: string, agency: string, latest: string, extra: Partial<LibraryDatasetRow> = {}): LibraryDatasetRow => ({
  id, name, sector, agency, source_id: null, source_url: null, grain: "One row per series per date", latest_snapshot_id: latest, ...extra,
});
const snap = (id: string, dataset_id: string, rows: number, at: string, extra: Partial<LibrarySnapshotRow> = {}): LibrarySnapshotRow => ({
  id, dataset_id, loaded_rows: rows, column_count: 4, published_at: at, retrieved_at: "2026-11-24T09:58:23.485+00:00",
  dims: { period: 0 }, consts: { source_url: "https://example.gov/file.csv" }, comp: null, family: null, ...extra,
});

// Three EIA tables and one FHFA table first published in one run across two hours; two EIA tables and the FHFA
// table replaced later; an internal specification table that the catalogue hides.
const DATASETS: LibraryDatasetRow[] = [
  dataset("official_04_energy_eia_mer_t01_01", "MER T01.01", "04_energy", "US EIA", H(11), { source_id: "EIA_MER" }),
  dataset("official_04_energy_eia_mer_t01_02", "MER T01.02", "04_energy", "US EIA", H(12), { source_id: "EIA_MER" }),
  dataset("official_04_energy_eia_mer_t02_01", "MER T02.01", "04_energy", "US EIA", H(3)),
  dataset("official_11_real_estate_hpi_master", "FHFA HPI master", "11_real_estate", "Federal Housing Finance Agency", H(14)),
  dataset("official_14_source_atlas_spec", "Collection specification", "14_source_atlas", "FiledUnder collection specifications", H(5)),
];
const SNAPSHOTS: LibrarySnapshotRow[] = [
  snap(H(1), "official_04_energy_eia_mer_t01_01", 100, "2026-11-25T05:30:00+00:00"),
  snap(H(2), "official_04_energy_eia_mer_t01_02", 200, "2026-11-25T05:50:00+00:00"),
  snap(H(3), "official_04_energy_eia_mer_t02_01", 300, "2026-11-25T06:20:00+00:00", { dims: { entity_id: 0, entity_name: 1 }, consts: { geo_level: "state" } }),
  snap(H(4), "official_11_real_estate_hpi_master", 186_031, "2026-11-25T06:36:00+00:00", { comp: { period: { indices: [0, 1] } } }),
  snap(H(5), "official_14_source_atlas_spec", 19, "2026-11-25T06:36:30+00:00"),
  snap(H(11), "official_04_energy_eia_mer_t01_01", 101, "2026-11-25T12:27:00+00:00", { family: "eia-mer" }),
  snap(H(12), "official_04_energy_eia_mer_t01_02", 201, "2026-11-25T12:27:05+00:00", { family: "eia-mer" }),
  snap(H(14), "official_11_real_estate_hpi_master", 187_213, "2026-11-25T07:01:00+00:00"),
];
const BUILT = "2026-11-25T20:00:00.000Z";

describe("buildLibrary", () => {
  const lib = buildLibrary(DATASETS, SNAPSHOTS, "direct", BUILT);
  const row = (id: string) => lib.datasets.find(r => r.id === id)!;

  it("describes every dataset through the catalogue and keeps the latest snapshot's facts", () => {
    expect(lib.datasets.map(r => r.id)).toEqual([...DATASETS.map(d => d.id)].sort());
    const t = row("official_04_energy_eia_mer_t01_01");
    const entry = describeDataset({ ...DATASETS[0], rows: 101, retrieved_at: SNAPSHOTS[5].retrieved_at });
    expect(t).toMatchObject({ title: entry.title, publisherId: entry.publisher.id, collectionId: entry.collection.id, rows: 101, versions: 2, refreshFamily: "eia-mer" });
    expect(t.publishedAt).toBe("2026-11-25T12:27:00.000Z");
    expect(t.storedName === null || t.storedName === "MER T01.01").toBe(true);
    expect(row("official_04_energy_eia_mer_t02_01").dimensions).toEqual(["entity_id", "entity_name", "geo_level"]);
    expect(row("official_11_real_estate_hpi_master").dimensions).toEqual(["period", "source_url"]);
  });
  it("counts what a reader sees by default and the hidden tables apart", () => {
    const hidden = lib.datasets.filter(r => r.hidden).length;
    expect(lib.totals.datasets + lib.totals.hiddenDatasets).toBe(5);
    expect(lib.totals.hiddenDatasets).toBe(hidden);
    const shown = lib.datasets.filter(r => !r.hidden);
    expect(lib.totals.rows).toBe(shown.reduce((n, r) => n + r.rows, 0));
    expect(lib.collections.reduce((n, c) => n + c.datasets + c.hidden, 0)).toBe(5);
    expect(lib.publishers.reduce((n, p) => n + p.datasets, 0)).toBe(lib.totals.datasets);
    expect(lib.totals.newestPublication).toBe("2026-11-25T12:27:05.000Z");
  });
  it("groups new versions by publisher and hour, first publications by run, newest first", () => {
    const [eia, fhfa, first] = lib.changes;
    expect(lib.changes).toHaveLength(3);
    expect(eia).toMatchObject({ kind: "version", datasets: 2, rows: 302, from: "2026-11-25T12:27:00.000Z", to: "2026-11-25T12:27:05.000Z", single: null, publishers: 1 });
    expect(eia.datasetIds).toEqual(["official_04_energy_eia_mer_t01_02", "official_04_energy_eia_mer_t01_01"]);
    expect(eia.members.map(i => lib.datasets[i].id)).toEqual(eia.datasetIds);
    expect(fhfa).toMatchObject({ kind: "version", datasets: 1 });
    expect(fhfa.single).toEqual({ datasetId: "official_11_real_estate_hpi_master", title: row("official_11_real_estate_hpi_master").title, rows: 187_213, previousRows: 186_031, snapshotId: H(14), previousSnapshotId: H(4) });
    expect(first).toMatchObject({ kind: "first", datasets: 5, from: "2026-11-25T05:30:00.000Z", to: "2026-11-25T06:36:30.000Z", publisherId: null, publisherName: null });
    expect(first.publishers).toBeGreaterThan(1);
  });
  it("starts a new run of first publications after an hour without one", () => {
    const later = [...SNAPSHOTS, snap(H(20), "official_x_new", 5, "2026-11-25T19:00:00+00:00")];
    const lib2 = buildLibrary([...DATASETS, dataset("official_x_new", "New", "04_energy", "US EIA", H(20))], later, "direct", BUILT);
    expect(lib2.changes[0]).toMatchObject({ kind: "first", datasets: 1, single: { datasetId: "official_x_new", previousRows: null, previousSnapshotId: null } });
  });
  it("leaves out a dataset whose latest snapshot is not readable", () => {
    const lib2 = buildLibrary([...DATASETS, dataset("official_x_hidden", "Hidden", "04_energy", "US EIA", H(99))], SNAPSHOTS, "direct", BUILT);
    expect(lib2.datasets.some(r => r.id === "official_x_hidden")).toBe(false);
  });
  it("packs and unpacks to the same library", () => {
    const wire = { ...lib, datasets: packLibraryRows(lib.datasets) };
    expect(unpackLibrary(JSON.parse(JSON.stringify(wire)))).toEqual(lib);
    expect(() => unpackLibrary({ ...wire, datasets: { ...wire.datasets, columns: ["id"] } })).toThrow();
  });
});

describe("readLibraryWire", () => {
  let db: FakeSourceDb;
  beforeEach(() => {
    resetReadState();
    const snapshots: FakeRow[] = SNAPSHOTS.map(s => ({
      id: s.id, dataset_id: s.dataset_id, status: "ready", loaded_rows: s.loaded_rows, column_count: s.column_count, published_at: s.published_at,
      retrieved_at: s.retrieved_at, ingest: { dimensions: s.dims, constants: s.consts, ...(s.comp ? { composites: s.comp } : {}) },
      coverage: s.family ? { refresh_provenance: { family: s.family } } : {},
    }));
    db = new FakeSourceDb({ source_datasets: DATASETS.map(d => ({ ...d })), source_snapshots: snapshots, source_records: [] });
  });
  const tables = () => db.calls.map(c => c.table);

  it("builds from direct selects when source_library is missing, the same library as the pure builder", async () => {
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(unpackLibrary(r.data)).toEqual(buildLibrary(DATASETS, SNAPSHOTS, "direct", BUILT));
    expect(tables()).toEqual(["source_snapshots", "source_datasets"]);
    expect(db.rpcs.map(x => x.fn)).toEqual(["source_library"]);
  });
  it("serves the cached copy for ten minutes, then checks the newest publication before rebuilding", async () => {
    const t0 = Date.parse(BUILT);
    await readLibraryWire(db, t0);
    await readLibraryWire(db, t0 + LIBRARY_TTL_MS - 1);
    expect(db.calls).toHaveLength(2);
    await readLibraryWire(db, t0 + LIBRARY_TTL_MS + 1);
    expect(tables()).toEqual(["source_snapshots", "source_datasets", "source_snapshots"]);
    db.tables.source_snapshots.push({ ...db.tables.source_snapshots[0], id: H(30), published_at: "2026-11-25T20:30:00+00:00", loaded_rows: 102 });
    db.tables.source_datasets[0].latest_snapshot_id = H(30);
    const r = await readLibraryWire(db, t0 + 2 * LIBRARY_TTL_MS + 2);
    expect(tables().slice(3)).toEqual(["source_snapshots", "source_datasets"]);
    expect(r.ok && unpackLibrary(r.data).datasets.find(x => x.id === DATASETS[0].id)?.rows).toBe(102);
  });
  it("uses source_library when it exists", async () => {
    db.rpcAnswer = fn => (fn === "source_library" ? { data: { datasets: DATASETS, snapshots: SNAPSHOTS }, error: null } : { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r.ok && r.data.via).toBe("source_library");
    expect(db.calls).toHaveLength(0);
  });
  it("fails plainly rather than build from part of the snapshot table", async () => {
    const base = db.tables.source_snapshots[0];
    for (let i = 0; i < 3000; i++) db.tables.source_snapshots.push({ ...base, id: H(1000 + i), published_at: "2026-11-25T05:00:00+00:00" });
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(!r.ok && r.message).toContain("0069");
    expect(db.calls.length).toBeLessThanOrEqual(5);
  });
  it("passes a database error through", async () => {
    db.failNext = { code: "57014", message: "canceling statement due to statement timeout" };
    expect(await readLibraryWire(db, Date.parse(BUILT))).toMatchObject({ ok: false, reason: "timeout" });
  });
});
