import { beforeEach, describe, expect, it } from "vitest";
import { FakeSourceDb } from "../read.fake";
import { resetReadState } from "../read.server";
import { readBoard, resetBoardCache } from "./board.server";
import { fixtureTables } from "./fixtures";
import { BOARDS, TILES } from "./specs";
import type { Board } from "./types";

/** Every board computed through the real read layer, on a fake member client that holds the fixture rows. */

const tables = fixtureTables();
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
