import { describe, expect, it } from "vitest";
import { DASH, asFiled, count, pct, points, shortHash, usdM } from "./format";

describe("number formats", () => {
  it("writes a missing value as a quiet en dash and a negative with a true minus", () => {
    expect(usdM(null)).toBe(DASH);
    expect(DASH).toBe("–");
    expect(usdM(-2_340_000)).toBe("−2.3");
    expect(count(12_431)).toBe("12,431");
  });
  it("prints shares as percent points and changes signed", () => {
    expect(pct(0.012345)).toBe("1.23");
    expect(points(0.0021)).toBe("+0.21");
    expect(points(-0.0005)).toBe("−0.05");
    expect(points(0)).toBe("0.00");
  });
  it("never converts a value whose scale is the filer's own", () => {
    expect(asFiled("0.0489")).toBe("0.0489");
    expect(asFiled(4.89)).toBe("4.8900");
    expect(shortHash("ab".repeat(32))).toBe("abababababab");
  });
});
