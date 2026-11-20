import { describe, expect, it } from "vitest";
import type { GraphNode, HopNode } from "./core";
import { isAppPath, siteMapText } from "@/lib/research/site-map";
import { resolveSelection, selectionParam, supplyHref, supplySearch } from "./url-state";

const node = (relation: GraphNode["relation"], name: string, ticker: string | null, key = `${relation}:${ticker ?? name.toLowerCase()}`): GraphNode => ({ key, name, ticker, domain: null, relation, links: [] });
const graph: (GraphNode | HopNode)[] = [
  node("supplier", "TSMC", "TSM"),
  node("customer", "TSMC", "TSM"),
  node("supplier", "Kioxia Corporation", null, "supplier:kioxia"),
  { ...node("supplier", "ASML", "ASML"), key: "h2:supplier:TSM:supplier:ASML", hop: 2, parent: "supplier:TSM" },
];

describe("supply page address", () => {
  it("keeps valid params and drops bad ones instead of failing the page", () => {
    expect(supplySearch.parse({ t: "NVDA", view: "globe", sel: "supplier:TSM", overlay: "single", depth: "2", tab: "shock" })).toEqual({ t: "NVDA", view: "globe", sel: "supplier:TSM", overlay: "single", depth: 2, tab: "shock" });
    expect(supplySearch.parse({ t: "NVDA", view: "sankey", overlay: "x", depth: "7", tab: "nope" })).toEqual({ t: "NVDA" });
    expect(supplySearch.parse({ sel: "x".repeat(500) })).toEqual({});
  });
  it("writes a selection readably and reads it back, by ticker, by name without suffixes, or by key", () => {
    expect(selectionParam(graph[0])).toBe("supplier:TSM");
    expect(selectionParam(graph[2])).toBe("supplier:Kioxia Corporation");
    expect(selectionParam(graph[3])).toBe("h2:supplier:TSM:supplier:ASML");
    for (const n of graph) expect(resolveSelection(graph, selectionParam(n))).toBe(n.key);
    expect(resolveSelection(graph, "customer:tsm")).toBe("customer:TSM");
    expect(resolveSelection(graph, "supplier:Kioxia")).toBe("supplier:kioxia");
    expect(resolveSelection(graph, "Kioxia Corp.")).toBe("supplier:kioxia");
    expect(resolveSelection(graph, "TSM")).toBe("supplier:TSM");
  });
  it("selects nothing for a name the page does not show", () => {
    expect(resolveSelection(graph, "partner:TSM")).toBeNull();
    expect(resolveSelection(graph, "Samsung")).toBeNull();
    expect(resolveSelection(graph, "")).toBeNull();
    expect(resolveSelection(graph, undefined)).toBeNull();
  });
  it("builds links with defaults left out", () => {
    expect(supplyHref({ t: "nvda" })).toBe("/app/supply-chain?t=NVDA");
    expect(supplyHref({ t: "NVDA", view: "globe", sel: "supplier:TSM", overlay: "geo", depth: 2, tab: "shock" })).toBe("/app/supply-chain?t=NVDA&view=globe&sel=supplier%3ATSM&overlay=geo&depth=2&tab=shock");
    expect(supplyHref({ view: "network", overlay: "none", depth: 1, tab: "evidence" })).toBe("/app/supply-chain");
    expect(supplySearch.parse(Object.fromEntries(new URLSearchParams(supplyHref({ t: "NVDA", sel: "supplier:Kioxia Corporation" }).split("?")[1])))).toEqual({ t: "NVDA", sel: "supplier:Kioxia Corporation" });
  });
  it("the assistant can open any of these links, and its site map tells it how", () => {
    expect(isAppPath(supplyHref({ t: "NVDA", view: "globe", sel: "supplier:TSM", overlay: "geo", depth: 2, tab: "shock" }))).toBe(true);
    const map = siteMapText();
    for (const p of ["view=network|globe|chain", "sel=relation:TICKER", "overlay=single|concentration|geo|dollars", "tab=evidence|reactions|changes|shock|exposure"]) expect(map).toContain(p);
  });
});
