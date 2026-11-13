import { describe, expect, it } from "vitest";
import type { GraphNode, RiskLink } from "@/lib/supply/core";
import { buildSupplySankey, flowParties, FOCUS_ID } from "./flow";

const link = (o: Partial<RiskLink>): RiskLink => ({ id: "x", ticker: "RTX", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "customer", detail: "", share_pct: null, quote: "", accn: "a1", doc: "d", form: "10-K", filed: "2026-02-06", ...o });
const node = (key: string, name: string, relation: GraphNode["relation"], links: RiskLink[], ticker: string | null = null): GraphNode => ({ key, name, ticker, domain: null, relation, links });

const graph: GraphNode[] = [
  node("customer:navy", "U.S. Navy", "customer", [link({ amount_usd: 23e9 }), link({ accn: "a2" })]),
  node("customer:af", "U.S. Air Force", "customer", [link({ amount_usd: 14.3e9, single_source: true })]),
  node("customer:BA", "Boeing", "customer", [link({})], "BA"),
  // Howmet's filing names RTX as 11% of Howmet's sales, so Howmet supplies RTX about 11% of its revenue.
  node("supplier:HWM", "Howmet Aerospace", "supplier", [link({ ticker: "HWM", counterparty_ticker: "RTX", relation: "customer", share_pct: 11 })], "HWM"),
  node("competitor:GE", "GE Aerospace", "competitor", [link({ relation: "competitor" })], "GE"),
];
const revenue = { RTX: 96e9, HWM: 8e9 };

describe("supply flow", () => {
  it("sizes each party by the largest dollar figure a filing states, or leaves it unsized", () => {
    const p = flowParties(graph, revenue);
    expect(p.map((x) => [x.name, x.dollars])).toEqual([["U.S. Navy", 23e9], ["U.S. Air Force", 14.3e9], ["Howmet Aerospace", 0.88e9], ["Boeing", null]]);
    expect(p[0].filings).toBe(2);
    expect(p[1].sole).toBe(true);
    expect(p[2]).toMatchObject({ relation: "supplier", share: 11 });
  });

  it("draws suppliers into the company and the company out to customers", () => {
    const s = buildSupplySankey("RTX Corp", flowParties(graph, revenue))!;
    expect(s.columns).toEqual(["Suppliers", "Company", "Customers"]);
    expect(s.nodes.find((n) => n.id === FOCUS_ID)).toMatchObject({ label: "RTX Corp", column: 1 });
    expect(s.links).toContainEqual({ source: "supplier:HWM", target: FOCUS_ID, value: 0.88e9 });
    expect(s.links).toContainEqual({ source: FOCUS_ID, target: "customer:navy", value: 23e9 });
    expect(s.undisclosed).toBe(1);
    expect(s.drawn).not.toContain("customer:BA");
  });

  it("folds the tail of a long side into one node and drops a side with no dollars", () => {
    const many = Array.from({ length: 11 }, (_, i) => node(`customer:c${i}`, `Customer ${i}`, "customer", [link({ amount_usd: (11 - i) * 1e9 })]));
    const s = buildSupplySankey("Acme", flowParties(many, {}), 8)!;
    expect(s.columns).toEqual(["Company", "Customers"]);
    expect(s.nodes.filter((n) => n.column === 1)).toHaveLength(9);
    expect(s.links.find((l) => l.target === "others:customer")).toMatchObject({ value: 6e9 });
    expect(s.nodes.find((n) => n.id === "others:customer")?.label).toBe("3 others");
    expect(s.folded).toEqual({ supplier: 0, customer: 3 });
  });

  it("returns nothing to draw when no filing states a dollar figure", () => {
    expect(buildSupplySankey("Acme", flowParties([node("customer:BA", "Boeing", "customer", [link({})], "BA")], {}))).toBeNull();
  });
});
