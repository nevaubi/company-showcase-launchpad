// Pure shaping for the insider activity view: open-market trades, per-person lanes, range totals and
// clusters of buyers. No React, no dates from the clock.
import type { InsiderTrade } from "@/lib/financials/types";

export interface MarketTrade {
  /** Epoch ms of the trade date (UTC midnight). */
  at: number;
  date: string;
  owner: string;
  role: string;
  buy: boolean;
  /** Dollars: shares × price. */
  value: number;
  shares: number;
  price: number;
  /** Made under a pre-scheduled 10b5-1 plan, so it says little about the insider's view. */
  plan: boolean;
  accn: string;
  doc: string;
  filed: string;
}

export const dayMs = 86_400_000;
export const toMs = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

/** Open-market purchases (P) and sales (S) with a price, oldest first. */
export function marketTrades(insiders: InsiderTrade[]): MarketTrade[] {
  return insiders
    .filter((t) => (t.code === "P" || t.code === "S") && t.price != null && t.price > 0 && t.shares > 0 && Number.isFinite(toMs(t.date)))
    .map((t) => ({
      at: toMs(t.date),
      date: t.date.slice(0, 10),
      owner: t.owner,
      role: tidyRole(t.role),
      buy: t.code === "P",
      value: t.shares * (t.price as number),
      shares: t.shares,
      price: t.price as number,
      plan: t.plan10b5,
      accn: t.accn,
      doc: t.doc,
      filed: t.filed,
    }))
    .sort((a, b) => a.at - b.at);
}

/** Form 4 titles arrive with XML entities and in capitals: "PRESIDENT &amp; CEO" reads as "President & CEO". */
export function tidyRole(role: string) {
  const plain = role.replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  if (plain !== plain.toUpperCase() && !/[A-Z]{5,}/.test(plain)) return plain;
  return plain.replace(/[A-Za-z']+/g, (w) => (/^(CEO|CFO|COO|CTO|CIO|CLO|CAO|CMO|EVP|SVP|VP|HR|IT|US|USA|EMEA|APAC)$/i.test(w) ? w.toUpperCase() : /^(and|of|the|for|in)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
}

export type Side = "all" | "buy" | "sell";

export function filterTrades(trades: MarketTrade[], side: Side, hidePlanned: boolean) {
  return trades.filter((t) => (side === "all" || (side === "buy") === t.buy) && !(hidePlanned && t.plan));
}

export const inRange = (t: { at: number }, from: number, to: number) => t.at >= from && t.at <= to;

export interface RangeSummary {
  bought: number;
  sold: number;
  /** Sales that were not pre-scheduled. */
  soldByDecision: number;
  net: number;
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
}

export function summarize(trades: MarketTrade[], from: number, to: number): RangeSummary {
  const sub = trades.filter((t) => inRange(t, from, to));
  const sum = (xs: MarketTrade[]) => xs.reduce((s, t) => s + t.value, 0);
  const buys = sub.filter((t) => t.buy);
  const sells = sub.filter((t) => !t.buy);
  return {
    bought: sum(buys),
    sold: sum(sells),
    soldByDecision: sum(sells.filter((t) => !t.plan)),
    net: sum(buys) - sum(sells),
    buys: buys.length,
    sells: sells.length,
    buyers: new Set(buys.map((t) => t.owner)).size,
    sellers: new Set(sells.map((t) => t.owner)).size,
  };
}

export interface Lane {
  owner: string;
  role: string;
  trades: MarketTrade[];
  /** Net dollars inside the range (buys minus sells). */
  net: number;
  /** Dollars traded inside the range, either way. */
  volume: number;
}

/** One lane per insider with a trade in the range: net buyers first, then by dollars traded. */
export function lanes(trades: MarketTrade[], from: number, to: number): Lane[] {
  const by = new Map<string, Lane>();
  for (const t of trades) {
    if (!inRange(t, from, to)) continue;
    const lane = by.get(t.owner) ?? { owner: t.owner, role: t.role, trades: [], net: 0, volume: 0 };
    lane.trades.push(t);
    lane.net += t.buy ? t.value : -t.value;
    lane.volume += t.value;
    // The latest filing carries the current title.
    lane.role = t.role;
    by.set(t.owner, lane);
  }
  return [...by.values()].sort((a, b) => b.net - a.net || b.volume - a.volume || a.owner.localeCompare(b.owner));
}

export interface Cluster {
  from: number;
  to: number;
  people: string[];
  value: number;
}

/**
 * Stretches where several different insiders bought by choice close together: at least `minPeople`
 * distinct buyers within `windowDays`. Pre-scheduled trades never count. Overlapping stretches merge.
 */
export function buyClusters(trades: MarketTrade[], windowDays = 30, minPeople = 3): Cluster[] {
  const buys = trades.filter((t) => t.buy && !t.plan);
  const out: Cluster[] = [];
  for (let i = 0; i < buys.length; i++) {
    const group = buys.filter((t) => t.at >= buys[i].at && t.at <= buys[i].at + windowDays * dayMs);
    const people = [...new Set(group.map((t) => t.owner))];
    if (people.length < minPeople) continue;
    const from = group[0].at;
    const to = group[group.length - 1].at;
    const last = out[out.length - 1];
    if (last && from <= last.to) {
      const merged = buys.filter((t) => t.at >= last.from && t.at <= Math.max(last.to, to));
      last.to = Math.max(last.to, to);
      last.people = [...new Set(merged.map((t) => t.owner))];
      last.value = merged.reduce((s, t) => s + t.value, 0);
    } else {
      out.push({ from, to, people, value: group.reduce((s, t) => s + t.value, 0) });
    }
  }
  return out;
}

export interface TradeMark {
  at: number;
  label: string;
  description: string;
}

// Thresholds sit just under each unit so $999,600 reads "$1.0M", never "$1000K".
const usd = (v: number) => (v >= 999.5e6 ? `$${(v / 1e9).toFixed(1)}B` : v >= 999.5e3 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
export const fmtUsdShort = usd;

/**
 * Chart markers for trades. Trades on the same day (or the same week once there are many) and the same
 * side share one marker, so a busy company stays readable.
 */
export function tradeMarks(trades: MarketTrade[], maxMarks = 30): TradeMark[] {
  const bucket = trades.length > maxMarks ? 7 * dayMs : dayMs;
  const groups = new Map<string, MarketTrade[]>();
  for (const t of trades) {
    const key = `${Math.floor(t.at / bucket)}:${t.buy ? "b" : "s"}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()]
    .map((g) => {
      const total = g.reduce((s, t) => s + t.value, 0);
      const side = g[0].buy ? "Buy" : "Sell";
      const who = [...new Set(g.map((t) => t.owner))];
      return {
        at: g[0].at,
        label: `${side} ${usd(total)}`,
        description: who.length === 1 ? `${who[0]} ${g[0].buy ? "bought" : "sold"} ${usd(total)}${g.every((t) => t.plan) ? " under a pre-scheduled plan" : ""}` : `${who.length} insiders ${g[0].buy ? "bought" : "sold"} ${usd(total)}`,
      };
    })
    .sort((a, b) => a.at - b.at);
}
