import { describe, expect, it } from "vitest";
import { rowLabel } from "./row-label";

describe("rowLabel", () => {
  it("shows schema pairs without an em dash and keeps the two share counts distinct", () => {
    expect(rowLabel("Weighted avg. shares — basic")).toBe("Weighted avg. shares, basic");
    expect(rowLabel("Weighted avg. shares — diluted")).toBe("Weighted avg. shares, diluted");
    expect(rowLabel("EPS — diluted")).toBe("EPS, diluted");
    expect(rowLabel("Research & development")).toBe("Research & development");
  });
});
