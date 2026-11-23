// The Overview's key relationships: the customers and suppliers the filings name, largest stated share first, with
// who stated the figure and what it is a share of. Built on the supply chain's own graph and facts (focusGraph,
// nodeFacts), so the numbers match the supply-chain page; every row keeps the filing sentence that states it. Pure.
import { concentrationBasis, copies, focusGraph, isTradeLink, type ConcBasis, type GraphNode, type RiskLink } from "@/lib/supply/core";
import { nodeFacts } from "@/lib/supply/describe";

export interface Relationship {
  key: string;
  name: string;
  ticker: string | null;
  domain: string | null;
  relation: "customer" | "supplier";
  /** largest stated share, in percent (12 = 12%), with the company whose total it is a share of and what total */
  share: { pct: number; of: string; basis: ConcBasis } | null;
  /** the sentence says sole, single or only source */
  singleSource: boolean;
  /** filings that state the tie */
  filings: number;
  /** the product or the newest statement's summary */
  summary: string | null;
  /** the row to open: the one that states the share, else the newest */
  source: RiskLink;
}

export interface KeyRelationships {
  customers: Relationship[];
  suppliers: Relationship[];
  /** names on each side before the cut */
  totals: { customers: number; suppliers: number; partners: number; competitors: number };
}

const BASIS_WORD: Record<ConcBasis, string> = { revenue: "revenue", receivables: "receivables", vendor: "purchases", channel: "channel sales", other: "stated total" };
/** "12% of Cirrus Logic's revenue": whose total the share is of, in words. */
export const shareOfWords = (s: NonNullable<Relationship["share"]>, nameOf: (ticker: string) => string): string => `of ${nameOf(s.of)}'s ${BASIS_WORD[s.basis]}`;

function toRelationship(n: GraphNode): Relationship {
  const links = n.links as RiskLink[];
  const facts = nodeFacts(n);
  const rows = links.flatMap((l) => copies(l));
  const newest = [...links].sort((a, b) => b.filed.localeCompare(a.filed) || a.id.localeCompare(b.id))[0];
  const withShare = rows.filter((l) => (l.share_pct ?? 0) > 0).sort((a, b) => (b.share_pct ?? 0) - (a.share_pct ?? 0) || b.filed.localeCompare(a.filed))[0];
  return {
    key: n.key,
    name: n.name,
    ticker: n.ticker,
    domain: n.domain,
    relation: n.relation as "customer" | "supplier",
    share: withShare ? { pct: withShare.share_pct as number, of: withShare.ticker, basis: concentrationBasis(withShare.quote ?? "") } : null,
    singleSource: facts.singleSource,
    filings: facts.filings,
    summary: facts.summary,
    source: withShare ?? newest,
  };
}

/**
 * Customers and suppliers of `focus` from the current filing links, trade ties only, ordered by stated share, then
 * sole-source wording, then how many filings state the tie. `links` are rows already verified by the supply reader.
 */
export function keyRelationships(focus: string, links: RiskLink[], names: Record<string, string>, perSide = 6): KeyRelationships {
  const graph = focusGraph(focus, links, names);
  const side = (relation: "customer" | "supplier") =>
    graph
      .filter((n) => n.relation === relation && (n.links as RiskLink[]).some(isTradeLink))
      .map(toRelationship)
      .sort((a, b) => (b.share?.pct ?? 0) - (a.share?.pct ?? 0) || Number(b.singleSource) - Number(a.singleSource) || b.filings - a.filings || Number(!!b.ticker) - Number(!!a.ticker) || a.name.localeCompare(b.name));
  const customers = side("customer");
  const suppliers = side("supplier");
  return {
    customers: customers.slice(0, perSide),
    suppliers: suppliers.slice(0, perSide),
    totals: { customers: customers.length, suppliers: suppliers.length, partners: graph.filter((n) => n.relation === "partner").length, competitors: graph.filter((n) => n.relation === "competitor").length },
  };
}

export interface TaggedConcentration {
  label: string;
  /** fraction (0.45 = 45%) */
  pct: number;
  kind: string;
  benchmark: string;
  benchmarkLabel: string | null;
  form: string;
  periodEnd: string;
  accn: string;
  elementId: string | null;
}

/**
 * Concentration shares the company tags in its own latest report ("Customer A, 17% of revenue"): the newest period,
 * largest first. Rows of the same member and benchmark in older periods are dropped.
 */
export function taggedConcentration(rows: { label: string; pct: number | string; kind: string; benchmark: string; benchmark_label?: string | null; form: string; period_end: string; accn: string; element_id?: string | null }[], max = 4): TaggedConcentration[] {
  const newest = rows.reduce<string | null>((m, r) => (m == null || r.period_end > m ? r.period_end : m), null);
  if (!newest) return [];
  const seen = new Set<string>();
  return rows
    .filter((r) => r.period_end === newest && Number(r.pct) > 0)
    .map((r) => ({ label: r.label, pct: Number(r.pct), kind: r.kind, benchmark: r.benchmark, benchmarkLabel: r.benchmark_label ?? null, form: r.form, periodEnd: r.period_end, accn: r.accn, elementId: r.element_id ?? null }))
    .sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label))
    .filter((r) => {
      const k = `${r.label}|${r.benchmark}|${r.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}
