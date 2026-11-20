// Pure layout for the supply-chain network view: suppliers on the left feed the company in the middle,
// which feeds customers on the right. Partners and competitors are not flows, so they sit in a second row
// under the company. Second-order names hang under the first-order name they belong to. No browser/Node APIs, so the geometry is unit-tested.
import { maxShare, type GraphNode, type HopNode, type NodeRisk, type Relation } from "./core";

export interface NetCard {
  key: string;
  node: GraphNode | HopNode;
  relation: Relation;
  hop: 1 | 2;
  x: number; y: number; w: number; h: number;
  /** largest stated share of revenue or purchases, 0 when none is stated */
  share: number;
  /** stated dollars, or stated share × SEC revenue; null when the filing gives neither */
  dollars: number | null;
}
export interface NetBand {
  key: string;
  relation: Relation;
  hop: 1 | 2;
  /** SVG path, drawn as a stroke of `t` px */
  d: string;
  t: number;
}
export interface NetMore { relation: Relation; x: number; y: number; w: number; h: number; hidden: number }
export interface NetHeader { relation: Relation; x: number; y: number; w: number; shown: number; total: number }
/** A flow column with no names (the relation is shown but the filings name none): a quiet placeholder keeps the picture balanced and says so. */
export interface NetEmpty { relation: "supplier" | "customer"; x: number; y: number; w: number; h: number }
export interface NetLayout {
  width: number; height: number;
  focus: { x: number; y: number; w: number; h: number };
  cards: NetCard[];
  bands: NetBand[];
  more: NetMore[];
  headers: NetHeader[];
  empty: NetEmpty[];
  /** what band width stands for on each side, so the caption can say it */
  basis: { supplier: Basis; customer: Basis };
}
export type Basis = "dollars" | "share" | "none";

/** Geometry in px. `card` holds two lines (name, then product); `cell` is a one-line card in the second row; `child` a second-order name. */
export const NET = { head: 30, card: 44, cell: 32, child: 28, gap: 6, indent: 16, gutter: 72, rowGap: 40, pad: 4, minFocus: 176, maxFocus: 360, focusMin: 168, focusMax: 232, tMin: 2, tMax: 18 } as const;

const isHop2 = (n: GraphNode | HopNode): n is HopNode => (n as HopNode).hop === 2;
const weight = (c: { dollars: number | null; share: number; node: { links: unknown[] } }) => [c.dollars ?? 0, c.share, c.node.links.length] as const;
const byWeight = (a: NetCard, b: NetCard) => {
  const x = weight(a), y = weight(b);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || a.node.name.localeCompare(b.node.name);
};

/** What band width means on one side: dollars when any name has them, else stated shares, else nothing (all bands equal). */
export function sideBasis(cards: Pick<NetCard, "dollars" | "share">[]): Basis {
  if (cards.some((c) => (c.dollars ?? 0) > 0)) return "dollars";
  if (cards.some((c) => c.share > 0)) return "share";
  return "none";
}
/** Band thickness on a square-root scale so one very large customer does not flatten the rest. */
export function bandWidths(cards: Pick<NetCard, "dollars" | "share">[], basis: Basis): number[] {
  const v = cards.map((c) => (basis === "dollars" ? c.dollars ?? 0 : basis === "share" ? c.share : 0));
  const max = Math.max(0, ...v);
  return v.map((x) => (max > 0 && x > 0 ? NET.tMin + (NET.tMax - NET.tMin) * Math.sqrt(x / max) : NET.tMin));
}

export interface NetworkInput {
  graph: GraphNode[];
  hop2: HopNode[];
  visible: Set<Relation>;
  risks: Record<string, NodeRisk>;
  /** inner width of the drawing area in px */
  width: number;
  /** names shown per relation before "show more"; null shows every name */
  limit: number | null;
  /** relations whose full list is shown regardless of `limit` */
  expanded?: ReadonlySet<Relation>;
}

export function layoutNetwork({ graph, hop2, visible, risks, width, limit, expanded }: NetworkInput): NetLayout {
  const W = Math.max(560, Math.floor(width));
  /* the company column is narrower than the two flow columns, so long counterparty names keep their room */
  const focusW = Math.round(Math.min(NET.focusMax, Math.max(NET.focusMin, W * 0.2)));
  const colW = Math.floor((W - 2 * NET.gutter - focusW) / 2);
  const xLeft = 0, xMid = colW + NET.gutter, xRight = W - colW;
  const top = NET.head + NET.gap;

  const first = (r: Relation): NetCard[] =>
    (visible.has(r) ? graph.filter((n) => n.relation === r) : [])
      .map((node) => ({ key: node.key, node, relation: r, hop: 1 as const, x: 0, y: 0, w: colW, h: NET.card, share: maxShare(node), dollars: risks[node.key]?.dollars ?? null }))
      .sort(byWeight);
  const cut = (list: NetCard[], r: Relation) => (limit == null || expanded?.has(r) || list.length <= limit ? list : list.slice(0, limit));
  const kids = (parent: string, r: Relation): NetCard[] =>
    hop2.filter((n) => isHop2(n) && n.parent === parent)
      .map((node) => ({ key: node.key, node, relation: r, hop: 2 as const, x: 0, y: 0, w: colW - NET.indent, h: NET.child, share: maxShare(node), dollars: risks[node.key]?.dollars ?? null }))
      .sort(byWeight);

  const cards: NetCard[] = [], bands: NetBand[] = [], more: NetMore[] = [], headers: NetHeader[] = [], empty: NetEmpty[] = [];

  /** One outer column: first-order cards with their second-order names indented underneath. Returns the y after the last row. */
  const column = (r: "supplier" | "customer", x: number): { shown: NetCard[]; end: number } => {
    const all = first(r), shown = cut(all, r);
    let y = top;
    for (const c of shown) {
      c.x = x; c.y = y; cards.push(c);
      y += NET.card + NET.gap;
      const children = kids(c.key, r);
      for (const k of children) {
        k.x = x + NET.indent; k.y = y; cards.push(k);
        const px = x + NET.indent / 2, py = c.y + c.h, ky = k.y + k.h / 2;
        bands.push({ key: k.key, relation: r, hop: 2, d: `M${px} ${py}V${ky}H${k.x}`, t: 1.2 });
        y += NET.child + NET.gap;
      }
    }
    if (all.length > shown.length) { more.push({ relation: r, x, y, w: colW, h: NET.child, hidden: all.length - shown.length }); y += NET.child + NET.gap; }
    if (all.length) headers.push({ relation: r, x, y: 0, w: colW, shown: shown.length, total: all.length });
    else if (visible.has(r) && graph.length) { empty.push({ relation: r, x, y: top, w: colW, h: NET.card }); y += NET.card + NET.gap; }
    return { shown, end: y };
  };
  const left = column("supplier", xLeft), right = column("customer", xRight);

  /* band thickness, and the height the middle card needs to take every band on its two edges */
  const basis = { supplier: sideBasis(left.shown), customer: sideBasis(right.shown) };
  const tL = bandWidths(left.shown, basis.supplier), tR = bandWidths(right.shown, basis.customer);
  const sum = (t: number[]) => t.reduce((a, b) => a + b, 0);
  const stack = (t: number[], gap = 1) => sum(t) + gap * Math.max(0, t.length - 1);
  const focusH = Math.min(NET.maxFocus, Math.max(NET.minFocus, stack(tL) + 20, stack(tR) + 20));
  /* when a full list does not fit the card's edge, the bands shrink in proportion and the gaps between them close, so the stack never spills past the card */
  const fit = (t: number[]): { w: number[]; gap: number } => {
    const room = focusH - 20;
    if (stack(t) <= room) return { w: t, gap: 1 };
    const total = sum(t);
    return { w: t.map((x) => (x * room) / total), gap: 0 };
  };
  const fL = fit(tL), fR = fit(tR);

  /* the company sits level with the middle of the taller side column */
  const sideEnd = Math.max(left.end, right.end, top);
  const focusY = Math.max(top, Math.round(top + (sideEnd - top - focusH) / 2));
  const focus = { x: xMid, y: focusY, w: focusW, h: focusH };

  /* partners and competitors are not flows: they sit in a second row under the company, side by side */
  const rowY = Math.max(sideEnd, focusY + focusH + NET.gap) + NET.rowGap;
  const partners = cut(first("partner"), "partner"), competitors = cut(first("competitor"), "competitor");
  const both = first("partner").length > 0 && first("competitor").length > 0;
  const group = (r: "partner" | "competitor", shown: NetCard[], x0: number, gw: number): { end: number; cx: number } => {
    const all = first(r);
    if (!all.length) return { end: rowY, cx: x0 + gw / 2 };
    const cols = Math.max(1, Math.min(both ? 2 : 4, Math.floor((gw + NET.gap) / (150 + NET.gap))));
    const cw = Math.floor((gw - (cols - 1) * NET.gap) / cols);
    headers.push({ relation: r, x: x0, y: rowY, w: gw, shown: shown.length, total: all.length });
    const y0 = rowY + NET.head + NET.gap;
    const cell = (i: number) => ({ x: x0 + (i % cols) * (cw + NET.gap), y: y0 + Math.floor(i / cols) * (NET.cell + NET.gap) });
    shown.forEach((c, i) => { const at = cell(i); c.x = at.x; c.y = at.y; c.w = cw; c.h = NET.cell; cards.push(c); });
    let n = shown.length;
    if (all.length > shown.length) { const at = cell(n); more.push({ relation: r, x: at.x, y: at.y, w: cw, h: NET.cell, hidden: all.length - shown.length }); n++; }
    /* the connector from the company lands on the group's heading mark */
    return { end: y0 + Math.ceil(n / cols) * (NET.cell + NET.gap), cx: x0 + 4 };
  };
  const half = Math.floor((W - NET.gutter / 2) / 2);
  const gp = group("partner", partners, 0, both ? half : W);
  const gc = group("competitor", competitors, both ? W - half : 0, both ? half : W);
  const hasPartners = partners.length > 0, hasCompetitors = competitors.length > 0;

  /* bands between the outer columns and the company, stacked along its edges in the same order as the cards */
  const attach = (shown: NetCard[], { w, gap }: { w: number[]; gap: number }, side: "supplier" | "customer") => {
    let y = focus.y + (focus.h - stack(w, gap)) / 2;
    shown.forEach((c, i) => {
      const fy = y + w[i] / 2; y += w[i] + gap;
      const cy = c.y + c.h / 2;
      const [x1, y1, x2, y2] = side === "supplier" ? [c.x + c.w, cy, focus.x, fy] : [focus.x + focus.w, fy, c.x, cy];
      const k = (x2 - x1) / 2;
      bands.push({ key: c.key, relation: side, hop: 1, d: `M${x1} ${y1}C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`, t: w[i] });
    });
  };
  attach(left.shown, fL, "supplier");
  attach(right.shown, fR, "customer");
  /* one elbow from the company down to each second-row group */
  const cx = focus.x + focus.w / 2, bend = rowY - NET.rowGap / 2, fb = focus.y + focus.h;
  const land = rowY + 5;
  if (hasPartners) bands.push({ key: "group:partner", relation: "partner", hop: 1, d: `M${cx - 8} ${fb}V${bend}H${gp.cx}V${land}`, t: 1.25 });
  if (hasCompetitors) bands.push({ key: "group:competitor", relation: "competitor", hop: 1, d: `M${cx + 8} ${fb}V${bend}H${gc.cx}V${land}`, t: 1.25 });

  const height = Math.max(sideEnd, fb + NET.gap, hasPartners ? gp.end : 0, hasCompetitors ? gc.end : 0) + NET.pad;
  return { width: W, height, focus, cards, bands, more, headers, empty, basis };
}
