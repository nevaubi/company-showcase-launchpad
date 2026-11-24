import { describe, expect, it } from "vitest";
import type { RiskLink } from "@/lib/supply/core";
import { keyRelationships, shareOfWords, taggedConcentration } from "./relationships";

let n = 0;
const link = (ticker: string, counterparty: string, counterpartyTicker: string | null, relation: RiskLink["relation"], over: Partial<RiskLink> = {}): RiskLink => ({
  id: `l${++n}`,
  ticker,
  counterparty,
  counterparty_ticker: counterpartyTicker,
  counterparty_domain: null,
  relation,
  detail: "",
  share_pct: null,
  quote: "",
  accn: `0000000000-26-00000${n}`,
  doc: "a.htm",
  form: "10-K",
  filed: "2026-02-01",
  ...over,
});

const NAMES = { AAPL: "Apple", CRUS: "Cirrus Logic", AMKR: "Amkor", SNX: "TD Synnex", TSM: "TSMC", QCOM: "Qualcomm" };
const LINKS: RiskLink[] = [
  // other companies naming Apple as their customer: they are Apple's suppliers, and the share is of their revenue
  link("CRUS", "Apple Inc.", "AAPL", "customer", { share_pct: 91, single_source: true, quote: "One customer, Apple Inc., represented 91 percent of total net sales.", filed: "2026-05-20" }),
  link("AMKR", "Apple", "AAPL", "customer", { share_pct: 29.8, quote: "Apple accounted for 29.8% of our net sales." }),
  link("QCOM", "Apple", "AAPL", "customer", { quote: "We sell modems to Apple." }),
  // Apple naming its own suppliers, without a share
  link("AAPL", "Taiwan Semiconductor", "TSM", "supplier", { single_source: true, quote: "Substantially all of the Company's processors are manufactured by a single outsourcing partner." }),
  link("AAPL", "Taiwan Semiconductor", "TSM", "supplier", { form: "10-Q", filed: "2026-07-31", accn: "0000000000-26-999999", quote: "The Company relies on a single outsourcing partner for processors." }),
  // a distributor names Apple as its supplier: it is Apple's customer, and the share is of the distributor's purchases
  link("SNX", "Apple, Inc.", "AAPL", "supplier", { share_pct: 12, quote: "Products purchased from Apple, Inc., our largest supplier, were 12% of purchases." }),
  link("AAPL", "Carrier Co", null, "customer", { quote: "The Company sells through cellular network carriers." }),
  link("AAPL", "Samsung", null, "competitor"),
  link("AAPL", "OpenAI", null, "partner"),
  // a financing tie is not a trade relationship
  link("AAPL", "Goldman Sachs", "GS", "supplier", { nature: "financial", quote: "Goldman Sachs is the issuer of the card." }),
];

describe("keyRelationships", () => {
  const r = keyRelationships("AAPL", LINKS, NAMES);
  it("lists suppliers and customers as seen from the company, largest stated share first", () => {
    expect(r.suppliers.map((s) => s.ticker)).toEqual(["CRUS", "AMKR", "TSM", "QCOM"]);
    expect(r.customers.map((s) => s.name)).toEqual(["TD Synnex", "Carrier Co"]);
    expect(r.totals).toEqual({ customers: 2, suppliers: 4, partners: 1, competitors: 1 });
  });
  it("says whose total a share is of", () => {
    const crus = r.suppliers[0];
    expect(crus.share).toEqual({ pct: 91, of: "CRUS", basis: "revenue" });
    expect(shareOfWords(crus.share!, (t) => NAMES[t as keyof typeof NAMES] ?? t)).toBe("of Cirrus Logic's revenue");
    expect(crus.source.quote).toMatch(/91 percent/);
    // a share of net sales is revenue even when the sentence does not use the word "customer"
    expect(r.suppliers[1].share).toEqual({ pct: 29.8, of: "AMKR", basis: "revenue" });
    const snx = r.customers[0];
    expect(snx.share).toEqual({ pct: 12, of: "SNX", basis: "vendor" });
    expect(shareOfWords(snx.share!, (t) => NAMES[t as keyof typeof NAMES] ?? t)).toBe("of TD Synnex's purchases");
  });
  it("keeps sole-source wording, counts filings and opens the newest statement when no share is stated", () => {
    const tsm = r.suppliers.find((s) => s.ticker === "TSM")!;
    expect(tsm).toMatchObject({ share: null, singleSource: true, filings: 2 });
    expect(tsm.source.form).toBe("10-Q");
    expect(r.suppliers.find((s) => s.ticker === "QCOM")).toMatchObject({ share: null, singleSource: false, filings: 1 });
  });
  it("leaves out ties that are not trade, and cuts each side", () => {
    expect(r.suppliers.map((s) => s.name)).not.toContain("Goldman Sachs");
    const cut = keyRelationships("AAPL", LINKS, NAMES, 2);
    expect(cut.suppliers).toHaveLength(2);
    expect(cut.totals.suppliers).toBe(4);
  });
  it("is empty for a company no filing names", () => {
    expect(keyRelationships("ZZZZ", LINKS, NAMES)).toEqual({ customers: [], suppliers: [], totals: { customers: 0, suppliers: 0, partners: 0, competitors: 0 } });
  });
});

describe("taggedConcentration", () => {
  const row = (label: string, pct: number | string, period_end: string, benchmark = "revenue", kind = "customer") => ({ label, pct, kind, benchmark, benchmark_label: null, form: "10-K", period_end, accn: "0000000000-26-000001", element_id: "f-1" });
  it("keeps the newest period, largest first", () => {
    const rows = [row("Customer One", "0.289", "2026-09-30"), row("Customer Two", 0.248, "2026-09-30"), row("Customer Two", 0.649, "2025-09-30"), row("Customer Three", 0.175, "2026-09-30"), row("Customer Four", 0, "2026-09-30")];
    expect(taggedConcentration(rows).map((r) => [r.label, r.pct])).toEqual([["Customer One", 0.289], ["Customer Two", 0.248], ["Customer Three", 0.175]]);
    expect(taggedConcentration(rows, 2)).toHaveLength(2);
    expect(taggedConcentration([])).toEqual([]);
  });
});
