import { describe, expect, it } from "vitest";
import { BOARD_DROP, BOARD_SETS, boardRows, boardSort, fitBoard, relativeSeries, sharedQuarter, signalShare, sortBoard, withoutTapeRow } from "./board";
import { tapeIndex, type MemberTape } from "./breadth";
import type { GroupFile, GroupSummary, Overview } from "./groups";
import { byUnit, mult, pct, pts, ratio, usd } from "./format";
import { fmtMetric, loadFailure, valuationCohort, valuationHistory } from "./groups";
import type { Member } from "./members";
import { marketIndex } from "./risk";

const T = (tk: string, p: Partial<MemberTape>): MemberTape => ({ tk, vol60: null, above200: null, near_high: null, ...p });

const LIST: Member[] = [
  { ticker: "AAA", sector: "Energy", industry: "Oil & Gas Midstream" },
  { ticker: "BBB", sector: "Energy", industry: "Oil & Gas Midstream" },
  { ticker: "CCC", sector: "Energy", industry: "Integrated Oil & Refining" },
  { ticker: "DDD", sector: "Utilities", industry: "Electric Utilities" },
];

const G = (p: Partial<GroupSummary>): GroupSummary => ({ slug: "s", name: "n", kind: "sector", sector: "Energy", n: 0, mcap: 0, q: "2026Q3", latest: {}, ...p });

describe("board", () => {
  const ov: Overview = {
    generated: "",
    as_of: "2026-11-20",
    metrics: {},
    etf_rrg: {},
    spy_returns: { "3M": 0.02, "1M": -0.05 },
    groups: [
      G({
        slug: "energy",
        name: "Energy",
        n: 3,
        mcap: 9e11,
        returns: { cw: { "3M": 0.08, "1M": null }, ew: null, spy: null, etf: null },
        breadth: { b200: 0.9 },
        latest: { pe: ["2026Q3", 12, 3], pfcf: ["2026Q3", 25, 3], rev_growth: ["2026Q3", 0.04, 3], rev_ttm: ["2026Q3", 5e11, 3], nm: ["2026Q2", 0.09, 2] },
        val_now: { pe: 10.5, ps: 1.4, pfcf: 20, n: 3 },
        top5: 0.6,
        disp: 0.07,
      }),
      G({ slug: "utilities", name: "Utilities", sector: "Utilities", n: 1, mcap: 5e11, q: "2026Q2", returns: { cw: { "3M": -0.01 }, ew: null, spy: null, etf: null }, latest: { pe: ["2026Q2", 18, 1], rev_growth: ["2026Q2", 0.01, 1] } }),
      G({ slug: "oil-and-gas-midstream", name: "Oil & Gas Midstream", kind: "industry", n: 2, mcap: 1e11 }),
    ],
  };
  it("keeps one level and measures returns against SPY", () => {
    const rows = boardRows(ov, "sector", LIST, null);
    expect(rows.map((r) => r.slug)).toEqual(["energy", "utilities"]);
    expect(rows[0].excess["3M"]).toBeCloseTo(0.06);
    expect(rows[0].excess["1M"]).toBeNull();
    expect(rows[0].n).toBe(3); // counted on the member list
  });
  it("shows one P/E: today's multiple, the same figure the group page and the historical rank use", () => {
    const [energy, utilities] = boardRows(ov, "sector", LIST, null);
    expect(energy.pe).toBe(10.5); // not the quarter-end 12
    expect(energy.valuation.pe.q).toBeNull();
    expect(energy.valuation.pe.n).toBe(3);
    expect(energy.ps).toBe(1.4);
    expect(energy.fcfYield).toBeCloseTo(0.05); // 1 ÷ 20
    // an older file without current multiples: the latest quarter's stands in and says which quarter
    expect(utilities.pe).toBe(18);
    expect(utilities.valuation.pe.q).toBe("2026Q2");
    expect(utilities.fcfYield).toBeNull();
  });
  it("keeps separate current and quarter-end valuation cohorts when sources differ by metric", () => {
    const group = G({ val_now: { pe: 10, ps: null, pfcf: 16, n: 117 }, latest: { ps: ["2026Q2", 2.5, 99] } });
    const [r] = boardRows({ ...ov, groups: [group] }, "sector", []);
    expect(r.valuation).toEqual({ pe: { v: 10, n: 117, q: null }, ps: { v: 2.5, n: 99, q: "2026Q2" }, pfcf: { v: 16, n: null, q: null } });
  });

  it("counts paired inputs per multiple and retains losses in aggregates only", () => {
    const group: NonNullable<GroupFile["val_now"]> = { n: 4, rows: [
      ["A", "2026Q3", 100, 15, 50, 4], ["B", "2026Q3", 40, -8, 20, null],
      ["C", "2026Q3", 20, 0, null, -1], ["D", "2026Q3", 15, 1, 10, 0],
    ] };
    expect(valuationCohort(group,"pe")).toEqual({ aggregate: 4, median: 2 });
    expect(valuationCohort(group,"ps")).toEqual({ aggregate: 3, median: 3 });
    expect(valuationCohort(group,"pfcf")).toEqual({ aggregate: 3, median: 1 });
    expect(valuationCohort(undefined,"ps")).toBeNull();
    expect(valuationCohort({ n: 117, rows: [] },"ps")).toBeNull();
  });

  it("labels the count and actual calendar span of sparse valuation history", () => {
    const sample = { n:16, from:"2008Q4", to:"2026Q3", min:2, med:10, max:40, pct:0.5 };
    expect(valuationHistory(sample)).toBe("16 positive quarterly observations, Q4 2008–Q3 2026");
    expect(valuationHistory({ ...sample, from:"" })).toBe("16 positive quarterly observations");
  });

  it("carries each latest-quarter figure with its own quarter and company count", () => {
    const [energy] = boardRows(ov, "sector", LIST, null);
    expect(energy.f.rev_ttm).toEqual({ v: 5e11, q: "2026Q3", n: 3 });
    expect(energy.f.nm).toEqual({ v: 0.09, q: "2026Q2", n: 2 }); // this one lags a quarter
    expect(energy.f.gm).toEqual({ v: null, q: null, n: null });
  });
  it("names the fundamentals' quarter only when every row shares it", () => {
    const rows = boardRows(ov, "sector", LIST, null);
    expect(sharedQuarter(rows)).toBeNull(); // Energy Q3, Utilities Q2
    expect(sharedQuarter([rows[0]])).toBe("2026Q3");
    // the answer does not depend on the order of the rows
    expect(sharedQuarter([...rows].reverse())).toBeNull();
  });
  it("uses the pipeline's breadth for every row when the tape did not load", () => {
    const rows = boardRows(ov, "sector", LIST, null);
    expect(rows[0].tape).toBeNull();
    expect(rows[0].above200).toBe(0.9);
    expect(rows[0].nearHigh).toBeNull();
  });
  it("uses the tape alone once it has loaded, also for a group none of whose members has a row", () => {
    const idx = tapeIndex([T("AAA", { above200: false, near_high: true, vol60: 0.02 }), T("BBB", { above200: true }), T("CCC", { above200: false })]);
    const [energy, utilities] = boardRows(ov, "sector", LIST, idx);
    expect(energy.above200).toBeCloseTo(1 / 3);
    expect(energy.nearHigh).toBe(1); // one known flag
    expect(energy.tape!.nearHigh.thin).toBe(true);
    expect(energy.vol).toBeCloseTo(0.02 * Math.sqrt(252));
    expect(utilities.above200).toBeNull(); // DDD has no row: no share, and no pipeline figure mixed in
    expect(utilities.tape!.noRow).toBe(1);
    expect(withoutTapeRow([energy, utilities])).toBe(1);
  });
  it("adds earnings moves and live signals from the markets file with their coverage", () => {
    const market = marketIndex({
      generatedAt: "2026-11-24T00:01:00Z",
      companies: [
        { ticker: "AAA", stats: { n: 8, avgAbsMove: 0.04 }, active: [{ kind: "breakout_52w", date: "2026-11-19", ago: 2 }] },
        { ticker: "CCC", stats: { n: 4, avgAbsMove: 0.08 }, active: [] },
      ] as never,
    });
    const [energy, utilities] = boardRows(ov, "sector", LIST, null, market);
    expect(energy.earnings).toEqual({ v: expect.closeTo(0.06), n: 2 });
    expect(energy.covered).toBe(2); // BBB is not in the file
    expect(energy.signals).toMatchObject({ total: 1, companies: 1, bullish: 1, bearish: 0 });
    expect(signalShare(energy)).toBe(0.5);
    expect(signalShare(utilities)).toBeNull(); // nothing covered: no share rather than zero
    expect(boardRows(ov, "sector", LIST, null)[0].earnings).toBeNull(); // file not loaded
  });
  it("sorts with missing values last", () => {
    const rows = boardRows(ov, "sector", LIST, null);
    expect(sortBoard(rows, "r3M", "asc").map((r) => r.slug)).toEqual(["utilities", "energy"]);
    expect(sortBoard(rows, "pe", "asc").map((r) => r.slug)).toEqual(["energy", "utilities"]);
    expect(sortBoard(rows, "revttm", "desc").map((r) => r.slug)).toEqual(["energy", "utilities"]);
    expect(sortBoard(rows, "fcfy", "asc").map((r) => r.slug)).toEqual(["energy", "utilities"]); // missing last
  });
  it("never orders the table by a column the open set does not show", () => {
    expect(boardSort("overview", "r1M", "asc")).toEqual({ sort: "r1M", dir: "asc" });
    expect(boardSort("fundamentals", "r1M", "asc")).toEqual({ sort: "revttm", dir: "desc" });
    expect(boardSort("risk", undefined, undefined)).toEqual({ sort: "vol", dir: "desc" });
    expect(boardSort("overview", "sector", "asc")).toEqual({ sort: "r3M", dir: "desc" }); // an old link
    expect(boardSort("fundamentals", "name", undefined)).toEqual({ sort: "name", dir: "asc" });
  });
});

describe("relative series", () => {
  it("rebases both legs to the first shared session", () => {
    const a = [["d1", 100], ["d2", 110], ["d3", 121]] as const;
    const b = [["d1", 50], ["d2", 50], ["d3", 55]] as const;
    const s = relativeSeries(a, b, 2);
    expect(s[0].v).toBe(0);
    expect(s[1].v).toBeCloseTo(0.1);
    expect(s[2].v).toBeCloseTo(1.21 / 1.1 - 1); // 10% ahead
  });
  it("only uses dates both series have", () => {
    const s = relativeSeries([["d1", 1], ["d2", 2], ["d4", 4]], [["d1", 1], ["d4", 2]], 5);
    expect(s.map((x) => x.date)).toEqual(["d1", "d4"]);
    expect(s[1].v).toBeCloseTo(1);
  });
});

describe("format", () => {
  it("uses one decimal, a true minus and an en dash", () => {
    expect(pct(-0.0474)).toBe("−4.7%");
    expect(pct(0.112, { sign: true })).toBe("+11.2%");
    expect(pct(-0.00001, { sign: true })).toBe("0.0%");
    expect(pct(null)).toBe("–");
    expect(mult(23.14)).toBe("23.1×");
    expect(usd(4.62e12)).toBe("$4.62T");
    expect(usd(946.4e9)).toBe("$946.4B");
    expect(pts(-0.012)).toBe("−1.2 pt");
    expect(byUnit(0.05, "ret")).toBe("+5.0%");
    expect(ratio(1.084)).toBe("1.08");
    expect(ratio(-0.3)).toBe("−0.30");
    expect(ratio(-0.001)).toBe("0.00");
    expect(ratio(undefined)).toBe("–");
  });
  it("stored figures share the convention", () => {
    expect(fmtMetric(0.11, "pct")).toBe("11.0%");
    expect(fmtMetric(0.077, "pct")).toBe("7.7%");
    expect(fmtMetric(1.3, "x")).toBe("1.3×");
    expect(fmtMetric(-2e9, "usd")).toBe("−$2.0B");
  });
});

describe("why a file did not load", () => {
  it("tells a missing file from a failing service", () => {
    expect(loadFailure(new Error("Not available for this company yet"))).toBe("missing");
    expect(loadFailure(new Error("Sign in to load this data"))).toBe("signin");
    expect(loadFailure(new Error("Data service returned 503"))).toBe("service");
    expect(loadFailure(new Error("Data service returned no response"))).toBe("service");
    expect(loadFailure(undefined)).toBe("service");
  });
});

describe("fitBoard", () => {
  // Widths as the board draws them (board.tsx).
  const W: Record<string, number> = { mcap: 72, r1W: 56, r1M: 56, r3M: 56, rYTD: 56, r1Y: 56, a200: 80, nh: 80, rev: 62, om: 62, roic: 62, pe: 56, pep: 84 };
  const over = BOARD_SETS.overview.map((k) => ({ k, w: W[k] }));
  const risk = BOARD_SETS.risk.map((k, i) => ({ k, w: [76, 64, 88, 88, 70, 96, 96, 70, 70][i] }));
  const sum = (cols: { w: number }[]) => cols.reduce((s, c) => s + c.w, 0);

  it("keeps every column when the board fits or is not measured yet", () => {
    expect(fitBoard(over, BOARD_DROP.overview, "r3M", 1200, 212)).toEqual(over);
    expect(fitBoard(over, BOARD_DROP.overview, "r3M", 0, 212)).toEqual(over);
  });

  it("drops the least useful columns until a laptop-width board fits", () => {
    // 1280 px window: the wrapper is about 990 px wide.
    const sectors = fitBoard(over, BOARD_DROP.overview, "r3M", 990, 212);
    expect(212 + sum(sectors)).toBeLessThanOrEqual(990);
    expect(sectors.map((c) => c.k)).toEqual(["mcap", "r1M", "r3M", "r1Y", "a200", "nh", "rev", "om", "roic", "pe", "pep"]);
    const industries = fitBoard(over, BOARD_DROP.overview, "r3M", 990, 310);
    expect(310 + sum(industries)).toBeLessThanOrEqual(990);
    expect(industries.map((c) => c.k)).not.toContain("pep");
  });

  it("never drops the column the board is sorted by", () => {
    const cols = fitBoard(over, BOARD_DROP.overview, "rYTD", 990, 310);
    expect(cols.map((c) => c.k)).toContain("rYTD");
    expect(310 + sum(cols)).toBeLessThanOrEqual(990);
  });

  it("keeps the sorted column on the first screen of a phone", () => {
    // 400 px phone: wrapper about 368 px, name column 172 px.
    const o = fitBoard(over, BOARD_DROP.overview, "r3M", 368, 172);
    const at = (cols: { k: string; w: number }[], k: string) => 172 + sum(cols.slice(0, cols.findIndex((c) => c.k === k) + 1));
    expect(at(o, "r3M")).toBeLessThanOrEqual(368);
    const r = fitBoard(risk, BOARD_DROP.risk, "vol", 368, 172);
    expect(at(r, "vol")).toBeLessThanOrEqual(368);
    expect(r[0].k).toBe("vol");
    const p = fitBoard(over, BOARD_DROP.overview, "pe", 368, 172);
    expect(at(p, "pe")).toBeLessThanOrEqual(368);
  });
});
