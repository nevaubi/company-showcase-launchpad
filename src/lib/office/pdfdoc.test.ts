import { describe, expect, it } from "vitest";
import { findPhrase, wrap } from "./pdfdoc";

describe("pdf studio helpers", () => {
  it("finds a phrase across text items", () => {
    const items = [{ s: "Total revenue was", x: 10, y: 100, w: 170, h: 10 }, { s: "$215.9 billion.", x: 10, y: 112, w: 150, h: 10 }];
    const hits = findPhrase(items, "revenue was $215.9");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toHaveLength(2);
    expect(hits[0][1].y).toBe(112);
  });
  it("wraps text to a width", () => {
    expect(wrap("aa bb cc", 5, (s) => s.length)).toEqual(["aa bb", "cc"]);
  });
});
