// Pure helpers for the supply-chain map (shared by scripts/supply-chain.ts, the app and tests).

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

/** Collapse whitespace, unify quotes/dashes, lowercase — for verbatim checks. */
export function normText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

/** Links that mention `focus` (either side), grouped into one node per counterparty as seen from `focus`. */
export function focusGraph(focus: string, all: SupplyLink[], names: Record<string, string>): GraphNode[] {
  const f = focus.toUpperCase();
  const byKey = new Map<string, GraphNode>();
  const add = (key: string, name: string, ticker: string | null, domain: string | null, relation: Relation, link: SupplyLink) => {
    const k = `${relation}:${key}`;
    const n = byKey.get(k) ?? { key: k, name, ticker, domain, relation, links: [] };
    if (!n.domain && domain) n.domain = domain;
    n.links.push(link);
    byKey.set(k, n);
  };
  for (const l of all) {
    if (l.ticker === f) {
      const key = l.counterparty_ticker ?? normText(l.counterparty);
      if (l.counterparty_ticker === f) continue;
      add(key, l.counterparty_ticker ? (names[l.counterparty_ticker] ?? l.counterparty) : l.counterparty, l.counterparty_ticker, l.counterparty_domain, l.relation, l);
    } else if (l.counterparty_ticker === f) {
      add(l.ticker, names[l.ticker] ?? l.ticker, l.ticker, null, inverse(l.relation), l);
    }
  }
  return [...byKey.values()].sort((a, b) => maxShare(b) - maxShare(a) || b.links.length - a.links.length || a.name.localeCompare(b.name));
}

export const maxShare = (n: { links: SupplyLink[] }) => Math.max(0, ...n.links.map((l) => l.share_pct ?? 0));

/**
 * Clean side-by-side layout around the focus: suppliers flow in from the left, customers out to the
 * right, partners above and competitors below. Columns/rows wrap so nodes never overlap.
 */
export function sidePositions(count: number, side: Relation): { x: number; y: number }[] {
  const ROW = 64, COL = 230, PER_COL = 9, PER_ROW = 5;
  return Array.from({ length: count }, (_, i) => {
    if (side === "supplier" || side === "customer") {
      const col = Math.floor(i / PER_COL), row = i % PER_COL;
      const inCol = Math.min(PER_COL, count - col * PER_COL);
      const dir = side === "supplier" ? -1 : 1;
      return { x: dir * (380 + col * COL), y: (row - (inCol - 1) / 2) * ROW };
    }
    const r = Math.floor(i / PER_ROW), c = i % PER_ROW;
    const inRow = Math.min(PER_ROW, count - r * PER_ROW);
    const dir = side === "partner" ? -1 : 1;
    return { x: (c - (inRow - 1) / 2) * COL, y: dir * (330 + r * ROW) };
  });
}

// ---------------------------------------------------------------- richer analysis

export interface RiskLink extends SupplyLink {
  amount_usd?: number | null;
  single_source?: boolean;
  regions?: string[];
  risk?: string | null;
}

/** Dollar value a link represents: the stated amount, else share × the filer's revenue (only for customer shares, which are % of revenue). */
export function linkDollars(l: RiskLink, revenue: Record<string, number | undefined>): number | null {
  if (l.amount_usd != null && l.amount_usd > 0) return l.amount_usd;
  const rev = revenue[l.ticker];
  if (l.share_pct != null && l.relation === "customer" && rev) return (l.share_pct / 100) * rev;
  return null;
}

export const HOTSPOTS = ["china", "taiwan", "hong kong", "russia", "ukraine", "israel", "korea", "middle east"];

export interface NodeRisk {
  singleSource: boolean;
  concentrated: boolean;
  hotspots: string[];
  regions: string[];
  dollars: number | null;
}

export function nodeRisk(links: RiskLink[], revenue: Record<string, number | undefined>): NodeRisk {
  const regions = [...new Set(links.flatMap((l) => l.regions ?? []))];
  const dollars = links.map((l) => linkDollars(l, revenue)).filter((d): d is number => d != null);
  return {
    singleSource: links.some((l) => !!l.single_source),
    concentrated: links.some((l) => (l.share_pct ?? 0) >= 10),
    hotspots: regions.filter((r) => HOTSPOTS.some((h) => r.toLowerCase().includes(h))),
    regions,
    dollars: dollars.length ? Math.max(...dollars) : null,
  };
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
  const seen = new Set(first.map((n) => n.ticker ?? n.name.toLowerCase()));
  seen.add(f);
  const out: HopNode[] = [];
  for (const p of first) {
    if (!p.ticker || (p.relation !== "supplier" && p.relation !== "customer")) continue;
    const kids = focusGraph(p.ticker, all, names).filter((k) => k.relation === p.relation && !seen.has(k.ticker ?? k.name.toLowerCase()));
    for (const k of kids.slice(0, perParent)) {
      seen.add(k.ticker ?? k.name.toLowerCase());
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

const linkKey = (l: SupplyLink) => `${l.relation}:${l.counterparty_ticker ?? normText(l.counterparty)}`;

/** 10-K filings (newest first) that `ticker` itself filed, among the links. */
export function annualFilings(ticker: string, all: SupplyLink[]): { accn: string; filed: string }[] {
  const m = new Map<string, string>();
  for (const l of all) if (l.ticker === ticker && l.form === "10-K") m.set(l.accn, l.filed);
  return [...m].map(([accn, filed]) => ({ accn, filed })).sort((a, b) => b.filed.localeCompare(a.filed));
}

/** Counterparties named in `newer` but not `older` (added), the reverse (dropped), and stated-share moves ≥ 1pt. */
export function linkChanges(ticker: string, all: SupplyLink[], newerAccn: string, olderAccn: string): LinkChange[] {
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

/** Known alias spellings → one canonical counterparty key, so "TSMC" and "Taiwan Semiconductor" merge. */
const ALIASES: [RegExp, string][] = [
  [/taiwan semiconductor|\btsmc\b/, "TSM"],
  [/samsung/, "SSNLF"],
  [/sk hynix|hynix/, "HXSCL"],
  [/foxconn|hon hai/, "HNHPF"],
  [/amazon web services|\baws\b/, "AMZN"],
  [/google cloud|\bgoogle\b/, "GOOGL"],
  [/microsoft azure|\bazure\b/, "MSFT"],
];

/** Stable identity for a counterparty: its ticker, a known alias, or its normalised name minus corporate suffixes. */
export function entityKey(name: string, ticker: string | null): string {
  if (ticker) return ticker.toUpperCase();
  const n = normText(name);
  for (const [re, k] of ALIASES) if (re.test(n)) return k;
  return n.replace(/[.,]/g, "").replace(/\b(inc|corp|corporation|co|ltd|limited|plc|llc|lp|ag|sa|nv|holdings?|group|company)\b/g, "").replace(/\s+/g, " ").trim();
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
  const stated = Math.min(100, s.reduce((a, x) => a + x, 0));
  const single = new Set(own.filter((l) => l.single_source && l.relation !== "customer").map((l) => entityKey(l.counterparty, l.counterparty_ticker))).size;
  const hotLinks = own.filter((l) => (l.regions ?? []).some((r) => HOTSPOTS.some((h) => r.toLowerCase().includes(h))));
  const hotspots = [...new Set(hotLinks.flatMap((l) => (l.regions ?? []).filter((r) => HOTSPOTS.some((h) => r.toLowerCase().includes(h)))))];
  const cPts = Math.round(Math.min(40, top * 0.8 + Math.min(10, hhi / 250)));
  const sPts = Math.min(30, single * 10);
  const gPts = Math.min(30, hotLinks.length * 6);
  return {
    score: cPts + sPts + gPts, customerHhi: Math.round(hhi), topCustomerPct: top, statedCustomerPct: stated,
    singleSource: single, hotspotLinks: hotLinks.length, hotspots,
    parts: [
      { label: "Customer concentration", points: cPts, max: 40, why: top ? `largest named customer ${top}% of revenue; ${s.length} customers with stated shares` : "no customer shares stated" },
      { label: "Single-source inputs", points: sPts, max: 30, why: `${single} supplier/partner dependencies stated as sole, single or limited source` },
      { label: "Geopolitical exposure", points: gPts, max: 30, why: hotspots.length ? `${hotLinks.length} links tied to ${hotspots.join(", ")}` : "no hotspot regions tied to links" },
    ],
  };
}

/** Links grouped by stated region (first-order, both directions), largest first. */
export function regionExposure(nodes: { links: ProLink[]; relation: string }[]): { region: string; hotspot: boolean; suppliers: number; customers: number; other: number }[] {
  const m = new Map<string, { region: string; hotspot: boolean; suppliers: number; customers: number; other: number }>();
  for (const n of nodes) {
    const regions = new Set(n.links.flatMap((l) => (l.regions ?? []).map((r) => r.trim())).filter(Boolean));
    for (const r of regions) {
      const key = r.toLowerCase();
      const e = m.get(key) ?? { region: r, hotspot: HOTSPOTS.some((h) => key.includes(h)), suppliers: 0, customers: 0, other: 0 };
      if (n.relation === "supplier") e.suppliers++; else if (n.relation === "customer") e.customers++; else e.other++;
      m.set(key, e);
    }
  }
  return [...m.values()].sort((a, b) => b.suppliers + b.customers + b.other - (a.suppliers + a.customers + a.other));
}
