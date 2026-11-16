import { describe, expect, it } from "vitest";
import type { RiskLink } from "./core";
import { buildChain, type TaggedShare } from "./chain";

const L = (id: string, ticker: string, counterparty: string, counterparty_ticker: string | null, relation: RiskLink["relation"], extra: Partial<RiskLink> = {}): RiskLink => ({
  id, ticker, counterparty, counterparty_ticker, counterparty_domain: null, relation, detail: "", share_pct: null, quote: "q", accn: `a-${id}`, doc: "d.htm", form: "10-K", filed: "2026-02-01", ...extra,
});
const names = { NVDA: "NVIDIA", AMAT: "Applied Materials", MSFT: "Microsoft", DELL: "Dell", SMCI: "Super Micro" };

const links: RiskLink[] = [
  L("1", "NVDA", "Taiwan Semiconductor Manufacturing Company Limited", null, "supplier", { single_source: true }),
  L("2", "AMAT", "TSMC", null, "customer", { share_pct: 17 }),
  L("3", "NVDA", "Microsoft", "MSFT", "customer", { share_pct: 19 }),
  L("4", "DELL", "NVIDIA", "NVDA", "supplier"),
  L("5", "NVDA", "Dell", "DELL", "customer"),
  L("6", "NVDA", "Intel", null, "competitor"),
];
const tagged: TaggedShare[] = [
  { ticker: "SMCI", counterparty: "NVDA", kind: "supplier", benchmark: "purchases", label: "NVIDIA", pct: 0.6, accn: "x1", form: "10-K", filed: "2026-08-01", period_end: "2026-06-30", element_id: "e1" },
];

describe("value chain", () => {
  const c = buildChain("NVDA", links, tagged, names, { NVDA: 100e9, AMAT: 27e9 });
  const node = (k: string) => c.nodes.find((n) => n.key === k);

  it("puts suppliers upstream, customers downstream and walks past an uncovered supplier by name", () => {
    expect(node("TSM")?.tier).toBe(-1);
    expect(node("AMAT")?.tier).toBe(-2); // AMAT names TSMC as a customer → AMAT supplies NVDA's supplier
    expect(node("MSFT")?.tier).toBe(1);
    expect(node("SMCI")?.tier).toBe(1); // from SMCI's tagged XBRL fact, NVDA is a supplier of SMCI
    expect(c.nodes.some((n) => n.name === "Intel")).toBe(false); // competitors are not in the chain
  });

  it("sizes edges from the stated share × the seller's revenue", () => {
    const e = c.edges.find((x) => x.from === "NVDA" && x.to === "MSFT")!;
    expect(e.share).toBe(19);
    expect(e.basis).toBe("revenue");
    expect(e.dollars).toBeCloseTo(19e9);
    const up = c.edges.find((x) => x.from === "AMAT" && x.to === "TSM")!;
    expect(up.dollars).toBeCloseTo(0.17 * 27e9);
    expect(c.edges.find((x) => x.from === "TSM" && x.to === "NVDA")!.sole).toBe(true);
  });

  it("marks an edge confirmed only when both companies' filings state it", () => {
    expect(c.edges.find((x) => x.from === "NVDA" && x.to === "DELL")!.confirmed).toBe(true);
    expect(c.edges.find((x) => x.from === "NVDA" && x.to === "MSFT")!.confirmed).toBe(false);
  });

  it("keeps the tagged fact as the edge's evidence with its share of purchases", () => {
    const e = c.edges.find((x) => x.from === "NVDA" && x.to === "SMCI")!;
    expect(e.share).toBe(60);
    expect(e.basis).toBe("purchases");
    expect(e.dollars).toBeNull();
    expect(e.evidence[0].kind).toBe("tag");
  });

  it("respects depth", () => {
    expect(buildChain("NVDA", links, tagged, names, {}, { depth: 1 }).tiers).toEqual([-1, 0, 1]);
  });
});

describe("chain text for the assistant", () => {
  it("lists each edge with its tier, share and source filing", async () => {
    const { chainText } = await import("./chain");
    const t = chainText(buildChain("NVDA", links, tagged, names, { NVDA: 100e9, AMAT: 27e9 }));
    expect(t).toContain("[Company → Customers] NVIDIA (NVDA) sells to Microsoft (MSFT) | 19% of revenue | ≈$19000M | per NVDA 10-K a-3");
    expect(t).toContain('XBRL-tagged "NVIDIA" 60.0% of purchases');
  });
});
