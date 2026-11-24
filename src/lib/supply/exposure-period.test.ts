import { describe, expect, it } from "vitest";
import { fiscalMatch, linkDollarsFrom, sharePeriod, type RiskLink } from "./core";
import { buildChain } from "./chain";
import { exposureSummary } from "./describe";
import { estimateWords, exposureWords } from "./strip";

const link = (p: Partial<RiskLink>): RiskLink => ({
  id: "f355fc74", ticker: "CRUS", counterparty: "Apple Inc.", counterparty_ticker: "AAPL", counterparty_domain: null, relation: "customer",
  detail: "", share_pct: null, quote: "", accn: "a", doc: "d", form: "10-K", filed: "2026-05-20", ...p,
});

/* CRUS as the review found it: the current 10-Q states Apple at 93% "for the three months"; the 10-K states the year. */
const q = link({ id: "q", form: "10-Q", filed: "2026-10-30", share_pct: 93, quote: "Apple Inc. represented approximately 93% of our total net sales for the three months ended September 27, 2026." });
const k = link({ id: "k", form: "10-K", share_pct: 89, quote: "Apple Inc. represented approximately 89% of our total net sales in fiscal year 2026." });
const revenue = { CRUS: 1_900e6 };

describe("exposure from a stated share (supply-globe-M4)", () => {
  it("reads the period a share covers", () => {
    expect(sharePeriod(q)).toBe("quarter");
    expect(sharePeriod(k)).toBe("annual");
    expect(sharePeriod({ form: "10-Q", quote: "accounted for 40% of revenue for the nine months ended June 30" })).toBe("interim");
  });
  it("prefers the 10-K's annual share over a larger 10-Q quarter share", () => {
    const kept = { ...q, own: q, corroboration: [k] };
    const d = linkDollarsFrom(kept, revenue)!;
    expect(d.from).toBe("share");
    expect(d.period).toBe("annual");
    expect(d.link.id).toBe("k");
    expect(d.dollars).toBeCloseTo(0.89 * 1_900e6);
  });
  it("a quarter's share alone is used, and named as a quarter's", () => {
    const d = linkDollarsFrom(q, revenue)!;
    expect(d.period).toBe("quarter");
    expect(estimateWords(93, d.period, "Cirrus Logic", d.basis)).toBe("est. 93% of Cirrus Logic's revenue for a quarter (10-Q) × 12-month revenue");
    const { exposure } = exposureSummary([{ key: "customer:AAPL", name: "Apple", ticker: "AAPL", domain: null, relation: "customer", links: [q] }], revenue);
    const w = exposureWords(exposure);
    expect(w.label).toBe("Estimated exposure");
    expect(w.label).not.toMatch(/disclosed/i);
    expect(w.title).toContain("1 estimate from a quarter's share in a 10-Q");
  });
  it("a figure the sentence states is stated, and a mix says both", () => {
    expect(exposureWords([{ from: "flow" }]).label).toBe("Stated exposure");
    expect(exposureWords([{ from: "flow" }, { from: "share", period: "annual" }])).toMatchObject({ label: "Exposure (stated, est.)", note: "1 estimated" });
  });
});

/*
 * p3-sup-L2 on CRUS's real rows. The 10-K filed 2026-05-21 (accn 0000772406-26-000012 in the kit) states Apple at 91% of net
 * sales "for fiscal years 2026, 2025, and 2024"; SEC companyconcept RevenueFromContractWithCustomerExcludingAssessedTax states
 * fiscal 2026 (2025-03-30 to 2026-03-28) at $1,997,379,000; the universe's last twelve months are $2,048,332,000.
 */
describe("an annual share is multiplied by its own fiscal year's revenue (p3-sup-L2)", () => {
  const k91 = link({ id: "k91", share_pct: 91, filed: "2026-05-21", quote: "Apple Inc., who purchased through multiple contract manufacturers and represented approximately 91 percent, 89 percent, and 87 percent, of the Company's total net sales for fiscal years 2026, 2025, and 2024, respectively." });
  const ttm = { CRUS: 2_048_332_000 };
  const fiscal = { CRUS: { fy: "2026", revenue: 1_997_379_000 } };
  it("CRUS: 91% of fiscal 2026 net sales is $1.818B, not 91% of the last twelve months ($1.864B)", () => {
    expect(linkDollarsFrom(k91, ttm)!.dollars).toBeCloseTo(0.91 * 2_048_332_000);
    const d = linkDollarsFrom(k91, ttm, fiscal)!;
    expect(d.dollars).toBeCloseTo(1_817_614_890);
    expect(d.basis).toEqual({ kind: "fy", fy: "2026", revenue: 1_997_379_000 });
    expect(estimateWords(91, d.period, "Cirrus Logic", d.basis)).toBe("est. 91% of Cirrus Logic's revenue × FY2026 revenue");
  });
  it("the chain's edge carries the same figure and its basis", () => {
    const chain = buildChain("AAPL", [k91], [], { CRUS: "Cirrus Logic", AAPL: "Apple" }, ttm, { depth: 1, fiscal });
    const e = chain.edges.find((x) => x.dollarsFrom === "share")!;
    expect(e.dollars).toBeCloseTo(1_817_614_890);
    expect(e.dollarsBasis).toMatchObject({ kind: "fy", fy: "2026" });
  });
  it("a 10-Q's share, an older 10-K, or a year it cannot tell keeps the last twelve months, and says so", () => {
    expect(linkDollarsFrom(q, ttm, fiscal)!.basis).toEqual({ kind: "ttm", revenue: 2_048_332_000 });
    const older = link({ id: "o", share_pct: 89, filed: "2025-05-22", quote: "represented approximately 89 percent of total net sales for fiscal years 2025, 2024 and 2023" });
    expect(linkDollarsFrom(older, ttm, fiscal)!.basis?.kind).toBe("ttm");
    expect(fiscalMatch(link({ filed: "2026-05-21", quote: "Apple represented 91% of net sales." }), fiscal.CRUS)).toBeNull();
    /* a December year: the 10-K filed in February 2026 states 2025, the universe's latest year */
    expect(fiscalMatch(link({ filed: "2026-02-20", quote: "for the year ended December 31, 2025" }), { fy: "FY2025", revenue: 1 })).not.toBeNull();
    /* with the year's end known, a 10-K filed more than 200 days after it is an older year's */
    expect(fiscalMatch(link({ filed: "2026-05-21", quote: "" }), { fy: "FY2026", revenue: 1, yearEnd: "0328" })).not.toBeNull();
    expect(fiscalMatch(link({ filed: "2025-05-21", quote: "fiscal 2025" }), { fy: "FY2025", revenue: 1, yearEnd: "1231" })).toBeNull();
  });
});
