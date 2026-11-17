import { describe, expect, it } from "vitest";
import { blankDeck, clampEl, duplicateSlide, H, makeSlide, moveSlide, W } from "./deck";

describe("deck ops", () => {
  it("title layout has a title and subtitle", () => {
    expect(makeSlide("title", "Q3", "Results").els.map((e) => e.role)).toEqual(["title", "subtitle"]);
  });
  it("keeps elements on the slide", () => {
    const e = clampEl({ id: "a", type: "text", x: 12, y: 7, w: 4, h: 2 });
    expect(e.x + e.w).toBeLessThanOrEqual(W); expect(e.y + e.h).toBeLessThanOrEqual(H);
  });
  it("moves and duplicates slides with fresh ids", () => {
    const d = blankDeck(); d.slides.push(makeSlide("blank"));
    const first = d.slides[0].id;
    moveSlide(d, 0, 1); expect(d.slides[1].id).toBe(first);
    const i = duplicateSlide(d, 1); expect(d.slides[i].id).not.toBe(first); expect(d.slides.length).toBe(3);
  });
});
