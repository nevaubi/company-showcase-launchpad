import { describe, expect, it } from "vitest";
import { composeBoards, composeProblems, type UnitSpecs } from "./compose";
import { BOARDS, CORE_BOARDS, CORE_TILES, TILES } from "./specs";
import type { BoardSpec, TileSpec } from "./types";
import { UNIT_SPECS } from "./units/index";

const tile = (id: string): TileSpec => ({ ...CORE_TILES[0], id }) as TileSpec;
const unit = (u: Partial<UnitSpecs> & { unit: string }): UnitSpecs => ({ tiles: [], boards: [], boardTiles: {}, ...u });

describe("composed boards", () => {
  it("fit together: no id twice, every listed tile and board defined", () => {
    expect(composeProblems(CORE_TILES, CORE_BOARDS, UNIT_SPECS)).toEqual([]);
  });

  it("keep the core boards first and every core tile", () => {
    expect(BOARDS.slice(0, CORE_BOARDS.length).map((b) => b.id)).toEqual(CORE_BOARDS.map((b) => b.id));
    for (const t of CORE_TILES) expect(TILES).toContain(t);
  });

  it("append a unit's tiles to a board in unit order, without repeats", () => {
    const core: BoardSpec[] = [{ id: "04_energy", title: "Energy", tiles: ["a"] }];
    const units = [
      unit({ unit: "one", tiles: [tile("b")], boardTiles: { "04_energy": ["b", "a"] } }),
      unit({ unit: "two", tiles: [tile("c")], boards: [{ id: "03_healthcare", title: "Health care", tiles: ["c"] }], boardTiles: { "04_energy": ["c"] } }),
    ];
    expect(composeBoards(core, units)).toEqual([
      { id: "04_energy", title: "Energy", tiles: ["a", "b", "c"] },
      { id: "03_healthcare", title: "Health care", tiles: ["c"] },
    ]);
    expect(core[0].tiles).toEqual(["a"]);
  });

  it("report a tile or board defined twice, and tiles or boards that do not exist", () => {
    const core: BoardSpec[] = [{ id: "04_energy", title: "Energy", tiles: [] }];
    const units = [
      unit({ unit: "one", tiles: [tile("x")], boards: [{ id: "04_energy", title: "Again", tiles: ["x"] }] }),
      unit({ unit: "two", tiles: [tile("x")], boardTiles: { "99_none": ["x"], "04_energy": ["y"] } }),
    ];
    expect(composeProblems([], core, units).map((p) => p.problem)).toEqual([
      "tile x is also defined by one",
      "board 04_energy is also defined by core",
      "adds tiles to board 99_none, which no spec defines",
      "adds tile y to board 04_energy, but no spec defines it",
    ]);
  });
});
