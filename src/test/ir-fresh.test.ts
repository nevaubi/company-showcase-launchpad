import { describe, expect, it } from "vitest";
import { extractScope, FRESH_MAX_TRIES, freshCompanies, freshDue, freshLine, freshOutcome, freshSettings, freshSince, planFresh, scoped, settleFresh, type FreshDoc, type FreshInput } from "../../scripts/lib/ir-fresh";

const NOW = Date.parse("2026-11-26T22:00:00Z");
const S = freshSettings({});
const doc = (id: string, ticker: string, filed: string | null, kind = "press-release", accn: string | null = "0001"): FreshDoc => ({ id, ticker, kind, filed, accn });
const input = (o: Partial<FreshInput> = {}): FreshInput => ({ settings: S, nowMs: NOW, companies: ["JPM", "BAC", "NVDA", "WMT", "XOM"], busy: new Set(), review: {}, tries: {}, ...o });

describe("fresh lane settings", () => {
  it("defaults to 45 days, top 200, 60 files; IR_FRESH_DAYS=0 turns it off", () => {
    expect(S).toEqual({ days: 45, top: 200, maxFiles: 60 });
    expect(freshSettings({ IR_FRESH_DAYS: "0" }).days).toBe(0);
    expect(freshSettings({ IR_FRESH_DAYS: "abc", IR_FRESH_TOP: "-3", IR_FRESH_MAX_FILES: "" })).toEqual(S);
    expect(freshSettings({ IR_FRESH_DAYS: "10", IR_FRESH_TOP: "50", IR_FRESH_MAX_FILES: "5" })).toEqual({ days: 10, top: 50, maxFiles: 5 });
    expect(freshSince(S, NOW)).toBe("2026-10-12");
    expect(freshSince({ ...S, days: 0 }, NOW)).toBeNull();
  });
  it("serves the priority campaign first, then the top N by rank; a campaign company outside the top N is served", () => {
    const rank = new Map([["NVDA", 1], ["WMT", 3], ["JPM", 2], ["TINYBANK", 900], ["SMALL", 201]]);
    expect(freshCompanies(["JPM", "TINYBANK"], rank, 200)).toEqual(["JPM", "TINYBANK", "NVDA", "WMT"]);
    expect(freshCompanies([], rank, 2)).toEqual(["NVDA", "JPM"]);
  });
});

describe("fresh lane plan", () => {
  it("is empty when the lane is off", () => {
    const p = planFresh([doc("a", "NVDA", "2026-11-17")], input({ settings: { ...S, days: 0 } }));
    expect(p.ids).toEqual([]);
  });
  it("takes newest filed first, then company order, then id, inside the window only", () => {
    const docs = [
      doc("old", "NVDA", "2026-08-27"),
      doc("x2", "XOM", "2026-10-31"),
      doc("n1", "NVDA", "2026-11-17"),
      doc("w1", "WMT", "2026-11-19"),
      doc("j1", "JPM", "2026-11-17"),
      doc("n0", "NVDA", "2026-11-17"),
      doc("fut", "WMT", "2026-12-30"),
      doc("nodate", "BAC", null),
      doc("other", "ZZZ", "2026-11-20"),
    ];
    const p = planFresh(docs, input());
    expect(p.ids).toEqual(["w1", "j1", "n0", "n1", "x2"]);
    expect(p.tickers).toEqual(["WMT", "JPM", "NVDA", "XOM"]);
    expect(p.skipped).toEqual({ old: 1, future: 1, undated: 1, outside: 1 });
  });
  it("caps the pass at IR_FRESH_MAX_FILES and counts the rest", () => {
    const docs = Array.from({ length: 70 }, (_, i) => doc(`d${String(i).padStart(2, "0")}`, "JPM", "2026-11-20"));
    const p = planFresh(docs, input());
    expect(p.ids).toHaveLength(60);
    expect(p.skipped.cap).toBe(10);
    expect(planFresh(docs, input({ settings: { ...S, maxFiles: 3 } })).ids).toEqual(["d00", "d01", "d02"]);
  });
  it("leaves out companies a lane is reading or that are held for review", () => {
    const docs = [doc("n1", "NVDA", "2026-11-17"), doc("j1", "JPM", "2026-11-17"), doc("b1", "BAC", "2026-11-17")];
    const p = planFresh(docs, input({ busy: new Set(["NVDA"]), review: { BAC: "failed 3 runs" } }));
    expect(p.ids).toEqual(["j1"]);
    expect(p.skipped).toEqual({ running: 1, review: 1 });
  });
  it("takes a deck only when the company has no other fresh file", () => {
    const docs = [doc("nd", "NVDA", "2026-11-18", "presentation"), doc("n1", "NVDA", "2026-11-17"), doc("wd", "WMT", "2026-11-19", "presentation")];
    const p = planFresh(docs, input());
    expect(p.ids).toEqual(["wd", "n1"]);
    expect(p.skipped).toEqual({ deck: 1 });
  });
  it("leaves a file tried twice to the normal order and forgets tries of files no longer waiting", () => {
    const docs = [doc("n1", "NVDA", "2026-11-17"), doc("n2", "NVDA", "2026-11-16")];
    const p = planFresh(docs, input({ tries: { n1: FRESH_MAX_TRIES, n2: 1, gone: 2 } }));
    expect(p.ids).toEqual(["n2"]);
    expect(p.skipped).toEqual({ tried: 1 });
    expect(p.tries).toEqual({ n1: 2, n2: 1 });
    // Rows cut at the query limit: tries of unseen files are kept.
    expect(planFresh(docs, input({ tries: { gone: 2 }, truncated: true })).tries).toEqual({ gone: 2 });
  });
  it("writes one line per pass", () => {
    const p = planFresh([doc("n1", "NVDA", "2026-11-17"), doc("o", "NVDA", "2026-01-01")], input());
    expect(freshLine(p, 2)).toBe("fresh lane: 1 files of 1 companies (NVDA); skipped: old 1");
    expect(freshLine(planFresh([], input()), 0)).toBe("fresh lane: nothing to read (0 candidates)");
  });
});

describe("fresh lane passes", () => {
  it("counts a try only when the reader ran", () => {
    expect(freshOutcome(null)).toBe("ran");
    expect(freshOutcome("exit 124")).toBe("ran");
    expect(freshOutcome("quota: provider:openai-paid open until 18:00")).toBe("credits");
    expect(freshOutcome("auth: key rejected")).toBe("credits");
    expect(freshOutcome("outage: 5 transient failures")).toBe("credits");
    expect(freshOutcome("busy: another runner holds ir-extract-runner:fresh")).toBe("not-run");
    expect(settleFresh({ a: 1 }, ["a", "b"], "ran")).toEqual({ a: 2, b: 1 });
    expect(settleFresh({ a: 1 }, ["a", "b"], "credits")).toEqual({ a: 1 });
    expect(settleFresh({}, ["a"], "not-run")).toEqual({});
  });
  it("runs one pass at start and one between two company starts, never two at once, never when off", () => {
    expect(freshDue({ settings: S, running: false, companiesStartedSincePass: 0, passes: 0 })).toBe(true);
    expect(freshDue({ settings: S, running: false, companiesStartedSincePass: 0, passes: 1 })).toBe(false);
    expect(freshDue({ settings: S, running: false, companiesStartedSincePass: 1, passes: 1 })).toBe(true);
    expect(freshDue({ settings: S, running: true, companiesStartedSincePass: 3, passes: 1 })).toBe(false);
    expect(freshDue({ settings: { ...S, days: 0 }, running: false, companiesStartedSincePass: 3, passes: 0 })).toBe(false);
  });
});

describe("ir-extract scope arguments", () => {
  it("reads --ids and --since; without them the reader is unchanged", () => {
    expect(scoped(extractScope({ ticker: "NVDA" }))).toBe(false);
    expect(extractScope({ ticker: "NVDA,WMT", ids: "a, b,", since: "2026-10-12" })).toEqual({ ticker: "NVDA,WMT", ids: ["a", "b"], since: "2026-10-12" });
    expect(scoped(extractScope({ since: "2026-10-12" }))).toBe(true);
    expect(() => extractScope({ since: "last week" })).toThrow();
  });
});
