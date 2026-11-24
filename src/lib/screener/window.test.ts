import { describe, expect, it } from "vitest";
import { scrollFor, stepIndex } from "./window";

describe("windowed row keyboard navigation", () => {
  it("moves by index in the row model and stays inside the list", () => {
    expect(stepIndex("ArrowDown", 4, 10, 20)).toBe(5);
    expect(stepIndex("ArrowUp", 0, 10, 20)).toBe(0);
    expect(stepIndex("ArrowDown", 9, 10, 20)).toBe(9);
    expect(stepIndex("PageDown", 2, 1844, 25)).toBe(27);
    expect(stepIndex("PageUp", 10, 1844, 25)).toBe(0);
    expect(stepIndex("End", 3, 1844, 25)).toBe(1843);
    expect(stepIndex("Home", 300, 1844, 25)).toBe(0);
    // a key the list does not handle, and an empty list
    expect(stepIndex("a", 3, 10, 25)).toBeNull();
    expect(stepIndex("ArrowDown", 0, 0, 25)).toBeNull();
    // a row that is no longer in the list starts from the top
    expect(stepIndex("ArrowDown", -1, 10, 25)).toBe(1);
  });

  it("scrolls just enough to show a row below the sticky head, and not at all when it is visible", () => {
    // viewport 1000 tall at scrollY 2000; app header plus table head cover 90 px
    expect(scrollFor(2500, 29, 2000, 1000, 90)).toBeNull();
    // under the sticky head: scroll so the row sits right below it
    expect(scrollFor(2050, 29, 2000, 1000, 90)).toBe(1960);
    // below the fold: scroll so its bottom edge is at the bottom of the viewport
    expect(scrollFor(3000, 29, 2000, 1000, 90)).toBe(2029);
    expect(scrollFor(10, 29, 500, 1000, 90)).toBe(0);
  });
});
