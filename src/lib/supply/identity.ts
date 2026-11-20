// Identity of supply links: one counterparty under one key however a filing spells it, and one link counted once
// when a filer's 10-K and a later 10-Q both state it. Pure, no browser/Node APIs.
import { entityKey, type SupplyLink } from "./core";

type Keyed = Pick<SupplyLink, "ticker" | "relation" | "counterparty" | "counterparty_ticker">;

/** Name part of a counterparty key: `entityKey` of the name alone (suffixes stripped, known aliases merged). */
const nameKey = (name: string) => entityKey(name ?? "", null);

/**
 * Tickers that rows give to a counterparty name, so a row naming "Volkswagen" without a ticker meets the row naming it
 * with VWAGY. A name maps to a ticker first within the same filer, then across all filers when every row that gives the
 * name a ticker gives the same one. A name two filers tie to different tickers is left unresolved.
 */
export interface NameTickers {
  byFiler: Map<string, string>;
  global: Map<string, string>;
}
export function nameTickers(links: Keyed[]): NameTickers {
  const byFilerSets = new Map<string, Set<string>>();
  const globalSets = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, k: string, t: string) => {
    const s = m.get(k) ?? new Set<string>();
    s.add(t);
    m.set(k, s);
  };
  for (const l of links) {
    const t = l.counterparty_ticker?.trim().toUpperCase();
    const n = nameKey(l.counterparty);
    if (!t || !n) continue;
    put(byFilerSets, `${l.ticker}|${n}`, t);
    put(globalSets, n, t);
  }
  const single = (m: Map<string, Set<string>>) => new Map([...m].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]]));
  return { byFiler: single(byFilerSets), global: single(globalSets) };
}

/** Stable key of a counterparty as `filer` names it: its ticker (given or resolved from another row), else its `entityKey`. */
export function counterpartyKey(l: Pick<Keyed, "ticker" | "counterparty" | "counterparty_ticker">, index?: NameTickers): string {
  if (l.counterparty_ticker?.trim()) return entityKey(l.counterparty, l.counterparty_ticker.trim());
  const n = nameKey(l.counterparty);
  const t = index?.byFiler.get(`${l.ticker}|${n}`) ?? index?.global.get(n);
  return t ?? n;
}

/** Identity of a link: filer, relation and counterparty key. Spelling variants of one counterparty share it. */
export function linkKey(l: Keyed, index?: NameTickers): string {
  return `${l.ticker}|${l.relation}|${counterpartyKey(l, index)}`;
}

/** `linkKey` with the name-to-ticker index built from `links` themselves. */
export function makeLinkKey(links: Keyed[]): (l: Keyed) => string {
  const index = nameTickers(links);
  return (l) => linkKey(l, index);
}

type Filed = Keyed & Pick<SupplyLink, "id" | "accn" | "form" | "filed">;
export type Deduped<T> = T & {
  /** the same link as stated in the filer's other current filings (or a spelling variant in the same filing), newest first */
  corroboration: T[];
};

const claims = (l: object) => {
  const r = l as { amount_usd?: number | null; share_pct?: number | null; single_source?: boolean | null };
  return (r.amount_usd != null ? 1 : 0) + (r.share_pct != null ? 1 : 0) + (r.single_source ? 1 : 0);
};

/**
 * One row per link among current links: copies of a link across a filer's 10-K and 10-Q count once. The row from the
 * newest filing is kept (same date: the one stating more, then the lower id, so the choice is stable); the others ride
 * along as `corroboration` so their quotes and figures can still be opened. Order of first appearance is preserved.
 */
export function dedupeCurrent<T extends Filed>(links: T[]): Deduped<T>[] {
  const key = makeLinkKey(links);
  const groups = new Map<string, T[]>();
  for (const l of links) {
    const k = key(l);
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }
  const out: Deduped<T>[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => b.filed.localeCompare(a.filed) || claims(b) - claims(a) || a.id.localeCompare(b.id));
    out.push({ ...sorted[0], corroboration: sorted.slice(1) });
  }
  return out;
}
