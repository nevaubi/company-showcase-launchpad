import { describe, expect, it } from "vitest";
import { dependencyScore, focusGraph, type ProLink } from "./core";
import { concentrationCell, hotspotCell, scoreScope, singleSourceCell, stripFacts } from "./strip";

const link = (p: Partial<ProLink>): ProLink => ({
  id: Math.random().toString(36).slice(2), ticker: "NVDA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null,
  relation: "supplier", detail: "", share_pct: null, quote: "", accn: "a", doc: "d", form: "10-K", filed: "2026-02-25", ...p,
});

/* NVIDIA as the review found it: its own 10-K names TSMC and states no shares or sole source; HPE's filing calls NVIDIA its
   sole source of GPUs; Fabrinet's filing says NVIDIA is 16.3% of Fabrinet's revenue. */
const all: ProLink[] = [
  link({ counterparty: "Taiwan Semiconductor Manufacturing Company Limited", counterparty_ticker: "TSM", relation: "supplier", quote: "We utilize foundries such as TSMC." }),
  link({ ticker: "HPE", counterparty: "NVIDIA", counterparty_ticker: "NVDA", relation: "supplier", single_source: true, quote: "NVIDIA is our sole source of certain GPUs." }),
  link({ ticker: "FN", counterparty: "NVIDIA", counterparty_ticker: "NVDA", relation: "customer", share_pct: 16.3, quote: "NVIDIA accounted for 16.3% of our total revenue." }),
];
const names = { NVDA: "NVIDIA", TSM: "TSMC", HPE: "Hewlett Packard Enterprise", FN: "Fabrinet" };

describe("stats strip and Dependency score (supply-globe-H1)", () => {
  const graph = focusGraph("NVDA", all, names);
  const f = stripFacts("NVDA", graph, all, names);
  const score = dependencyScore("NVDA", all);

  it("a strip cell that uses a score part's words counts what that part counts", () => {
    const cell = singleSourceCell(f, "NVIDIA");
    const part = score.parts.find((p) => p.label === cell.label);
    expect(part).toBeDefined();
    expect(cell.value).toBe(score.singleSource);
    expect(cell.value).toBe(0);
  });

  it("a counterparty naming the company as its sole source is said with its direction, not counted as an input", () => {
    const cell = singleSourceCell(f, "NVIDIA");
    expect(f.namedSoleBy.map((b) => b.label)).toEqual(["HPE"]);
    expect(cell.hint).toBe("HPE names NVIDIA its sole source");
    expect(cell.title).toContain("not an input of NVIDIA");
  });

  it("a share says whose revenue it is a share of, and that the score leaves out shares others state", () => {
    const cell = concentrationCell(f, "NVIDIA");
    expect(cell.value).toBe(1);
    expect(f.concentratedOwn).toBe(0);
    expect(cell.hint).toBe("largest 16.3% of Fabrinet's revenue");
    expect(cell.title).toContain("the Dependency score does not count those");
    expect(score.topCustomerPct).toBe(0);
  });

  it("the company's own customer share is the company's revenue, the same figure the score uses", () => {
    const own = [...all, link({ counterparty: "Microsoft", counterparty_ticker: "MSFT", relation: "customer", share_pct: 19, quote: "Customer A represented 19% of total revenue." })];
    const g = focusGraph("NVDA", own, { ...names, MSFT: "Microsoft" });
    const ff = stripFacts("NVDA", g, own, names);
    expect(concentrationCell(ff, "NVIDIA").hint).toBe("largest 19% of NVIDIA's revenue");
    expect(ff.topShare?.pct).toBe(dependencyScore("NVDA", own).topCustomerPct);
  });

  it("the hotspot label says where the regions were read", () => {
    expect(hotspotCell(["China"], false, "NVIDIA").label).toBe("Hotspots in filings and calls");
    expect(hotspotCell(["China"], false, "NVIDIA").title).toContain("not in any link sentence");
    expect(hotspotCell(["China"], true, "NVIDIA").label).toBe("Hotspots in link sentences");
  });

  it("the score says what it counts and where the rest is", () => {
    expect(scoreScope("NVIDIA")).toBe("Counts NVIDIA's own 10-K and 10-Q only. Sole-source ties and shares that other companies state about NVIDIA are in the strip at the top.");
  });
});
