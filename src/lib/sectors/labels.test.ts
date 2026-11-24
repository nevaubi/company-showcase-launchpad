import { describe, expect, it } from "vitest";
import { placeLabels, type LabelOut } from "./labels";

const overlap = (a: LabelOut["box"], b: LabelOut["box"]) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const clear = (out: LabelOut[]) => out.every((a, i) => out.every((b, j) => i >= j || !overlap(a.box, b.box)));
const AREA = { left: 24, right: 344, top: 24, bottom: 296 };

describe("label placement", () => {
  it("keeps labels of crowded points apart at phone width", () => {
    // eleven sector funds on a 368 px wide plot, several within a few pixels of each other
    const pts = [
      ["XLP", 300, 96], ["XLRE", 296, 100], ["XLU", 288, 104], ["XLY", 250, 108], ["XLF", 240, 118], ["XLV", 300, 124],
      ["XLB", 215, 130], ["XLI", 190, 106], ["XLC", 184, 114], ["XLE", 205, 190], ["XLK", 90, 200],
    ].map(([id, x, y]) => ({ id: id as string, x: x as number, y: y as number, w: (id as string).length * 7 }));
    const out = placeLabels(pts, AREA);
    expect(out).toHaveLength(11);
    expect(clear(out)).toBe(true);
    for (const l of out) expect(l.box.x0 >= AREA.left && l.box.x1 <= AREA.right, l.id).toBe(true);
  });
  it("puts a label to the right when there is room and to the left at the right edge", () => {
    const [a, b] = placeLabels([{ id: "A", x: 100, y: 100, w: 30 }, { id: "B", x: 330, y: 200, w: 30 }], AREA);
    expect(a).toMatchObject({ anchor: "start", x: 107, y: 103.5 });
    expect(b).toMatchObject({ anchor: "end", x: 323 });
  });
  it("gives the second of two coincident points a free slot beside the first", () => {
    const [a, b] = placeLabels([{ id: "A", x: 100, y: 100, w: 30 }, { id: "B", x: 100, y: 100, w: 30 }], AREA);
    expect(a.y).toBe(103.5);
    expect(overlap(a.box, b.box)).toBe(false);
  });
});
