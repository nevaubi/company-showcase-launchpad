// What the hover card, the cards and the group headers of the supply-chain views say about a name.
// Pure (no browser/Node APIs) so the Network and Globe views describe a counterparty the same way.
import { copies, isTradeLink, linkDollarsFrom, nodeNature, statedAmounts, type GraphNode, type HopNode, type NodeRisk, type Relation, type RiskLink, type SharePeriod, type StatedAmount } from "./core";
import type { AmountKind, LinkNature } from "./claims";

/** What a stated amount is, in plain words. */
export const KIND_WORD: Record<AmountKind, string> = {
  revenue: "revenue", purchases: "purchases", contract: "contract value",
  commitment: "commitment", investment: "investment", financing: "financing", guarantee: "guarantee",
  settlement: "settlement", balance: "balance", other: "other figure",
};
/** What a tie that is not trade is, in plain words; null for trade. */
export const NATURE_WORD: Record<LinkNature, string | null> = { trade: null, unknown: null, financial: "Financing tie", corporate: "Acquisition or sale", regulatory: "Regulator" };

/** A figure with what it is: a flow can be summed and drawn as width; any other stated figure is only shown. */
export interface Figure { value: number; kind: AmountKind; flow: boolean }

/** Facts about one counterparty, read from the filing links behind it. */
export interface NodeFacts {
  relation: Relation;
  hop: 1 | 2;
  /** number of filing statements behind the name */
  statements: number;
  /** largest stated share of revenue or purchases, null when none is stated */
  share: number | null;
  /** largest stated flow (revenue, purchases, contract value) its sentence states; null when none */
  flow: Figure | null;
  /** largest stated figure that is not a flow (guarantee, investment, financing...): shown with its kind, never summed */
  other: Figure | null;
  /** the product or service the filings name most often */
  product: string | null;
  /** one line for a card: the product, else the newest statement's summary of the tie */
  summary: string | null;
  singleSource: boolean;
  /** dependency flagged without sole-source wording */
  dependency: boolean;
  /** the tie is not trade: financing, an acquisition or sale, a regulator */
  nature: LinkNature;
  /** current filings that state the tie (10-K and 10-Q copies count once as a link, here each filing counts) */
  filings: number;
  hotspots: string[];
  /** start of the newest quoted sentence, cut at a word */
  excerpt: string;
  form: string;
  filed: string;
}

type Linked = Pick<GraphNode, "relation" | "links"> & Partial<Pick<HopNode, "hop">>;
type ProductLink = RiskLink & { product?: string | null };

/** The start of a sentence, cut at a word boundary with an ellipsis, so a hover card stays two or three lines. */
export function excerpt(text: string, max = 150): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.(-]+$/, "")}…`;
}

export function nodeFacts(node: Linked, risk?: NodeRisk): NodeFacts {
  const links = node.links as ProductLink[];
  const newest = [...links].sort((a, b) => b.filed.localeCompare(a.filed) || a.id.localeCompare(b.id))[0];
  const tally = new Map<string, number>();
  for (const l of links) {
    const p = l.product?.trim();
    if (p) tally.set(p, (tally.get(p) ?? 0) + 1);
  }
  const product = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const rows = links.flatMap((l) => copies(l));
  const amounts = statedAmounts(links);
  const pick = (a: StatedAmount | undefined): Figure | null => (a ? { value: a.value, kind: a.kind, flow: a.flow } : null);
  const share = Math.max(0, ...rows.map((l) => l.share_pct ?? 0));
  // competition is not a flow either way: a sentence about a rival's FDA approval does not make the rival a regulator
  const nature = node.relation === "competitor" ? "trade" : (risk?.nature ?? nodeNature(links));
  return {
    relation: node.relation as Relation,
    hop: node.hop === 2 ? 2 : 1,
    statements: links.length,
    share: share > 0 ? share : null,
    flow: nature === "trade" || nature === "unknown" ? pick(amounts.find((a) => a.flow)) : null,
    other: pick(amounts.find((a) => !a.flow)),
    product,
    summary: product ?? (newest?.detail?.trim() || null),
    singleSource: risk?.singleSource ?? rows.some((l) => !!l.single_source),
    dependency: risk?.dependency ?? (!rows.some((l) => !!l.single_source) && rows.some((l) => !!l.dependency)),
    nature,
    filings: new Set(rows.map((l) => l.accn)).size,
    hotspots: risk?.hotspots ?? [],
    excerpt: newest ? excerpt(newest.quote ?? "") : "",
    form: newest?.form ?? "",
    filed: newest?.filed ?? "",
  };
}

/**
 * What a relation group's header states: how many names, how many carry a stated share or flow, the largest share, the sum
 * of each name's largest stated flow, and how many names carry only other figures (not added).
 */
export interface GroupTotals { names: number; quantified: number; maxShare: number | null; flows: number | null; others: number }
export function groupTotals(nodes: Linked[]): GroupTotals {
  let quantified = 0, top = 0, flows = 0, any = false, others = 0;
  for (const n of nodes) {
    const f = nodeFacts(n);
    if (f.share != null || f.flow != null) quantified++;
    else if (f.other != null) others++;
    if (f.share != null) top = Math.max(top, f.share);
    if (f.flow != null) { flows += f.flow.value; any = true; }
  }
  return { names: nodes.length, quantified, maxShare: top > 0 ? top : null, flows: any ? flows : null, others };
}

/** True when a name's links carry at least one trade tie (so it is drawn as a flow). */
export const isTradeNode = (n: Pick<GraphNode, "links">): boolean => (n.links as RiskLink[]).some(isTradeLink);

/** One name's dollar exposure and the sentence it comes from. */
export interface ExposureRow { n: GraphNode; l: RiskLink; d: number; from: "flow" | "share"; period?: SharePeriod }
/**
 * What the "Disclosed $ exposure" tile and the Exposure tab show: each name once, at its largest stated flow (revenue,
 * purchases, contract value) or stated customer share × SEC revenue, largest first, and apart from it every other stated
 * figure (guarantees, investments, financing, commitments, settlements, balances), which is never added.
 */
export function exposureSummary(graph: GraphNode[], revenue: Record<string, number | undefined>): { exposure: ExposureRow[]; total: number; others: { n: GraphNode; a: StatedAmount }[] } {
  const exposure: ExposureRow[] = [];
  for (const n of graph) {
    let best: ExposureRow | null = null;
    for (const l of n.links as RiskLink[]) {
      const x = linkDollarsFrom(l, revenue);
      if (x && (!best || x.dollars > best.d)) best = { n, l: x.link, d: x.dollars, from: x.from, period: x.period };
    }
    if (best) exposure.push(best);
  }
  exposure.sort((a, b) => b.d - a.d);
  const others = graph.flatMap((n) => statedAmounts(n.links as RiskLink[]).filter((a) => !a.flow).map((a) => ({ n, a }))).sort((x, y) => y.a.value - x.a.value);
  return { exposure, total: exposure.reduce((t, x) => t + x.d, 0), others };
}
