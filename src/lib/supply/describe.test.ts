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
  it("reads the newest statement, the most named product and the largest stated figures", () => {
    const f = nodeFacts(N("partner", [
      L({ relation: "partner", filed: "2026-02-25", form: "10-K", amount_usd: 40e6, product: "Dry powder drug technology", quote: "In September 2018, we entered into a license." }),
      L({ relation: "partner", filed: "2026-11-04", form: "10-Q", amount_usd: 35e6, product: "ralinepag DPI formulation technology", quote: "In August 2025, we exercised the option." }),
      L({ relation: "partner", filed: "2025-02-25", product: "Dry powder drug technology", share_pct: 4 }),
    ]));
    expect(f).toMatchObject({ relation: "partner", hop: 1, statements: 3, amount: 40e6, share: 4, product: "Dry powder drug technology", form: "10-Q", filed: "2026-11-04" });
    expect(f.excerpt).toBe("In August 2025, we exercised the option.");
  });
  it("says nothing it was not told", () => {
    const f = nodeFacts(N("competitor", [L({ relation: "competitor" })]));
    expect(f).toMatchObject({ share: null, amount: null, product: null, summary: null, singleSource: false, hotspots: [] });
    expect(nodeFacts(N("customer", [L({ detail: "Buys GPUs for its data centres." })])).summary).toBe("Buys GPUs for its data centres.");
  });
  it("takes single-source and hotspot flags from the risk when given", () => {
    const f = nodeFacts(N("supplier", [L({ single_source: false })]), { singleSource: true, concentrated: false, hotspots: ["Taiwan"], regions: ["Taiwan"], dollars: null });
    expect(f.singleSource).toBe(true);
    expect(f.hotspots).toEqual(["Taiwan"]);
  });
});

describe("groupTotals", () => {
  it("counts quantified names, the largest share and the sum of stated amounts", () => {
    const t = groupTotals([
      N("supplier", [L({ share_pct: 16.3 })]),
      N("supplier", [L({ amount_usd: 2e9 }), L({ amount_usd: 1e9 })]),
      N("supplier", [L({})]),
    ]);
    expect(t).toEqual({ names: 3, quantified: 2, maxShare: 16.3, stated: 2e9 });
    expect(groupTotals([N("supplier", [L({})])])).toEqual({ names: 1, quantified: 0, maxShare: null, stated: null });
  });
});
