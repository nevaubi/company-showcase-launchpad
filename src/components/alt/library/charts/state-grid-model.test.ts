import { describe, expect, it } from "vitest";
import { GRID_PLACES } from "@/lib/sources/geo/us-states";
import { gridFill, gridNeighbor, gridWidthFor } from "./state-grid-model";

describe("grid fills", () => {
  it("run one hue from the low end to the high end of a sequential domain", () => {
    expect(gridFill(0, "sequential", [0, 100])).toMatchObject({ hue: "var(--chart-1)", percent: 10 });
    expect(gridFill(50, "sequential", [0, 100]).percent).toBe(55);
    expect(gridFill(100, "sequential", [0, 100]).percent).toBe(100);
    // a domain of one value takes the middle
    expect(gridFill(7, "sequential", [7, 7]).percent).toBe(55);
  });

  it("split a diverging domain at zero: blue above, orange below, the larger end reaching the full hue", () => {
    expect(gridFill(4, "diverging", [-2, 4])).toMatchObject({ hue: "var(--chart-1)", percent: 100 });
    expect(gridFill(-2, "diverging", [-2, 4])).toMatchObject({ hue: "var(--chart-4)", percent: 55 });
    expect(gridFill(0, "diverging", [-2, 4]).percent).toBe(10);
  });

  it("leave a state without a figure unfilled, never as the low end", () => {
    expect(gridFill(null, "sequential", [0, 1])).toEqual({ hue: null, percent: 0, lightInkLight: false, lightInkDark: false });
  });

  it("put light ink on dark fills: dark blue in the light theme, never on the light end", () => {
    expect(gridFill(100, "sequential", [0, 100]).lightInkLight).toBe(true);
    expect(gridFill(0, "sequential", [0, 100]).lightInkLight).toBe(false);
    // in the dark theme the high end is light, so its label is dark; the low end is dark, so its label is light
    expect(gridFill(100, "sequential", [0, 100]).lightInkDark).toBe(false);
    expect(gridFill(0, "sequential", [0, 100]).lightInkDark).toBe(true);
  });
});

describe("grid keys", () => {
  it("move along a row and to the nearest column of the next row", () => {
    expect(gridNeighbor("WA", "right")?.code).toBe("ID");
    expect(gridNeighbor("WA", "left")).toBeNull();
    expect(gridNeighbor("CA", "down")?.code).toBe("AZ");
    expect(gridNeighbor("TX", "up")?.code).toBe("OK");
    expect(gridNeighbor("ME", "down")?.code).toBe("NH");
    expect(gridNeighbor("HI", "down")).toBeNull();
    expect(gridNeighbor("CA", "first")?.code).toBe(GRID_PLACES[0].code);
    expect(gridNeighbor("CA", "last")?.code).toBe("FL");
  });

  it("fit eleven columns by eight rows into a height", () => {
    expect(gridWidthFor(200, 2)).toBe(275);
  });
});
