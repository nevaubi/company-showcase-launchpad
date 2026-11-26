import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "../catalog/collections";
import { boardLayout, galleryBoards, sectionRequests } from "./layout";
import { BOARDS, tileSpec } from "./specs";

describe("board layouts", () => {
  it("hold every tile of a board once, in sections", () => {
    for (const board of BOARDS) {
      const layout = boardLayout(board.id)!;
      expect(layout.sections.flatMap((s) => s.tiles.map((t) => t.id)).sort(), board.id).toEqual([...board.tiles].sort());
      expect(new Set(layout.sections.map((s) => s.title)).size, board.id).toBe(layout.sections.length);
    }
  });

  it("group the landing board by collection, in the order of its tiles", () => {
    const layout = boardLayout("library")!;
    for (const s of layout.sections) expect(s.title).not.toBeNull();
    const first = tileSpec(BOARDS.find((b) => b.id === "library")!.tiles[0])!;
    expect(layout.sections[0].tiles[0].collection).toBe(first.collection);
  });

  it("lead a collection board with its tiles without a section, then the sections in board order", () => {
    for (const board of BOARDS.filter((b) => b.id !== "library")) {
      const layout = boardLayout(board.id)!;
      const untitled = layout.sections.findIndex((s) => s.title === null);
      expect(untitled === -1 || untitled === 0, board.id).toBe(true);
    }
  });

  it("list every collection board once in the gallery, in collection order, and split a long section into requests", () => {
    const gallery = galleryBoards();
    const ids = gallery.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const collections = ids.filter((id) => id !== "library");
    const rank = (id: string) => {
      const i = COLLECTIONS.findIndex((c) => c.id === id);
      return i === -1 ? COLLECTIONS.length : i;
    };
    for (let i = 1; i < collections.length; i++) expect(rank(collections[i - 1]) <= rank(collections[i]), collections[i]).toBe(true);
    expect([...collections].sort()).toEqual(BOARDS.filter((b) => b.id !== "library").map((b) => b.id).sort());
    expect(sectionRequests({ title: "x", tiles: Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, title: "", form: "line", size: "regular", collection: "c", datasetId: "d" })) }, 6).map((r) => r.length)).toEqual([6, 6, 1]);
  });

  it("show every chart of every board in the gallery exactly once, a landing tile through its collection's board", () => {
    const gallery = galleryBoards();
    const shown = gallery.flatMap((b) => b.sections.flatMap((s) => s.tiles.map((t) => t.id)));
    expect(new Set(shown).size).toBe(shown.length);
    expect(new Set(shown)).toEqual(new Set(BOARDS.flatMap((b) => b.tiles)));
    // a tile shown under the landing board is on no collection board
    const landing = gallery.find((b) => b.id === "library");
    const onCollections = new Set(BOARDS.filter((b) => b.id !== "library").flatMap((b) => b.tiles));
    for (const s of landing?.sections ?? []) for (const t of s.tiles) expect(onCollections.has(t.id), t.id).toBe(false);
  });
});
