/**
 * The layout of a board from its specs alone, pure: sections with their headings in board order, each tile's form and
 * width, so a board renders its frame (headings, skeletons of each tile's real size) before any figure arrives and
 * loads one section at a time as it scrolls into view. On the landing board ("library") tiles are grouped by
 * collection, under the collection's name; elsewhere by the tile's `section`, tiles without one leading the board
 * under no heading.
 */
import { COLLECTIONS } from "../catalog/collections";
import { BOARDS, boardSpec, tileSpec } from "./specs";
import type { BoardLayout, BoardLayoutSection, BoardLayoutTile, TileSpec } from "./types";

const collectionName = (id: string) => COLLECTIONS.find((c) => c.id === id)?.name ?? id;

function layoutTile(spec: TileSpec): BoardLayoutTile {
  return { id: spec.id, title: spec.title, form: spec.form, size: spec.size ?? "regular", collection: spec.collection, datasetId: spec.datasetId };
}

/** The sections of a board, in the order their first tile appears in its list; null for a board that does not exist. */
export function boardLayout(id: string): BoardLayout | null {
  const board = boardSpec(id);
  if (!board) return null;
  const sections: BoardLayoutSection[] = [];
  const byTitle = new Map<string | null, BoardLayoutSection>();
  for (const tileId of board.tiles) {
    const spec = tileSpec(tileId);
    if (!spec) continue;
    const title = board.id === "library" ? collectionName(spec.collection) : (spec.section ?? null);
    let section = byTitle.get(title);
    if (!section) {
      section = { title, tiles: [] };
      byTitle.set(title, section);
      // tiles without a section lead the board
      if (title === null) sections.unshift(section);
      else sections.push(section);
    }
    section.tiles.push(layoutTile(spec));
  }
  return { id: board.id, title: board.title, sections };
}

/**
 * What the gallery shows, every chart once: each collection board in collection order (a board of no collection
 * after them, by id), then the landing board holding only the tiles that are on no collection board, when it has any
 * (the landing board's other tiles are each shown on their collection's board).
 */
export function galleryBoards(): BoardLayout[] {
  const order = new Map(COLLECTIONS.map((c, i) => [c.id, i] as const));
  const rank = (id: string) => order.get(id) ?? COLLECTIONS.length;
  const boards = BOARDS.filter((b) => b.id !== "library")
    .slice()
    .sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((b) => boardLayout(b.id))
    .filter((b): b is BoardLayout => b !== null);
  const onBoards = new Set(boards.flatMap((b) => b.sections.flatMap((s) => s.tiles.map((t) => t.id))));
  const landing = boardLayout("library");
  if (!landing) return boards;
  const sections = landing.sections.map((s) => ({ ...s, tiles: s.tiles.filter((t) => !onBoards.has(t.id)) })).filter((s) => s.tiles.length > 0);
  return sections.length ? [...boards, { ...landing, sections }] : boards;
}

/** The tiles of one section, split into requests of at most `size` tiles (one server request each). */
export function sectionRequests(section: BoardLayoutSection, size = 6): string[][] {
  const ids = section.tiles.map((t) => t.id);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
