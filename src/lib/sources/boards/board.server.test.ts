import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb } from "../read.fake";
import { resetReadState } from "../read.server";
import { readBoard, resetBoardCache } from "./board.server";
import { fixtureTables } from "./fixtures";
import { BOARDS, TILES } from "./specs";
import type { Board } from "./types";

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
const board = async (id: string, db = new FakeSourceDb(tables)): Promise<Board> => {
  const read = await readBoard(db, id, Date.UTC(2026, 10, 25, 21));
  if (!read.ok) throw new Error(read.message);
  return read.data;
};

beforeEach(() => {
  resetBoardCache();
  resetReadState();
});

describe("boards on the fixture rows", () => {
  it("computes every tile of every board, none refused", async () => {
    for (const spec of BOARDS) {
      const b = await board(spec.id);
      expect(b.refused, spec.id).toEqual([]);
      expect(b.tiles.map((t) => t.id)).toEqual(spec.tiles);
    }
    expect(new Set(BOARDS.flatMap((b) => b.tiles))).toEqual(new Set(TILES.map((t) => t.id)));
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
    await readBoard(db, "library", start);
    const cold = db.calls.length;
    await readBoard(db, "library", start + 5 * 60_000);
    expect(db.calls.length).toBe(cold);
    await readBoard(db, "library", start + 11 * 60_000);
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

  it("answers not-found for an unknown board", async () => {
    expect(await readBoard(new FakeSourceDb(tables), "nope")).toMatchObject({ ok: false, reason: "not-found" });
  });
});
