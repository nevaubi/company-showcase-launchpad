import { describe, expect, it } from "vitest";
import { groupSearch, joinTape, slugify, sortRows, summary } from "./group";
import type { Constituent, GroupFile } from "./groups";
import { tapeIndex } from "./breadth";

const C = (tk: string, p: Partial<Constituent>): Constituent => ({ tk, name: tk, industry: "Banks", mcap: null, w: null, price: null, ...p });

const cons = [
  C("AAA", { mcap: 500, rev_growth: 0.1, om: 0.2, pe: 10, ret_1m: 0.05 }),
  C("BBB", { mcap: 300, rev_growth: -0.04, om: null, pe: -3, ret_1m: null, above200: true }),
  C("CCC", { mcap: 200, rev_growth: 0.02, om: 0.1, pe: 30, ret_1m: -0.02 }),
];
const file = {
  quarters: ["2026Q2", "2026Q3"],
  agg: { rev_growth: { agg: [0.05, null], cw: [], med: [], n: [3, 0] }, om: { agg: [0.12, 0.13], cw: [], med: [], n: [3, 3] } },
  val_now: { pe: 18.2, n: 3, rows: [] },
  val_range: { pe: { min: 10, max: 30, med: 18, from: "", to: "", n: 40, pct: 0.55 } },
  returns: { cw: { "3M": 0.04, "1Y": 0.2 }, ew: null, spy: { "3M": 0.01, "1Y": 0.1 }, etf: null },
} as unknown as GroupFile;

describe("group page model", () => {
  it("takes trend flags from the member tape before the group file", () => {
    const rows = joinTape(cons, tapeIndex([{ tk: "AAA", r5: null, r21: null, r63: null, r126: null, r252: null, vol60: null, above200: false, near_high: true }]));
    expect(rows.map((r) => r.a200)).toEqual([false, true, null]);
    expect(rows[0].nearHigh).toBe(true);
  });
  it("summarises medians, the latest aggregate and the concentration", () => {
    const s = summary(file, joinTape(cons, null));
    expect(s.revMed).toBe(0.02); // −0.04, 0.02, 0.1
    expect(s.revAgg).toBe(0.05); // latest quarter with a value is Q2
    expect(s.q).toBe("2026Q2");
    expect(s.omMed).toBeCloseTo(0.15); // BBB has none
    expect(s.peMed).toBe(20); // the loss is left out: 10 and 30
    expect(s.peAgg).toBe(18.2);
    expect(s.top5).toBe(1);
    expect(s.mcap).toBe(1000);
    expect(s.above200).toMatchObject({ hits: 1, known: 1, thin: true });
  });
  it("sorts constituents with missing values last and P/E on profits only", () => {
    const rows = joinTape(cons, null);
    expect(sortRows(rows, "ret_1m", "desc").map((r) => r.tk)).toEqual(["AAA", "CCC", "BBB"]);
    expect(sortRows(rows, "pe", "asc").map((r) => r.tk)).toEqual(["AAA", "CCC", "BBB"]);
    expect(sortRows(rows, "tk", "desc").map((r) => r.tk)).toEqual(["CCC", "BBB", "AAA"]);
  });
  it("reads the address leniently", () => {
    expect(groupSearch.parse({ sort: "om", dir: "asc", dm: "pe" })).toMatchObject({ sort: "om", dir: "asc", dm: "pe" });
    expect(groupSearch.parse({ sort: "bogus", dm: "nope", span: "20" })).toEqual({ sort: undefined, dm: undefined, span: undefined });
  });
  it("slugs match the pipeline's", () => {
    expect(slugify("Hotels, Restaurants & Leisure")).toBe("hotels-restaurants-and-leisure");
    expect(slugify("Information Technology")).toBe("information-technology");
  });
});
