import { describe, expect, it } from "vitest";
import { byRank, fairOrder, priorityEnabled, rankFromDv20, rankOrder, topN } from "./priority";

describe("priority ordering", () => {
  const rank = rankFromDv20([
    { ticker: "AAPL", dv20: 9e9 },
    { ticker: "MSFT", dv20: "8e9" },
    { ticker: "ZZZ", dv20: null },
    { ticker: "TINY", dv20: 1e5 },
    { ticker: "B", dv20: 5e8 },
    { ticker: "A", dv20: 5e8 },
  ]);
  it("ranks by dv20, ties by ticker, skips empty", () => {
    expect([...rank]).toEqual([["AAPL", 1], ["MSFT", 2], ["A", 3], ["B", 4], ["TINY", 5]]);
  });
  it("puts ranked first and keeps unranked in input order", () => {
    expect(rankOrder(["X", "TINY", "Y", "AAPL", "X", "MSFT"], rank)).toEqual(["AAPL", "MSFT", "TINY", "X", "Y"]);
    expect([...topN(rank, 2)]).toEqual(["AAPL", "MSFT"]);
    expect(byRank([{ t: "Q" }, { t: "MSFT" }, { t: "AAPL" }], (r) => r.t, rank).map((r) => r.t)).toEqual(["AAPL", "MSFT", "Q"]);
  });
  it("serves the top first with a rotating share for the tail", () => {
    const head = Array.from({ length: 8 }, (_, i) => `H${i}`);
    const tail = ["T0", "T1", "T2", "T3", "T4"];
    const r = new Map(head.map((t, i) => [t, i + 1]));
    const day0 = fairOrder([...tail, ...head], r, { top: 8, tailEvery: 4, offset: 0 });
    expect(day0).toEqual(["H0", "H1", "H2", "H3", "T0", "H4", "H5", "H6", "H7", "T1", "T2", "T3", "T4"]);
    const day1 = fairOrder([...tail, ...head], r, { top: 8, tailEvery: 4, offset: 2 });
    expect(day1.slice(0, 5)).toEqual(["H0", "H1", "H2", "H3", "T2"]);
    expect(new Set(day1)).toEqual(new Set(day0));
  });
  it("can be switched off", () => {
    expect(priorityEnabled({ PRIORITY_ORDER: "0" })).toBe(false);
    expect(priorityEnabled({})).toBe(true);
  });
});

import { fairOrder as fo, nextTailOffset } from "./priority";
describe("options tail across short nights (review R4)", () => {
  // 1,844 companies, the top 1,000 ranked; a night reaches only 1,500 positions
  const all = Array.from({ length: 1844 }, (_, i) => `T${String(i).padStart(4, "0")}`);
  const rank = new Map(all.slice(0, 1000).map((t, i) => [t, i + 1]));
  const tail = new Set(all.slice(1000));
  const nights = (next: (offset: number, night: number) => number) => {
    const seen = new Set<string>();
    let offset = 0;
    for (let n = 0; n < 6; n++) {
      fo(all, rank, { offset }).slice(0, 1500).forEach((t) => tail.has(t) && seen.add(t));
      offset = next(offset, n);
    }
    return tail.size - seen.size;
  };
  it("the night-number offset (the old rule) misses the same tail names night after night", () => {
    expect(nights((_o, n) => 20261120 + n + 1)).toBe(283);
  });
  it("resuming where the tail ended serves every tail name within a few nights", () => {
    expect(nights((o) => nextTailOffset(all, rank, o, 1500))).toBe(0);
  });
  it("a night that reached nothing keeps the offset", () => {
    expect(nextTailOffset(all, rank, 17, 0)).toBe(17);
  });
});
