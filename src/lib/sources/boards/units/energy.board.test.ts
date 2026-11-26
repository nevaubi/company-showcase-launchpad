import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb } from "../../read.fake";
import { resetReadState } from "../../read.server";
import { readBoard, resetBoardCache } from "../board.server";
import { fixtureTables } from "../fixtures";
import type { Board } from "../types";
import { SPECS } from "./energy";
import { energyFixtureTables, type EnergyTableFixtures } from "./energy-tables";

/**
 * The Energy, Power and utilities and landing boards computed by the board server itself (its reads, its cache, its
 * compute) on a fake member client holding the core fixture rows and the energy fixture rows, all of them production
 * rows (energy report, round 6). The tiles must give the figures the energy checks recorded.
 */

const FIXTURES = JSON.parse(readFileSync("src/lib/sources/boards/units/energy.fixtures.json", "utf8")) as EnergyTableFixtures;
const CHECKS = JSON.parse(readFileSync("src/lib/sources/boards/units/energy.checks.json", "utf8")) as {
  tiles: Record<string, { snapshotId: string; asOf: string; figure: string; headline: string; rows: number[] }>;
};

function tables() {
  const core = fixtureTables();
  const energy = energyFixtureTables(FIXTURES);
  const coreIds = new Set(core.source_datasets.map((d) => d.id));
  const coreRows = new Set(core.source_records.map((r) => `${r.snapshot_id}:${r.row_number}`));
  return {
    source_datasets: [...core.source_datasets, ...energy.source_datasets.filter((d) => !coreIds.has(d.id))],
    source_snapshots: [...core.source_snapshots, ...energy.source_snapshots.filter((s) => !coreIds.has(s.dataset_id))],
    // a table both hold (MER T03.01) keeps the core rows; the energy rows of other series of it are added
    source_records: [...core.source_records, ...energy.source_records.filter((r) => !coreRows.has(`${r.snapshot_id}:${r.row_number}`))],
  };
}

const board = async (id: string, db: FakeSourceDb): Promise<Board> => {
  const read = await readBoard(db, id, Date.UTC(2026, 10, 26, 5));
  if (!read.ok) throw new Error(read.message);
  return read.data;
};

beforeEach(() => {
  resetBoardCache();
  resetReadState();
});

describe("energy boards on production rows, through the board server", () => {
  it.each(["04_energy", "05_utilities", "library"])("%s: every energy tile computes the checked figures", async (id) => {
    const db = new FakeSourceDb(tables());
    const b = await board(id, db);
    const mine = new Set(SPECS.tiles.map((t) => t.id));
    expect(b.refused.filter((r) => mine.has(r.id))).toEqual([]);
    for (const tile of b.tiles.filter((t) => mine.has(t.id))) {
      const check = CHECKS.tiles[tile.id];
      expect(check, tile.id).toBeDefined();
      expect(tile.result.ok).toBe(true);
      if (!tile.result.ok) continue;
      expect({ snapshotId: tile.result.refs.snapshotId, asOf: tile.result.asOf, figure: tile.result.figure, headline: tile.result.headline, rows: tile.result.refs.rows }).toEqual({
        snapshotId: check.snapshotId,
        asOf: check.asOf,
        figure: check.figure,
        headline: check.headline,
        rows: check.rows,
      });
      expect(tile.source.snapshotId).toBe(check.snapshotId);
      expect(tile.section, tile.id).toBeTruthy();
    }
  });

  it("reads each MER tile with one cell-filtered series read of one page, after one select for the dataset", async () => {
    const db = new FakeSourceDb(tables());
    await board("05_utilities", db);
    const records = db.calls.filter((c) => c.table === "source_records");
    const datasets = db.calls.filter((c) => c.table === "source_datasets");
    const tiles = SPECS.boards[0].tiles.length;
    expect(records.length).toBe(tiles);
    // T07.02A holds six of the tiles: its dictionary is read once and shared
    expect(datasets.length).toBeLessThan(tiles);
    for (const c of records) {
      expect(c.filters.some((f) => f.startsWith("values->>0"))).toBe(true);
      expect(c.limit).toBeLessThanOrEqual(1000);
    }
  });
});
