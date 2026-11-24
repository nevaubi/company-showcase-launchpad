import { describe, expect, it } from "vitest";
import { boardRows } from "./board";
import { groupTape, tapeIndex, type MemberTape } from "./breadth";
import { figAt, groupSearch, joinRows, lastFullIndex, refQuarter, slugify, sortRows, summary, tableSort } from "./group";
import type { Constituent, GroupFile, Overview } from "./groups";
import { baseMembers, membersOf, pageMembers } from "./members";
import { marketIndex } from "./risk";

const C = (tk: string, p: Partial<Constituent>): Constituent => ({ tk, name: tk, industry: "Banks", mcap: null, w: null, price: null, ...p });
const T = (tk: string, p: Partial<MemberTape>): MemberTape => ({ tk, vol60: null, above200: null, near_high: null, ...p });

const cons = [
  C("AAA", { mcap: 500, rev_growth: 0.1, om: 0.2, pe: 10, ret_1m: 0.05, beta: 1.2 }),
  C("BBB", { mcap: 300, rev_growth: -0.04, om: null, pe: -3, ret_1m: null, above200: true, beta: 0.8 }),
  C("CCC", { mcap: 200, rev_growth: 0.02, om: 0.1, pe: 30, ret_1m: -0.02 }),
];

/** Five quarters; the last one is early in its season: three of about fifty-five companies have reported. */
const file = {
  slug: "banks",
  name: "Banks",
  kind: "industry",
  sector: "Financials",
  quarters: ["2025Q3", "2025Q4", "2026Q1", "2026Q2", "2026Q3", "2026Q4"],
  agg: {
    rev_growth: { agg: [0.03, 0.04, 0.05, 0.06, 0.077, 0.5], cw: [], med: [0.02, 0.03, 0.04, 0.05, 0.08, 0.4], n: [52, 53, 54, 55, 55, 3] },
    ni_growth: { agg: [0.01, 0.01, 0.01, 0.01, 0.02, 0.9], cw: [], med: [], n: [50, 51, 52, 53, 54, 3] },
    om: { agg: [0.211, 0.2, 0.2, 0.2, 0.2, null], cw: [], med: [0.15, 0.15, 0.15, 0.15, 0.16, null], n: [52, 53, 54, 55, 56, 0] },
    pe: { agg: [20, 21, 22, 23, 24, null], cw: [], med: [], n: [50, 50, 50, 50, 50, 0] },
  },
  val_now: { pe: 18.2, n: 48, rows: [] },
  val_range: { pe: { min: 10, max: 30, med: 18, from: "", to: "", n: 40, pct: 0.55 } },
  returns: { cw: { "3M": 0.04, "1Y": 0.2 }, ew: null, spy: { "3M": 0.01, "1Y": 0.1 }, etf: null },
  constituents: cons,
} as unknown as GroupFile;

describe("reference quarter", () => {
  it("follows the pipeline's rule: half the previous quarter's reporting count", () => {
    expect(lastFullIndex([52, 55, 3])).toBe(1); // 3 < 27.5: the early quarter is not the latest
    expect(lastFullIndex([52, 55, 28])).toBe(2); // 28 ≥ 27.5
    expect(lastFullIndex([52, 55, 27])).toBe(1);
    expect(lastFullIndex([0, 0, 4])).toBe(2); // the only quarter with reports
    expect(lastFullIndex([10, 0, 4])).toBe(0); // compared with the previous quarter that has reports
    expect(lastFullIndex([10, 0, 5])).toBe(2);
    expect(lastFullIndex([0, null, undefined])).toBeNull();
  });
  it("does not headline a quarter three companies have reported, and says so", () => {
    const ref = refQuarter(file)!;
    expect(ref).toEqual({ i: 4, q: "2026Q3", n: 55, early: { q: "2026Q4", n: 3 } });
  });
  it("has no early quarter once enough companies have reported", () => {
    const full = { ...file, agg: { ...file.agg, rev_growth: { ...file.agg.rev_growth, n: [52, 53, 54, 55, 55, 30] } } } as GroupFile;
    expect(refQuarter(full)).toEqual({ i: 5, q: "2026Q4", n: 30, early: null });
  });
  it("reads every figure at the reference quarter, falling back only to an earlier one", () => {
    const ref = refQuarter(file);
    expect(figAt(file, "rev_growth", ref)).toEqual({ v: 0.077, med: 0.08, q: "2026Q3", n: 55, i: 4 });
    const gap = { ...file, agg: { ...file.agg, om: { ...file.agg.om, agg: [0.211, 0.2, 0.2, 0.19, null, 0.3] } } } as GroupFile;
    expect(figAt(gap, "om", ref)).toMatchObject({ v: 0.19, q: "2026Q2", n: 55 }); // never the early quarter's 0.3
    expect(figAt(file, "nope", ref).v).toBeNull();
  });
});

describe("group page model", () => {
  it("takes every trend flag from the tape once it has loaded, and from the group file only when it has not", () => {
    const idx = tapeIndex([T("AAA", { above200: false, near_high: true, vol60: 0.02 })]);
    const on = joinRows(cons, { tape: idx });
    expect(on.map((r) => r.a200)).toEqual([false, null, null]); // BBB has no row: not the file's "true"
    expect(on[0].nearHigh).toBe(true);
    expect(on[0].vol).toBeCloseTo(0.02 * Math.sqrt(252));
    const off = joinRows(cons, { tape: null });
    expect(off.map((r) => r.a200)).toEqual([null, true, null]);
    expect(joinRows(cons, { tape: new Map() }).map((r) => r.a200)).toEqual([null, true, null]); // an empty tape is no tape
  });
  it("joins earnings moves and live signals, and knows which companies the file lacks", () => {
    const market = marketIndex({ generatedAt: "2026-11-24T00:01:00Z", companies: [{ ticker: "AAA", stats: { n: 6, avgAbsMove: 0.051 }, active: [{ kind: "death_cross", date: "2026-11-18", ago: 3 }] }] as never });
    const rows = joinRows(cons, { market });
    expect(rows[0]).toMatchObject({ em: 0.051, prints: 6, inMarket: true });
    expect(rows[0].signals[0]).toMatchObject({ label: "Death cross", bias: "bearish", ago: 3 });
    expect(rows[1]).toMatchObject({ em: null, prints: 0, inMarket: false, signals: [] });
    expect(sortRows(rows, "sig", "desc").map((r) => r.tk)).toEqual(["AAA", "BBB", "CCC"]); // not in the file: last, by ticker
  });
  it("headlines the reference quarter on every tile, with its company count", () => {
    const s = summary(file, joinRows(cons), null);
    expect(s.ref!.q).toBe("2026Q3");
    expect(s.rev).toMatchObject({ v: 0.077, med: 0.08, q: "2026Q3", n: 55 }); // not the +50% three companies reported
    expect(s.om).toMatchObject({ v: 0.2, q: "2026Q3", n: 56 });
    expect(s.omYearAgo).toBe(0.211); // 2025Q3
    expect(s.pe).toEqual({ v: 18.2, n: 48, q: null, pct: 0.55 }); // today's multiple
    expect(s.mcap).toBe(1000);
  });
  it("uses the latest quarter's P/E, named as such, when the file has no current one", () => {
    const old = { ...file, val_now: undefined } as GroupFile;
    expect(summary(old, joinRows(cons), null).pe).toEqual({ v: 24, n: 50, q: "2026Q3", pct: null });
  });
  it("measures concentration over the five largest of more than five members", () => {
    const seven = [100, 90, 80, 70, 60, 50, 50].map((m, i) => C(`T${i}`, { mcap: m }));
    const s = summary({ ...file, constituents: seven } as GroupFile, joinRows(seven), null);
    expect(s.top5).toBeCloseTo(400 / 500); // 100 + 90 + 80 + 70 + 60 of 500
    expect(s.n).toBe(7);
  });
  it("sorts constituents with missing values last and P/E on profits only", () => {
    const rows = joinRows(cons);
    expect(sortRows(rows, "ret_1m", "desc").map((r) => r.tk)).toEqual(["AAA", "CCC", "BBB"]);
    expect(sortRows(rows, "pe", "asc").map((r) => r.tk)).toEqual(["AAA", "CCC", "BBB"]);
    expect(sortRows(rows, "tk", "desc").map((r) => r.tk)).toEqual(["CCC", "BBB", "AAA"]);
    expect(sortRows(rows, "beta", "desc").map((r) => r.tk)).toEqual(["AAA", "BBB", "CCC"]);
  });
  it("never orders the table by a column the open set does not show", () => {
    expect(tableSort("fundamentals", "gm", "asc")).toEqual({ sort: "gm", dir: "asc" });
    expect(tableSort("risk", "gm", "asc")).toEqual({ sort: "mcap", dir: "desc" });
    expect(tableSort("risk", "beta", undefined)).toEqual({ sort: "beta", dir: "desc" });
    expect(tableSort("fundamentals", undefined, undefined)).toEqual({ sort: "mcap", dir: "desc" });
    expect(tableSort("risk", "industry", undefined)).toEqual({ sort: "industry", dir: "asc" });
  });
  it("reads the address leniently", () => {
    expect(groupSearch.parse({ sort: "om", dir: "asc", dm: "pe", cols: "risk", wk: "2026-11-09" })).toMatchObject({ sort: "om", dir: "asc", dm: "pe", cols: "risk", wk: "2026-11-09" });
    expect(groupSearch.parse({ sort: "bogus", dm: "nope", span: "20", cols: "all", wk: "last week" })).toEqual({ sort: undefined, dm: undefined, span: undefined, cols: undefined, wk: undefined });
  });
  it("slugs match the pipeline's", () => {
    expect(slugify("Hotels, Restaurants & Leisure")).toBe("hotels-restaurants-and-leisure");
    expect(slugify("Information Technology")).toBe("information-technology");
  });
});

describe("breadth is counted once per page", () => {
  // The coverage list says the industry has AAA, BBB and DDD; the pipeline's group file says AAA, BBB and CCC.
  const coverage = [
    { ticker: "AAA", sector: "Financials", group: "Banks", industry: "x" },
    { ticker: "BBB", sector: "Financials", group: "Banks", industry: "x" },
    { ticker: "DDD", sector: "Financials", group: "Banks", industry: "x" },
    { ticker: "EEE", sector: "Financials", group: "Insurance", industry: "x" },
  ];
  const ov = {
    generated: "",
    as_of: "2026-11-20",
    metrics: {},
    etf_rrg: {},
    spy_returns: {},
    groups: [
      { slug: "financials", name: "Financials", kind: "sector", sector: "Financials", n: 4, mcap: 1, q: "2026Q3", latest: {}, breadth: { b200: 0.61 } },
      { slug: "banks", name: "Banks", kind: "industry", sector: "Financials", n: 3, mcap: 1, q: "2026Q3", latest: {}, breadth: { b200: 0.4 } },
    ],
  } as unknown as Overview;
  // BBB carries the pipeline's flag but has no tape row; DDD has a tape row but is not in the group file.
  const idx = tapeIndex([T("AAA", { above200: true }), T("CCC", { above200: false }), T("DDD", { above200: true }), T("EEE", { above200: true })]);
  const list = pageMembers(baseMembers(ov, coverage).list, file);

  it("gives the strip, the group's row among its peers and the company dots the same members and the same rule", () => {
    const members = membersOf("industry", "Banks", "Financials", list);
    expect(members.sort()).toEqual(["AAA", "BBB", "CCC"]); // the group file's own list
    const rows = joinRows(cons, { tape: idx });
    const strip = summary(file, rows, groupTape(members, idx)).breadth;
    const peer = boardRows(ov, "industry", list, idx).find((r) => r.slug === "banks")!;
    expect(strip.above200).toEqual(peer.tape!.above200);
    expect(strip.above200).toMatchObject({ hits: 1, known: 2 }); // AAA above, CCC below; BBB has no row
    expect(strip.noRow).toBe(1);
    expect(peer.n).toBe(3);
    expect(rows.filter((r) => r.a200).length).toBe(strip.above200!.hits); // the dots in the table add up to the tile
    expect(rows.filter((r) => r.a200 != null).length).toBe(strip.above200!.known);
  });
  it("uses the pipeline's share in both places when the tape did not load", () => {
    const peer = boardRows(ov, "industry", list, null).find((r) => r.slug === "banks")!;
    const strip = summary(file, joinRows(cons, { tape: null }), null, peer.above200).breadth;
    expect(strip).toMatchObject({ from: "pipeline", share: 0.4 });
    expect(peer.above200).toBe(0.4);
    // without the overview file there is no peers table; the strip counts the group file's own flags
    expect(summary(file, joinRows(cons, { tape: null }), null).breadth).toMatchObject({ from: "pipeline", share: 1, above200: { hits: 1, known: 1 } });
  });
});
