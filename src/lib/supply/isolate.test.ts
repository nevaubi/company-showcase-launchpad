import { describe, expect, it } from "vitest";
import type { Chain, ChainEdge, ChainNode } from "./chain";
import type { GraphNode, HopNode, Relation } from "./core";
import { canonicalPath, chainEdgePath, chainPath, isolatedHas, isolationParam, joinPath, nextIsolation, parseIsolation, pathHops, resolveIsolation, type IsolateContext, type Isolation } from "./isolate";
import { supplyHref, supplySearch } from "./url-state";

const node = (relation: Relation, name: string, ticker: string | null, key = `${relation}:${ticker ?? name.toLowerCase()}`): GraphNode => ({ key, name, ticker, domain: null, relation, links: [] });
const hop = (parent: GraphNode, name: string, ticker: string): HopNode => ({ ...node(parent.relation as Relation, name, ticker), key: `h2:${parent.key}:${parent.relation}:${ticker}`, hop: 2, parent: parent.key });

const tsm = node("supplier", "TSMC", "TSM"), kioxia = node("supplier", "Kioxia Corporation", null, "supplier:kioxia");
const msft = node("customer", "Microsoft", "MSFT"), hpe = node("customer", "Hewlett Packard Enterprise", "HPE");
const arm = node("partner", "Arm", "ARM"), amd = node("competitor", "AMD", "AMD");
const asml = hop(tsm, "ASML", "ASML"), orcl = hop(hpe, "Oracle", "ORCL");
const graph = [tsm, kioxia, msft, hpe, arm, amd], hop2 = [asml, orcl];

const cn = (key: string, name: string, tier: number, via: string | null): ChainNode => ({ key, name, ticker: /^[A-Z]+$/.test(key) ? key : null, tier, via });
const ce = (from: string, to: string): ChainEdge => ({ key: `${from}>${to}`, from, to, share: null, basis: null, dollars: null, dollarsFrom: null, sole: false, confirmed: false, types: [], products: [], evidence: [] });
const chain: Chain = {
  focus: "NVDA",
  nodes: [cn("NVDA", "NVIDIA", 0, null), cn("TSM", "TSMC", -1, "NVDA"), cn("kioxia", "Kioxia", -1, "NVDA"), cn("ENTG", "Entegris", -2, "TSM"), cn("ASML", "ASML", -2, "TSM"),
    cn("MSFT", "Microsoft", 1, "NVDA"), cn("HPE", "Hewlett Packard Enterprise", 1, "NVDA"), cn("ORCL", "Oracle", 2, "HPE")],
  // ENTG also sells to Kioxia: a stated link that did not place a node
  edges: [ce("TSM", "NVDA"), ce("kioxia", "NVDA"), ce("ENTG", "TSM"), ce("ASML", "TSM"), ce("ENTG", "kioxia"), ce("NVDA", "MSFT"), ce("NVDA", "HPE"), ce("HPE", "ORCL")],
  tiers: [-2, -1, 0, 1, 2],
};
const map: IsolateContext = { focus: "NVDA", focusName: "NVIDIA", graph, hop2 };
const withChain: IsolateContext = { ...map, chain };
const keys = (s: ReadonlySet<string> | null | undefined) => [...(s ?? [])].sort();

describe("isolation in the address", () => {
  it("round-trips a relation, a name and a pathway, and reads anything else as no isolation", () => {
    const cases: Isolation[] = [{ kind: "relation", relation: "supplier" }, { kind: "node", node: "supplier:TSM" }, { kind: "node", node: "customer:Kioxia Corporation" }, { kind: "path", keys: ["ENTG", "TSM", "NVDA", "HPE"] }];
    for (const c of cases) expect(parseIsolation(isolationParam(c))).toEqual(c);
    expect(isolationParam({ kind: "path", keys: ["ENTG", "TSM", "NVDA", "HPE"] })).toBe("path:ENTG>TSM>NVDA>HPE");
    for (const bad of [undefined, "", "rel:", "rel:friend", "path:NVDA", "node:", "nonsense", ":x", `path:${Array.from({ length: 9 }, (_, i) => `K${i}`).join(">")}`]) expect(parseIsolation(bad)).toBeNull();
    expect(isolationParam(null)).toBeUndefined();
  });
  it("survives the page's own address validation and is written into links", () => {
    expect(supplySearch.parse({ t: "NVDA", iso: "path:ENTG>TSM>NVDA>HPE" })).toEqual({ t: "NVDA", iso: "path:ENTG>TSM>NVDA>HPE" });
    expect(supplySearch.parse({ iso: "x".repeat(500) })).toEqual({});
    const href = supplyHref({ t: "NVDA", view: "chain", iso: "rel:supplier" });
    expect(href).toBe("/app/supply-chain?t=NVDA&view=chain&iso=rel%3Asupplier");
    expect(parseIsolation(new URLSearchParams(href.split("?")[1]).get("iso"))).toEqual({ kind: "relation", relation: "supplier" });
  });
});

describe("what an isolation lights", () => {
  it("a relation lights every name of that kind and what hangs off them, on the map and in the chain", () => {
    const s = resolveIsolation({ kind: "relation", relation: "supplier" }, withChain)!;
    expect(s.label).toBe("Suppliers only");
    expect(keys(s.lit)).toEqual([asml.key, tsm.key, kioxia.key].sort());
    expect(keys(s.chainNodes)).toEqual(["ASML", "ENTG", "NVDA", "TSM", "kioxia"]);
    expect(keys(s.chainEdges)).toEqual(["ASML>TSM", "ENTG>TSM", "ENTG>kioxia", "TSM>NVDA", "kioxia>NVDA"]);
    expect(s.path).toEqual([]);
    const c = resolveIsolation({ kind: "relation", relation: "customer" }, withChain)!;
    expect(keys(c.lit)).toEqual([hpe.key, msft.key, orcl.key].sort());
    expect(keys(c.chainNodes)).toEqual(["HPE", "MSFT", "NVDA", "ORCL"]);
  });
  it("partners and competitors are lit on the map and leave the chain whole, with the reason", () => {
    const s = resolveIsolation({ kind: "relation", relation: "partner" }, withChain)!;
    expect(keys(s.lit)).toEqual([arm.key]);
    expect(s.chainNodes).toBeNull();
    expect(s.chainNote).toMatch(/suppliers and customers only/);
  });
  it("a name lights itself and its second-order names; in the chain, its pathway to the company and what is beyond it", () => {
    const s = resolveIsolation({ kind: "node", node: "supplier:TSM" }, withChain)!;
    expect(s.label).toBe("TSMC");
    expect(keys(s.lit)).toEqual([asml.key, tsm.key].sort());
    expect(s.path).toEqual(["TSM", "NVDA"]);
    expect(keys(s.chainNodes)).toEqual(["ASML", "ENTG", "NVDA", "TSM"]);
    expect(keys(s.chainEdges)).toEqual(["ASML>TSM", "ENTG>TSM", "TSM>NVDA"]);
  });
  it("a second-order name keeps its parent lit, so the pathway to the company stays whole", () => {
    const s = resolveIsolation({ kind: "node", node: asml.key }, withChain)!;
    expect(s.label).toBe("ASML via TSMC");
    expect(keys(s.lit)).toEqual([asml.key, tsm.key].sort());
    expect(s.path).toEqual(["ASML", "TSM", "NVDA"]);
    const down = resolveIsolation({ kind: "node", node: orcl.key }, withChain)!;
    expect(keys(down.lit)).toEqual([hpe.key, orcl.key].sort());
    expect(down.path).toEqual(["NVDA", "HPE", "ORCL"]);
  });
  it("a name that is not a supplier or customer leaves the chain whole", () => {
    const s = resolveIsolation({ kind: "node", node: "competitor:AMD" }, withChain)!;
    expect(keys(s.lit)).toEqual([amd.key]);
    expect(s.chainNodes).toBeNull();
    expect(s.chainNote).toBe("AMD is not in the chain as drawn");
  });
  it("a pathway lights its names on the map by side and tier, and its links in the chain", () => {
    const s = resolveIsolation({ kind: "path", keys: ["ASML", "TSM", "NVDA", "HPE", "ORCL"] }, withChain)!;
    expect(s.label).toBe("ASML to Oracle");
    expect(keys(s.lit)).toEqual([asml.key, tsm.key, hpe.key, orcl.key].sort());
    expect(s.path).toEqual(["ASML", "TSM", "NVDA", "HPE", "ORCL"]);
    expect(keys(s.chainEdges)).toEqual(["ASML>TSM", "HPE>ORCL", "NVDA>HPE", "TSM>NVDA"]);
    // without the chain (Network or Globe open) the same address still lights the same names
    const onMap = resolveIsolation({ kind: "path", keys: ["ASML", "TSM", "NVDA", "HPE", "ORCL"] }, map)!;
    expect(keys(onMap.lit)).toEqual(keys(s.lit));
    expect(onMap.label).toBe("ASML to Oracle");
    expect(onMap.chainNodes).toBeNull();
  });
  it("a pathway that ends at the company is named to the company", () => {
    expect(resolveIsolation({ kind: "path", keys: ["TSM", "NVDA"] }, withChain)!.label).toBe("TSMC to NVIDIA");
    expect(resolveIsolation({ kind: "path", keys: ["NVDA", "MSFT"] }, map)!.label).toBe("NVIDIA to Microsoft");
  });
  it("a tier the map does not draw is lit in the chain only", () => {
    const s = resolveIsolation({ kind: "path", keys: ["ENTG", "TSM", "NVDA"] }, withChain)!;
    expect(keys(s.lit)).toEqual([tsm.key]);
    expect(s.path).toEqual(["ENTG", "TSM", "NVDA"]);
  });
  it("a pathway through a second-order name has the same label in Chain, Network and Globe, at either depth (supply-globe-M6)", () => {
    const names = { ENTG: "Entegris", TSM: "TSMC", NVDA: "NVIDIA" };
    const entg = hop(tsm, "Entegris, Inc.", "ENTG");
    const iso: Isolation = { kind: "path", keys: ["ENTG", "TSM", "NVDA"] };
    const inChain = resolveIsolation(iso, { ...withChain, names })!;
    const depth1 = resolveIsolation(iso, { ...map, names, mapDepth: 1 })!;
    const depth2 = resolveIsolation(iso, { ...map, hop2: [...hop2, entg], names, mapDepth: 2 })!;
    expect(inChain.label).toBe("Entegris to NVIDIA");
    expect(depth1.label).toBe(inChain.label);
    expect(depth2.label).toBe(inChain.label);
    // the map at depth 1 does not draw Entegris: it says so and names the depth that does
    expect(depth1.needsDepth).toEqual({ depth: 2, name: "Entegris" });
    expect(keys(depth1.lit)).toEqual([tsm.key]);
    expect(depth2.needsDepth).toBeNull();
    expect(keys(depth2.lit)).toEqual([entg.key, tsm.key].sort());
    expect(inChain.needsDepth).toBeNull();
  });
  it("a key that resolves to nothing is dropped before labelling (supply-globe-L2)", () => {
    const s = resolveIsolation({ kind: "path", keys: ["TSM", "NVDA", "HPE?dark=1"] }, withChain)!;
    expect(s.label).toBe("TSMC to NVIDIA");
    expect(s.path).toEqual(["TSM", "NVDA"]);
    expect(resolveIsolation({ kind: "path", keys: ["TSM", "NVDA", "HPE?dark=1"] }, map)!.label).toBe("TSMC to NVIDIA");
  });
  it("names the page does not show isolate nothing", () => {
    expect(resolveIsolation({ kind: "node", node: "supplier:Samsung" }, withChain)).toBeNull();
    expect(resolveIsolation({ kind: "path", keys: ["XXXX", "NVDA"] }, withChain)).toBeNull();
    expect(resolveIsolation(null, withChain)).toBeNull();
  });
});

describe("requests from the views", () => {
  it("the same relation or name twice clears; clear always clears", () => {
    const a = nextIsolation(null, { kind: "relation", relation: "supplier" }, map);
    expect(a).toEqual({ kind: "relation", relation: "supplier" });
    expect(nextIsolation(a, { kind: "relation", relation: "supplier" }, map)).toBeNull();
    expect(nextIsolation(a, { kind: "relation", relation: "customer" }, map)).toEqual({ kind: "relation", relation: "customer" });
    const n = nextIsolation(a, { kind: "node", key: tsm.key }, map);
    expect(n).toEqual({ kind: "node", node: "supplier:TSM" });
    expect(nextIsolation(n, { kind: "node", key: tsm.key }, map)).toBeNull();
    expect(nextIsolation(n, { kind: "clear" }, map)).toBeNull();
    // a key the page does not show changes nothing
    expect(nextIsolation(n, { kind: "node", key: "supplier:nobody" }, map)).toBe(n);
  });
  it("map keys become one pathway through the company: a supplier and a customer, or a second-order name with its parent", () => {
    expect(canonicalPath([tsm.key, msft.key], map)).toEqual(["TSM", "NVDA", "MSFT"]);
    expect(canonicalPath([msft.key, tsm.key], map)).toEqual(["TSM", "NVDA", "MSFT"]);
    expect(canonicalPath([asml.key], map)).toEqual(["ASML", "TSM", "NVDA"]);
    expect(canonicalPath([orcl.key, kioxia.key], map)).toEqual(["kioxia", "NVDA", "HPE", "ORCL"]);
    // partners and competitors are not on a pathway
    expect(canonicalPath([arm.key, amd.key], map)).toEqual([]);
    expect(nextIsolation(null, { kind: "path", keys: [tsm.key, msft.key] }, map)).toEqual({ kind: "path", keys: ["TSM", "NVDA", "MSFT"] });
    expect(nextIsolation(null, { kind: "path", keys: [arm.key] }, map)).toBeNull();
  });
  it("a chain key alone brings the names between it and the company", () => {
    expect(canonicalPath(["ENTG"], withChain)).toEqual(["ENTG", "TSM", "NVDA"]);
    expect(canonicalPath(["ORCL"], withChain)).toEqual(["NVDA", "HPE", "ORCL"]);
  });
});

describe("pathways in the chain", () => {
  it("runs from a node to the company along the links that placed it, upstream to downstream", () => {
    expect(chainPath(chain, "ENTG")).toEqual(["ENTG", "TSM", "NVDA"]);
    expect(chainPath(chain, "ORCL")).toEqual(["NVDA", "HPE", "ORCL"]);
    expect(chainPath(chain, "NVDA")).toEqual(["NVDA"]);
    expect(chainPath(chain, "nobody")).toEqual([]);
  });
  it("a clicked link is on its own pathway even when it did not place a node", () => {
    expect(chainEdgePath(chain, { from: "ENTG", to: "kioxia" })).toEqual(["ENTG", "kioxia", "NVDA"]);
    expect(chainEdgePath(chain, { from: "ENTG", to: "TSM" })).toEqual(["ENTG", "TSM", "NVDA"]);
    expect(chainEdgePath(chain, { from: "HPE", to: "ORCL" })).toEqual(["NVDA", "HPE", "ORCL"]);
    expect(chainEdgePath(chain, { from: "NVDA", to: "MSFT" })).toEqual(["NVDA", "MSFT"]);
  });
  it("a supplier then a customer make one pathway; a new pick replaces its own half; the same pick drops it", () => {
    const a = joinPath(null, ["ENTG", "TSM", "NVDA"], "NVDA");
    expect(a).toEqual(["ENTG", "TSM", "NVDA"]);
    const b = joinPath(a, ["NVDA", "HPE", "ORCL"], "NVDA");
    expect(b).toEqual(["ENTG", "TSM", "NVDA", "HPE", "ORCL"]);
    expect(joinPath(b, ["kioxia", "NVDA"], "NVDA")).toEqual(["kioxia", "NVDA", "HPE", "ORCL"]);
    expect(joinPath(b, ["ENTG", "TSM", "NVDA"], "NVDA")).toEqual(["NVDA", "HPE", "ORCL"]);
    expect(joinPath(["NVDA", "MSFT"], ["NVDA", "MSFT"], "NVDA")).toBeNull();
    // through the request handler, as the Chain view raises it
    const first = nextIsolation(null, { kind: "path", keys: chainPath(chain, "TSM") }, withChain);
    expect(nextIsolation(first, { kind: "path", keys: chainPath(chain, "MSFT") }, withChain)).toEqual({ kind: "path", keys: ["TSM", "NVDA", "MSFT"] });
    expect(nextIsolation(first, { kind: "path", keys: chainPath(chain, "TSM") }, withChain)).toBeNull();
  });
  it("lists the links of a pathway in order, with the stated link when there is one", () => {
    const hops = pathHops(chain, ["ENTG", "TSM", "NVDA", "HPE"]);
    expect(hops.map((h) => `${h.from.name} > ${h.to.name}`)).toEqual(["Entegris > TSMC", "TSMC > NVIDIA", "NVIDIA > Hewlett Packard Enterprise"]);
    expect(hops.every((h) => h.edge != null)).toBe(true);
    expect(pathHops(chain, ["ASML", "kioxia"])[0].edge).toBeNull();
  });
});

describe("tables follow the isolation", () => {
  it("keeps every row when nothing is isolated, lit names otherwise, and a relation's rows even when the name left the map", () => {
    expect(isolatedHas(null, { key: "anything" })).toBe(true);
    const rel = resolveIsolation({ kind: "relation", relation: "supplier" }, map)!;
    expect(isolatedHas(rel, { key: tsm.key, relation: "supplier" })).toBe(true);
    expect(isolatedHas(rel, { key: "supplier:dropped-last-year", relation: "supplier" })).toBe(true);
    expect(isolatedHas(rel, { key: msft.key, relation: "customer" })).toBe(false);
    const one = resolveIsolation({ kind: "node", node: "supplier:TSM" }, map)!;
    expect(isolatedHas(one, { key: tsm.key, relation: "supplier" })).toBe(true);
    expect(isolatedHas(one, { key: kioxia.key, relation: "supplier" })).toBe(false);
  });
});

describe("an isolation opened from an address with another parameter (p7-map5 item 3)", () => {
  /* the preview's hash router hands the page `iso=rel:supplier?x=1` when the address has `?x=1` before the hash; a shared
     link with a tracking tag added after a second "?" arrives the same way. Before the fix rel: and node: read as nothing. */
  it("reads the isolation and ignores what follows a stray ? or #", () => {
    for (const [raw, want] of [
      ["rel:supplier?x=1", { kind: "relation", relation: "supplier" }],
      ["rel:customer?utm_source=newsletter&utm_medium=email", { kind: "relation", relation: "customer" }],
      ["node:supplier:TSM?dark=1", { kind: "node", node: "supplier:TSM" }],
      ["path:TSM>NVDA>HPE#evidence", { kind: "path", keys: ["TSM", "NVDA", "HPE"] }],
    ] as const) expect(parseIsolation(raw)).toEqual(want);
  });
  it("the page's search schema strips the tail from every value, whichever comes last", () => {
    const s = supplySearch.parse({ t: "NVDA?x=1", view: "chain?x=1", iso: "rel:supplier?x=1", sel: "supplier:TSM#a", extra: "1" });
    expect(s).toMatchObject({ t: "NVDA", view: "chain", iso: "rel:supplier", sel: "supplier:TSM" });
    expect(supplySearch.parse({ t: "NVDA", iso: "node:supplier:TSM" })).toMatchObject({ t: "NVDA", iso: "node:supplier:TSM" });
    expect(supplySearch.parse({ depth: "2?x=1" }).depth).toBe(2);
  });
});
