import { describe, expect, it } from "vitest";
import { barProblem } from "./bar-check";

describe("daily bar sanity", () => {
  it("rejects an open or close outside the high-low range (integrity F11 examples)", () => {
    expect(barProblem({ open: 53.47, high: 52.44, low: 51, close: 52 })).toBe("open 53.47 above high 52.44");
    expect(barProblem({ open: 41.29, high: 40.84, low: 40, close: 40.5 })).toMatch(/above high/);
    expect(barProblem({ open: 10, high: 11, low: 9.5, close: 9.2 })).toBe("close 9.2 below low 9.5");
    expect(barProblem({ open: 10, high: 9, low: 9.5, close: 9.2 })).toMatch(/below low|high 9 below/);
    expect(barProblem({ open: 0, high: 1, low: 0, close: 1 })).toMatch(/non-positive/);
  });
  it("accepts consistent bars, including equal fields", () => {
    expect(barProblem({ open: 10, high: 11, low: 9, close: 10.5 })).toBeNull();
    expect(barProblem({ open: 10, high: 10, low: 10, close: 10 })).toBeNull();
  });
});
