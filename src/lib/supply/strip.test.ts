import { describe, expect, it } from "vitest";
import { dependencyScore, focusGraph, type ProLink } from "./core";
import { concentrationCell, hotspotCell, scoreReading, scoreScope, singleSourceCell, stripFacts, unnamedCustomerShare } from "./strip";

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
    expect(cell.hint).toBe("HPE: NVIDIA is its sole source");
    expect(cell.title).toContain("not an input of NVIDIA");
  });

  it("a share says whose revenue it is a share of, and that the score leaves out shares others state", () => {
    const cell = concentrationCell(f, "NVIDIA");
    expect(cell.value).toBe(1);
    expect(f.concentratedOwn).toBe(0);
    expect(cell.hint).toBe("16.3% of Fabrinet's revenue (largest)");
    expect(cell.title).toContain("the Dependency score does not count those");
    expect(score.topCustomerPct).toBe(0);
  });

  it("the company's own customer share is the company's revenue, the same figure the score uses", () => {
    const own = [...all, link({ counterparty: "Microsoft", counterparty_ticker: "MSFT", relation: "customer", share_pct: 19, quote: "Customer A represented 19% of total revenue." })];
    const g = focusGraph("NVDA", own, { ...names, MSFT: "Microsoft" });
    const ff = stripFacts("NVDA", g, own, names);
    expect(concentrationCell(ff, "NVIDIA").hint).toBe("19% of NVIDIA's revenue (largest)");
    expect(ff.topShare?.pct).toBe(dependencyScore("NVDA", own).topCustomerPct);
  });

  it("the hotspot label says where the regions were read", () => {
    expect(hotspotCell(["China"], false, "NVIDIA").hint).toBe("China, in filings and calls");
    expect(hotspotCell(["China"], false, "NVIDIA").title).toContain("not in any link sentence");
    expect(hotspotCell(["China", "Taiwan", "Israel"], true, "NVIDIA").hint).toBe("China, Taiwan +1, in link sentences");
  });

  it("the score says what it counts and where the rest is", () => {
    expect(scoreScope("NVIDIA")).toBe("Counts NVIDIA's own 10-K and 10-Q only. Sole-source ties and shares that other companies state about NVIDIA are in the strip at the top.");
  });
});

/* p3-vis-H2: NVIDIA's panel printed "0 of 100" beside a strip with five hotspots and its own note about a 22% customer. The
   signals are NVIDIA's 10-K sentences as the kit holds them (supply_signals, kind concentration, source filing). */
const nvdaSignals = [
  { kind: "concentration", pct: 22, quote: "For fiscal year 2026, sales to one direct customer represented 22% of total revenue", source_kind: "filing", form: "10-K", period: "FY2026" },
  { kind: "concentration", pct: 14, quote: "sales to another direct customer represented 14% of total revenue, all of which were primarily attributable to the Compute & Networking segment", source_kind: "filing", form: "10-K", period: "FY2026" },
  { kind: "concentration", pct: 30, quote: "One customer represented 30% of revenue, the CEO said on the call", source_kind: "transcript", form: null, period: null },
];
const NVDA_HOT = ["China", "Taiwan", "Israel", "Russia", "Hong Kong"];

describe("Dependency score never reads as no risk when its inputs are missing (p3-vis-H2)", () => {
  const d = dependencyScore("NVDA", all);
  it("NVIDIA: the unnamed 22% customer from its own 10-K is scored, and the hotspots the strip counts make geopolitics not scored, not 0", () => {
    const u = unnamedCustomerShare(nvdaSignals);
    expect(u).toEqual({ pct: 22, period: "FY2026", form: "10-K" });
    const r = scoreReading(d, "NVIDIA", u, { hotspots: NVDA_HOT, fromLinks: false });
    expect(r.value).toBe(20);
    expect(r.parts[0]).toMatchObject({ label: "Customer concentration", points: 20 });
    expect(r.parts[0].why).toBe("largest customer 22% of revenue, unnamed in NVIDIA's 10-K (FY2026)");
    expect(r.parts[2].points).toBeNull();
    expect(r.parts[2].why).toBe("Not scored: NVIDIA's filings and calls name China, Taiwan, Israel and 2 more, but no link sentence ties a counterparty there");
    expect(r.sub).toBe("of 100 · geopolitical exposure not scored");
    // the strip's hotspot cell counts five; the score part must not say there are none
    expect(hotspotCell(NVDA_HOT, false, "NVIDIA").value).toBe(5);
    expect(r.parts[2].why).not.toMatch(/no hotspot/);
  });
  it("with no input at all the panel prints no number, and says why", () => {
    const r = scoreReading(d, "NVIDIA", null, { hotspots: NVDA_HOT, fromLinks: false });
    expect(r.value).toBeNull();
    expect(r.sub).toBe("Not scored: NVIDIA's filings name no customer share and tie no link to a hotspot region");
    expect(r.parts[0].why).toBe("Not scored: NVIDIA's filings state no customer share");
  });
  it("a share from a call is not a filing fact, and a smaller unnamed share may be a named one, so neither is folded in", () => {
    expect(unnamedCustomerShare(nvdaSignals.slice(2))).toBeNull();
    const own = [...all, link({ counterparty: "Microsoft", counterparty_ticker: "MSFT", relation: "customer", share_pct: 25, quote: "Microsoft represented 25% of total revenue." })];
    const r = scoreReading(dependencyScore("NVDA", own), "NVIDIA", unnamedCustomerShare(nvdaSignals), { hotspots: [], fromLinks: false });
    expect(r.unnamed).toBeNull();
    expect(r.parts[0].why).toContain("largest named customer 25% of revenue");
  });
});

/* CRUS as the kit holds it: Apple at 91% in the 10-K (fiscal 2026) and 93% in the 10-Q (a quarter), one link with two copies. */
const crus10q = link({ ticker: "CRUS", counterparty: "Apple Inc.", counterparty_ticker: "AAPL", relation: "customer", share_pct: 93, form: "10-Q", filed: "2026-11-04",
  quote: "We had one end customer, Apple Inc., that purchased through multiple contract manufacturers and represented approximately 93 percent and 90 percent of the Company's total net sales" });
const crus10k = link({ ticker: "CRUS", counterparty: "Apple Inc.", counterparty_ticker: "AAPL", relation: "customer", share_pct: 91, form: "10-K", filed: "2026-05-21",
  quote: "Apple Inc., who purchased through multiple contract manufacturers and represented approximately 91 percent, 89 percent, and 87 percent, of the Company's total net sales, respectively." });
const crusLink: ProLink = { ...crus10q, own: crus10q, corroboration: [crus10k] };
const crusAll: ProLink[] = [crusLink, link({ ticker: "CRUS", counterparty: "TSMC", counterparty_ticker: "TSM", relation: "supplier", regions: ["Taiwan"], quote: "wafers are made by TSMC in Taiwan" })];

describe("one share, one period (p3-sup-L1) and a company with stated shares (p3-vis-H2)", () => {
  const d = dependencyScore("CRUS", crusAll);
  it("the score and the strip quote the 10-K's 91%, the share the dollar estimate uses, not the 10-Q quarter's 93%", () => {
    expect(d.topCustomerPct).toBe(91);
    expect(d.customerHhi).toBe(8281);
    const f = stripFacts("CRUS", focusGraph("CRUS", crusAll, { CRUS: "Cirrus Logic", AAPL: "Apple" }), crusAll, { CRUS: "Cirrus Logic", AAPL: "Apple" });
    expect(f.topShare).toMatchObject({ pct: 91, period: "annual" });
    expect(concentrationCell(f, "Cirrus Logic").hint).toBe("91% of Cirrus Logic's revenue (largest)");
  });
  it("CRUS is scored from its stated share and its Taiwan link; nothing reads not scored", () => {
    const r = scoreReading(d, "Cirrus Logic", null, { hotspots: ["Taiwan"], fromLinks: true });
    expect(r.value).toBe(d.score);
    expect(r.value).toBe(40 + 0 + 6);
    expect(r.parts.every((p) => p.points != null)).toBe(true);
    expect(r.sub).toBe("of 100 · higher is more fragile");
    expect(r.parts[0].why).toBe("largest named customer 91% of revenue; 1 customer with a stated share");
  });
  it("a share only a 10-Q states is said with its period", () => {
    const only: ProLink[] = [{ ...crus10q, own: crus10q }];
    const f = stripFacts("CRUS", focusGraph("CRUS", only, {}), only, { CRUS: "Cirrus Logic" });
    expect(concentrationCell(f, "Cirrus Logic").hint).toBe("93% of Cirrus Logic's revenue in a 10-Q quarter (largest)");
    expect(dependencyScore("CRUS", only).parts[0].why).toContain("93% of revenue in a 10-Q quarter");
  });
});
