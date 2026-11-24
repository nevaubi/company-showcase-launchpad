import { describe, expect, it } from "vitest";
import { corr100 } from "./format";

describe("correlation cells", () => {
  it("print whole numbers with a true minus and an en dash for missing", () => {
    expect(corr100(-0.163)).toBe("−16");
    expect(corr100(0.874)).toBe("87");
    expect(corr100(-0.004)).toBe("0");
    expect(corr100(null)).toBe("–");
    expect(corr100(Number.NaN)).toBe("–");
  });
});
