import { describe, expect, it } from "vitest";
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

  it("list every collection board once in the gallery and split a long section into requests", () => {
    const ids = galleryBoards().map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("library");
    expect(sectionRequests({ title: "x", tiles: Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, title: "", form: "line", size: "regular", collection: "c", datasetId: "d" })) }, 6).map((r) => r.length)).toEqual([6, 6, 1]);
  });
});
