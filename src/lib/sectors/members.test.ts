import { describe, expect, it } from "vitest";
import { baseMembers, membersOf, pageMembers, type CoverageLike } from "./members";

const COVERAGE: CoverageLike[] = [
  { ticker: "AAA", sector: "Energy", group: "Oil & Gas Midstream", industry: "Pipelines" },
  { ticker: "BBB", sector: "Energy", group: "Oil & Gas Midstream", industry: "Pipelines" },
  { ticker: "CCC", sector: "Energy", group: "Integrated Oil & Refining", industry: "Refining" },
  { ticker: "DDD", sector: "Utilities", industry: "Electric Utilities" },
];

describe("one member list", () => {
  it("is the pipeline's assignment when the overview carries one", () => {
    const m = baseMembers({ companies: [{ tk: "AAA", sector: "Energy", industry: "Integrated Oil & Refining" }] }, COVERAGE);
    expect(m.from).toBe("pipeline");
    expect(m.list).toEqual([{ ticker: "AAA", sector: "Energy", industry: "Integrated Oil & Refining" }]);
  });
  it("falls back to the coverage list's industry groups", () => {
    const m = baseMembers({}, COVERAGE);
    expect(m.from).toBe("coverage");
    expect(membersOf("industry", "Oil & Gas Midstream", "Energy", m.list)).toEqual(["AAA", "BBB"]);
    expect(membersOf("industry", "Electric Utilities", "Utilities", m.list)).toEqual(["DDD"]); // no group: its industry
    expect(membersOf("sector", "Energy", "Energy", m.list)).toEqual(["AAA", "BBB", "CCC"]);
  });
  it("lays the open industry's own file over the base list", () => {
    // The base puts BBB in Midstream; the Midstream file lists AAA and CCC (CCC moved in, BBB moved out).
    const base = baseMembers(null, COVERAGE).list;
    const list = pageMembers(base, { kind: "industry", name: "Oil & Gas Midstream", sector: "Energy", constituents: [{ tk: "AAA", industry: "Oil & Gas Midstream" }, { tk: "CCC", industry: "Oil & Gas Midstream" }] });
    expect(membersOf("industry", "Oil & Gas Midstream", "Energy", list).sort()).toEqual(["AAA", "CCC"]);
    expect(membersOf("industry", "Integrated Oil & Refining", "Energy", list)).toEqual([]); // CCC is counted once
    expect(list.filter((m) => m.ticker === "BBB")).toEqual([]); // the base's claim on this group does not stand
    expect(membersOf("sector", "Utilities", "Utilities", list)).toEqual(["DDD"]);
  });
  it("lays a sector file over the base list with each company's industry from that file", () => {
    const base = baseMembers(null, COVERAGE).list;
    const list = pageMembers(base, { kind: "sector", name: "Energy", sector: "Energy", constituents: [{ tk: "AAA", industry: "Integrated Oil & Refining" }, { tk: "EEE", industry: "Oil & Gas Midstream" }] });
    expect(membersOf("sector", "Energy", "Energy", list).sort()).toEqual(["AAA", "EEE"]);
    expect(membersOf("industry", "Oil & Gas Midstream", "Energy", list)).toEqual(["EEE"]);
    expect(pageMembers(base, null)).toEqual(base);
  });
});
