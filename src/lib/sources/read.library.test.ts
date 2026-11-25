import { beforeEach, describe, expect, it } from "vitest";
import { describeDataset } from "./catalog";
import { FakeSourceDb, type FakeRow } from "./read.fake";
import {
  buildLibrary, LIBRARY_DATASET_SELECT, LIBRARY_TTL_MS, LIBRARY_WINDOW, readLibraryWire, resetReadState,
  type LibraryDatasetRow, type LibraryEventRow, type LibrarySource,
} from "./read.server";
import { packLibraryRows, unpackLibrary } from "./read-types";

const H = (n: number) => n.toString(16).padStart(64, "0");
type Snap = { id: string; dataset_id: string; rows: number; at: string; dims?: Record<string, number>; consts?: Record<string, string>; comp?: Record<string, unknown> | null; family?: string | null };
const snap = (id: string, dataset_id: string, rows: number, at: string, extra: Partial<Snap> = {}): Snap => ({ id, dataset_id, rows, at, ...extra });
const DS = [
  { id: "official_04_energy_eia_mer_t01_01", name: "MER T01.01", sector: "04_energy", agency: "US EIA", source_id: "EIA_MER" },
  { id: "official_04_energy_eia_mer_t01_02", name: "MER T01.02", sector: "04_energy", agency: "US EIA", source_id: "EIA_MER" },
  { id: "official_04_energy_eia_mer_t02_01", name: "MER T02.01", sector: "04_energy", agency: "US EIA", source_id: null },
  { id: "official_11_real_estate_hpi_master", name: "FHFA HPI master", sector: "11_real_estate", agency: "Federal Housing Finance Agency", source_id: null },
  { id: "official_14_source_atlas_spec", name: "Collection specification", sector: "14_source_atlas", agency: "FiledUnder collection specifications", source_id: null },
];
// Three EIA tables and one FHFA table first published in one run across two hours; two EIA tables and the FHFA
// table replaced later; an internal specification table that the catalogue hides.
const SNAPS: Snap[] = [
  snap(H(1), DS[0].id, 100, "2026-11-25T05:30:00+00:00"),
  snap(H(2), DS[1].id, 200, "2026-11-25T05:50:00+00:00"),
  snap(H(3), DS[2].id, 300, "2026-11-25T06:20:00+00:00", { dims: { entity_id: 0, entity_name: 1 }, consts: { geo_level: "state" } }),
  snap(H(4), DS[3].id, 186_031, "2026-11-25T06:36:00+00:00", { comp: { period: { indices: [0, 1] } } }),
  snap(H(5), DS[4].id, 19, "2026-11-25T06:36:30+00:00"),
  snap(H(11), DS[0].id, 101, "2026-11-25T12:27:00+00:00", { family: "eia_mer" }),
  snap(H(12), DS[1].id, 201, "2026-11-25T12:27:05+00:00", { family: "eia_mer" }),
  snap(H(14), DS[3].id, 187_213, "2026-11-25T07:01:00+00:00", { family: "fhfa" }),
];
const LATEST: Record<string, string> = { [DS[0].id]: H(11), [DS[1].id]: H(12), [DS[2].id]: H(3), [DS[3].id]: H(14), [DS[4].id]: H(5) };
const BUILT = "2026-11-25T20:00:00.000Z";
const RETRIEVED = "2026-11-24T09:58:23.485+00:00";

/** The rows the direct path reads, built by hand from a snapshot list and a window size. */
function sourceOf(snaps: Snap[], windowSize: number): LibrarySource {
  const byTime = [...snaps].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  const window = byTime.slice(0, windowSize);
  const full = window.length === windowSize;
  const start = window[window.length - 1]?.at;
  const event = (s: Snap): LibraryEventRow => ({ id: s.id, dataset_id: s.dataset_id, loaded_rows: s.rows, published_at: s.at });
  const datasets: LibraryDatasetRow[] = DS.map(d => {
    const l = snaps.find(s => s.id === LATEST[d.id])!;
    return {
      ...d, source_url: null, grain: "One row per series per date", latest_snapshot_id: l.id,
      latest: { id: l.id, loaded_rows: l.rows, column_count: 4, published_at: l.at, retrieved_at: RETRIEVED, dims: l.dims ?? { period: 0 }, consts: l.consts ?? { source_url: "https://example.gov/file.csv" }, comp: l.comp ?? null, family: l.family ?? null },
      prev: full ? byTime.filter(s => s.dataset_id === d.id && Date.parse(s.at) < Date.parse(start!)).slice(0, 2).map(s => ({ id: s.id, loaded_rows: s.rows, published_at: s.at })) : [],
    };
  });
  return { datasets, window: window.map(event), windowFull: full };
}

describe("buildLibrary", () => {
  const lib = buildLibrary(sourceOf(SNAPS, LIBRARY_WINDOW), "direct", BUILT);
  const row = (id: string) => lib.datasets.find(r => r.id === id)!;

  it("describes every dataset through the catalogue and keeps the current snapshot's facts", () => {
    expect(lib.datasets.map(r => r.id)).toEqual(DS.map(d => d.id).sort());
    const t = row(DS[0].id);
    const entry = describeDataset({ ...DS[0], source_url: null, grain: "One row per series per date", rows: 101, retrieved_at: RETRIEVED });
    expect(t).toMatchObject({ title: entry.title, publisherId: entry.publisher.id, collectionId: entry.collection.id, rows: 101, replaced: true, refreshFamily: "eia_mer" });
    expect(t.publishedAt).toBe("2026-11-25T12:27:00.000Z");
    expect(row(DS[2].id)).toMatchObject({ replaced: false, dimensions: ["entity_id", "entity_name", "geo_level"] });
    expect(row(DS[3].id).dimensions).toEqual(["period", "source_url"]);
    expect(lib.changesSince).toBeNull();
  });
  it("counts what a reader sees by default and the hidden tables apart", () => {
    const hidden = lib.datasets.filter(r => r.hidden).length;
    expect(lib.totals.datasets + lib.totals.hiddenDatasets).toBe(5);
    expect(lib.totals.hiddenDatasets).toBe(hidden);
    expect(lib.totals.rows).toBe(lib.datasets.filter(r => !r.hidden).reduce((n, r) => n + r.rows, 0));
    expect(lib.collections.reduce((n, c) => n + c.datasets + c.hidden, 0)).toBe(5);
    expect(lib.publishers.reduce((n, p) => n + p.datasets, 0)).toBe(lib.totals.datasets);
    expect(lib.totals.newestPublication).toBe("2026-11-25T12:27:05.000Z");
  });
  it("groups new versions by publisher and hour, first publications by run, newest first", () => {
    const [eia, fhfa, first] = lib.changes;
    expect(lib.changes).toHaveLength(3);
    expect(eia).toMatchObject({ kind: "version", datasets: 2, rows: 302, from: "2026-11-25T12:27:00.000Z", to: "2026-11-25T12:27:05.000Z", single: null, publishers: 1 });
    expect(eia.datasetIds).toEqual([DS[1].id, DS[0].id]);
    expect(eia.members.map(i => lib.datasets[i].id)).toEqual(eia.datasetIds);
    expect(fhfa.single).toEqual({ datasetId: DS[3].id, title: row(DS[3].id).title, rows: 187_213, previousRows: 186_031, snapshotId: H(14), previousSnapshotId: H(4) });
    expect(first).toMatchObject({ kind: "first", datasets: 5, from: "2026-11-25T05:30:00.000Z", to: "2026-11-25T06:36:30.000Z", publisherId: null, publisherName: null });
  });
  it("with a full window keeps only whole groups and knows predecessors from before it", () => {
    // The 3 newest publications: the two EIA versions and the FHFA version, whose predecessor is before the window.
    const small = buildLibrary(sourceOf(SNAPS, 3), "direct", BUILT);
    expect(small.changesSince).toBe("2026-11-25T07:01:00.000Z");
    // The FHFA version (07:01) is in the window's first hour: it may have company before the window, so it is left out.
    expect(small.changes.map(c => [c.kind, c.datasets, c.from])).toEqual([["version", 2, "2026-11-25T12:27:00.000Z"]]);
    expect(small.datasets.find(r => r.id === DS[3].id)?.replaced).toBe(true);
    expect(small.datasets.find(r => r.id === DS[2].id)?.replaced).toBe(false);
    // Four newest: the window starts at 06:36:30 inside the first-publication run, so the run is left out, and the
    // FHFA version, in a later hour, keeps its predecessor from before the window.
    const four = buildLibrary(sourceOf(SNAPS, 4), "direct", BUILT);
    expect(four.changes.map(c => c.kind)).toEqual(["version", "version"]);
    expect(four.changes[1].single).toMatchObject({ datasetId: DS[3].id, previousRows: 186_031, previousSnapshotId: H(4) });
  });
  it("leaves out a dataset whose current snapshot is not readable", () => {
    const src = sourceOf(SNAPS, LIBRARY_WINDOW);
    src.datasets.push({ ...src.datasets[0], id: "official_x_hidden", latest: null, latest_snapshot_id: H(99) });
    expect(buildLibrary(src, "direct", BUILT).datasets.some(r => r.id === "official_x_hidden")).toBe(false);
  });
  it("packs and unpacks to the same library", () => {
    const wire = { ...lib, datasets: packLibraryRows(lib.datasets) };
    expect(unpackLibrary(JSON.parse(JSON.stringify(wire)))).toEqual(lib);
    expect(() => unpackLibrary({ ...wire, datasets: { ...wire.datasets, columns: ["id"] } })).toThrow();
  });
});

/** Fake tables: datasets, and snapshots with the columns the selects read. */
function tables(snaps: Snap[], datasets: typeof DS = DS, latest: Record<string, string> = LATEST): Record<"source_datasets" | "source_snapshots" | "source_records", FakeRow[]> {
  return {
    source_datasets: datasets.map(d => ({ ...d, source_url: null, grain: "One row per series per date", latest_snapshot_id: latest[d.id] })),
    source_snapshots: snaps.map(s => ({
      id: s.id, dataset_id: s.dataset_id, status: "ready", loaded_rows: s.rows, column_count: 4, published_at: s.at, retrieved_at: RETRIEVED,
      ingest: { dimensions: s.dims ?? { period: 0 }, constants: s.consts ?? { source_url: "https://example.gov/file.csv" }, ...(s.comp ? { composites: s.comp } : {}) },
      coverage: s.family ? { refresh_provenance: { family: s.family } } : {},
    })),
    source_records: [],
  };
}

describe("readLibraryWire", () => {
  let db: FakeSourceDb;
  beforeEach(() => {
    resetReadState();
    db = new FakeSourceDb(tables(SNAPS));
  });
  const kinds = () => db.calls.map(c => c.table);

  it("reads the window and the datasets with their current and earlier snapshots embedded", async () => {
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(unpackLibrary(r.data)).toEqual(buildLibrary(sourceOf(SNAPS, LIBRARY_WINDOW), "direct", BUILT));
    expect(kinds()).toEqual(["source_snapshots", "source_datasets"]);
    expect(db.calls[0]).toMatchObject({ columns: "id,dataset_id,loaded_rows,published_at", orders: ["published_at.desc", "id.desc"], limit: 400 });
    expect(db.calls[1].columns).toBe(
      "id,name,sector,agency,source_id,source_url,grain,latest_snapshot_id," +
      "latest:source_snapshots!source_datasets_latest_fk(id,loaded_rows,column_count,published_at,retrieved_at,dims:ingest->dimensions,consts:ingest->constants,comp:ingest->composites,family:coverage->refresh_provenance->>family)," +
      "prev:source_snapshots!source_snapshots_dataset_id_fkey(id,loaded_rows,published_at)");
    expect(db.calls[1].columns).toBe(LIBRARY_DATASET_SELECT);
    expect(db.calls[1]).toMatchObject({ orders: ["id.asc"], limit: 1000, embeds: { prev: { filters: ["status=eq", "published_at=lt"], orders: ["published_at.desc", "id.desc"], limit: 2 } } });
    expect(db.rpcs.map(x => x.fn)).toEqual(["source_library"]);
  });
  it("stays within four selects whatever the number of snapshots", async () => {
    const many: Snap[] = [...SNAPS];
    for (let i = 0; i < 10_000; i++) many.push(snap(H(100_000 + i), DS[i % 4].id, 50 + i, new Date(Date.parse("2026-11-26T00:00:00Z") + i * 60_000).toISOString()));
    const latest = { ...LATEST };
    for (let k = 0; k < 4; k++) latest[DS[k].id] = H(100_000 + 9996 + k);
    db = new FakeSourceDb(tables(many, DS, latest));
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lib = unpackLibrary(r.data);
    expect(db.calls.length).toBeLessThanOrEqual(4);
    expect(lib.changesSince).not.toBeNull();
    expect(lib.datasets.find(x => x.id === DS[0].id)).toMatchObject({ rows: 50 + 9996, replaced: true });
    expect(lib.datasets.find(x => x.id === DS[4].id)).toMatchObject({ replaced: false });
    expect(lib.changes.every(c => c.kind === "version")).toBe(true);
    expect(lib.changes.reduce((n, c) => n + c.datasets, 0)).toBeLessThanOrEqual(400);
  });
  it("pages 1,500 datasets in two selects and refuses more than 2,000 plainly", async () => {
    const datasets = Array.from({ length: 1500 }, (_, i) => ({ id: `official_04_energy_t${String(i).padStart(4, "0")}`, name: `T${i}`, sector: "04_energy", agency: "US EIA", source_id: null as string | null }));
    const snaps = datasets.map((d, i) => snap(H(200_000 + i), d.id, i + 1, new Date(Date.parse("2026-11-25T05:00:00Z") + i * 1000).toISOString()));
    db = new FakeSourceDb(tables(snaps, datasets, Object.fromEntries(datasets.map((d, i) => [d.id, H(200_000 + i)]))));
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r.ok && unpackLibrary(r.data).datasets).toHaveLength(1500);
    expect(kinds()).toEqual(["source_snapshots", "source_datasets", "source_datasets"]);
    resetReadState();
    const more = Array.from({ length: 2100 }, (_, i) => ({ id: `official_04_energy_u${String(i).padStart(4, "0")}`, name: `U${i}`, sector: "04_energy", agency: "US EIA", source_id: null as string | null }));
    const moreSnaps = more.map((d, i) => snap(H(300_000 + i), d.id, 1, "2026-11-25T05:00:00Z"));
    db = new FakeSourceDb(tables(moreSnaps, more, Object.fromEntries(more.map((d, i) => [d.id, H(300_000 + i)]))));
    const refused = await readLibraryWire(db, Date.parse(BUILT));
    expect(refused).toMatchObject({ ok: false, reason: "error" });
    expect(!refused.ok && refused.message).toContain("0069");
    expect(db.calls.length).toBeLessThanOrEqual(5);
  });
  it("serves the cached copy for ten minutes, then rebuilds only after a new publication", async () => {
    const t0 = Date.parse(BUILT);
    await readLibraryWire(db, t0);
    await readLibraryWire(db, t0 + LIBRARY_TTL_MS - 1);
    expect(db.calls).toHaveLength(2);
    await readLibraryWire(db, t0 + LIBRARY_TTL_MS + 1);
    expect(kinds()).toEqual(["source_snapshots", "source_datasets", "source_snapshots"]);
    expect(db.calls[2]).toMatchObject({ columns: "published_at", orders: ["published_at.desc"], limit: 1 });
    db.tables.source_snapshots.push({ ...db.tables.source_snapshots[0], id: H(30), published_at: "2026-11-25T20:30:00+00:00", loaded_rows: 102 });
    db.tables.source_datasets[0].latest_snapshot_id = H(30);
    const r = await readLibraryWire(db, t0 + 2 * LIBRARY_TTL_MS + 2);
    expect(kinds().slice(3)).toEqual(["source_snapshots", "source_snapshots", "source_datasets"]);
    expect(r.ok && unpackLibrary(r.data).datasets.find(x => x.id === DS[0].id)?.rows).toBe(102);
  });
  it("uses source_library when it exists", async () => {
    const src = sourceOf(SNAPS, LIBRARY_WINDOW);
    db.rpcAnswer = fn => (fn === "source_library" ? { data: src, error: null } : { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const r = await readLibraryWire(db, Date.parse(BUILT));
    expect(r.ok && r.data.via).toBe("source_library");
    expect(db.calls).toHaveLength(0);
  });
  it("passes a database error through", async () => {
    db.failNext = { code: "57014", message: "canceling statement due to statement timeout" };
    expect(await readLibraryWire(db, Date.parse(BUILT))).toMatchObject({ ok: false, reason: "timeout" });
  });
});
