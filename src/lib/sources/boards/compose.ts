import type { ScaleUnit } from "./scale";
import type { BoardSpec, TileSpec } from "./types";

/**
 * What one unit adds to the boards, kept in its own file (./units/<unit>.ts) so that units working at the same
 * time never edit a shared list: its tiles, the boards it defines (a collection that had none), and the tiles it
 * appends to boards defined elsewhere, by board id.
 */
export type UnitSpecs = {
  unit: string;
  tiles: readonly TileSpec[];
  boards: readonly BoardSpec[];
  boardTiles: Readonly<Record<string, readonly string[]>>;
  /**
   * Units the unit's tiles print in a reader's scale, added to the whitelist of `scale.ts`. Each entry matches a unit
   * exactly as a dictionary or a reviewed profile states it, checked on production, with its evidence in a comment
   * beside it (the snapshot and fields that state it, the publisher's instructions). A unit string may appear in more
   * than one unit's list only with the same exponent and base (a test holds them to it).
   */
  scaleUnits?: readonly ScaleUnit[];
};

/** A problem of the composed boards, for the tests: an id defined twice, or a board or tile that does not exist. */
export type ComposeProblem = { unit: string; problem: string };

/**
 * The boards: the core boards, then each unit's new boards, then each unit's tiles appended to a board, in unit
 * order. A tile already on a board is not added twice. Nothing is thrown at load: `composeProblems` reports what
 * does not fit, and a test requires it to report nothing.
 */
export function composeBoards(core: readonly BoardSpec[], units: readonly UnitSpecs[]): BoardSpec[] {
  const out: BoardSpec[] = core.map((b) => ({ ...b, tiles: [...b.tiles] }));
  for (const u of units) for (const b of u.boards) if (!out.some((o) => o.id === b.id)) out.push({ ...b, tiles: [...b.tiles] });
  for (const u of units)
    for (const [id, tiles] of Object.entries(u.boardTiles)) {
      const board = out.find((o) => o.id === id);
      if (!board) continue;
      board.tiles = [...board.tiles, ...tiles.filter((t) => !board.tiles.includes(t))];
    }
  return out;
}

export function composeProblems(coreTiles: readonly TileSpec[], core: readonly BoardSpec[], units: readonly UnitSpecs[]): ComposeProblem[] {
  const problems: ComposeProblem[] = [];
  const tileIds = new Map<string, string>(coreTiles.map((t) => [t.id, "core"] as const));
  for (const u of units)
    for (const t of u.tiles) {
      const owner = tileIds.get(t.id);
      if (owner) problems.push({ unit: u.unit, problem: `tile ${t.id} is also defined by ${owner}` });
      else tileIds.set(t.id, u.unit);
    }
  const boardIds = new Map<string, string>(core.map((b) => [b.id, "core"] as const));
  for (const u of units)
    for (const b of u.boards) {
      const owner = boardIds.get(b.id);
      if (owner) problems.push({ unit: u.unit, problem: `board ${b.id} is also defined by ${owner}` });
      else boardIds.set(b.id, u.unit);
    }
  for (const u of units) {
    for (const b of u.boards) for (const t of b.tiles) if (!tileIds.has(t)) problems.push({ unit: u.unit, problem: `board ${b.id} lists tile ${t}, which no spec defines` });
    for (const [id, tiles] of Object.entries(u.boardTiles)) {
      if (!boardIds.has(id)) problems.push({ unit: u.unit, problem: `adds tiles to board ${id}, which no spec defines` });
      for (const t of tiles) if (!tileIds.has(t)) problems.push({ unit: u.unit, problem: `adds tile ${t} to board ${id}, but no spec defines it` });
    }
  }
  return problems;
}
