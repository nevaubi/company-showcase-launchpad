// Pure helpers for the supply-chain map (shared by scripts/supply-chain.ts, the app and tests).
import { entityKey, normText } from "./entity";
import { nameTickers, counterpartyKey, type NameTickers } from "./identity";
import type { AmountKind, LinkNature } from "./claims";

export { entityKey, normText };

export type Relation = "customer" | "supplier" | "partner" | "competitor";
export const RELATIONS: Relation[] = ["customer", "supplier", "partner", "competitor"];

export interface SupplyLink {
  id: string;
  /** company whose filing states the link */
  ticker: string;
  counterparty: string;
  counterparty_ticker: string | null;
  counterparty_domain: string | null;
  /** what the counterparty is to `ticker` */
  relation: Relation;
  detail: string;
  share_pct: number | null;
  quote: string;
  accn: string;
  doc: string;
  form: string;
  filed: string;
}

/** A quote counts only if it appears verbatim (after normalisation) in the filing text and is long enough to mean something. */
export function quoteInText(quote: string, text: string): boolean {
  const q = normText(quote);
  if (q.split(" ").length < 5) return false;
  return normText(text).includes(q);
}

/** Inverse view: if A says B is its supplier, then from B's side A is a customer. */
export function inverse(r: Relation): Relation {
  return r === "customer" ? "supplier" : r === "supplier" ? "customer" : r;
}

export interface GraphNode {
  key: string;
  name: string;
  ticker: string | null;
  domain: string | null;
  relation: Relation | "focus";
  links: SupplyLink[];
}

/** One name-to-ticker index per link array, so focusGraph can be called per company without rebuilding it. */
const indexCache = new WeakMap<object, NameTickers>();
export function tickerIndex(all: Parameters<typeof nameTickers>[0]): NameTickers {
  let i = indexCache.get(all);
  if (!i) {
    i = nameTickers(all);
    indexCache.set(all, i);
  }
  return i;
}

/**
 * Links that mention `focus` (either side), grouped into one node per counterparty as seen from `focus`. Spelling variants
 * of one counterparty ("Kioxia", "Kioxia Corporation", "Volkswagen [VWAGY]") share a node: names are keyed by
 * `counterpartyKey`, which strips corporate suffixes and borrows the ticker another row gives the same name.
 */
export function focusGraph(focus: string, all: SupplyLink[], names: Record<string, string>): GraphNode[] {
  const f = focus.toUpperCase();
  const index = tickerIndex(all);
  const byKey = new Map<string, GraphNode>();
  const add = (key: string, name: string, ticker: string | null, domain: string | null, relation: Relation, link: SupplyLink) => {
    const k = `${relation}:${key}`;
    const n = byKey.get(k) ?? { key: k, name, ticker, domain, relation, links: [] };
    if (!n.domain && domain) n.domain = domain;
    if (!n.ticker && ticker) {
      n.ticker = ticker;
      n.name = name;
    }
    n.links.push(link);
    byKey.set(k, n);
  };
  for (const l of all) {
    if (l.ticker === f) {
      if (l.counterparty_ticker === f) continue;
      const key = counterpartyKey(l, index);
      // a ticker borrowed from another row is a ticker only when it is ticker-shaped (resolved keys are; name keys are lower case)
      const ticker = l.counterparty_ticker ?? (/^[A-Z][A-Z0-9.-]{0,9}$/.test(key) ? key : null);
      if (ticker === f) continue;
      add(key, ticker ? (names[ticker] ?? l.counterparty) : l.counterparty, ticker, l.counterparty_domain, l.relation, l);
    } else if (l.counterparty_ticker === f) {
      add(l.ticker, names[l.ticker] ?? l.ticker, l.ticker, null, inverse(l.relation), l);
    }
  }
  return [...byKey.values()].sort((a, b) => maxShare(b) - maxShare(a) || b.links.length - a.links.length || a.name.localeCompare(b.name));
}

export const maxShare = (n: { links: SupplyLink[] }) => Math.max(0, ...n.links.map((l) => l.share_pct ?? 0));

// ---------------------------------------------------------------- richer analysis

export interface RiskLink extends SupplyLink {
  amount_usd?: number | null;
  single_source?: boolean;
  regions?: string[];
  risk?: string | null;
  /* set by `trustLink` (claims.ts) on every row the app loads */
  /** the stated amount when it is money passing between the two parties for goods or services */
  flow_usd?: number | null;
  /** what a stated amount is (revenue, guarantee, investment...) */
  amount_kind?: AmountKind | null;
  /** sole, single, only or exclusive source wording in the sentence (same as `single_source` once trusted) */
  sole_source?: boolean;
  /** flagged as a dependency by the model, but the sentence does not say sole source */
  dependency?: boolean;
  /** what the sentence says the tie is: trade, financing, a corporate transaction, a regulator */
  nature?: LinkNature;
  dropped?: string[];
  /* set by `dedupeCurrent` (identity.ts) */
  /** the same link as stated in the filer's other current filings: counted once, shown as corroboration */
  corroboration?: RiskLink[];
  /** figures the kept row's own filing does not state, carried from the newest copy that does (with that copy's filing) */
  figure_from?: Partial<Record<"share" | "amount" | "single" | "regions", { id: string; form: string; filed: string; accn: string; doc?: string; quote?: string }>>;
  /** the kept row exactly as its own filing states it, before figures were carried onto it */
  own?: RiskLink;
}

/** Each filing's row once, as that filing states it: the kept row (without carried figures) and its copies. */
export const copies = <T extends RiskLink>(l: T): T[] => [(l.own ?? l) as T, ...((l.corroboration ?? []) as T[])];

/** Ties that are not trade (financing, acquisitions, regulators): shown and labelled, never a flow or a shock path. */
export const NOT_TRADE: ReadonlySet<string> = new Set(["financial", "corporate", "regulatory"]);
export const isTradeLink = (l: Pick<RiskLink, "nature">): boolean => !l.nature || !NOT_TRADE.has(l.nature);

/** Where a link's dollar value comes from: a stated flow (revenue, purchases, contract value) or a stated share × SEC revenue. */
/** What period a stated share covers: a 10-K's year, a 10-Q's quarter ("three months"), or a 10-Q's year to date. */
export type SharePeriod = "annual" | "quarter" | "interim";
export function sharePeriod(c: Pick<SupplyLink, "form" | "quote">): SharePeriod {
  if (!/10-Q/i.test(c.form ?? "")) return "annual";
  return /\b(three|six|nine)[- ]months?\b/i.test(c.quote ?? "") && !/\bthree[- ]months?\b/i.test(c.quote ?? "") ? "interim" : "quarter";
}
const PERIOD_RANK: Record<SharePeriod, number> = { annual: 2, interim: 1, quarter: 0 };

export interface LinkDollars {
  dollars: number;
  from: "flow" | "share";
  /** for an estimate from a share: the period the share covers (the revenue it multiplies is always the last twelve months) */
  period?: SharePeriod;
  /** the row whose sentence states it (the link itself or one of its copies) */
  link: RiskLink;
}

/**
 * Dollar value a link represents, counted once across its 10-K and 10-Q copies: the largest stated flow, else the largest
 * stated customer share × the filer's revenue. A stated amount that is not a flow (guarantee, investment, financing,
 * commitment, settlement, balance) and an amount the sentence does not state never count, and ties that are not trade have none.
 */
export function linkDollarsFrom(l: RiskLink, revenue: Record<string, number | undefined>): LinkDollars | null {
  if (!isTradeLink(l)) return null;
  let best: LinkDollars | null = null;
  for (const c of copies(l)) if (c.flow_usd != null && c.flow_usd > 0 && (!best || c.flow_usd > best.dollars)) best = { dollars: c.flow_usd, from: "flow", link: c };
  if (best) return best;
  const rev = revenue[l.ticker];
  if (l.relation !== "customer" || !rev) return null;
  /* a 10-K's annual share is the one that matches twelve months of revenue: it wins over a 10-Q's quarter share whatever their sizes */
  for (const c of copies(l)) if (c.share_pct != null && c.share_pct > 0) {
    const d = (c.share_pct / 100) * rev;
    const period = sharePeriod(c);
    const rank = PERIOD_RANK[period], bestRank = best?.period ? PERIOD_RANK[best.period] : -1;
    if (!best || rank > bestRank || (rank === bestRank && d > best.dollars)) best = { dollars: d, from: "share", link: c, period };
  }
  return best;
}

/** Dollar value a link represents (see `linkDollarsFrom`); null when the filings give neither a flow nor a customer share. */
export function linkDollars(l: RiskLink, revenue: Record<string, number | undefined>): number | null {
  return linkDollarsFrom(l, revenue)?.dollars ?? null;
}

/** A dollar figure a sentence states, with what it is. Flows widen bands and count as exposure; the rest are only shown. */
export interface StatedAmount {
  value: number;
  kind: AmountKind;
  flow: boolean;
  link: RiskLink;
}
/** Every verified amount behind these links (copies included, one per row), largest first. */
export function statedAmounts(links: RiskLink[]): StatedAmount[] {
  const out: StatedAmount[] = [];
  const seen = new Set<string>();
  for (const l of links) for (const c of copies(l)) {
    if (seen.has(c.id) || c.amount_usd == null || !(c.amount_usd > 0)) continue;
    seen.add(c.id);
    const flow = c.flow_usd != null && c.flow_usd > 0 && isTradeLink(c);
    out.push({ value: c.amount_usd, kind: (c.amount_kind ?? "other") as AmountKind, flow, link: c });
  }
  return out.sort((a, b) => b.value - a.value);
}

export const HOTSPOTS = ["china", "taiwan", "hong kong", "russia", "ukraine", "israel", "korea", "middle east"];
/** "Worldwide excluding China", "Outside mainland China": the region the entry names is the one it leaves out. */
const NEGATED = /\b(exclud\w*|outside|except|other than|ex-|non-)/i;
/** A region entry that ties the link to a geopolitical hotspot (negated entries do not). */
export const isNegatedRegion = (r: string): boolean => NEGATED.test(r);
export const isHotspotRegion = (r: string): boolean => !NEGATED.test(r) && HOTSPOTS.some((h) => r.toLowerCase().includes(h));
/** Regions the sentences behind a link name (its 10-K and 10-Q copies together), without "excluding X" entries. */
export const statedRegions = (l: RiskLink): string[] => [...new Set(copies(l).flatMap((c) => c.regions ?? []).filter((r) => r && !NEGATED.test(r)))];

export interface NodeRisk {
  /** sole-source wording in a quoted sentence */
  singleSource: boolean;
  /** a dependency the model flagged that the sentence does not call sole source */
  dependency: boolean;
  concentrated: boolean;
  hotspots: string[];
  /** regions the sentences name */
  regions: string[];
  /** largest stated flow or share × revenue; null when none */
  dollars: number | null;
  /** trade, or the kind of non-trade tie when every link behind the name is one */
  nature: LinkNature;
}

export function nodeRisk(links: RiskLink[], revenue: Record<string, number | undefined>): NodeRisk {
  const rows = links.flatMap((l) => copies(l));
  const regions = [...new Set(links.flatMap(statedRegions))];
  const dollars = links.map((l) => linkDollars(l, revenue)).filter((d): d is number => d != null);
  const singleSource = rows.some((l) => !!l.single_source);
  return {
    singleSource,
    dependency: !singleSource && rows.some((l) => !!l.dependency),
    concentrated: rows.some((l) => (l.share_pct ?? 0) >= 10),
    hotspots: regions.filter(isHotspotRegion),
    regions,
    dollars: dollars.length ? Math.max(...dollars) : null,
    nature: nodeNature(links),
  };
}

/** A name is a non-trade tie only when every link behind it is one; the most frequent kind names it. */
export function nodeNature(links: Pick<RiskLink, "nature">[]): LinkNature {
  const trade = links.filter(isTradeLink);
  if (!links.length || trade.some((l) => l.nature !== "unknown")) return "trade";
  if (trade.length) return "unknown";
  const tally = new Map<LinkNature, number>();
  for (const l of links) tally.set(l.nature as LinkNature, (tally.get(l.nature as LinkNature) ?? 0) + 1);
  return [...tally].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
}

export interface HopNode extends GraphNode {
  hop: 1 | 2;
  parent: string;
}

/**
 * Second-order links: suppliers of the focus's suppliers and customers of its customers
 * (plus each hop-1 company's own top partners), up to `perParent` per hop-1 company.
 */
export function secondOrder(focus: string, first: GraphNode[], all: SupplyLink[], names: Record<string, string>, perParent = 4): HopNode[] {
  const f = focus.toUpperCase();
  /* financing, acquisitions and regulators are not hops in a supply chain */
  const trade = (all as RiskLink[]).filter(isTradeLink);
  const id = (n: GraphNode) => n.ticker ?? entityKey(n.name, null);
  const seen = new Set(first.map(id));
  seen.add(f);
  const out: HopNode[] = [];
  for (const p of first) {
    if (!p.ticker || (p.relation !== "supplier" && p.relation !== "customer")) continue;
    if (!(p.links as RiskLink[]).some(isTradeLink)) continue;
    const kids = focusGraph(p.ticker, trade, names).filter((k) => k.relation === p.relation && !seen.has(id(k)));
    for (const k of kids.slice(0, perParent)) {
      seen.add(id(k));
      out.push({ ...k, key: `h2:${p.key}:${k.key}`, hop: 2, parent: p.key });
    }
  }
  return out;
}

export interface ShockImpact {
  key: string;
  name: string;
  ticker: string | null;
  hop: number;
  channel: "lost sales" | "supply disruption";
  /** fraction of this company's revenue at risk, when the filings quantify it */
  revenuePct: number | null;
  dollars: number | null;
  severity: "high" | "medium" | "low";
  path: string[];
  link: RiskLink;
}

/**
 * Propagate a demand/output shock at `source` (e.g. 0.2 = 20% drop):
 * - its suppliers lose sales: share of their revenue from source × shock (quantified when they disclose the share), recursing upstream;
 * - its customers face supply disruption (high when single-sourced), one more hop downstream.
 */
export function simulateShock(source: string, shock: number, all: RiskLink[], names: Record<string, string>, revenue: Record<string, number | undefined>, maxHop = 2): ShockImpact[] {
  const out = new Map<string, ShockImpact>();
  const nm = (t: string) => names[t] ?? t;
  const keep = (imp: ShockImpact) => {
    const prev = out.get(imp.key);
    const score = (x: ShockImpact) => (x.revenuePct ?? 0) * 10 + (x.severity === "high" ? 3 : x.severity === "medium" ? 2 : 1) - x.hop;
    if (!prev || score(imp) > score(prev)) out.set(imp.key, imp);
  };
  const walk = (s: string, size: number, hop: number, path: string[], dir: "up" | "down" | "both") => {
    if (hop > maxHop || size < 0.002) return;
    for (const l of all) {
      // financing, acquisitions and regulators do not carry a demand or supply shock
      if (!isTradeLink(l)) continue;
      // upstream: U says S is its customer, or S says U is its supplier
      const up = l.relation === "customer" && l.counterparty_ticker === s ? { t: l.ticker, name: nm(l.ticker), share: l.share_pct } : l.relation === "supplier" && l.ticker === s ? { t: l.counterparty_ticker, name: l.counterparty_ticker ? nm(l.counterparty_ticker) : l.counterparty, share: null } : null;
      if (up && dir !== "down" && up.t !== source) {
        const pct = up.share != null ? (up.share / 100) * size : null;
        const key = up.t ?? normText(up.name);
        const rev = up.t ? revenue[up.t] : undefined;
        keep({ key, name: up.name, ticker: up.t ?? null, hop, channel: "lost sales", revenuePct: pct, dollars: pct != null && rev ? pct * rev : null, severity: pct != null ? (pct >= 0.05 ? "high" : pct >= 0.01 ? "medium" : "low") : "low", path: [...path, up.name], link: l });
        if (up.t && pct != null) walk(up.t, pct, hop + 1, [...path, up.name], "up");
      }
      // downstream: D says S is its supplier, or S says D is its customer
      const down = l.relation === "supplier" && l.counterparty_ticker === s ? { t: l.ticker, name: nm(l.ticker) } : l.relation === "customer" && l.ticker === s ? { t: l.counterparty_ticker, name: l.counterparty_ticker ? nm(l.counterparty_ticker) : l.counterparty } : null;
      if (down && dir !== "up" && down.t !== source) {
        const key = down.t ?? normText(down.name);
        keep({ key, name: down.name, ticker: down.t ?? null, hop, channel: "supply disruption", revenuePct: null, dollars: null, severity: l.single_source ? "high" : hop === 1 ? "medium" : "low", path: [...path, down.name], link: l });
        if (down.t && hop < maxHop) walk(down.t, size / 2, hop + 1, [...path, down.name], "down");
      }
    }
  };
  walk(source.toUpperCase(), shock, 1, [nm(source.toUpperCase())], "both");
  const rank = { high: 0, medium: 1, low: 2 };
  return [...out.values()].sort((a, b) => (b.revenuePct ?? -1) - (a.revenuePct ?? -1) || rank[a.severity] - rank[b.severity] || a.hop - b.hop);
}

// ---------- Change over time ----------

export interface LinkChange {
  key: string;
  name: string;
  ticker: string | null;
  relation: Relation;
  kind: "added" | "dropped" | "share";
  from: number | null;
  to: number | null;
  /** link from the newer filing (added/share) or the older one (dropped) — for click-to-source */
  link: SupplyLink;
}


/** 10-K filings (newest first) that `ticker` itself filed, among the links. */
export function annualFilings(ticker: string, all: SupplyLink[]): { accn: string; filed: string }[] {
  const m = new Map<string, string>();
  for (const l of all) if (l.ticker === ticker && l.form === "10-K") m.set(l.accn, l.filed);
  return [...m].map(([accn, filed]) => ({ accn, filed })).sort((a, b) => b.filed.localeCompare(a.filed));
}

/** Counterparties named in `newer` but not `older` (added), the reverse (dropped), and stated-share moves ≥ 1pt. */
export function linkChanges(ticker: string, all: SupplyLink[], newerAccn: string, olderAccn: string): LinkChange[] {
  // spelling variants across years ("Kioxia" then "Kioxia Corporation") are the same counterparty, not one dropped and one added
  const index = tickerIndex(all);
  const linkKey = (l: SupplyLink) => `${l.relation}:${counterpartyKey(l, index)}`;
  const pick = (accn: string) => {
    const m = new Map<string, SupplyLink>();
    for (const l of all) if (l.ticker === ticker && l.accn === accn && !m.has(linkKey(l))) m.set(linkKey(l), l);
    return m;
  };
  const a = pick(newerAccn), b = pick(olderAccn);
  const out: LinkChange[] = [];
  const mk = (l: SupplyLink, kind: LinkChange["kind"], from: number | null, to: number | null): LinkChange =>
    ({ key: linkKey(l), name: l.counterparty, ticker: l.counterparty_ticker, relation: l.relation, kind, from, to, link: l });
  for (const [k, l] of a) {
    const o = b.get(k);
    if (!o) out.push(mk(l, "added", null, l.share_pct));
    else if (l.share_pct != null && o.share_pct != null && Math.abs(l.share_pct - o.share_pct) >= 1) out.push(mk(l, "share", o.share_pct, l.share_pct));
  }
  for (const [k, l] of b) if (!a.has(k)) out.push(mk(l, "dropped", l.share_pct, null));
  const order = { share: 0, added: 1, dropped: 2 };
  return out.sort((x, y) => order[x.kind] - order[y.kind] || x.name.localeCompare(y.name));
}

// ---------- Earnings price reactions ----------

/** [date, close] pairs sorted ascending. */
export type Closes = [string, number][];

/** Return from the close before `date` to the close after it (covers pre-market and after-hours releases). */
export function eventReturn(c: Closes, date: string): number | null {
  const i = c.findIndex(([d]) => d >= date);
  if (i < 1 || i + 1 >= c.length) return null;
  // released on a trading day: close[i-1] → close[i+1]
  return c[i + 1][1] / c[i - 1][1] - 1;
}

export interface Spillover {
  events: number;
  /** mean move of the counterparty around the focus company's earnings */
  meanMove: number;
  /** mean absolute move */
  meanAbs: number;
  /** share of events where both moved the same way */
  sameDir: number;
  /** slope of counterparty move on focus move */
  beta: number | null;
  rows: { date: string; focus: number; other: number }[];
}

export function spillover(focus: Closes, other: Closes, dates: string[]): Spillover | null {
  const rows = dates
    .map((date) => ({ date, focus: eventReturn(focus, date), other: eventReturn(other, date) }))
    .filter((r): r is { date: string; focus: number; other: number } => r.focus != null && r.other != null);
  if (rows.length < 3) return null;
  const n = rows.length;
  const mf = rows.reduce((s, r) => s + r.focus, 0) / n;
  const mo = rows.reduce((s, r) => s + r.other, 0) / n;
  const cov = rows.reduce((s, r) => s + (r.focus - mf) * (r.other - mo), 0);
  const vf = rows.reduce((s, r) => s + (r.focus - mf) ** 2, 0);
  return {
    events: n,
    meanMove: mo,
    meanAbs: rows.reduce((s, r) => s + Math.abs(r.other), 0) / n,
    sameDir: rows.filter((r) => Math.sign(r.focus) === Math.sign(r.other)).length / n,
    beta: vf > 0 ? cov / vf : null,
    rows,
  };
}

// ---------------------------------------------------------------- analyst layer

export interface ProLink extends RiskLink {
  product?: string | null;
  link_type?: string | null;
}

export type Confidence = "corroborated" | "stated" | "mentioned";

/**
 * How well-supported a link is. corroborated = the counterparty's own filing names the focus with the
 * mirrored relation; stated = a filing quote carries a share, amount or dependency; mentioned = named only.
 */
export function confidence(l: ProLink, all: SupplyLink[]): Confidence {
  if (l.counterparty_ticker) {
    const mirror = all.some((m) => m.ticker === l.counterparty_ticker && m.counterparty_ticker === l.ticker && m.relation === inverse(l.relation));
    if (mirror) return "corroborated";
  }
  return l.share_pct != null || (l.amount_usd ?? 0) > 0 || l.single_source ? "stated" : "mentioned";
}

/** The mirrored links (counterparty's filing naming the filer) that back up `l`. */
export function mirrors(l: SupplyLink, all: SupplyLink[]): SupplyLink[] {
  if (!l.counterparty_ticker) return [];
  return all.filter((m) => m.ticker === l.counterparty_ticker && m.counterparty_ticker === l.ticker && m.relation === inverse(l.relation));
}

/** Earliest annual filing in which `ticker` named this counterparty with this relation. */
export function firstSeen(l: SupplyLink, history: SupplyLink[]): string {
  const k = `${l.relation}:${entityKey(l.counterparty, l.counterparty_ticker)}`;
  return history
    .filter((h) => h.ticker === l.ticker && `${h.relation}:${entityKey(h.counterparty, h.counterparty_ticker)}` === k)
    .reduce((m, h) => (h.filed < m ? h.filed : m), l.filed);
}

export interface Dependency {
  /** 0–100, higher = more fragile */
  score: number;
  /** Herfindahl of stated customer shares (0–10,000) */
  customerHhi: number;
  topCustomerPct: number;
  statedCustomerPct: number;
  singleSource: number;
  /** dependencies the model flagged whose sentence does not say sole source: shown, not scored */
  statedDependencies: number;
  hotspotLinks: number;
  hotspots: string[];
  parts: { label: string; points: number; max: number; why: string }[];
}

/**
 * Fragility of one company from its own current filing: customer concentration (stated shares),
 * stated single-source inputs, and links tied to geopolitical hotspots. Every input is a filing fact.
 */
export function dependencyScore(ticker: string, all: ProLink[]): Dependency {
  const own = all.filter((l) => l.ticker === ticker);
  const shares = new Map<string, number>();
  for (const l of own) if (l.relation === "customer" && l.share_pct != null) {
    const k = entityKey(l.counterparty, l.counterparty_ticker);
    shares.set(k, Math.max(shares.get(k) ?? 0, l.share_pct));
  }
  const s = [...shares.values()];
  const hhi = s.reduce((a, x) => a + x * x, 0);
  const top = Math.max(0, ...s);
  const statedPct = Math.min(100, s.reduce((a, x) => a + x, 0));
  // a flag stated in either of a link's 10-K and 10-Q copies counts, once
  const flag = (l: ProLink, k: "single_source" | "dependency") => copies(l).some((c) => !!c[k]);
  const singleKeys = new Set(own.filter((l) => flag(l, "single_source") && l.relation !== "customer").map((l) => entityKey(l.counterparty, l.counterparty_ticker)));
  const single = singleKeys.size;
  const stated = new Set(own.filter((l) => flag(l, "dependency") && l.relation !== "customer").map((l) => entityKey(l.counterparty, l.counterparty_ticker)).filter((k) => !singleKeys.has(k))).size;
  const hotLinks = own.filter((l) => statedRegions(l).some(isHotspotRegion));
  const hotspots = [...new Set(hotLinks.flatMap((l) => statedRegions(l).filter(isHotspotRegion)))];
  const cPts = Math.round(Math.min(40, top * 0.8 + Math.min(10, hhi / 250)));
  const sPts = Math.min(30, single * 10);
  const gPts = Math.min(30, hotLinks.length * 6);
  return {
    score: cPts + sPts + gPts, customerHhi: Math.round(hhi), topCustomerPct: top, statedCustomerPct: statedPct,
    singleSource: single, statedDependencies: stated, hotspotLinks: hotLinks.length, hotspots,
    parts: [
      { label: "Customer concentration", points: cPts, max: 40, why: top ? `largest named customer ${top}% of revenue; ${s.length} customers with stated shares` : "no customer shares stated" },
      { label: "Single-source inputs", points: sPts, max: 30, why: `${single} supplier/partner ${single === 1 ? "tie" : "ties"} the filing calls sole, single or exclusive source${stated ? `; ${stated} other stated ${stated === 1 ? "dependency" : "dependencies"} not counted` : ""}` },
      { label: "Geopolitical exposure", points: gPts, max: 30, why: hotspots.length ? `${hotLinks.length} links tied to ${hotspots.join(", ")}` : "no hotspot regions tied to links" },
    ],
  };
}

/** Links grouped by stated region (first-order, both directions), largest first. */
export function regionExposure(nodes: { links: ProLink[]; relation: string }[]): { region: string; hotspot: boolean; suppliers: number; customers: number; other: number }[] {
  const m = new Map<string, { region: string; hotspot: boolean; suppliers: number; customers: number; other: number }>();
  for (const n of nodes) {
    const regions = new Set(n.links.flatMap((l) => statedRegions(l).map((r) => r.trim())).filter(Boolean));
    for (const r of regions) {
      const key = r.toLowerCase();
      const e = m.get(key) ?? { region: r, hotspot: isHotspotRegion(r), suppliers: 0, customers: 0, other: 0 };
      if (n.relation === "supplier") e.suppliers++; else if (n.relation === "customer") e.customers++; else e.other++;
      m.set(key, e);
    }
  }
  return [...m.values()].sort((a, b) => b.suppliers + b.customers + b.other - (a.suppliers + a.customers + a.other));
}

/** What a stated concentration percentage measures, read from its verbatim quote. */
export type ConcBasis = "revenue" | "receivables" | "vendor" | "channel" | "other";
export function concentrationBasis(quote: string): ConcBasis {
  const q = quote.toLowerCase();
  if (/receivable/.test(q)) return /vendor/.test(q) ? "vendor" : "receivables";
  if (/\b(vendor|supplier|purchases)\b/.test(q)) return "vendor";
  if (/\b(channel|distribution)\b/.test(q)) return "channel";
  if (/(revenue|net sales|total sales)/.test(q) && /(customer|client|distributor|partner)/.test(q)) return "revenue";
  return "other";
}
