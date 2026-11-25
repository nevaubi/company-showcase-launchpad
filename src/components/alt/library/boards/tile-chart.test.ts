import { describe, expect, it } from "vitest";
import { tickFormat } from "./tile-chart";

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
