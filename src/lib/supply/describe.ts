// What the hover card, the cards and the group headers of the supply-chain views say about a name.
// Pure (no browser/Node APIs) so the Network and Globe views describe a counterparty the same way.
import { maxShare, type GraphNode, type HopNode, type NodeRisk, type Relation, type RiskLink } from "./core";

/** Facts about one counterparty, read from the filing links behind it. */
export interface NodeFacts {
  relation: Relation;
  hop: 1 | 2;
  /** number of filing statements behind the name */
  statements: number;
  /** largest stated share of revenue or purchases, null when none is stated */
  share: number | null;
  /**
   * Largest dollar amount written in a quoted sentence, as stated. It can be a purchase commitment, an investment,
   * a guarantee or a programme size, so it is never shown as sales.
   */
  amount: number | null;
  /** the product or service the filings name most often */
  product: string | null;
  /** one line for a card: the product, else the newest statement's summary of the tie */
  summary: string | null;
  singleSource: boolean;
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
  const amounts = links.map((l) => l.amount_usd ?? 0).filter((a) => a > 0);
  const share = maxShare(node as GraphNode);
  return {
    relation: node.relation as Relation,
    hop: node.hop === 2 ? 2 : 1,
    statements: links.length,
    share: share > 0 ? share : null,
    amount: amounts.length ? Math.max(...amounts) : null,
    product,
    summary: product ?? (newest?.detail?.trim() || null),
    singleSource: risk?.singleSource ?? links.some((l) => !!l.single_source),
    hotspots: risk?.hotspots ?? [],
    excerpt: newest ? excerpt(newest.quote ?? "") : "",
    form: newest?.form ?? "",
    filed: newest?.filed ?? "",
  };
}

/** What a relation group's header states: how many names, how many carry a stated share or amount, the largest share and the sum of stated amounts. */
export interface GroupTotals { names: number; quantified: number; maxShare: number | null; stated: number | null }
export function groupTotals(nodes: Linked[]): GroupTotals {
  let quantified = 0, top = 0, stated = 0, any = false;
  for (const n of nodes) {
    const f = nodeFacts(n);
    if (f.share != null || f.amount != null) quantified++;
    if (f.share != null) top = Math.max(top, f.share);
    if (f.amount != null) { stated += f.amount; any = true; }
  }
  return { names: nodes.length, quantified, maxShare: top > 0 ? top : null, stated: any ? stated : null };
}
