import { describe, expect, it } from "vitest";
import type { GraphNode, ProLink, Relation } from "./core";
import { excerpt, groupTotals, nodeFacts } from "./describe";

const L = (p: Partial<ProLink>): ProLink => ({
  id: Math.random().toString(), ticker: "UTHR", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "supplier",
  detail: "", share_pct: null, quote: "q", accn: "a", doc: "d", form: "10-K", filed: "2026-02-25", regions: [], ...p,
});
const N = (relation: Relation, links: ProLink[]): GraphNode => ({ key: `${relation}:x`, name: "X", ticker: null, domain: null, relation, links });

describe("excerpt", () => {
  it("keeps short sentences whole and cuts long ones at a word", () => {
    expect(excerpt("  We rely on   MannKind. ")).toBe("We rely on MannKind.");
    const long = "We rely entirely on MannKind to manufacture Tyvaso DPI finished drug product and inhalers for us, with no plans to develop an alternate or backup supply arrangement";
    const cut = excerpt(long, 80);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(81);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });
});

describe("nodeFacts", () => {
  it("reads the newest statement, the most named product, the largest share and the stated figures by kind", () => {
    const f = nodeFacts(N("partner", [
      L({ relation: "partner", filed: "2026-02-25", form: "10-K", amount_usd: 40e6, amount_kind: "revenue", flow_usd: 40e6, nature: "trade", product: "Dry powder drug technology", quote: "In September 2018, we entered into a license." }),
      L({ relation: "partner", filed: "2026-11-04", form: "10-Q", amount_usd: 90e6, amount_kind: "investment", flow_usd: null, nature: "trade", product: "ralinepag DPI formulation technology", quote: "In August 2025, we exercised the option." }),
      L({ relation: "partner", filed: "2025-02-25", product: "Dry powder drug technology", share_pct: 4, nature: "trade" }),
    ]));
    expect(f).toMatchObject({ relation: "partner", hop: 1, statements: 3, share: 4, product: "Dry powder drug technology", form: "10-Q", filed: "2026-11-04" });
    expect(f.flow).toEqual({ value: 40e6, kind: "revenue", flow: true });
    expect(f.other).toEqual({ value: 90e6, kind: "investment", flow: false });
    expect(f.excerpt).toBe("In August 2025, we exercised the option.");
  });
  it("says nothing it was not told", () => {
    const f = nodeFacts(N("competitor", [L({ relation: "competitor" })]));
    expect(f).toMatchObject({ share: null, flow: null, other: null, product: null, summary: null, singleSource: false, dependency: false, hotspots: [] });
    expect(nodeFacts(N("customer", [L({ detail: "Buys GPUs for its data centres." })])).summary).toBe("Buys GPUs for its data centres.");
  });
  it("shows nothing for an amount the sentence does not state (trustLink cleared it)", () => {
    const f = nodeFacts(N("customer", [L({ amount_usd: null, dropped: ["amount_usd"], quote: "on behalf of a customer, an affiliate of OpenAI Group PBC (OpenAI), related to leases" })]));
    expect(f.flow).toBeNull();
    expect(f.other).toBeNull();
  });
  it("never calls a financing tie's figure a flow, and names the tie", () => {
    const f = nodeFacts(N("partner", [L({ amount_usd: 2e9, amount_kind: "investment", flow_usd: null, nature: "financial" })]));
    expect(f.nature).toBe("financial");
    expect(f.flow).toBeNull();
    expect(f.other?.kind).toBe("investment");
  });
  it("never labels a competitor as a regulator or a financing tie", () => {
    expect(nodeFacts(N("competitor", [L({ relation: "competitor", nature: "regulatory" })])).nature).toBe("trade");
  });
  it("counts a 10-K and a 10-Q copy as one statement in two filings", () => {
    const copy = L({ accn: "q", form: "10-Q", filed: "2026-11-04", share_pct: 12 });
    const f = nodeFacts(N("customer", [L({ accn: "k", share_pct: 10, corroboration: [copy] })]));
    expect(f.statements).toBe(1);
    expect(f.filings).toBe(2);
    expect(f.share).toBe(12);
  });
  it("takes single-source, dependency and hotspot flags from the risk when given", () => {
    const f = nodeFacts(N("supplier", [L({ single_source: false })]), { singleSource: true, dependency: false, concentrated: false, hotspots: ["Taiwan"], regions: ["Taiwan"], dollars: null, nature: "trade" });
    expect(f.singleSource).toBe(true);
    expect(f.hotspots).toEqual(["Taiwan"]);
    expect(nodeFacts(N("supplier", [L({ single_source: false, dependency: true })])).dependency).toBe(true);
  });
});

describe("groupTotals", () => {
  it("adds only each name's largest stated flow; other figures are counted apart, never summed", () => {
    const t = groupTotals([
      N("customer", [L({ share_pct: 16.3 })]),
      N("customer", [L({ amount_usd: 2e9, flow_usd: 2e9, amount_kind: "revenue", nature: "trade" }), L({ amount_usd: 1e9, flow_usd: 1e9, amount_kind: "contract", nature: "trade" })]),
      N("customer", [L({ amount_usd: 105e9, flow_usd: null, amount_kind: "guarantee", nature: "trade" })]),
      N("customer", [L({})]),
    ]);
    expect(t).toEqual({ names: 4, quantified: 2, maxShare: 16.3, flows: 2e9, others: 1 });
    expect(groupTotals([N("supplier", [L({})])])).toEqual({ names: 1, quantified: 0, maxShare: null, flows: null, others: 0 });
  });
});
