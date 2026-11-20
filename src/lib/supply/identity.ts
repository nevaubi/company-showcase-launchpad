// Identity of supply links: one counterparty under one key however a filing spells it, and one link counted once
// when a filer's 10-K and a later 10-Q both state it. Pure, no browser/Node APIs.
import type { SupplyLink } from "./core";
import { entityKey } from "./entity";

type Keyed = Pick<SupplyLink, "ticker" | "relation" | "counterparty" | "counterparty_ticker">;

/** Name part of a counterparty key: `entityKey` of the name alone (suffixes stripped, known aliases merged). */
const nameKey = (name: string) => entityKey(name ?? "", null);

/**
 * Tickers that rows give to a counterparty name, so a row naming "Volkswagen" without a ticker meets the row naming it
 * with VWAGY. A name maps to a ticker first within the same filer, then across all filers when at least two rows give the
 * name a ticker and every such row gives the same one. A name two filers tie to different tickers is left unresolved.
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
  // across filers a name needs two rows (from different filers or filings) that agree, so one mistagged row cannot rename it everywhere
  const globalRows = new Map<string, number>();
  for (const l of links) {
    const t = l.counterparty_ticker?.trim().toUpperCase();
    const n = nameKey(l.counterparty);
    if (!t || !n) continue;
    put(byFilerSets, `${l.ticker}|${n}`, t);
    put(globalSets, n, t);
    globalRows.set(n, (globalRows.get(n) ?? 0) + 1);
  }
  const single = (m: Map<string, Set<string>>, min = 1) => new Map([...m].filter(([k, s]) => s.size === 1 && (min === 1 || (globalRows.get(k) ?? 0) >= min)).map(([k, s]) => [k, [...s][0]]));
  return { byFiler: single(byFilerSets), global: single(globalSets, 2) };
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
/** The filing row a lifted figure comes from, so the evidence panel can open the sentence that states it. */
export interface FigureSource { id: string; form: string; filed: string; accn: string; doc?: string; quote?: string }
export type FigureField = "share" | "amount" | "single" | "regions";
export type Deduped<T> = T & {
  /** the same link as stated in the filer's other current filings (or a spelling variant in the same filing), newest first */
  corroboration: T[];
  /** figures the kept row does not state, taken from the newest copy that does, with that copy's filing */
  figure_from?: Partial<Record<FigureField, FigureSource>>;
  /** the kept row as its own filing states it (set only when figures were carried onto it) */
  own?: T;
};

/** Field groups a copy can lend the kept row: each moves whole (an amount with its flow and kind). */
const FIELDS: Record<FigureField, { has: (r: Record<string, unknown>) => boolean; keys: string[] }> = {
  share: { has: (r) => r.share_pct != null, keys: ["share_pct"] },
  amount: { has: (r) => r.amount_usd != null, keys: ["amount_usd", "flow_usd", "amount_kind"] },
  single: { has: (r) => !!r.single_source || !!r.sole_source, keys: ["single_source", "sole_source", "dependency"] },
  regions: { has: (r) => Array.isArray(r.regions) && (r.regions as unknown[]).length > 0, keys: ["regions"] },
};

/** The kept row with each figure it lacks taken from the newest copy that states it (copies are newest first). */
function lift<T extends Filed>(keep: T, rest: T[]): Deduped<T> {
  const out = { ...keep, corroboration: rest } as Deduped<T>;
  const from: Partial<Record<FigureField, FigureSource>> = {};
  for (const [field, f] of Object.entries(FIELDS) as [FigureField, (typeof FIELDS)[FigureField]][]) {
    if (f.has(keep as unknown as Record<string, unknown>)) continue;
    const src = rest.find((r) => f.has(r as unknown as Record<string, unknown>));
    if (!src) continue;
    for (const k of f.keys) if (k in (src as object)) (out as Record<string, unknown>)[k] = (src as Record<string, unknown>)[k];
    const r = src as unknown as { id: string; form: string; filed: string; accn: string; doc?: string; quote?: string };
    from[field] = { id: r.id, form: r.form, filed: r.filed, accn: r.accn, doc: r.doc, quote: r.quote };
  }
  if (Object.keys(from).length) {
    out.figure_from = from;
    (out as Record<string, unknown>).own = keep;
  }
  return out;
}

const claims = (l: object) => {
  const r = l as { amount_usd?: number | null; share_pct?: number | null; single_source?: boolean | null };
  return (r.amount_usd != null ? 1 : 0) + (r.share_pct != null ? 1 : 0) + (r.single_source ? 1 : 0);
};

/**
 * One row per link among current links: copies of a link across a filer's 10-K and 10-Q count once. The row from the
 * newest filing is kept (same date: the one stating more, then the lower id, so the choice is stable); the others ride
 * along as `corroboration` so their quotes and figures can still be opened. A share, amount, single-source flag or region
 * list that only an older copy states is carried onto the kept row with its own source (`figure_from`), so no reader
 * loses it. Order of first appearance is preserved.
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
    out.push(lift(sorted[0], sorted.slice(1)));
  }
  return out;
}
