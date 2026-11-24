// Positioning context for the Overview: how much of the reported off-exchange volume was sold short lately, and what
// the options market prices. Both are context, not signals: FINRA's daily short sale volume is not short interest
// (it counts short sales by market makers too), and the options figures are only as deep as the recorded days. Pure.
import { earningsImpliedMove, impliedMoveBy, ivRank, type TermPoint } from "@/lib/options/core";

export interface ShortDay {
  date: string;
  /** shares sold short and total shares in FINRA's daily files (off-exchange and TRF-reported volume) */
  short: number;
  total: number;
}

export interface ShortTrend {
  /** newest trading day in the window */
  asOf: string;
  /** trading days in the latest window (20 when the history is long enough) */
  days: number;
  /** short volume ÷ total volume over the latest window */
  share: number;
  /** the same over the window before it, when that many days exist */
  prior: number | null;
  /** the share over the last 60 trading days, when that many exist */
  share60: number | null;
  /** daily share, oldest first, at most 60 days: what the small chart draws */
  series: { date: string; share: number }[];
}

const WINDOW = 20;
/** A ticker symbol that was reused carries another company's rows from years ago: only a recent, unbroken run counts. */
const MAX_GAP_DAYS = 12;
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * The share of reported volume sold short over the last 20 trading days against the 20 before. Rows are used only
 * back to the first gap of more than `MAX_GAP_DAYS` calendar days, and days with no volume are skipped.
 */
export function shortTrend(rows: ShortDay[]): ShortTrend | null {
  const days = rows.filter((r) => r.total > 0 && r.short >= 0 && r.short <= r.total).sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return null;
  let from = days.length - 1;
  while (from > 0 && t(days[from].date) - t(days[from - 1].date) <= MAX_GAP_DAYS * 86_400_000) from--;
  const run = days.slice(from);
  if (run.length < 5) return null;
  const share = (xs: ShortDay[]) => xs.reduce((s, r) => s + r.short, 0) / xs.reduce((s, r) => s + r.total, 0);
  const latest = run.slice(-WINDOW);
  const before = run.slice(-2 * WINDOW, -WINDOW);
  return {
    asOf: run[run.length - 1].date,
    days: latest.length,
    share: share(latest),
    prior: before.length === WINDOW && latest.length === WINDOW ? share(before) : null,
    share60: run.length >= 60 ? share(run.slice(-60)) : null,
    series: run.slice(-60).map((r) => ({ date: r.date, share: r.short / r.total })),
  };
}

export interface OptionsDay {
  date: string;
  price: number;
  iv30: number | null;
  skew25: number | null;
  pc_oi: number | null;
  pc_vol: number | null;
  term: TermPoint[];
}

export interface OptionsContext {
  asOf: string;
  /** 30-day implied volatility (annualised) and its change in points from the fifth recorded day before */
  iv30: number | null;
  ivChange: { points: number; from: string } | null;
  /** where today's IV30 sits in the recorded range, once enough days are recorded */
  rank: { rank: number; n: number } | null;
  /** recorded days with an IV30, including the latest */
  recorded: number;
  putCallOpenInterest: number | null;
  putCallVolume: number | null;
  skew25: number | null;
  /** the move the at-the-money straddle prices: by the first expiry after the next earnings date, else about a month out */
  implied: { move: number; expiry: string; days: number; through: "earnings" | "month" } | null;
}

/** The newest recorded day summarised. `rows` in any order; `nextEarnings` is the next report date when known. */
export function optionsContext(rows: OptionsDay[], nextEarnings: string | null): OptionsContext | null {
  const days = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const last = days.at(-1);
  if (!last) return null;
  const ivs = days.filter((d) => d.iv30 != null);
  const earlier = ivs.filter((d) => d.date < last.date);
  const back = earlier.length >= 5 ? earlier[earlier.length - 5] : null;
  const rank = last.iv30 != null ? ivRank(earlier.map((d) => d.iv30 as number), last.iv30) : null;
  const term = last.term ?? [];
  const byEarnings = nextEarnings && nextEarnings >= last.date ? earningsImpliedMove(term, nextEarnings, last.date) : null;
  const month = byEarnings ? null : impliedMoveBy(term, 30);
  const pick = byEarnings ?? month;
  return {
    asOf: last.date,
    iv30: last.iv30,
    ivChange: back && last.iv30 != null ? { points: last.iv30 - (back.iv30 as number), from: back.date } : null,
    rank: rank ? { rank: rank.rank, n: rank.n } : null,
    recorded: ivs.length,
    putCallOpenInterest: last.pc_oi,
    putCallVolume: last.pc_vol,
    skew25: last.skew25,
    implied: pick ? { move: pick.m, expiry: pick.e, days: pick.d, through: byEarnings ? "earnings" : "month" } : null,
  };
}
