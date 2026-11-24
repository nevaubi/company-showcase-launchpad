// Pure geometry for the Chain view: one column per tier (suppliers' suppliers on the left, the company in the middle,
// customers' customers on the right), names stacked down each column and centred on the tallest one. A name beyond the
// first tier sits near the name that brought it into the chain, so a pathway reads as a short line rather than a tangle.
// No browser/Node APIs, so the geometry is unit-tested.
import type { Chain, ChainEdge, ChainNode } from "./chain";

/**
 * Geometry in px: `box` is a node's height (two lines: name, ticker), `step` the distance between two rows, `head` the
 * tier labels' band. The gutter between two columns is kept before the box width: it holds the lines and the figure of
 * each link, so a box narrows first (down to `boxMin`; under `compact` it shows the ticker alone).
 */
export const CHAIN = { box: 44, step: 52, head: 34, pad: 10, boxMax: 208, boxMin: 72, compact: 96, gutterMin: 44, wMin: 1.25, wMax: 9 } as const;

export interface ChainColumn { tier: number; x: number; w: number; count: number }
export interface ChainBox { key: string; x: number; y: number; w: number; h: number; tier: number }
export interface ChainLayout { width: number; height: number; boxW: number; columns: ChainColumn[]; boxes: Map<string, ChainBox> }

export function layoutChain(chain: Chain, width: number): ChainLayout {
  const tiers = chain.tiers.length ? chain.tiers : [0];
  const colW = width / tiers.length;
  const boxW = Math.max(CHAIN.boxMin, Math.min(CHAIN.boxMax, Math.floor(colW - CHAIN.gutterMin)));
  const byTier = new Map<number, ChainNode[]>(tiers.map((t) => [t, chain.nodes.filter((n) => n.tier === t)]));
  const rows = Math.max(1, ...[...byTier.values()].map((l) => l.length));
  const height = CHAIN.head + rows * CHAIN.step - (CHAIN.step - CHAIN.box) + CHAIN.pad * 2;
  const boxes = new Map<string, ChainBox>();
  /* nearest tiers first, so a name can be ordered by where its parent already sits */
  for (const t of [...tiers].sort((a, b) => Math.abs(a) - Math.abs(b))) {
    const list = byTier.get(t) ?? [];
    const parentY = (n: ChainNode) => (n.via ? (boxes.get(n.via)?.y ?? 0) : 0);
    const order = Math.abs(t) <= 1 ? list : list.map((n, i) => ({ n, i })).sort((a, b) => parentY(a.n) - parentY(b.n) || a.i - b.i).map((x) => x.n);
    const ci = tiers.indexOf(t);
    const y0 = CHAIN.head + CHAIN.pad + ((rows - order.length) * CHAIN.step) / 2;
    order.forEach((n, i) => boxes.set(n.key, { key: n.key, x: Math.round(ci * colW + (colW - boxW) / 2), y: Math.round(y0 + i * CHAIN.step), w: boxW, h: CHAIN.box, tier: t }));
  }
  const columns = tiers.map((t, ci) => ({ tier: t, x: ci * colW, w: colW, count: byTier.get(t)?.length ?? 0 }));
  return { width, height, boxW, columns, boxes };
}

/** Legal-form words at the end of a name that say nothing in a 100 px box ("Inc.", "Corporation", "Co., Ltd."). */
const LEGAL_TAIL = /(?:[,\s]+(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.?l\.?c|plc|p\.?l\.?c|n\.?v|s\.?a|s\.?e|ag|gmbh|lp|l\.?p|sa\/nv|k\.?k)\.?)+$/i;

/**
 * The name written in a chain box: a covered company's short name when there is one, else the stated name without
 * its trailing legal form. The full name stays in the box's accessible name and title.
 */
export function boxName(name: string, shortName?: string | null): string {
  if (shortName && shortName.trim()) return shortName.trim();
  const t = name.trim().replace(LEGAL_TAIL, "").trim();
  return t || name.trim();
}

/** Room for text in a chain box of width `w`: the 20 px logo, its gap, the padding and the lock mark taken off. */
const BOX_CHROME = 48;
/** Average advance of a 12 px medium sans character, rounded up so a borderline name counts as cut. */
const CHAR_PX = 6.9;
/** Whether a name fits on one line of a chain box without being cut. */
export function nameFits(name: string, w: number): boolean {
  return name.length * CHAR_PX <= w - BOX_CHROME;
}

export type ChainSizeBasis = "share" | "dollars";
/** What a line's width shows: the stated share, or dollars on a square-root scale so one very large flow does not flatten the rest. Unsized links get the thinnest line. */
export function edgeWidth(e: Pick<ChainEdge, "share" | "dollars">, basis: ChainSizeBasis, maxDollars: number): { width: number; sized: boolean } {
  if (basis === "dollars") {
    if (e.dollars == null || !(maxDollars > 0)) return { width: CHAIN.wMin, sized: false };
    return { width: 2 + (CHAIN.wMax - 2) * Math.sqrt(Math.min(1, e.dollars / maxDollars)), sized: true };
  }
  if (e.share == null) return { width: CHAIN.wMin, sized: false };
  return { width: Math.max(2, Math.min(CHAIN.wMax, 2 + (CHAIN.wMax - 2) * (Math.min(e.share, 100) / 100) ** 0.6)), sized: true };
}

/** The curve of a link between two boxes, and where its figure is written: at the end where the lines fan out, so labels of links sharing a node do not stack. */
export function edgePath(a: ChainBox, b: ChainBox, labelAtTarget: boolean): { d: string; lx: number; ly: number; anchor: "start" | "end" } {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
  return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lx: labelAtTarget ? x2 - 6 : x1 + 6, ly: (labelAtTarget ? y2 : y1) - 5, anchor: labelAtTarget ? "end" : "start" };
}
