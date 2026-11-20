// The rules the views rely on, checked where they are used: rows go through `currentRows` (as the loader does), then
// into the graph, the exposure figures, the shock simulation and the country tallies.
import { describe, expect, it } from "vitest";
import { focusGraph, linkDollars, linkDollarsFrom, nodeRisk, secondOrder, simulateShock, statedAmounts, dependencyScore, isHotspotRegion, type RiskLink } from "./core";
import { countryExposure } from "./analytics";
import { buildChain } from "./chain";
import { currentRows } from "./trusted";
import { exposureSummary } from "./describe";

let n = 0;
const row = (p: Partial<RiskLink>): RiskLink => ({
  id: `r${++n}`, ticker: "NVDA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "customer",
  detail: "", share_pct: null, quote: "", accn: "0001-26-000001", doc: "d", form: "10-K", filed: "2026-03-02", amount_usd: null, single_source: false, regions: [], ...p,
});
const names = { NVDA: "NVIDIA", TSM: "TSMC", MSFT: "Microsoft", COHR: "Coherent" };
const revenue = { NVDA: 200e9, TSM: 100e9, COHR: 6e9 };

/* rows as stored on 20 Nov 2026 (quotes verbatim from supply_links) */
const NVDA_ROWS = [
  row({ counterparty: "SB Energy Corp.", relation: "partner", form: "10-Q", filed: "2026-08-26", accn: "q2", amount_usd: 105e9, regions: ["Ohio"],
    quote: "In August 2026, we entered into guarantees, capped at a total of $ 105 billion, to provide credit support on a land, power, and shell buildout with affiliates of SB Energy Corp." }),
  row({ counterparty: "OpenAI Group PBC", relation: "customer", form: "10-Q", filed: "2026-08-26", accn: "q2", amount_usd: 105e9, regions: ["Ohio"],
    quote: "on behalf of a customer, an affiliate of OpenAI Group PBC (OpenAI), related to leases for approximately 4.25 gigawatts of IT load" }),
  row({ ticker: "BAM", counterparty: "NVIDIA", counterparty_ticker: "NVDA", relation: "partner", amount_usd: 100e9,
    quote: "Brookfield announced the launch of a $100 billion global AI Infrastructure program in partnership with NVIDIA and the Kuwait Investment Authority (\"KIA\")." }),
  row({ ticker: "COHR", counterparty: "NVIDIA Corporation", counterparty_ticker: "NVDA", relation: "partner", form: "10-Q", filed: "2026-11-04", amount_usd: 2e9,
    quote: "On March 2, 2026, NVIDIA made a $2 billion investment in the Company through the purchase of shares of the Company's Common Stock." }),
  row({ counterparty: "Microsoft", counterparty_ticker: "MSFT", share_pct: 19, quote: "Sales to Microsoft accounted for 19% of total revenue in fiscal year 2026." }),
  row({ counterparty: "Microsoft", counterparty_ticker: "MSFT", share_pct: 18, form: "10-Q", filed: "2026-08-26", accn: "q2", quote: "Sales to Microsoft accounted for 18% of total revenue for the first half of fiscal year 2027." }),
  row({ counterparty: "Taiwan Semiconductor Manufacturing Company Limited", counterparty_ticker: "TSM", relation: "supplier", single_source: true, regions: ["Taiwan", "Worldwide excluding China"],
    quote: "We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, as the sole source of our wafers in Taiwan." }),
  row({ counterparty: "Kioxia", relation: "supplier", single_source: true, regions: ["Japan"],
    quote: "We depend on a limited number of suppliers, including Kioxia, for key memory components." }),
  row({ counterparty: "Kioxia Corporation", relation: "supplier", form: "10-Q", filed: "2026-08-26", accn: "q2",
    quote: "We purchase NAND flash memory from Kioxia Corporation under a supply agreement." }),
];

describe("NVIDIA page after the claim checks", () => {
  const all = currentRows(NVDA_ROWS);
  const graph = focusGraph("NVDA", all, names);
  const node = (name: RegExp) => graph.find((g) => name.test(g.name))!;
  const risk = (name: RegExp) => nodeRisk(node(name).links as RiskLink[], revenue);

  it("shows the SB Energy guarantee as a guarantee, never as exposure", () => {
    const sb = node(/SB Energy/);
    expect(statedAmounts(sb.links as RiskLink[])).toEqual([expect.objectContaining({ value: 105e9, kind: "guarantee", flow: false })]);
    expect(risk(/SB Energy/).dollars).toBeNull();
    expect(linkDollars(sb.links[0] as RiskLink, revenue)).toBeNull();
  });
  it("does not show the OpenAI $105B at all: the sentence states no such figure", () => {
    const oa = node(/OpenAI/);
    expect((oa.links[0] as RiskLink).amount_usd).toBeNull();
    expect(statedAmounts(oa.links as RiskLink[])).toEqual([]);
    expect(risk(/OpenAI/).dollars).toBeNull();
  });
  it("keeps the Brookfield programme and the Coherent investment out of flows", () => {
    expect(statedAmounts(node(/^BAM$|Brookfield|BAM/).links as RiskLink[])[0]).toMatchObject({ kind: "investment", flow: false });
    expect(risk(/Coherent/)).toMatchObject({ dollars: null, nature: "financial" });
  });
  it("totals only flows and shares: Microsoft's share × revenue, counted once across its 10-K and 10-Q", () => {
    const total = graph.reduce((s, g) => s + (nodeRisk(g.links as RiskLink[], revenue).dollars ?? 0), 0);
    expect(total).toBeCloseTo(0.19 * 200e9);
    const msft = node(/Microsoft/);
    expect(msft.links).toHaveLength(1);
    expect((msft.links[0] as RiskLink).corroboration).toHaveLength(1);
    expect(linkDollarsFrom(msft.links[0] as RiskLink, revenue)).toMatchObject({ from: "share", dollars: 0.19 * 200e9 });
  });
  it("the exposure tile adds only flows and shares; guarantees and investments are listed apart; the OpenAI figure is gone", () => {
    const sum = exposureSummary(graph, revenue);
    expect(sum.exposure.map((x) => x.n.name)).toEqual(["Microsoft"]);
    expect(sum.total).toBeCloseTo(0.19 * 200e9);
    expect(sum.others.map((o) => [o.n.name, o.a.kind, o.a.value])).toEqual([["SB Energy Corp.", "guarantee", 105e9], ["BAM", "investment", 100e9], ["Coherent", "investment", 2e9]]);
    expect(sum.others.some((o) => /OpenAI/.test(o.n.name))).toBe(false);
  });
  it("merges spelling variants into one node and keeps the other filing as corroboration", () => {
    const kioxia = graph.filter((g) => /kioxia/i.test(g.name));
    expect(kioxia).toHaveLength(1);
    expect((kioxia[0].links[0] as RiskLink).corroboration).toHaveLength(1);
  });
  it("calls single source only with sole-source wording; the weaker flag becomes a stated dependency", () => {
    expect(risk(/Taiwan Semiconductor|TSMC/)).toMatchObject({ singleSource: true, dependency: false });
    expect(risk(/Kioxia/)).toMatchObject({ singleSource: false, dependency: true });
    const dep = dependencyScore("NVDA", all);
    expect(dep.singleSource).toBe(1);
    expect(dep.statedDependencies).toBe(1);
  });
  it("keeps only regions the sentence names, and an 'excluding' entry is never a hotspot", () => {
    expect(risk(/SB Energy/).regions).toEqual([]);
    expect(risk(/Kioxia/).regions).toEqual([]);
    expect(risk(/Taiwan Semiconductor|TSMC/).hotspots).toEqual(["Taiwan"]);
    expect(isHotspotRegion("Worldwide excluding China")).toBe(false);
    const rows = countryExposure(all, [], revenue);
    expect(rows.find((r) => r.country === "Ohio")).toBeUndefined();
    // Kioxia's sentence names no country: Japan counts only as its home country, not as a stated region
    expect(rows.find((r) => r.country === "Japan")).toMatchObject({ links: 0, hq: 1 });
    expect(rows.find((r) => r.country === "Taiwan")?.links).toBe(1);
  });
});

describe("ties that are not trade stay out of flows and shocks", () => {
  const all = currentRows([
    row({ ticker: "AAA", counterparty: "BBB Inc.", counterparty_ticker: "BBB", relation: "supplier", quote: "We purchase all of our wafers from BBB under a supply agreement." }),
    row({ ticker: "AAA", counterparty: "Lender Bank", counterparty_ticker: "LNDR", relation: "supplier", quote: "We borrowed $500 million under the credit agreement with Lender Bank as administrative agent." }),
    row({ ticker: "CCC", counterparty: "AAA Corp", counterparty_ticker: "AAA", relation: "customer", share_pct: 30, quote: "Sales to AAA accounted for 30% of our revenue in 2025." }),
    row({ ticker: "LNDR", counterparty: "AAA Corp", counterparty_ticker: "AAA", relation: "customer", share_pct: 40, quote: "We provided a term loan of $500 million and a revolving credit facility to AAA." }),
  ]);
  it("the shock reaches the trade customer's supplier, not the lender", () => {
    const hit = simulateShock("AAA", 0.2, all, {}, {});
    expect(hit.map((h) => h.ticker)).toContain("CCC");
    expect(hit.map((h) => h.ticker)).not.toContain("LNDR");
  });
  it("second-order hops and the value chain skip financing ties", () => {
    const g = focusGraph("AAA", all, {});
    expect(g.find((x) => x.ticker === "LNDR")).toBeDefined();
    expect(secondOrder("AAA", g, all, {}).some((h) => h.ticker === "LNDR")).toBe(false);
    const chain = buildChain("AAA", all, [], {}, {});
    expect(chain.nodes.map((x) => x.ticker)).not.toContain("LNDR");
    expect(chain.nodes.map((x) => x.ticker)).toContain("CCC");
  });
});
