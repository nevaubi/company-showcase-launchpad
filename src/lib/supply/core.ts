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
