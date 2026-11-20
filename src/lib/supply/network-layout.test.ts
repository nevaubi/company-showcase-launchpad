import { describe, expect, it } from "vitest";
import type { GraphNode, HopNode, NodeRisk, Relation, SupplyLink } from "./core";
import { bandWidths, layoutNetwork, NET, sideBasis } from "./network-layout";

const link = (share: number | null): SupplyLink => ({ id: String(Math.random()), ticker: "NVDA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "supplier", detail: "", share_pct: share, quote: "q", accn: "a", doc: "d", form: "10-K", filed: "2026-02-01" });
const node = (relation: Relation, name: string, share: number | null = null): GraphNode => ({ key: `${relation}:${name}`, name, ticker: null, domain: null, relation, links: [link(share)] });
const risk = (dollars: number | null): NodeRisk => ({ singleSource: false, concentrated: false, hotspots: [], regions: [], dollars });
const ALL = new Set<Relation>(["customer", "supplier", "partner", "competitor"]);

const graph: GraphNode[] = [
  node("supplier", "TSMC"), node("supplier", "SK Hynix"), node("supplier", "Micron"),
  node("customer", "Microsoft", 19), node("customer", "Meta", 11), node("customer", "Dell"),
  node("partner", "Arm"), node("competitor", "AMD"), node("competitor", "Intel"),
];
const hop2: HopNode[] = [{ ...node("supplier", "ASML"), key: "h2:supplier:TSMC:asml", hop: 2, parent: "supplier:TSMC" }];
const risks: Record<string, NodeRisk> = { "customer:Microsoft": risk(40e9), "customer:Meta": risk(22e9), "supplier:TSMC": risk(null) };
const base = { graph, hop2, visible: ALL, risks, width: 900, limit: 12 as number | null };

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("layoutNetwork", () => {
  const L = layoutNetwork(base);
  it("puts suppliers left of the company, customers right of it, and partners and competitors in a row underneath", () => {
    for (const c of L.cards.filter((c) => c.relation === "supplier")) expect(c.x + c.w).toBeLessThanOrEqual(L.focus.x);
    for (const c of L.cards.filter((c) => c.relation === "customer")) expect(c.x).toBeGreaterThanOrEqual(L.focus.x + L.focus.w);
    const sides = L.cards.filter((c) => c.relation === "supplier" || c.relation === "customer");
    const below = Math.max(L.focus.y + L.focus.h, ...sides.map((c) => c.y + c.h));
    for (const c of L.cards.filter((c) => c.relation === "partner" || c.relation === "competitor")) expect(c.y).toBeGreaterThanOrEqual(below);
    const partner = L.cards.find((c) => c.relation === "partner")!, rival = L.cards.find((c) => c.relation === "competitor")!;
    expect(partner.x + partner.w).toBeLessThanOrEqual(rival.x);
  });
  it("never overlaps two cards or a card and the company, and stays inside the frame", () => {
    const boxes = [...L.cards, L.focus];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(L.width); expect(b.y + b.h).toBeLessThanOrEqual(L.height); }
  });
  it("orders each side by stated dollars, then share", () => {
    expect(L.cards.filter((c) => c.relation === "customer").map((c) => c.node.name)).toEqual(["Microsoft", "Meta", "Dell"]);
  });
  it("hangs a second-order name under its parent, indented, with its own connector", () => {
    const parent = L.cards.find((c) => c.key === "supplier:TSMC")!, child = L.cards.find((c) => c.hop === 2)!;
    expect(child.x).toBe(parent.x + NET.indent);
    expect(child.y).toBeGreaterThan(parent.y);
    expect(L.bands.find((b) => b.hop === 2)?.key).toBe(child.key);
  });
  it("draws one band per first-order supplier and customer, sized by the side's basis", () => {
    expect(L.bands.filter((b) => b.hop === 1 && b.relation === "customer")).toHaveLength(3);
    expect(L.bands.filter((b) => b.hop === 1 && b.relation === "supplier")).toHaveLength(3);
    expect(L.basis).toEqual({ supplier: "none", customer: "dollars" });
    const t = Object.fromEntries(L.bands.filter((b) => b.relation === "customer").map((b) => [b.key, b.t]));
    expect(t["customer:Microsoft"]).toBeGreaterThan(t["customer:Meta"]);
    expect(t["customer:Meta"]).toBeGreaterThan(t["customer:Dell"]);
    expect(t["customer:Dell"]).toBe(NET.tMin);
  });
  it("respects the relation toggles", () => {
    const only = layoutNetwork({ ...base, visible: new Set<Relation>(["customer"]) });
    expect(new Set(only.cards.map((c) => c.relation))).toEqual(new Set(["customer"]));
    expect(only.headers.map((h) => h.relation)).toEqual(["customer"]);
  });
  it("caps long lists and reports what is hidden", () => {
    const many = Array.from({ length: 20 }, (_, i) => node("supplier", `S${String(i).padStart(2, "0")}`, 20 - i));
    const capped = layoutNetwork({ ...base, graph: many, hop2: [], limit: 12 });
    expect(capped.cards).toHaveLength(12);
    expect(capped.more).toEqual([expect.objectContaining({ relation: "supplier", hidden: 8 })]);
    expect(capped.headers[0]).toMatchObject({ shown: 12, total: 20 });
    const full = layoutNetwork({ ...base, graph: many, hop2: [], limit: null });
    expect(full.cards).toHaveLength(20);
    expect(full.more).toEqual([]);
    expect(full.height).toBeGreaterThan(capped.height);
  });
  it("keeps every band inside the company card's edge even with many links", () => {
    const many = Array.from({ length: 40 }, (_, i) => node("customer", `C${i}`, 40 - i));
    const full = layoutNetwork({ ...base, graph: many, hop2: [], limit: null });
    const total = full.bands.filter((b) => b.hop === 1).reduce((s, b) => s + b.t, 0);
    expect(total).toBeLessThanOrEqual(full.focus.h);
    expect(full.focus.h).toBeLessThanOrEqual(NET.maxFocus);
  });
  it("gives a lone second-row group the full width", () => {
    const only = layoutNetwork({ ...base, graph: graph.filter((n) => n.relation !== "partner") });
    const rivals = only.cards.filter((c) => c.relation === "competitor");
    expect(rivals[0].x).toBe(0);
    expect(rivals[0].y).toBe(rivals[1].y);
  });
  it("stacks bands inside the company card's edge, gaps included, however long the list", () => {
    for (const n of [12, 60, 150]) {
      const many = Array.from({ length: n }, (_, i) => node("customer", `C${i}`, 5));
      const full = layoutNetwork({ ...base, graph: many, hop2: [], limit: null });
      const ys = full.bands.filter((b) => b.hop === 1).map((b) => ({ y: Number(/C[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+)$/.exec(b.d)?.[1] ?? /^M[\d.-]+ ([\d.-]+)/.exec(b.d)?.[1]), t: b.t }));
      /* customer bands start on the company's right edge: read that y from the path's first point */
      const starts = full.bands.filter((b) => b.hop === 1).map((b) => ({ y: Number(/^M[\d.-]+ ([\d.-]+)/.exec(b.d)![1]), t: b.t }));
      expect(ys).toHaveLength(n);
      expect(Math.min(...starts.map((s) => s.y - s.t / 2))).toBeGreaterThanOrEqual(full.focus.y - 0.01);
      expect(Math.max(...starts.map((s) => s.y + s.t / 2))).toBeLessThanOrEqual(full.focus.y + full.focus.h + 0.01);
    }
  });
  it("expands one relation without touching the others", () => {
    const many = [...Array.from({ length: 20 }, (_, i) => node("supplier", `S${i}`)), ...Array.from({ length: 20 }, (_, i) => node("customer", `C${i}`))];
    const one = layoutNetwork({ ...base, graph: many, hop2: [], limit: 12, expanded: new Set<Relation>(["supplier"]) });
    expect(one.cards.filter((c) => c.relation === "supplier")).toHaveLength(20);
    expect(one.cards.filter((c) => c.relation === "customer")).toHaveLength(12);
    expect(one.more.map((m) => m.relation)).toEqual(["customer"]);
  });
  it("does not draw a second-order name whose parent is cut by the cap or hidden by a toggle", () => {
    const many = Array.from({ length: 14 }, (_, i) => node("supplier", `S${String(i).padStart(2, "0")}`, 20 - i));
    const orphan: HopNode = { ...node("supplier", "Deep"), key: "h2:supplier:S13:deep", hop: 2, parent: "supplier:S13" };
    expect(layoutNetwork({ ...base, graph: many, hop2: [orphan], limit: 12 }).cards.some((c) => c.hop === 2)).toBe(false);
    expect(layoutNetwork({ ...base, graph: many, hop2: [orphan], limit: null }).cards.some((c) => c.hop === 2)).toBe(true);
    expect(layoutNetwork({ ...base, hop2, visible: new Set<Relation>(["customer"]) }).cards.some((c) => c.hop === 2)).toBe(false);
  });
  it("gives every card a unique key and survives a very narrow container", () => {
    const narrow = layoutNetwork({ ...base, width: 120 });
    expect(new Set(narrow.cards.map((c) => c.key)).size).toBe(narrow.cards.length);
    expect(narrow.width).toBe(560);
    for (const c of narrow.cards) expect(c.w).toBeGreaterThan(40);
  });
  it("shows a list of exactly the cap without a more button", () => {
    const exact = layoutNetwork({ ...base, graph: Array.from({ length: 12 }, (_, i) => node("supplier", `S${i}`)), hop2: [], limit: 12 });
    expect(exact.cards).toHaveLength(12);
    expect(exact.more).toEqual([]);
  });
  it("handles an empty graph", () => {
    const empty = layoutNetwork({ ...base, graph: [], hop2: [] });
    expect(empty.cards).toEqual([]);
    expect(empty.bands).toEqual([]);
    expect(empty.height).toBeGreaterThan(0);
  });
});

describe("band sizing", () => {
  it("prefers dollars, then shares, then equal bands", () => {
    expect(sideBasis([{ dollars: null, share: 0 }, { dollars: 5, share: 0 }])).toBe("dollars");
    expect(sideBasis([{ dollars: null, share: 12 }])).toBe("share");
    expect(sideBasis([{ dollars: null, share: 0 }])).toBe("none");
  });
  it("scales on a square root and never goes below the minimum", () => {
    const w = bandWidths([{ dollars: 100, share: 0 }, { dollars: 25, share: 0 }, { dollars: null, share: 0 }], "dollars");
    expect(w[0]).toBe(NET.tMax);
    expect(w[1]).toBeCloseTo(NET.tMin + (NET.tMax - NET.tMin) / 2);
    expect(w[2]).toBe(NET.tMin);
    expect(bandWidths([{ dollars: null, share: 0 }], "none")).toEqual([NET.tMin]);
  });
});
