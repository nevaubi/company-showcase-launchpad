// The live record by signal day, read from finished `setup_signals` rows the engine caught as they
// fired (`first_seen = fired_at`). Trades entered on one day move together (one market, one sector
// fund hedge), so a day of 65 trades is one observation, not 65; and days inside one holding period
// share most of their path, so the unit the live check counts is the independent holding period.
// Pure and browser-safe.
import { weekdaysBetween } from "./events";

/** One finished live trade. */
export interface LiveTrade {
  variant: string;
  ticker: string;
  firedAt: string;
  /** Net return after costs. */
  net: number;
}

/** Finished live trades of one rule entered on one day. */
export interface LiveDay {
  date: string;
  n: number;
  /** Average net return of that day's trades. */
  mean: number;
}

/** Signal days whose holds overlap, grouped: one independent observation. */
export interface LivePeriod {
  start: string;
  days: number;
  n: number;
  /** Average of the day averages in the period. */
  mean: number;
}

/** Finished live trades grouped by rule and by entry day, days in date order. */
export function liveDays(trades: readonly LiveTrade[]): Map<string, LiveDay[]> {
  const acc = new Map<string, Map<string, { n: number; sum: number }>>();
  for (const t of trades) {
    if (!Number.isFinite(t.net)) continue;
    const byDay = acc.get(t.variant) ?? new Map<string, { n: number; sum: number }>();
    const d = byDay.get(t.firedAt) ?? { n: 0, sum: 0 };
    d.n++;
    d.sum += t.net;
    byDay.set(t.firedAt, d);
    acc.set(t.variant, byDay);
  }
  const out = new Map<string, LiveDay[]>();
  for (const [v, byDay] of acc) {
    out.set(v, [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, d]) => ({ date, n: d.n, mean: d.sum / d.n })));
  }
  return out;
}

/**
 * Signal days cut into independent holding periods: a period opens on a signal day and holds every
 * later signal day that enters before its first trade is out (fewer than `horizon` trading days
 * after the opening day). Periods with no signal day do not exist, so calendar time adds nothing.
 */
export function livePeriods(days: readonly LiveDay[], horizon: number): LivePeriod[] {
  const h = Math.max(1, Math.round(horizon) || 1);
  const out: LivePeriod[] = [];
  let cur: { start: string; means: number[]; n: number } | null = null;
  const close = () => {
    if (cur) out.push({ start: cur.start, days: cur.means.length, n: cur.n, mean: cur.means.reduce((s, x) => s + x, 0) / cur.means.length });
  };
  for (const d of days) {
    if (!cur || weekdaysBetween(cur.start, d.date) >= h) {
      close();
      cur = { start: d.date, means: [], n: 0 };
    }
    cur.means.push(d.mean);
    cur.n += d.n;
  }
  close();
  return out;
}

/**
 * Rules whose finished live trades are the same trades (same stocks, same days, same outcomes): one
 * live record under several names, which must not be read as several confirmations. Each rule in
 * such a set maps to the other rules in it, sorted.
 */
export function sameLiveTrades(trades: readonly LiveTrade[]): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const t of trades) {
    if (!Number.isFinite(t.net)) continue;
    const g = rows.get(t.variant) ?? [];
    g.push(`${t.ticker}|${t.firedAt}|${t.net.toFixed(6)}`);
    rows.set(t.variant, g);
  }
  const bySig = new Map<string, string[]>();
  for (const [v, g] of rows) {
    const sig = g.sort().join(",");
    bySig.set(sig, [...(bySig.get(sig) ?? []), v]);
  }
  const out = new Map<string, string[]>();
  for (const vs of bySig.values()) {
    if (vs.length < 2) continue;
    const sorted = [...vs].sort();
    for (const v of sorted) out.set(v, sorted.filter((x) => x !== v));
  }
  return out;
}
