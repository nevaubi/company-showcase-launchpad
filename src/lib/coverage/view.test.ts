import { describe, expect, it } from "vitest";
import { CORPORA } from "./corpora";
import { COVERAGE_SEARCH, coverageSearch, filterMatrix, matrix, pct, signed, summaries, type MatrixPayload } from "./view";

// Three corpora in the database's (alphabetical) order, three companies.
const payload: MatrixPayload = {
  checked: "2026-11-27T14:10:47Z",
  corpora: ["calls", "ir_figures", "statements"],
  rows: { AAPL: "ffp", ACME: "nnf", BNK: "pxf" },
  daily: [
    ["2026-11-19", "calls", "full", 0, 0], // more than a week before the newest day: not the comparison day
    ["2026-11-21", "calls", "full", 0, 0],
    ["2026-11-27", "calls", "full", 1, 21],
    ["2026-11-27", "calls", "partial", 1, 5],
    ["2026-11-27", "calls", "none", 1, 0],
  ],
};

describe("coverage summaries", () => {
  it("counts each corpus in the order of the rules and measures the change over a week", () => {
    const s = summaries(payload);
    // the rules list statements before IR figures before calls
    expect(s.map((x) => x.def.id)).toEqual(["statements", "ir_figures", "calls"]);
    const calls = s.find((x) => x.def.id === "calls")!;
    expect(calls.counts).toEqual({ full: 1, partial: 1, none: 1, not_applicable: 0, held: 0 });
    expect(calls.share).toBeCloseTo(1 / 3);
    expect(calls).toMatchObject({ weekChange: 1, weekFrom: "2026-11-21" });
    // "does not apply" is left out of the share
    const ir = s.find((x) => x.def.id === "ir_figures")!;
    expect(ir.counts).toMatchObject({ full: 1, none: 1, not_applicable: 1 });
    expect(ir).toMatchObject({ applies: 2, share: 0.5 });
    // a corpus with no earlier day on record has no change to show
    expect(summaries({ ...payload, daily: payload.daily.filter((d) => d[0] === "2026-11-27") })[0].weekChange).toBeNull();
  });
  it("leaves out a corpus the ledger does not hold yet", () => {
    expect(summaries(payload)).toHaveLength(3);
    expect(CORPORA.length).toBeGreaterThan(3);
  });
});

describe("coverage matrix", () => {
  const { ids, rows } = matrix(payload);
  const names = new Map([["AAPL", "Apple"], ["ACME", "Acme Machines"], ["BNK", "First Bank"]]);
  it("puts each company's states in the order of the rules", () => {
    expect(ids).toEqual(["statements", "ir_figures", "calls"]);
    expect(rows.map((r) => r.ticker)).toEqual(["AAPL", "ACME", "BNK"]);
    expect(rows[0]).toMatchObject({ cells: ["partial", "full", "full"], gaps: 0, partial: 1 });
    expect(rows[1]).toMatchObject({ cells: ["full", "none", "none"], gaps: 2 });
    expect(rows[2].cells).toEqual(["full", "not_applicable", "partial"]);
  });
  it("filters by a corpus's state, by any state, and by ticker or name", () => {
    const f = (o: Partial<typeof COVERAGE_SEARCH>) => filterMatrix(rows, ids, { ...COVERAGE_SEARCH, ...o }, names).map((r) => r.ticker);
    expect(f({})).toEqual(["AAPL", "ACME", "BNK"]);
    expect(f({ corpus: "calls", state: "none" })).toEqual(["ACME"]);
    expect(f({ corpus: "calls", state: "held" })).toEqual([]);
    expect(f({ state: "partial" })).toEqual(["AAPL", "BNK"]); // any corpus
    expect(f({ q: "ac" })).toEqual(["ACME"]); // ticker starts with
    expect(f({ q: "bank" })).toEqual(["BNK"]); // name contains
    expect(f({ sort: "gaps" })).toEqual(["ACME", "AAPL", "BNK"]); // most gaps first, then most partial, then ticker
  });
});

describe("the page's search params", () => {
  it("keeps what it knows and drops the rest", () => {
    expect(coverageSearch({})).toEqual(COVERAGE_SEARCH);
    expect(coverageSearch({ corpus: "calls", state: "none", q: "app", sort: "gaps", co: "aapl" })).toEqual({ corpus: "calls", state: "none", q: "app", sort: "gaps", co: "AAPL" });
    expect(coverageSearch({ corpus: "nothing", state: "broken", sort: "x", co: "../etc", q: 12 })).toEqual(COVERAGE_SEARCH);
    expect(coverageSearch({ co: "BRK-B" }).co).toBe("BRK-B");
  });
  it("writes changes with a true minus and shares without false zeros", () => {
    expect(signed(12)).toBe("+12");
    expect(signed(-3)).toBe("−3");
    expect(signed(0)).toBe("0");
    expect(pct(0.356)).toBe("36%");
    expect(pct(0.002)).toBe("<1%");
    expect(pct(0)).toBe("0%");
    expect(pct(null)).toBe("–");
  });
});
