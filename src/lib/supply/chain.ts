// End-to-end value chain: suppliers' suppliers → suppliers → company → customers → customers' customers.
// Built from every quoted supply link (either company's filing) plus XBRL-tagged customer/supplier
// concentration facts, so each edge carries the evidence that states it. Goods flow left to right
// (seller → buyer). Pure: no React, no fetching.
import { entityKey, linkDollars, type RiskLink } from "./core";

/** One tagged concentration fact (xbrl_concentration row) naming a covered counterparty. */
export interface TaggedShare {
  ticker: string;
  counterparty: string;
  kind: string;
  benchmark: string;
  label: string;
  pct: number;
  accn: string;
  form: string;
  filed: string;
  period_end: string;
  element_id: string | null;
}

export type ChainEvidence =
  | { kind: "text"; link: RiskLink }
  | { kind: "tag"; fact: TaggedShare };

export interface ChainEdge {
  key: string;
  /** Seller node key. */
  from: string;
  /** Buyer node key. */
  to: string;
  /** Largest stated share, in percent, with what it is a share of. */
  share: number | null;
  basis: "revenue" | "receivables" | "purchases" | null;
  /** Largest dollar figure stated or implied (share of the seller's revenue × that revenue). */
  dollars: number | null;
  sole: boolean;
  /** Both companies' own filings state the relationship. */
  confirmed: boolean;
  evidence: ChainEvidence[];
}

export interface ChainNode {
  key: string;
  name: string;
  ticker: string | null;
  /** Negative = upstream (suppliers), 0 = the company, positive = downstream (customers). */
  tier: number;
  /** Node one tier closer to the company that brought this one into the chain. */
  via: string | null;
}

export interface Chain {
  focus: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  tiers: number[];
}

export interface ChainOptions {
  depth?: number;
  /** Most parties shown next to the company on each side. */
  first?: number;
  /** Most parties added per node beyond the first tier. */
  perNode?: number;
  /** Most parties in any one tier beyond the first. */
  perTier?: number;
}

const weight = (e: ChainEdge) => [e.dollars ?? 0, e.share ?? 0, e.evidence.length] as const;
const byWeight = (a: ChainEdge, b: ChainEdge) => {
  const x = weight(a), y = weight(b);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};

/** Every seller → buyer edge stated anywhere, merged per pair. */
export function chainEdges(links: RiskLink[], tagged: TaggedShare[], names: Record<string, string>, revenue: Record<string, number | undefined>): { edges: Map<string, ChainEdge>; label: Map<string, { name: string; ticker: string | null }> } {
  const edges = new Map<string, ChainEdge>();
  const label = new Map<string, { name: string; ticker: string | null }>();
  const node = (name: string, ticker: string | null) => {
    const k = entityKey(name, ticker);
    const cur = label.get(k);
    const display = ticker ? (names[ticker] ?? name) : name;
    if (!cur) label.set(k, { name: display, ticker });
    else if (!cur.ticker && ticker) label.set(k, { name: display, ticker });
    else if (!ticker && !cur.ticker && display.length < cur.name.length) cur.name = display;
    return k;
  };
  const edge = (from: string, to: string) => {
    const k = `${from}>${to}`;
    let e = edges.get(k);
    if (!e) {
      e = { key: k, from, to, share: null, basis: null, dollars: null, sole: false, confirmed: false, evidence: [] };
      edges.set(k, e);
    }
    return e;
  };
  const reporters = new Map<string, Set<string>>();
  const saw = (e: ChainEdge, reporter: string) => {
    const s = reporters.get(e.key) ?? new Set<string>();
    s.add(reporter);
    reporters.set(e.key, s);
  };
  for (const l of links) {
    if (l.relation !== "customer" && l.relation !== "supplier") continue;
    const me = node(names[l.ticker] ?? l.ticker, l.ticker);
    const cp = node(l.counterparty, l.counterparty_ticker);
    if (me === cp) continue;
    const e = l.relation === "customer" ? edge(me, cp) : edge(cp, me);
    e.evidence.push({ kind: "text", link: l });
    saw(e, l.ticker);
    if (l.single_source) e.sole = true;
    if (l.share_pct != null && l.share_pct > (e.share ?? 0)) {
      e.share = l.share_pct;
      e.basis = l.relation === "customer" ? "revenue" : "purchases";
    }
    const d = linkDollars(l, revenue);
    if (d != null && d > (e.dollars ?? 0)) e.dollars = d;
  }
  for (const f of tagged) {
    if (f.kind !== "customer" && f.kind !== "supplier") continue;
    const me = node(names[f.ticker] ?? f.ticker, f.ticker);
    const cp = node(names[f.counterparty] ?? f.counterparty, f.counterparty);
    if (me === cp) continue;
    const e = f.kind === "customer" ? edge(me, cp) : edge(cp, me);
    e.evidence.push({ kind: "tag", fact: f });
    saw(e, f.ticker);
    const pct = f.pct * 100;
    const basis = f.kind === "supplier" ? "purchases" : f.benchmark === "receivables" ? "receivables" : "revenue";
    // A revenue share beats a receivables share of the same size: it is the one that sizes the flow.
    if (pct > (e.share ?? 0) || (basis === "revenue" && e.basis === "receivables")) {
      e.share = Math.round(pct * 10) / 10;
      e.basis = basis;
    }
    const rev = revenue[f.ticker];
    if (f.kind === "customer" && f.benchmark === "revenue" && rev) {
      const d = f.pct * rev;
      if (d > (e.dollars ?? 0)) e.dollars = d;
    }
  }
  for (const e of edges.values()) {
    const who = reporters.get(e.key) ?? new Set();
    const seller = label.get(e.from)?.ticker, buyer = label.get(e.to)?.ticker;
    e.confirmed = !!seller && !!buyer && who.has(seller) && who.has(buyer);
  }
  return { edges, label };
}

/** The tiered chain around `focus`, strongest stated relationships first at every tier. */
export function buildChain(focus: string, links: RiskLink[], tagged: TaggedShare[], names: Record<string, string>, revenue: Record<string, number | undefined>, opts: ChainOptions = {}): Chain {
  const depth = Math.max(1, Math.min(opts.depth ?? 2, 3));
  const first = opts.first ?? 8, perNode = opts.perNode ?? 3, perTier = opts.perTier ?? 10;
  const f = focus.toUpperCase();
  const { edges, label } = chainEdges(links, tagged, names, revenue);
  const out = new Map<string, ChainEdge[]>();
  const into = new Map<string, ChainEdge[]>();
  for (const e of edges.values()) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    into.set(e.to, [...(into.get(e.to) ?? []), e]);
  }
  const placed = new Map<string, ChainNode>();
  placed.set(f, { key: f, name: label.get(f)?.name ?? names[f] ?? f, ticker: f, tier: 0, via: null });
  const kept: ChainEdge[] = [];
  for (const dir of [1, -1] as const) {
    let frontier = [f];
    for (let t = 1; t <= depth && frontier.length; t++) {
      const next: { key: string; via: string; e: ChainEdge }[] = [];
      for (const k of frontier) {
        const cand = (dir > 0 ? out.get(k) : into.get(k)) ?? [];
        const fresh = cand.filter((e) => !placed.has(dir > 0 ? e.to : e.from)).sort(byWeight);
        for (const e of fresh.slice(0, t === 1 ? first : perNode)) next.push({ key: dir > 0 ? e.to : e.from, via: k, e });
      }
      next.sort((a, b) => byWeight(a.e, b.e));
      const tierNodes: string[] = [];
      for (const n of next) {
        if (placed.has(n.key)) continue;
        if (t > 1 && tierNodes.length >= perTier) break;
        const l = label.get(n.key);
        placed.set(n.key, { key: n.key, name: l?.name ?? n.key, ticker: l?.ticker ?? null, tier: dir * t, via: n.via });
        tierNodes.push(n.key);
      }
      frontier = tierNodes;
    }
  }
  // Every stated edge between neighbouring tiers, not only the ones that placed a node.
  for (const e of edges.values()) {
    const a = placed.get(e.from), b = placed.get(e.to);
    if (a && b && b.tier === a.tier + 1) kept.push(e);
  }
  const nodes = [...placed.values()];
  return { focus: f, nodes, edges: kept.sort(byWeight), tiers: [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b) };
}

export const TIER_LABEL = (t: number) => (t === 0 ? "Company" : t < 0 ? (t === -1 ? "Suppliers" : `Tier ${-t} suppliers`) : t === 1 ? "Customers" : `Their customers${t > 2 ? ` (${t})` : ""}`);

/** The chain as text for the assistant: one line per edge, with its share, dollars and the filings that state it. */
export function chainText(c: Chain, max = 40): string {
  const byKey = new Map(c.nodes.map((n) => [n.key, n]));
  const nm = (k: string) => {
    const n = byKey.get(k);
    return n ? `${n.name}${n.ticker && n.ticker !== n.name ? ` (${n.ticker})` : ""}` : k;
  };
  const lines = c.edges.slice(0, max).map((e) => {
    const t = byKey.get(e.from)?.tier ?? 0;
    const src = e.evidence
      .slice(0, 3)
      .map((ev) => (ev.kind === "text" ? `${ev.link.ticker} ${ev.link.form} ${ev.link.accn}` : `${ev.fact.ticker} ${ev.fact.form} ${ev.fact.accn} XBRL-tagged "${ev.fact.label}" ${(ev.fact.pct * 100).toFixed(1)}% of ${ev.fact.benchmark}`))
      .join("; ");
    return `[${TIER_LABEL(t)} → ${TIER_LABEL(t + 1)}] ${nm(e.from)} sells to ${nm(e.to)}${e.share != null ? ` | ${e.share}% of ${e.basis}` : ""}${e.dollars != null ? ` | ≈$${(e.dollars / 1e6).toFixed(0)}M` : ""}${e.sole ? " | SINGLE SOURCE" : ""}${e.confirmed ? " | both filings state it" : ""} | per ${src}`;
  });
  return `VALUE CHAIN (goods flow left to right; tiers ${c.tiers.join(", ")}; ${c.nodes.length - 1} companies):\n${lines.join("\n")}${c.edges.length > max ? `\n…${c.edges.length - max} more edges` : ""}`;
}
