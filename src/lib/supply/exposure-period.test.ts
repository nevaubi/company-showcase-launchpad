import { describe, expect, it } from "vitest";
import { linkDollarsFrom, sharePeriod, type RiskLink } from "./core";
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
    expect(estimateWords(93, d.period, "Cirrus Logic")).toBe("est. 93% of Cirrus Logic's revenue for a quarter (10-Q) × 12-month revenue");
    const { exposure } = exposureSummary([{ key: "customer:AAPL", name: "Apple", ticker: "AAPL", domain: null, relation: "customer", links: [q] }], revenue);
    const w = exposureWords(exposure);
    expect(w.label).toBe("Estimated exposure");
    expect(w.label).not.toMatch(/disclosed/i);
    expect(w.title).toContain("1 estimate from a quarter's share in a 10-Q");
  });
  it("a figure the sentence states is stated, and a mix says both", () => {
    expect(exposureWords([{ from: "flow" }]).label).toBe("Stated exposure");
    expect(exposureWords([{ from: "flow" }, { from: "share", period: "annual" }])).toMatchObject({ label: "Stated and estimated exposure", note: "1 estimated" });
  });
});
