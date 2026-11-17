import { describe, expect, it } from "vitest";
import { canSpend, pickModel, recordResult } from "./free-lane";
import { applyRulings } from "./prose-core";

describe("free-model lane", () => {
  it("stops at the daily cap", () => {
    expect(canSpend(949, [], 0, 950)).toBe(true);
    expect(canSpend(950, [], 0, 950)).toBe(false);
  });
  it("rests a model for an hour after two failures", () => {
    let h = recordResult({}, "a", false, 0);
    expect(pickModel(["a", "b"], h, 1)).toBe("a");
    h = recordResult(h, "a", false, 0);
    expect(pickModel(["a", "b"], h, 1)).toBe("b");
    expect(pickModel(["a", "b"], h, 3_600_001)).toBe("a");
  });
  it("a ruling picking neither reading saves nothing", () => {
    expect(applyRulings([{ a: {} as never, b: {} as never } as never], [{ d: 0, pick: "neither" }])).toEqual([]);
  });
});
