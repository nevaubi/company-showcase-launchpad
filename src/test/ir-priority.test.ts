import { describe, expect, it } from "vitest";
import { COVERAGE } from "@/lib/coverage";
import { PRIORITY_GROUPS, priorityCampaign, priorityCandidates, priorityKey, priorityList, priorityMaxRuns, restorePriority, settlePriority, unknownGroups } from "../../scripts/lib/ir-priority";

const coverage = [
  { ticker: "TINY", industry: "Banks", group: "Banks" },
  { ticker: "JPM", industry: "Diversified Banks", group: "Banks" },
  { ticker: "AAPL", industry: "Technology Hardware, Storage & Peripherals", group: "Technology Hardware & Storage" },
  { ticker: "GS", industry: "Investment Banking & Brokerage", group: "Capital Markets" },
  { ticker: "BAC", industry: "Diversified Banks", group: "Banks" },
  { ticker: "RGNL", industry: "Regional Banks" },
];
const rank = new Map([["JPM", 1], ["AAPL", 2], ["BAC", 3]]);

describe("IR priority settings", () => {
  it("is off unless a known group or tickers are set", () => {
    expect(priorityKey({})).toBe("");
    expect(priorityKey({ IR_PRIORITY_GROUP: "" })).toBe("");
    expect(priorityKey({ IR_PRIORITY_GROUP: "nonsense" })).toBe("");
    expect(unknownGroups({ IR_PRIORITY_GROUP: "banks,nonsense" })).toEqual(["nonsense"]);
    expect(priorityKey({ IR_PRIORITY_GROUP: "Banks" })).toBe("groups=banks;tickers=");
    expect(priorityKey({ IR_PRIORITY_TICKERS: "gs, ms" })).toBe("groups=;tickers=GS,MS");
    expect(priorityCampaign(null, "", ["JPM"])).toBeNull();
  });
  it("lists banks largest first, unranked after in coverage order, explicit tickers ahead", () => {
    expect(priorityList({ IR_PRIORITY_GROUP: "banks" }, coverage, rank)).toEqual(["JPM", "BAC", "TINY", "RGNL"]);
    expect(priorityList({ IR_PRIORITY_GROUP: "banks", IR_PRIORITY_TICKERS: "GS,bac" }, coverage, rank)).toEqual(["GS", "BAC", "JPM", "TINY", "RGNL"]);
    expect(priorityList({ IR_PRIORITY_GROUP: "banks" }, coverage, new Map())).toEqual(["TINY", "JPM", "BAC", "RGNL"]);
  });
  it("the banks group on the real coverage holds the big banks and no brokers", () => {
    const banks = COVERAGE.filter(PRIORITY_GROUPS.banks!).map((c) => c.ticker);
    for (const t of ["JPM", "BAC", "C", "WFC", "USB", "PNC", "TFC", "COF", "BNY"]) expect(banks).toContain(t);
    for (const t of ["GS", "MS", "SCHW", "AAPL", "V"]) expect(banks).not.toContain(t);
    expect(banks.length).toBeGreaterThan(100);
  });
  it("bounds the runs per company", () => {
    expect(priorityMaxRuns({})).toBe(3);
    expect(priorityMaxRuns({ IR_PRIORITY_MAX_RUNS: "0" })).toBe(3);
    expect(priorityMaxRuns({ IR_PRIORITY_MAX_RUNS: "99" })).toBe(10);
  });
});

describe("IR priority campaign", () => {
  const fresh = () => priorityCampaign(null, "k", ["JPM", "BAC", "TINY"])!;
  it("keeps a campaign while the settings are unchanged and restarts it when they change", () => {
    const p = settlePriority(fresh(), "JPM", "finished", 3);
    expect(priorityCampaign(p, "k", ["JPM", "BAC", "TINY"])).toBe(p);
    expect(priorityCampaign(p, "other", ["X"])!.queue).toEqual(["X"]);
  });
  it("skips running companies and those held for review", () => {
    expect(priorityCandidates(fresh(), new Set(["JPM"]), { BAC: "failed 3 runs" })).toEqual(["TINY"]);
  });
  it("a finished, empty or reviewed company leaves; a credit stop never counts", () => {
    const p = fresh();
    settlePriority(p, "JPM", "credits", 1);
    settlePriority(p, "JPM", "credits", 1);
    expect(p.queue).toEqual(["JPM", "BAC", "TINY"]);
    settlePriority(p, "JPM", "finished", 3);
    settlePriority(p, "BAC", "empty", 3);
    settlePriority(p, "TINY", "review", 3);
    expect(p).toMatchObject({ queue: [], done: ["JPM"], empty: ["BAC"], dropped: ["TINY"] });
  });
  it("unfinished runs are bounded, so one company cannot hold the queue", () => {
    const p = fresh();
    settlePriority(p, "JPM", "unfinished", 2);
    expect(p.queue[0]).toBe("JPM");
    settlePriority(p, "JPM", "unfinished", 2);
    expect(p.queue).toEqual(["BAC", "TINY"]);
    expect(p.dropped).toEqual(["JPM"]);
    // Outcomes for companies no longer queued change nothing.
    settlePriority(p, "JPM", "finished", 2);
    expect(p.done).toEqual([]);
  });
  it("a configuration re-queue brings back companies that had nothing waiting, in their place", () => {
    const p = fresh();
    settlePriority(p, "JPM", "empty", 3);
    settlePriority(p, "TINY", "finished", 3);
    restorePriority(p, ["JPM", "TINY", "AAPL"], ["JPM", "BAC", "TINY"]);
    expect(p.queue).toEqual(["JPM", "BAC"]);
    expect(p.empty).toEqual([]);
    expect(p.done).toEqual(["TINY"]);
  });
});
