import { describe, expect, it } from "vitest";
import type { Chain, ChainNode } from "./chain";
import { CHAIN, edgePath, edgeWidth, layoutChain } from "./chain-layout";

const n = (key: string, tier: number, via: string | null): ChainNode => ({ key, name: key, ticker: key, tier, via });
const chain: Chain = {
  focus: "F",
  nodes: [n("F", 0, null), n("S1", -1, "F"), n("S2", -1, "F"), n("S3", -1, "F"), n("C1", 1, "F"), n("C2", 1, "F"),
    // listed against the order of their parents: T2b belongs to S1 (top), T2a to S3 (bottom)
    n("T2a", -2, "S3"), n("T2b", -2, "S1"), n("D2", 2, "C2")],
  edges: [],
  tiers: [-2, -1, 0, 1, 2],
};
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("layoutChain", () => {
  const L = layoutChain(chain, 1000);
  const box = (k: string) => L.boxes.get(k)!;
  it("gives each tier a column in order, upstream on the left", () => {
    expect(L.columns.map((c) => c.tier)).toEqual([-2, -1, 0, 1, 2]);
    expect(box("T2a").x).toBeLessThan(box("S1").x);
    expect(box("S1").x).toBeLessThan(box("F").x);
    expect(box("F").x).toBeLessThan(box("C1").x);
    expect(box("C1").x).toBeLessThan(box("D2").x);
    expect(L.columns.find((c) => c.tier === -1)!.count).toBe(3);
  });
  it("never overlaps two names, keeps a gutter between columns for the lines, and stays inside the frame", () => {
    const all = [...L.boxes.values()];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
    for (const b of all) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(L.width); expect(b.y).toBeGreaterThanOrEqual(CHAIN.head); expect(b.y + b.h).toBeLessThanOrEqual(L.height); }
    expect(box("F").x - (box("S1").x + box("S1").w)).toBeGreaterThanOrEqual(CHAIN.gutterMin);
  });
  it("centres shorter columns on the tallest, so the company sits level with the middle of its suppliers", () => {
    const mid = (k: string) => box(k).y + box(k).h / 2;
    expect(mid("F")).toBe(mid("S2"));
  });
  it("orders a far tier by where its parents sit, so pathways do not cross needlessly", () => {
    expect(box("T2b").y).toBeLessThan(box("T2a").y);
  });
  it("beside the evidence panel (a 736 px frame) five tiers keep the gutter a share label needs and a two-line box", () => {
    const beside = layoutChain(chain, 736);
    const s = beside.boxes.get("S1")!, f = beside.boxes.get("F")!;
    expect(f.x - (s.x + s.w)).toBeGreaterThanOrEqual(CHAIN.gutterMin);
    expect(beside.boxW).toBeGreaterThanOrEqual(CHAIN.compact);
  });
  it("keeps names readable in a narrow frame and survives an empty chain", () => {
    const narrow = layoutChain(chain, 640);
    expect(narrow.boxW).toBeGreaterThanOrEqual(CHAIN.boxMin);
    const empty = layoutChain({ focus: "F", nodes: [n("F", 0, null)], edges: [], tiers: [0] }, 800);
    expect(empty.boxes.size).toBe(1);
    expect(empty.height).toBeGreaterThan(CHAIN.head);
  });
});

describe("line width", () => {
  it("grows with the stated share and never exceeds the widest line; a link with no share is the thinnest", () => {
    const w = (share: number | null) => edgeWidth({ share, dollars: null }, "share", 0);
    expect(w(null)).toEqual({ width: CHAIN.wMin, sized: false });
    expect(w(5).width).toBeLessThan(w(20).width);
    expect(w(20).width).toBeLessThan(w(91).width);
    expect(w(100).width).toBeLessThanOrEqual(CHAIN.wMax);
    expect(w(1).width).toBeGreaterThan(CHAIN.wMin);
  });
  it("in dollars, scales on a square root of the largest flow drawn", () => {
    const w = (dollars: number | null) => edgeWidth({ share: 50, dollars }, "dollars", 4e9);
    expect(w(null).sized).toBe(false);
    expect(w(4e9).width).toBe(CHAIN.wMax);
    expect(w(1e9).width).toBeCloseTo(2 + (CHAIN.wMax - 2) / 2, 5);
  });
  it("writes a link's figure at the chosen end, just off the box", () => {
    const a = { key: "a", x: 0, y: 100, w: 100, h: 36, tier: -1 }, b = { key: "b", x: 300, y: 200, w: 100, h: 36, tier: 0 };
    expect(edgePath(a, b, false)).toMatchObject({ lx: 106, anchor: "start" });
    expect(edgePath(a, b, true)).toMatchObject({ lx: 294, anchor: "end" });
    expect(edgePath(a, b, false).d.startsWith("M100,118")).toBe(true);
  });
});
