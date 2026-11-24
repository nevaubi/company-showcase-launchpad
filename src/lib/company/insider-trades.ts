// Open-market insider trades as the Overview shows them, in one place, so the Ownership block and Recent events
// value the same Form 4 the same way and the totals and the list below them cover the same trades. Pure.
//
// A trade is one Form 4 filing's open-market rows of one kind (code S, sale, or P, purchase): a filing that
// reports several sales on consecutive days is one sale, valued at the sum of shares times price over its rows,
// dated by its latest row. A row without a price has no value; a trade whose rows all lack a price has none.
import type { InsiderTrade } from "@/lib/financials/types";
import { fmtCompactUsd } from "@/lib/format";
import { INSIDER_WINDOW_DAYS } from "@/lib/insiders/window";

export interface OpenMarketTrade {
  accn: string;
  doc: string;
  filed: string;
  owner: string;
  role: string;
  kind: "sale" | "purchase";
  /** latest and earliest transaction date of the rows (ISO) */
  date: string;
  firstDate: string;
  shares: number;
  /** sum of shares x price over the priced rows; null when no row has a price */
  usd: number | null;
  /** rows without a price (their shares count, their value does not) */
  unpriced: number;
  rows: number;
  plan10b5: boolean;
}

const priced = (t: InsiderTrade) => t.price != null && Number.isFinite(t.price) && t.price > 0;

/** One trade per filing and kind, newest first. Codes other than S and P (awards, exercises, tax withholding) are left out. */
export function openMarketTrades(rows: InsiderTrade[]): OpenMarketTrade[] {
  const by = new Map<string, OpenMarketTrade>();
  for (const t of rows) {
    if (t.code !== "S" && t.code !== "P") continue;
    const key = `${t.accn}|${t.code}`;
    const cur = by.get(key);
    const v = priced(t) ? t.shares * t.price! : null;
    if (!cur) {
      by.set(key, { accn: t.accn, doc: t.doc, filed: t.filed, owner: t.owner, role: t.role, kind: t.code === "P" ? "purchase" : "sale", date: t.date, firstDate: t.date, shares: t.shares, usd: v, unpriced: v == null ? 1 : 0, rows: 1, plan10b5: t.plan10b5 });
      continue;
    }
    cur.rows++;
    cur.shares += t.shares;
    if (v != null) cur.usd = (cur.usd ?? 0) + v;
    else cur.unpriced++;
    if (t.date > cur.date) cur.date = t.date;
    if (t.date < cur.firstDate) cur.firstDate = t.date;
    cur.plan10b5 = cur.plan10b5 || t.plan10b5;
  }
  return [...by.values()].sort((a, b) => (a.date === b.date ? b.filed.localeCompare(a.filed) : b.date.localeCompare(a.date)));
}

/** The one rounding for a trade's or a total's dollar value: $5.5M, $336.2K. */
export function fmtTradeUsd(v: number): string {
  return fmtCompactUsd(v, 1);
}

/** "sold $5.5M", or the share count when no row carries a price. */
export function tradeAmount(t: OpenMarketTrade): string {
  const verb = t.kind === "purchase" ? "bought" : "sold";
  return t.usd != null ? `${verb} ${fmtTradeUsd(t.usd)}` : `${verb} ${t.shares.toLocaleString("en-US")} sh`;
}

export interface InsiderSummary {
  days: number;
  /** first day counted (ISO) */
  since: string;
  /** the stored rows start after `since`: the totals cover less than the window, from `from` */
  partial: boolean;
  from: string | null;
  /** the trades in the window, newest first; the totals are their sums */
  inWindow: OpenMarketTrade[];
  sold: number;
  bought: number;
  sales: number;
  purchases: number;
  /** trades in the window whose value is unknown or understated (rows without a price) */
  unpriced: number;
  /** what the list under the totals shows, and its title */
  list: OpenMarketTrade[];
  listTitle: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Totals and list from the same trades. When the window holds trades the list is those trades (at most `limit`);
 * when it holds none the list is the latest trades on file and says so, so a total never reads $0 above sales.
 */
export function insiderSummary(rows: InsiderTrade[], today: Date = new Date(), days = INSIDER_WINDOW_DAYS, limit = 4): InsiderSummary {
  const since = iso(new Date(today.getTime() - days * 864e5));
  const all = openMarketTrades(rows);
  const inWindow = all.filter((t) => t.date >= since);
  const from = rows.reduce<string | null>((m, t) => (m == null || t.date < m ? t.date : m), null);
  const sum = (k: OpenMarketTrade["kind"]) => inWindow.filter((t) => t.kind === k).reduce((s, t) => s + (t.usd ?? 0), 0);
  const list = (inWindow.length ? inWindow : all).slice(0, limit);
  return {
    days,
    since,
    partial: from != null && from > since,
    from,
    inWindow,
    sold: sum("sale"),
    bought: sum("purchase"),
    sales: inWindow.filter((t) => t.kind === "sale").length,
    purchases: inWindow.filter((t) => t.kind === "purchase").length,
    unpriced: inWindow.filter((t) => t.unpriced > 0).length,
    list,
    listTitle: inWindow.length ? (inWindow.length > list.length ? `Latest ${list.length} of ${inWindow.length} in the window` : "In the window") : "Latest trades on file",
  };
}

/** The caption of the totals: the window, or the date the records start when they start inside it. */
export function insiderWindowCaption(s: InsiderSummary, fmtDate: (iso: string) => string): string {
  return s.partial && s.from ? `Open-market trades since ${fmtDate(s.from)}` : `Open-market trades, last ${s.days} days`;
}

const SMALL_WORDS = new Set(["AND", "OF", "THE", "FOR", "TO", "IN", "ON", "AT"]);

/**
 * A Form 4 role as the page prints it: the filer's upper-case officer title in sentence case
 * ("CHIEF EXECUTIVE OFFICER, Director" reads "Chief executive officer, Director"). Short upper-case words are
 * kept as abbreviations (CEO, CFO, SR VP, EVP), so "SR VP, CFO AND TREASURER" reads "SR VP, CFO and treasurer".
 */
export function roleLabel(role: string): string {
  return role
    .split(/,\s*/)
    .map((part) => {
      const letters = part.replace(/[^A-Za-z]/g, "");
      if (!letters || letters !== letters.toUpperCase()) return part;
      const words = part.split(/(\s+)/).map((w) => (SMALL_WORDS.has(w) || w.replace(/[^A-Za-z]/g, "").length > 3 ? w.toLowerCase() : w));
      const out = words.join("");
      return out.charAt(0).toUpperCase() + out.slice(1);
    })
    .join(", ");
}
