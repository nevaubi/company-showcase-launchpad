import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb } from "../../read.fake";
import { resetReadState } from "../../read.server";
import { BOARD_READ_BUDGET, readBoard, resetBoardCache } from "../board.server";
import { boardFixtureTables, fixtureTables } from "../fixtures";
import type { Board } from "../types";
import { SPECS } from "./energy";
import { energyFixtureTables, type EnergyTableFixtures } from "./energy-tables";
import { withUnitFixtures } from "./fixtures";

/**
 * The Energy, Power and utilities and landing boards computed by the board server itself (its reads, its read budget,
 * its compute) on a fake member client holding the core rows and the energy fixture rows, all production rows (energy
 * report, round 6). Every energy tile must give the figures the energy checks recorded, on the trimmed rows of
 * `energy.fixtures.json` and on the untrimmed rows of `energy.rows.json` alike.
 */

const ROWS = JSON.parse(readFileSync("src/lib/sources/boards/units/energy.rows.json", "utf8")) as EnergyTableFixtures;
const CHECKS = JSON.parse(readFileSync("src/lib/sources/boards/units/energy.checks.json", "utf8")) as {
  tiles: Record<string, { datasetId: string; snapshotId: string; asOf: string; figure: string; figureUnit: string; headline: string; rows: number[] }>;
};
const MINE = new Set(SPECS.tiles.map((t) => t.id));
const NOW = Date.UTC(2026, 10, 26, 6);

/** Every tile of a board through as many requests as its read budget takes, each request's selects counted. */
async function wholeBoard(db: FakeSourceDb, id: string): Promise<{ board: Board; requests: number[] }> {
  const requests: number[] = [];
  const tiles: Board["tiles"] = [];
  const refused: Board["refused"] = [];
  let left: string[] | undefined;
  for (let round = 0; round < 12; round += 1) {
    const before = db.calls.length;
    const read = await readBoard(db, id, NOW, left);
    if (!read.ok) throw new Error(read.message);
    requests.push(db.calls.length - before);
    tiles.push(...read.data.tiles);
    refused.push(...read.data.refused);
    left = read.data.deferred;
    if (!left?.length) return { board: { ...read.data, tiles, refused, deferred: undefined }, requests };
  }
  throw new Error(`board ${id} still defers tiles after 12 requests`);
}

const summary = (t: Board["tiles"][number]) =>
  t.result.ok
    ? { datasetId: t.source.datasetId, snapshotId: t.result.refs.snapshotId, asOf: t.result.asOf, figure: t.result.figure, figureUnit: t.result.figureUnit, headline: t.result.headline, rows: t.result.refs.rows }
    : null;

beforeEach(() => {
  resetBoardCache();
  resetReadState();
});

describe("energy boards on production rows, through the board server", () => {
  it.each(["04_energy", "05_utilities", "library"])("%s: every energy tile computes the checked figures within the read budget", async (id) => {
    const db = new FakeSourceDb(boardFixtureTables());
    const { board, requests } = await wholeBoard(db, id);
    expect(board.refused.filter((r) => MINE.has(r.id))).toEqual([]);
    for (const n of requests) expect(n).toBeLessThanOrEqual(BOARD_READ_BUDGET);
    const mine = board.tiles.filter((t) => MINE.has(t.id));
    expect(mine.length).toBeGreaterThan(0);
    for (const tile of mine) {
      expect(summary(tile), tile.id).toEqual(CHECKS.tiles[tile.id]);
      expect(tile.source.snapshotId).toBe(CHECKS.tiles[tile.id].snapshotId);
      expect(tile.section, tile.id).toBeTruthy();
      expect(tile.result.ok && tile.result.headline).not.toMatch(/\u2014/);
    }
  });

  it("gives the same figures on the untrimmed rows", async () => {
    const full = withUnitFixtures(fixtureTables(), [{ unit: "energy", tables: energyFixtureTables(ROWS) }]);
    for (const id of ["04_energy", "05_utilities"]) {
      resetBoardCache();
      resetReadState();
      const { board } = await wholeBoard(new FakeSourceDb(full), id);
      expect(board.refused.filter((r) => MINE.has(r.id))).toEqual([]);
      for (const tile of board.tiles.filter((t) => MINE.has(t.id))) expect(summary(tile), tile.id).toEqual(CHECKS.tiles[tile.id]);
    }
  });

  it("records a check for every energy tile and for nothing else", () => {
    expect(Object.keys(CHECKS.tiles).sort()).toEqual([...MINE].sort());
  });
});
