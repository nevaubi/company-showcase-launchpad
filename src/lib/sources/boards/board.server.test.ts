import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb } from "../read.fake";
import { resetReadState } from "../read.server";
import { BOARD_READ_BUDGET, crossRead, latestParsedPeriod, readBoard, readTiles, resetBoardCache } from "./board.server";
import { fixtureTables } from "./fixtures";
import { CORE_BOARDS, CORE_TILES } from "./specs";
import type { Board, CompareTileSpec, TileSpec } from "./types";

/** Every board computed through the real read layer, on a fake member client that holds the fixture rows. */

const tables = fixtureTables();

const MORTGAGE = "official_11_real_estate_raw_fred_mortgage30us_dbaf839e72";
const HPI = "official_11_real_estate_hpi_master_all_0755e8292e";
/** Rows production holds under the FHFA United States address, every index type and frequency (review int-code S3). */
const HPI_USA_ROWS = 1136;

/**
 * The fixture rows padded to what production holds for the series the library board reads (datasets.json `rows`):
 * weekly observations before the fixture's first mortgage rate, and FHFA United States rows of other index flavours,
 * which the tile's own cell matches drop. The FRED monthly tables (at most 322 rows), the MER series and the FDIC
 * cohort (496 rows, all in the fixture) need no padding: they fit one page either way.
 */
function productionShaped() {
  const t = fixtureTables();
  const snapshotOf = (datasetId: string) => {
    const s = t.source_snapshots.find((x) => x.dataset_id === datasetId);
    if (!s) throw new Error(`no snapshot of ${datasetId}`);
    return s;
  };
  const mortgage = snapshotOf(MORTGAGE);
  const weekly = t.source_records.filter((r) => r.snapshot_id === mortgage.id).sort((a, b) => Number(a.row_number) - Number(b.row_number));
  const firstDay = Date.parse(`${weekly[0].period as string}T00:00:00Z`);
  for (let row = Number(weekly[0].row_number) - 1, k = 1; row >= 1; row--, k++) {
    const day = new Date(firstDay - k * 7 * 864e5).toISOString().slice(0, 10);
    t.source_records.push({ snapshot_id: mortgage.id, row_number: row, period: day, values: [day, "7.00"] });
  }
  const hpi = snapshotOf(HPI);
  const usa = t.source_records.filter((r) => r.snapshot_id === hpi.id).length;
  for (let i = 0; usa + i < HPI_USA_ROWS; i++) {
    const yr = String(1975 + Math.floor(i / 4));
    t.source_records.push({ snapshot_id: hpi.id, row_number: 100_000 + i, period: yr, geo_code: "USA", values: ["traditional", "all-transactions", "quarterly", null, null, "USA", yr, String(1 + (i % 4)), "100.00", null, null, null] });
  }
  return t;
}
/** The tiles of round 4 on a board: the fixtures hold their rows (units' tiles have their own checks). */
const coreTiles = (id: string) => CORE_BOARDS.find((b) => b.id === id)?.tiles ?? [];
const board = async (id: string, db = new FakeSourceDb(tables)): Promise<Board> => {
  const read = await readBoard(db, id, Date.UTC(2026, 10, 25, 21), coreTiles(id));
  if (!read.ok) throw new Error(read.message);
  return read.data;
};

beforeEach(() => {
  resetBoardCache();
  resetReadState();
});

describe("boards on the fixture rows", () => {
  it("computes every tile of every core board, none refused or deferred", async () => {
    for (const spec of CORE_BOARDS) {
      const b = await board(spec.id);
      expect(b.refused, spec.id).toEqual([]);
      expect(b.deferred, spec.id).toBeUndefined();
      expect(b.tiles.map((t) => t.id)).toEqual(spec.tiles);
    }
    expect(new Set(CORE_BOARDS.flatMap((b) => b.tiles))).toEqual(new Set(CORE_TILES.map((t) => t.id)));
  });

  it("serves the library board with its source lines", async () => {
    const b = await board("library");
    const byId = new Map(b.tiles.map((t) => [t.id, t] as const));
    const energy = byId.get("energy-consumption");
    expect(energy?.result.ok && energy.result.headline).toBe("Total primary energy consumption was 8.29 Quadrillion Btu in Aug 2026, 1.7% above Aug 2025.");
    expect(energy?.source).toMatchObject({
      datasetId: "official_04_energy_raw_mer_t01_01_50b683cd84",
      snapshotId: "9a953a8c60285f8aeef9c451850a3cbf362cef7d6550e35fde21315788d74f32",
      retrievedAt: "2026-11-25T06:05:26.061+00:00",
    });
    const hpi = byId.get("house-prices-12m");
    expect(hpi?.result.ok && hpi.result.headline).toBe("The FHFA purchase-only house price index for the United States rose 2.5% over the 12 months to Sep 2026.");
    const banks = byId.get("largest-banks-assets");
    expect(banks?.result.ok && banks.result.points[0]).toMatchObject({ key: "628", label: "JPMORGAN CHASE BANK NA", row: 10 });
    expect(b.tiles.every((t) => t.source.publisher.length > 0 && t.source.table.length > 0)).toBe(true);
  });

  it("keeps every read inside the bounds of today's reads", async () => {
    const db = new FakeSourceDb(tables);
    await board("library", db);
    const recordCalls = db.calls.filter((c) => c.table === "source_records");
    expect(recordCalls.length).toBeGreaterThan(0);
    for (const c of recordCalls) {
      expect(c.filters[0]).toBe("snapshot_id=eq");
      expect(c.limit).not.toBeNull();
      expect(c.limit as number).toBeLessThanOrEqual(1001);
      expect(c.columns).not.toMatch(/(^|,)values(,|$)/);
    }
  });

  it("reads the library board cold in at most 25 selects on rows shaped like production", async () => {
    const shaped = productionShaped();
    expect(shaped.source_records.filter((r) => r.snapshot_id === shaped.source_snapshots.find((s) => s.dataset_id === MORTGAGE)?.id)).toHaveLength(1403);
    const db = new FakeSourceDb(shaped);
    const b = await board("library", db);
    expect(b.refused).toEqual([]);
    expect(b.tiles).toHaveLength(9);
    // 58 selects before review int-code S3: two metadata selects a tile, a snapshot select in every read, one series read a field
    expect(db.calls.length).toBeLessThanOrEqual(25);
    // each dictionary once: on the dataset select with its snapshot, never on a snapshot select of its own
    expect(db.calls.filter((c) => c.table === "source_snapshots")).toEqual([]);
    expect(db.calls.filter((c) => c.columns.includes("columns,ingest"))).toHaveLength(9);
    // the FHFA tile: the measure, its three cell matches and the period on one select a page (1,136 rows, two pages)
    const hpi = db.calls.filter((c) => c.table === "source_records" && c.filters.includes("geo_code=eq"));
    expect(hpi).toHaveLength(2);
    expect(hpi[0].columns).toBe("row_number,period,c0:values->>9,c1:values->>6,c2:values->>7,c3:values->>2,c4:values->>0,c5:values->>1");
  });

  it("shares one read and one computation among callers that ask at the same time", async () => {
    const one = new FakeSourceDb(productionShaped());
    await board("library", one);
    resetBoardCache();
    resetReadState();
    const db = new FakeSourceDb(productionShaped());
    const [a, b] = await Promise.all([board("library", db), board("library", db)]);
    expect(a.tiles).toEqual(b.tiles);
    expect(db.calls.length).toBe(one.calls.length);
  });

  it("after ten minutes reads only each dataset's pointer and keeps the computed tiles of an unchanged snapshot", async () => {
    const db = new FakeSourceDb(productionShaped());
    const start = Date.UTC(2026, 10, 25, 21);
    await readBoard(db, "library", start, coreTiles("library"));
    const cold = db.calls.length;
    await readBoard(db, "library", start + 5 * 60_000, coreTiles("library"));
    expect(db.calls.length).toBe(cold);
    await readBoard(db, "library", start + 11 * 60_000, coreTiles("library"));
    const later = db.calls.slice(cold);
    expect(later).toHaveLength(9);
    expect(later.every((c) => c.table === "source_datasets" && !c.columns.includes("latest:"))).toBe(true);
  });

  it("turns a tile off and says why when the publisher renames a field", async () => {
    const renamed = fixtureTables();
    const snap = renamed.source_snapshots.find((s) => s.dataset_id === "official_04_energy_raw_mer_t01_01_50b683cd84");
    if (!snap) throw new Error("no snapshot");
    snap.columns = (snap.columns as { label: string }[]).map((c) => (c.label === "Unit" ? { ...c, label: "Units" } : c));
    const b = await board("04_energy", new FakeSourceDb(renamed));
    expect(b.refused).toEqual([
      {
        id: "energy-consumption",
        title: "Total primary energy consumption (MER table 1.1)",
        reason: "Charts are off for this version: the eia-mer profile reads fields this version does not carry as expected (field Unit not found).",
      },
    ]);
    expect(b.tiles).toHaveLength(3);
  });

  it("answers not-found for an unknown board and refuses a tile that is not on the board", async () => {
    expect(await readBoard(new FakeSourceDb(tables), "nope")).toMatchObject({ ok: false, reason: "not-found" });
    expect(await readBoard(new FakeSourceDb(tables), "01_financials", Date.now(), ["unemployment-rate"])).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("the read budget of a board request", () => {
  it("defers the tiles past the budget and serves them in the next request, no request past its budget", async () => {
    const db = new FakeSourceDb(productionShaped());
    const now = Date.UTC(2026, 10, 25, 21);
    const first = await readBoard(db, "library", now, coreTiles("library"), 10);
    if (!first.ok) throw new Error(first.message);
    expect(db.calls.length).toBeLessThanOrEqual(10);
    expect(first.data.deferred?.length).toBeGreaterThan(0);
    const seen = new Set(first.data.tiles.map((t) => t.id));
    let left = first.data.deferred ?? [];
    for (let round = 0; left.length && round < 8; round += 1) {
      const before = db.calls.length;
      const next = await readBoard(db, "library", now, left, 10);
      if (!next.ok) throw new Error(next.message);
      expect(db.calls.length - before).toBeLessThanOrEqual(10);
      next.data.tiles.forEach((t) => seen.add(t.id));
      expect(next.data.refused).toEqual([]);
      left = next.data.deferred ?? [];
    }
    expect(left).toEqual([]);
    expect([...seen].sort()).toEqual([...coreTiles("library")].sort());
  });

  it("keeps the whole library board inside one budget of 40 selects", async () => {
    const db = new FakeSourceDb(productionShaped());
    await board("library", db);
    expect(db.calls.length).toBeLessThanOrEqual(BOARD_READ_BUDGET);
  });
});

describe("tiles of several tables", () => {
  const UNRATE = "official_00_universal_raw_fred_unrate_3286ca8718";
  const FEDFUNDS = "official_00_universal_raw_fred_fedfunds_60a510e6af";
  const compare: CompareTileSpec = {
    id: "t-compare",
    collection: "00_universal",
    datasetId: UNRATE,
    measure: "UNRATE",
    title: "Unemployment and the funds rate",
    subject: "The unemployment rate",
    unit: "Percent",
    decimals: 2,
    form: "compare",
    transform: "level",
    headline: "spread",
    spread: { of: 0, less: 1 },
    window: 24,
    lines: [
      { label: "Unemployment rate", subject: "the unemployment rate", series: { whole: true } },
      { datasetId: FEDFUNDS, measure: "FEDFUNDS", label: "Federal funds rate", subject: "the effective federal funds rate", series: { whole: true } },
    ],
  };

  it("reads each series on its own table and names the other tables in the source", async () => {
    const db = new FakeSourceDb(tables);
    const b = await readTiles(db, [compare as TileSpec], Date.UTC(2026, 10, 25, 21));
    expect(b.refused).toEqual([]);
    const t = b.tiles[0];
    expect(t.result.ok && t.result.headline).toBe("The unemployment rate was 0.22 percentage points above the effective federal funds rate in Oct 2026.");
    expect(t.source.datasetId).toBe(UNRATE);
    expect(t.source.also?.map((a) => a.datasetId)).toEqual([FEDFUNDS]);
    expect(t.selection).toEqual({ lines: [{ datasetId: UNRATE, series: { whole: true } }, { datasetId: FEDFUNDS, series: { whole: true } }] });
    // two datasets, one page of each series
    expect(db.calls.length).toBe(4);
  });
});

/** A synthetic state table: one record per state and year, EIA's footer stored as a record, 1,200 records a year. */
function stateTable(opts: { years: string[]; perYear: number; footer?: boolean; rows?: number }) {
  const records: Record<string, unknown>[] = [];
  let row = 0;
  for (const year of opts.years)
    for (let i = 0; i < opts.perYear; i += 1) {
      row += 1;
      records.push({ snapshot_id: "s1", row_number: row, period: year, geo_code: `K${i}`, values: [year, `K${i}`, String(i), i % 2 ? "a" : "b"] });
    }
  if (opts.footer) records.push({ snapshot_id: "s1", row_number: row + 1, period: "Source: U.S. Energy Information Administration", values: ["Source: U.S. Energy Information Administration", null, null, null] });
  const columns = ["Year", "State", "Value", "Kind"].map((label, i) => ({ key: `col${i}`, label, type: "string" }));
  const tables = {
    source_datasets: [{ id: "d1", source_id: "T", latest_snapshot_id: "s1", name: "t", sector: "05_utilities", agency: "a", source_url: null, grain: "g" }],
    source_snapshots: [{ id: "s1", dataset_id: "d1", status: "ready", columns, ingest: { dimensions: { period: 0, geo_code: 1 } }, retrieved_at: "2026-11-24T09:00:00Z", published_at: null, loaded_rows: opts.rows ?? records.length, column_count: 4, file_sha256: "x" }],
    source_records: records,
  };
  return { tables, meta: { snapshotId: "s1", rows: opts.rows ?? records.length, columns, ingest: { dimensions: { period: 0, geo_code: 1 } } } };
}

describe("cross-sections", () => {
  it("take the greatest period of the declared format, passing over a footer stored as a record and counting it", async () => {
    const { tables } = stateTable({ years: ["2024", "2025"], perYear: 3, footer: true });
    const db = new FakeSourceDb(tables as never);
    expect(await latestParsedPeriod(db, "s1", "year")).toEqual({ period: "2025", skipped: [{ period: "Source: U.S. Energy Information Administration", records: 1, atLeast: false }] });
  });

  it("read one period in pages, complete only when it ends inside five", async () => {
    const { tables, meta } = stateTable({ years: ["2025"], perYear: 2500 });
    const db = new FakeSourceDb(tables as never);
    const read = await crossRead(db, meta as never, { by: "geo_code", period: "latest" }, [2], "year");
    expect(read.cells).toHaveLength(2500);
    expect(read.period).toBe("2025");
    // a probe, then three pages
    expect(db.calls.length).toBe(4);
    const big = stateTable({ years: ["2025"], perYear: 5001 });
    await expect(crossRead(new FakeSourceDb(big.tables as never), big.meta as never, { by: "geo_code", period: "2025" }, [2], "year")).rejects.toThrow(
      "The period 2025 has more than 5,000 records; a part is never ranked or drawn as the whole.",
    );
  });

  it("filter by a field inside the select on a small snapshot and after the read on a large one", async () => {
    const small = stateTable({ years: ["2025"], perYear: 10 });
    const db = new FakeSourceDb(small.tables as never);
    const a = await crossRead(db, small.meta as never, { by: "geo_code", period: "2025", where: [{ field: "Kind", value: "a" }] }, [2], "year");
    expect(a.cells.map((c) => c.key)).toEqual(["K1", "K3", "K5", "K7", "K9"]);
    expect(db.calls[0].filters).toContain("values->>3=eq");
    const large = stateTable({ years: ["2025"], perYear: 10, rows: 60_000 });
    const db2 = new FakeSourceDb(large.tables as never);
    const b = await crossRead(db2, large.meta as never, { by: "geo_code", period: "2025", where: [{ field: "Kind", value: "a" }] }, [2], "year");
    expect(b.cells.map((c) => c.key)).toEqual(["K1", "K3", "K5", "K7", "K9"]);
    expect(db2.calls[0].filters).not.toContain("values->>3=eq");
  });

  it("read a whole small table only when it has no period dimension", async () => {
    const { tables, meta } = stateTable({ years: ["2025"], perYear: 4 });
    await expect(crossRead(new FakeSourceDb(tables as never), meta as never, { by: "geo_code", period: "table" }, [2], "year")).rejects.toThrow("The table has periods");
    const flat = { ...meta, ingest: { dimensions: { geo_code: 1 } } };
    const read = await crossRead(new FakeSourceDb(tables as never), flat as never, { by: "geo_code", period: "table" }, [2], null);
    expect(read).toMatchObject({ table: true, period: null });
    expect(read.cells).toHaveLength(4);
  });
});
