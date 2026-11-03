import { describe, expect, it } from "vitest";
import { scaleOutliers } from "./payload";

const cells = (vals: number[]) => Object.fromEntries(vals.map((v, i) => [`2025-0${i + 1}-30`, { v }]));

describe("unit mix-up detection", () => {
  it("flags a quarter read in thousands instead of millions", () => {
    const c = cells([4.1e9, 4.3e9, 4.4e6, 4.6e9, 4.8e9]);
    expect([...scaleOutliers(c)]).toEqual(["2025-03-30"]);
  });
  it("does not flag ordinary growth or a 10× jump", () => {
    expect(scaleOutliers(cells([1e6, 2e6, 4e6, 8e6, 16e6])).size).toBe(0);
    expect(scaleOutliers(cells([1e9, 1.1e9, 11e9, 1.2e9, 1.3e9])).size).toBe(0);
  });
  it("needs agreeing neighbours as a baseline", () => {
    expect(scaleOutliers(cells([1e3, 1e6, 1e9])).size).toBe(0);
  });
});
