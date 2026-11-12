// One window for insider totals, so the overview card, the 30-day summary and the ownership page say the same
// thing about the same period. Pure.
import type { InsiderTrade } from "@/lib/financials/types";

export const INSIDER_WINDOW_DAYS = 90;

export interface InsiderWindow {
  /** First day counted (ISO date). */
  since: string;
  days: number;
  /** Dollar value of open-market sales (code S) and purchases (code P) in the window. */
  sold: number;
  bought: number;
  sales: number;
  buys: number;
  /** Form 4 filings with any transaction in the window. */
  filings: number;
  /**
   * False when the stored trades start after the window does, so the totals cover less than the full window.
   * `from` is then the earliest trade date held.
   */
  complete: boolean;
  from: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Open-market insider buying and selling over the last `days` days, counted back from `today`. */
export function insiderWindow(trades: InsiderTrade[], today: Date = new Date(), days = INSIDER_WINDOW_DAYS): InsiderWindow {
  const since = iso(new Date(today.getTime() - days * 864e5));
  const inWindow = trades.filter((t) => t.date >= since);
  const value = (t: InsiderTrade) => t.shares * (t.price ?? 0);
  const of = (code: string) => inWindow.filter((t) => t.code === code);
  const from = trades.reduce<string | null>((m, t) => (m == null || t.date < m ? t.date : m), null);
  return {
    since,
    days,
    sold: of("S").reduce((s, t) => s + value(t), 0),
    bought: of("P").reduce((s, t) => s + value(t), 0),
    sales: of("S").length,
    buys: of("P").length,
    filings: new Set(inWindow.map((t) => t.accn)).size,
    complete: from != null && from <= since,
    from,
  };
}

/** How to caption the totals: the window when it is fully covered, otherwise the date the records start. */
export function insiderWindowLabel(w: InsiderWindow, fmtDate: (iso: string) => string): string {
  if (w.complete || !w.from) return `Open-market trades, last ${w.days} days`;
  return `Open-market trades since ${fmtDate(w.from)}`;
}
