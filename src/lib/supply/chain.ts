// End-to-end value chain: suppliers' suppliers → suppliers → company → customers → customers' customers.
// Built from every quoted supply link (either company's filing) plus XBRL-tagged customer/supplier
// concentration facts, so each edge carries the evidence that states it. Goods flow left to right
// (seller → buyer). Pure: no React, no fetching.
import { copies, entityKey, isTradeLink, linkDollarsFrom, type ProLink, type RiskLink } from "./core";

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
  /**
   * Stated share, in percent, with what it is a share of. A share of the seller's revenue or of the buyer's purchases
   * measures the flow itself and always wins over a share of receivables or of the buyer's own revenue; within the same
   * kind the largest stated share is kept.
   */
  share: number | null;
  basis: ShareBasis | null;
  /** Largest dollar figure stated or implied (share of the seller's revenue × that revenue). */
  dollars: number | null;
  /** Where the dollar figure comes from: a flow the quote states (revenue, purchases, contract value), or a stated share × the seller's revenue. */
  dollarsFrom: "stated" | "share" | null;
  sole: boolean;
  /** Both companies' own filings state the relationship. */
  confirmed: boolean;
  /** Kinds of relationship the quotes describe (component, foundry, distributor…), most cited first. */
  types: string[];
  /** What changes hands, as the quotes name it, most cited first. */
  products: string[];
  evidence: ChainEvidence[];
}

/**
 * What a stated share is a share of: the seller's revenue (a customer share), the buyer's purchases (a supplier share),
 * the seller's receivables, or the buyer's own revenue (a reseller stating how much of its sales come from one
 * supplier's products, which is not what it pays that supplier).
 */
export type ShareBasis = "revenue" | "purchases" | "receivables" | "buyer_revenue";
export const BASIS_WORD: Record<ShareBasis, string> = { revenue: "revenue", purchases: "purchases", receivables: "receivables", buyer_revenue: "the buyer's revenue" };
/** Shares that measure the flow between the two companies. */
const isFlowShare = (b: ShareBasis | null) => b === "revenue" || b === "purchases";
/** Whether a newly read share replaces the one an edge already holds. */
const betterShare = (pct: number, basis: ShareBasis, e: Pick<ChainEdge, "share" | "basis">) =>
  e.share == null || (isFlowShare(basis) && !isFlowShare(e.basis)) || (isFlowShare(basis) === isFlowShare(e.basis) && pct > e.share);
/**
 * What a supplier link's stated share measures, read from its sentence: a share of what the filer buys, unless the
 * sentence puts it against the filer's own sales ("products from X were 12% of our revenue").
 */
export function supplierShareBasis(quote: string): ShareBasis {
  const q = quote.toLowerCase();
  if (/purchas|procure|cost of (goods|sales|revenue)|inventory|raw material|supply of|supplied/.test(q)) return "purchases";
  return /\b(revenues?|net sales|total sales|sales)\b/.test(q) ? "buyer_revenue" : "purchases";
}

/** What kind of flow to draw: everything, or one family of stated relationship types. */
export type ChainFlow = "all" | "making" | "selling" | "tech";
export const CHAIN_FLOWS: { v: ChainFlow; label: string; hint: string }[] = [
  { v: "all", label: "Everything", hint: "every stated customer and supplier link" },
  { v: "making", label: "Making it", hint: "the supply base behind the company's products, and buyers that build them into their own" },
  { v: "selling", label: "Selling it", hint: "the route to market: customers, distributors, resellers, logistics and governments" },
  { v: "tech", label: "Tech & IP", hint: "cloud, licensing and co-development, both ways" },
];
const TECH = ["cloud", "licensor", "licensee", "co_development"];
const PARTS = ["component", "contract_manufacturer", "foundry", "materials"];
const CHANNEL = ["distributor", "reseller", "logistics"];
export const LINK_TYPE_LABEL = (t: string) => t.replace(/_/g, " ");

/** Which side of the company a link sits on: upstream (its supply base) or downstream (its buyers). */
export type ChainSide = "up" | "down";

/**
 * Whether a quoted link belongs to the flow on this side of the company, and matches the product search.
 * Making = everything physical upstream, plus downstream buyers that use the goods as parts. Selling =
 * everything physical downstream, plus channel partners upstream. Tech & IP = the tech types on either side.
 */
export function inFlow(l: Pick<ProLink, "link_type" | "product" | "detail">, flow: ChainFlow, product: string, side: ChainSide = "down"): boolean {
  const t = l.link_type ?? "";
  const ok =
    flow === "all" ||
    (flow === "tech" && TECH.includes(t)) ||
    (flow === "making" && (side === "up" ? !TECH.includes(t) : PARTS.includes(t))) ||
    (flow === "selling" && (side === "down" ? !TECH.includes(t) : CHANNEL.includes(t)));
  if (!ok) return false;
  const q = product.trim().toLowerCase();
  return !q || `${l.product ?? ""} ${l.detail ?? ""}`.toLowerCase().includes(q);
}
/** Tagged XBRL shares carry no type or product: they count as physical trade, and never under a product search. */
const tagInFlow = (f: TaggedShare, flow: ChainFlow, product: string, side: ChainSide) =>
  !product.trim() && (flow === "all" || (flow === "making" && (side === "up" || f.kind === "supplier")) || (flow === "selling" && side === "down"));

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
  flow?: ChainFlow;
  /** Keep only links whose stated product or detail contains this text. */
  product?: string;
}

const weight = (e: ChainEdge) => [e.dollars ?? 0, e.share ?? 0, e.evidence.length] as const;
const byWeight = (a: ChainEdge, b: ChainEdge) => {
  const x = weight(a), y = weight(b);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};

/** Every seller → buyer edge stated anywhere, merged per pair. */
export function chainEdges(links: RiskLink[], tagged: TaggedShare[], names: Record<string, string>, revenue: Record<string, number | undefined>, flow: ChainFlow = "all", product = "", side: ChainSide = "down"): { edges: Map<string, ChainEdge>; label: Map<string, { name: string; ticker: string | null }> } {
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
      e = { key: k, from, to, share: null, basis: null, dollars: null, dollarsFrom: null, sole: false, confirmed: false, types: [], products: [], evidence: [] };
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
  const tally = new Map<string, { types: Map<string, number>; products: Map<string, number> }>();
  const bump = (m: Map<string, number>, k: string | null | undefined) => {
    const v = k?.trim();
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  };
  for (const l of links) {
    if (l.relation !== "customer" && l.relation !== "supplier") continue;
    // financing, acquisitions and regulators are not a seller and a buyer
    if (!isTradeLink(l)) continue;
    if (!inFlow(l as ProLink, flow, product, side)) continue;
    const me = node(names[l.ticker] ?? l.ticker, l.ticker);
    const cp = node(l.counterparty, l.counterparty_ticker);
    if (me === cp) continue;
    const e = l.relation === "customer" ? edge(me, cp) : edge(cp, me);
    e.evidence.push({ kind: "text", link: l });
    saw(e, l.ticker);
    const t = tally.get(e.key) ?? { types: new Map(), products: new Map() };
    tally.set(e.key, t);
    const pl = l as ProLink;
    if (pl.link_type && pl.link_type !== "other") bump(t.types, pl.link_type);
    bump(t.products, pl.product);
    for (const c of copies(l)) {
      if (c.single_source) e.sole = true;
      if (c.share_pct == null || !(c.share_pct > 0)) continue;
      const basis: ShareBasis = l.relation === "customer" ? "revenue" : supplierShareBasis(c.quote ?? "");
      if (betterShare(c.share_pct, basis, e)) {
        e.share = c.share_pct;
        e.basis = basis;
      }
    }
    const d = linkDollarsFrom(l, revenue);
    if (d != null && d.dollars > (e.dollars ?? 0)) {
      e.dollars = d.dollars;
      e.dollarsFrom = d.from === "flow" ? "stated" : "share";
    }
  }
  for (const f of tagged) {
    if (f.kind !== "customer" && f.kind !== "supplier") continue;
    if (!tagInFlow(f, flow, product, side)) continue;
    const me = node(names[f.ticker] ?? f.ticker, f.ticker);
    const cp = node(names[f.counterparty] ?? f.counterparty, f.counterparty);
    if (me === cp) continue;
    const e = f.kind === "customer" ? edge(me, cp) : edge(cp, me);
    e.evidence.push({ kind: "tag", fact: f });
    saw(e, f.ticker);
    const pct = Math.round(f.pct * 1000) / 10;
    // a supplier fact tagged against revenue is the filer's own sales of that supplier's products, not what it pays the supplier
    const basis: ShareBasis = f.kind === "supplier" ? (f.benchmark === "revenue" ? "buyer_revenue" : "purchases") : f.benchmark === "receivables" ? "receivables" : "revenue";
    // a share of revenue or purchases sizes the flow: a receivables balance, often from an earlier period, never replaces it
    if (betterShare(pct, basis, e)) {
      e.share = pct;
      e.basis = basis;
    }
    const rev = revenue[f.ticker];
    if (f.kind === "customer" && f.benchmark === "revenue" && rev) {
      const d = f.pct * rev;
      if (d > (e.dollars ?? 0)) {
        e.dollars = d;
        e.dollarsFrom = "share";
      }
    }
  }
  const ranked = (m: Map<string, number> | undefined, n: number) => [...(m ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
  for (const e of edges.values()) {
    const t = tally.get(e.key);
    e.types = ranked(t?.types, 3);
    // the same product named with different capitalisation is one product
    const seen = new Set<string>();
    e.products = ranked(t?.products, 8).filter((p) => (seen.has(p.toLowerCase()) ? false : (seen.add(p.toLowerCase()), true))).slice(0, 3);
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
  const flow = opts.flow ?? "all", product = opts.product ?? "";
  const down = chainEdges(links, tagged, names, revenue, flow, product, "down");
  // unfiltered, both sides see the same edges: build them once
  const upE = flow === "all" && !product.trim() ? down : chainEdges(links, tagged, names, revenue, flow, product, "up");
  const label = new Map([...upE.label, ...down.label]);
  const out = new Map<string, ChainEdge[]>();
  const into = new Map<string, ChainEdge[]>();
  for (const e of down.edges.values()) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  for (const e of upE.edges.values()) into.set(e.to, [...(into.get(e.to) ?? []), e]);
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
  for (const e of down.edges.values()) {
    const a = placed.get(e.from), b = placed.get(e.to);
    if (a && b && b.tier === a.tier + 1 && a.tier >= 0) kept.push(e);
  }
  for (const e of upE.edges.values()) {
    const a = placed.get(e.from), b = placed.get(e.to);
    if (a && b && b.tier === a.tier + 1 && b.tier <= 0) kept.push(e);
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
    const what = [...e.types.map(LINK_TYPE_LABEL), ...e.products].join(", ");
    return `[${TIER_LABEL(t)} → ${TIER_LABEL(t + 1)}] ${nm(e.from)} sells to ${nm(e.to)}${what ? ` (${what})` : ""}${e.share != null ? ` | ${e.share}% of ${e.basis ? BASIS_WORD[e.basis] : "an unstated base"}` : ""}${e.dollars != null ? ` | ≈$${(e.dollars / 1e6).toFixed(0)}M` : ""}${e.sole ? " | SINGLE SOURCE" : ""}${e.confirmed ? " | both filings state it" : ""} | per ${src}`;
  });
  return `VALUE CHAIN (goods flow left to right; tiers ${c.tiers.join(", ")}; ${c.nodes.length - 1} companies):\n${lines.join("\n")}${c.edges.length > max ? `\n…${c.edges.length - max} more edges` : ""}`;
}
