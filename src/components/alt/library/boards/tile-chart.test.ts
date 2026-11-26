import { describe, expect, it } from "vitest";
import * as d3 from "d3";
import type { TilePoint } from "@/lib/sources/boards/types";
import { columnEndLabel, stepPlaces, tickFormat } from "./tile-chart";

describe("axis ticks", () => {
  it("prints a step of a tenth with one place even when the step was computed in floating point", () => {
    // d3 ticks on a reader-scale axis: Millions of Units 1.1, 1.2, ...; Millions of Persons 12.5, 12.6, ...
    expect([1.1, 1.2, 1.3].map((t) => tickFormat(t, 1.2 - 1.1))).toEqual(["1.1", "1.2", "1.3"]);
    expect(tickFormat(12.6, 12.6 - 12.5)).toBe("12.6");
    expect(tickFormat(0.05, 0.15 - 0.1)).toBe("0.05");
  });

  it("prints whole steps without places, in full under 10,000 and compact above, with a true minus sign", () => {
    expect([0, 5, 25].map((t) => tickFormat(t, 5))).toEqual(["0", "5", "25"]);
    expect(tickFormat(-100, 100)).toBe("−100");
    expect(tickFormat(7500, 2500)).toBe("7,500");
    expect(tickFormat(200_000, 50_000)).toBe("200K");
    expect(tickFormat(1_500_000, 500_000)).toBe("1.5M");
  });
});

describe("tick places", () => {
  it("give ticks one step apart different labels, however small the step", () => {
    expect([1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.005, 0.001].map(stepPlaces)).toEqual([0, 1, 1, 1, 2, 2, 3, 3]);
    // a reader-scale axis in trillions a quarter of a hundredth apart: 6.745, 6.750, 6.755 never read alike
    const ticks = [6.745, 6.75, 6.755, 6.76];
    const labels = ticks.map((t) => tickFormat(t, 0.005));
    expect(new Set(labels).size).toBe(ticks.length);
    expect(labels).toEqual(["6.745", "6.750", "6.755", "6.760"]);
  });
});

describe("the last column's label", () => {
  const point = (i: number, value: number): TilePoint => ({ key: String(i), label: `Q${i}`, value, display: String(value), text: String(value), row: i + 1 });
  // twenty quarters in 300px: columns 12px wide, 15px apart, as a board's bars of a growth rate
  const band = d3.scaleBand<number>().domain(Array.from({ length: 20 }, (_, i) => i)).range([0, 300]).paddingInner(0.2);
  const y = d3.scaleLinear().domain([-4, 10]).range([140, 0]);
  const values = (last: number, before: number) => Array.from({ length: 20 }, (_, i) => point(i, i === 19 ? last : i === 18 ? before : i === 10 ? 10 : 1));

  it("stands above the tallest column it passes over, not on a taller neighbour", () => {
    const at = columnEndLabel(values(2, 4), 19, "+2.1", band, 12, y);
    expect(at.y).toBe(y(4) - 4);
    // the text ends at the last column's right edge; a tall column far to the left does not lift it
    expect(at.x).toBeCloseTo((band(19) ?? 0) + band.bandwidth() / 2 + 6, 6);
  });

  it("stands just above the last column when its neighbours are lower", () => {
    expect(columnEndLabel(values(3, 1), 19, "+3.0", band, 12, y).y).toBe(y(3) - 4);
  });

  it("sits under the deepest column it passes over for a negative value", () => {
    expect(columnEndLabel(values(-1, -3), 19, "\u22121.0", band, 12, y).y).toBe(y(-3) + 11);
  });
});
