import { describe, expect, it } from "vitest";
import { quoteShown } from "./quote-cut";

describe("a cut quote ends at a word, with an ellipsis (review p5 M9)", () => {
  it("a whole sentence is shown whole", () => {
    expect(quoteShown("Licenses are reviewed under a presumption of denial.")).toBe("Licenses are reviewed under a presumption of denial.");
    expect(quoteShown("We sell to “TSMC.”")).toBe("We sell to “TSMC.”");
  });
  it("a quote stored cut in the middle of a word drops the broken word", () => {
    expect(quoteShown("Licenses for these items are reviewed under a presumption of denia")).toBe("Licenses for these items are reviewed under a presumption of…");
    expect(quoteShown("We gen")).toBe("We…");
    expect(quoteShown("Our customers in China are not permit")).toBe("Our customers in China are not…");
  });
  it("a shorter part for a small panel is cut at a word too", () => {
    const s = "Hon Hai Precision Industry assembles a substantial portion of our products in facilities located in Taiwan and China.";
    const out = quoteShown(s, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(s.startsWith(out.slice(0, -1))).toBe(true);
    expect(s[out.length - 1]).toBe(" ");
  });
  it("trailing commas and dashes are not left before the ellipsis", () => {
    expect(quoteShown("We rely on suppliers in Taiwan, Korea, and Japa")).toBe("We rely on suppliers in Taiwan, Korea, and…");
    expect(quoteShown("Sales to Apple, which", 13)).toBe("Sales to…");
  });
});
