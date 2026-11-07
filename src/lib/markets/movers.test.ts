import { describe, expect, it } from "vitest";
import { sectorStrip } from "./movers";

describe("sectorStrip", () => {
  it("keeps sectors with an ETF return, sorted", () => {
    const g = [
      {
        kind: "sector",
        name: "Energy",
        etf: "XLE",
        slug: "energy",
        returns: { etf: { "1M": 0.05 } },
      },
      { kind: "sector", name: "Tech", etf: "XLK", slug: "tech", returns: { etf: { "1M": -0.02 } } },
      {
        kind: "industry",
        name: "Software",
        etf: "IGV",
        slug: "software",
        returns: { etf: { "1M": 0.1 } },
      },
      { kind: "sector", name: "Other", etf: null, slug: "other", returns: null },
    ];
    expect(sectorStrip(g, "1M").map((s) => s.etf)).toEqual(["XLE", "XLK"]);
  });
});
