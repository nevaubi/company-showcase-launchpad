import { describe, expect, it } from "vitest";
import { boardRows, membersOf, relativeSeries, sortBoard, type Member } from "./board";
import { freshRows, groupTape, returnsFromCloses, tapeIndex, trailingReturn, type MemberTape } from "./breadth";
import type { GroupSummary, Overview } from "./groups";
import { byUnit, mult, pct, pts, usd } from "./format";
import { fmtMetric } from "./groups";

const T = (tk: string, p: Partial<MemberTape>): MemberTape => ({ tk, r5: null, r21: null, r63: null, r126: null, r252: null, vol60: null, above200: null, near_high: null, ...p });

const LIST: Member[] = [
  { ticker: "AAA", sector: "Energy", group: "Oil & Gas Midstream", industry: "x" },
  { ticker: "BBB", sector: "Energy", group: "Oil & Gas Midstream", industry: "x" },
  { ticker: "CCC", sector: "Energy", group: "Integrated Oil & Refining", industry: "x" },
  { ticker: "DDD", sector: "Utilities", group: "Electric Utilities", industry: "x" },
];

describe("member tape", () => {
  it("derives longer returns from closes", () => {
    const c = Array.from({ length: 300 }, (_, i) => 100 + i); // last = 399
    expect(trailingReturn(c, 63)).toBeCloseTo(399 / 336 - 1);
    expect(returnsFromCloses(c.slice(-100)).r126).toBeNull(); // too short
    expect(trailingReturn([0, 5], 1)).toBeNull();
  });
  it("drops rows a week older than the newest session", () => {
    const f = freshRows([
      { end_date: "2026-11-20" },
      { end_date: "2026-11-13" },
      { end_date: "2026-11-12" },
    ]);
    expect(f.asOf).toBe("2026-11-20");
    expect(f.rows.map((r) => r.end_date)).toEqual(["2026-11-20", "2026-11-13"]);
  });
  it("rolls a group up from its members", () => {
    const idx = tapeIndex([
      T("AAA", { r21: -0.1, above200: true, near_high: false, vol60: 0.02 }),
      T("BBB", { r21: 0.05, above200: false, near_high: true, vol60: 0.01 }),
      T("CCC", { r21: 0.02, above200: null }),
    ]);
    const g = groupTape(["AAA", "BBB", "CCC", "ZZZ"], idx);
    expect(g.members).toBe(4);
    expect(g.known).toBe(3);
    expect(g.above200.share).toBe(0.5); // CCC's flag is unknown
    expect(g.med.r21).toBe(0.02);
    expect(g.up1m.hits).toBe(2);
    expect(g.vol).toBeCloseTo(0.015 * Math.sqrt(252));
  });
});

const G = (p: Partial<GroupSummary>): GroupSummary => ({ slug: "s", name: "n", kind: "sector", sector: "Energy", n: 0, mcap: 0, q: "2026Q3", latest: {}, ...p });

describe("board", () => {
  const ov: Overview = {
    generated: "",
    as_of: "2026-11-20",
    metrics: {},
    etf_rrg: {},
    spy_returns: { "3M": 0.02, "1M": -0.05 },
    groups: [
      G({ slug: "energy", name: "Energy", n: 3, mcap: 9e11, returns: { cw: { "3M": 0.08, "1M": null }, ew: null, spy: null, etf: null }, breadth: { b200: 0.9 }, latest: { pe: ["2026Q3", 12, 3] } }),
      G({ slug: "utilities", name: "Utilities", sector: "Utilities", n: 1, mcap: 5e11, returns: { cw: { "3M": -0.01 }, ew: null, spy: null, etf: null } }),
      G({ slug: "oil-and-gas-midstream", name: "Oil & Gas Midstream", kind: "industry", n: 2, mcap: 1e11 }),
    ],
  };
  it("keeps one level and measures returns against SPY", () => {
    const rows = boardRows(ov, "sector", LIST, null);
    expect(rows.map((r) => r.slug)).toEqual(["energy", "utilities"]);
    expect(rows[0].excess["3M"]).toBeCloseTo(0.06);
    expect(rows[0].excess["1M"]).toBeNull();
    expect(rows[0].above200).toBe(0.9); // no tape: the pipeline's figure
    expect(rows[0].pe).toBe(12);
  });
  it("prefers the member tape for breadth", () => {
    const idx = tapeIndex([T("AAA", { above200: false, near_high: true }), T("BBB", { above200: true }), T("CCC", { above200: false })]);
    const r = boardRows(ov, "sector", LIST, idx)[0];
    expect(r.above200).toBeCloseTo(1 / 3);
    expect(r.nearHigh).toBe(1); // one known flag
    expect(r.tape!.nearHigh.thin).toBe(true);
    expect(membersOf("industry", "Oil & Gas Midstream", "Energy", LIST)).toEqual(["AAA", "BBB"]);
  });
  it("sorts with missing values last", () => {
    const rows = boardRows(ov, "sector", LIST, null);
    expect(sortBoard(rows, "r3M", "asc").map((r) => r.slug)).toEqual(["utilities", "energy"]);
    expect(sortBoard(rows, "pe", "asc").map((r) => r.slug)).toEqual(["energy", "utilities"]);
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
  });
  it("stored figures share the convention", () => {
    expect(fmtMetric(0.11, "pct")).toBe("11.0%");
    expect(fmtMetric(0.077, "pct")).toBe("7.7%");
    expect(fmtMetric(1.3, "x")).toBe("1.3×");
    expect(fmtMetric(-2e9, "usd")).toBe("−$2.0B");
  });
});
