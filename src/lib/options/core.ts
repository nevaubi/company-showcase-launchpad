// Options-market context from Cboe's delayed option chains. Pure: no fetches, no storage.
//
// One snapshot per stock and trading day: Cboe's 30-day implied volatility, the at-the-money straddle
// for each of the first expiries (the move the market prices to that date), 25-delta skew around 30
// days, and put/call open interest and volume. Snapshots are recorded nightly, so implied-volatility
// rank and every later comparison only ever use readings that existed on that day.

export interface CboeOption {
  option: string;
  bid: number;
  ask: number;
  iv: number;
  open_interest: number;
  volume: number;
  delta: number;
}
export interface CboeChain {
  symbol: string;
  current_price?: number;
  close?: number;
  prev_day_close?: number;
  iv30?: number;
  last_trade_time?: string;
  options: CboeOption[];
}

/** The at-the-money straddle for one expiry. */
export interface TermPoint {
  /** expiry (YYYY-MM-DD) */
  e: string;
  /** calendar days from the snapshot's trading day */
  d: number;
  /** straddle mid ÷ stock price: the absolute move the market prices by that expiry */
  m: number;
  /** at-the-money implied volatility (annualised), when Cboe has one */
  iv: number | null;
  /** strike(s) the straddle was read at */
  k: number;
}

export interface OptionsSnapshot {
  ticker: string;
  /** trading day the quotes belong to */
  date: string;
  price: number;
  /** Cboe's 30-day implied volatility (annualised fraction) */
  iv30: number | null;
  /** at-the-money implied volatility at the expiry nearest 30 days */
  atmIv: number | null;
  /** 25-delta put IV − 25-delta call IV at the expiry nearest 30 days (positive = downside protection costs more) */
  skew25: number | null;
  callOi: number;
  putOi: number;
  callVol: number;
  putVol: number;
  term: TermPoint[];
}

/** Our tickers use "-" for share classes; Cboe uses "." (BRK-B → BRK.B). */
export const cboeSymbol = (ticker: string) => ticker.toUpperCase().replace(/-/g, ".");
export const cboeChainUrl = (ticker: string) => `https://cdn-api.cboe.com/api/global/delayed_quotes/options/${cboeSymbol(ticker)}.json`;
/** Public page a reader can open to check the same quotes. */
export const cboeQuotePage = (ticker: string) => `https://www.cboe.com/delayed_quotes/${cboeSymbol(ticker).toLowerCase()}/quote_table`;

const OCC = /^([A-Z.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
export function parseOcc(sym: string): { root: string; expiry: string; type: "C" | "P"; strike: number } | null {
  const m = OCC.exec(sym);
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] as "C" | "P", strike: Number(m[6]) / 1000 };
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const mid = (o: CboeOption) => (o.bid + o.ask) / 2;
/** A two-sided quote tight enough to trust its midpoint. */
const quoted = (o: CboeOption | undefined): o is CboeOption =>
  !!o && o.bid > 0 && o.ask >= o.bid && (o.ask - o.bid) / mid(o) <= 0.6;

const MAX_TERM = 24;
const MAX_DAYS = 400;
/** Every expiry in the next ~10 weeks, then only the standard monthly (third-week) expiries. */
const WEEKLY_DAYS = 75;
const isMonthly = (e: string) => {
  const day = Number(e.slice(8, 10));
  return day >= 15 && day <= 21;
};

export function summarizeChain(ticker: string, chain: CboeChain): OptionsSnapshot | null {
  const price = chain.current_price || chain.close || 0;
  const date = (chain.last_trade_time ?? "").slice(0, 10);
  if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // OCC roots drop the class dot (BRK.B options trade as BRKB…)
  const root = cboeSymbol(ticker).replace(/\./g, "");
  const byExp = new Map<string, Map<number, { c?: CboeOption; p?: CboeOption }>>();
  let callOi = 0, putOi = 0, callVol = 0, putVol = 0;
  for (const o of chain.options ?? []) {
    const s = parseOcc(o.option);
    // adjusted contracts after splits and mergers trade under another root; they price a different deliverable
    if (!s || s.root !== root) continue;
    if (s.type === "C") { callOi += o.open_interest || 0; callVol += o.volume || 0; }
    else { putOi += o.open_interest || 0; putVol += o.volume || 0; }
    let ks = byExp.get(s.expiry);
    if (!ks) byExp.set(s.expiry, (ks = new Map()));
    const pair = ks.get(s.strike) ?? {};
    if (s.type === "C") pair.c = o; else pair.p = o;
    ks.set(s.strike, pair);
  }
  const term: TermPoint[] = [];
  let skew25: number | null = null;
  let atmIv: number | null = null;
  let best30 = Infinity;
  for (const e of [...byExp.keys()].sort()) {
    const d = days(date, e);
    if (d < 1 || d > MAX_DAYS) continue;
    const ks = byExp.get(e)!;
    const pairs = [...ks.entries()].filter(([, p]) => quoted(p.c) && quoted(p.p)).sort((a, b) => a[0] - b[0]);
    if (!pairs.length) continue;
    // straddle at the stock price: interpolate between the strikes either side, else the nearest one
    const hi = pairs.findIndex(([k]) => k >= price);
    let straddle: number;
    let k: number;
    let iv: number | null;
    const ivOf = (p: { c?: CboeOption; p?: CboeOption }) => {
      const a = p.c!.iv, b = p.p!.iv;
      return a > 0 && b > 0 ? (a + b) / 2 : a > 0 ? a : b > 0 ? b : null;
    };
    if (hi > 0 && pairs[hi][0] !== price) {
      const [k0, p0] = pairs[hi - 1];
      const [k1, p1] = pairs[hi];
      const w = (price - k0) / (k1 - k0);
      straddle = (1 - w) * (mid(p0.c!) + mid(p0.p!)) + w * (mid(p1.c!) + mid(p1.p!));
      k = w < 0.5 ? k0 : k1;
      const i0 = ivOf(p0), i1 = ivOf(p1);
      iv = i0 != null && i1 != null ? (1 - w) * i0 + w * i1 : i0 ?? i1;
    } else {
      const [k0, p0] = hi === 0 ? pairs[0] : hi < 0 ? pairs[pairs.length - 1] : pairs[hi];
      // too far from the money to stand in for an at-the-money straddle
      if (Math.abs(k0 - price) / price > 0.05) continue;
      straddle = mid(p0.c!) + mid(p0.p!);
      k = k0;
      iv = ivOf(p0);
    }
    if (term.length < MAX_TERM && (d <= WEEKLY_DAYS || (isMonthly(e) && !term.some((t) => t.e.slice(0, 7) === e.slice(0, 7) && t.d > WEEKLY_DAYS))))
      term.push({ e, d, m: round(straddle / price, 5), iv: iv != null ? round(iv, 4) : null, k });
    // skew and at-the-money IV at the expiry nearest 30 days (at least a week out)
    if (d >= 7 && Math.abs(d - 30) < best30) {
      const near = (want: number, side: "c" | "p") => {
        let pick: CboeOption | null = null;
        for (const [, p] of ks) {
          const o = p[side];
          if (!quoted(o) || !(o.iv > 0)) continue;
          if (Math.abs(o.delta - want) < 0.1 && (!pick || Math.abs(o.delta - want) < Math.abs(pick.delta - want))) pick = o;
        }
        return pick;
      };
      const put = near(-0.25, "p");
      const call = near(0.25, "c");
      best30 = Math.abs(d - 30);
      skew25 = put && call ? round(put.iv - call.iv, 4) : null;
      atmIv = iv != null ? round(iv, 4) : null;
    }
  }
  const iv30 = chain.iv30 && chain.iv30 > 0 ? round(chain.iv30 / 100, 4) : null;
  if (!term.length && iv30 == null) return null;
  return { ticker: ticker.toUpperCase(), date, price, iv30, atmIv, skew25, callOi, putOi, callVol, putVol, term };
}

const round = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;

/**
 * The move priced for a report: the straddle of the first expiry after the report date (strictly
 * after, so it covers the reaction whether the company reports before the open or after the close).
 */
export function earningsImpliedMove(term: TermPoint[], reportDate: string, asOf: string): TermPoint | null {
  if (reportDate < asOf) return null;
  const p = term.find((t) => t.e > reportDate);
  return p && days(reportDate, p.e) <= 45 ? p : null;
}

/** Straddle-implied move by a given number of calendar days, read off the nearest expiry at or after it. */
export function impliedMoveBy(term: TermPoint[], d: number): TermPoint | null {
  return term.find((t) => t.d >= d) ?? null;
}

/** Annualised close-to-close volatility over the last n daily returns. */
export function realizedVol(closes: number[], n = 20): number | null {
  if (closes.length < n + 1) return null;
  const xs = closes.slice(-(n + 1));
  const r: number[] = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] > 0) r.push(Math.log(xs[i] / xs[i - 1]));
  if (r.length < n * 0.8) return null;
  const mu = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mu) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 252);
}

/** Minimum recorded days before an implied-volatility rank means anything. */
export const IV_RANK_MIN_DAYS = 20;

/**
 * Where today's implied volatility sits in its own recorded history: rank (0 = lowest, 1 = highest
 * of the range) and percentile (share of days it was lower). Null until enough days are recorded.
 */
export function ivRank(history: number[], current: number): { rank: number; pct: number; n: number; min: number; max: number } | null {
  const xs = history.filter((x) => Number.isFinite(x) && x > 0);
  if (xs.length < IV_RANK_MIN_DAYS) return null;
  const min = Math.min(...xs, current);
  const max = Math.max(...xs, current);
  const rank = max > min ? (current - min) / (max - min) : 0.5;
  const pct = xs.filter((x) => x < current).length / xs.length;
  return { rank, pct, n: xs.length, min, max };
}

/** Row shape of `options_daily`. */
export function snapshotRow(s: OptionsSnapshot) {
  return {
    ticker: s.ticker,
    date: s.date,
    price: s.price,
    iv30: s.iv30,
    atm_iv: s.atmIv,
    skew25: s.skew25,
    call_oi: s.callOi,
    put_oi: s.putOi,
    call_vol: s.callVol,
    put_vol: s.putVol,
    pc_oi: s.callOi > 0 ? round(s.putOi / s.callOi, 4) : null,
    pc_vol: s.callVol > 0 ? round(s.putVol / s.callVol, 4) : null,
    term: s.term,
  };
}

/** Today's priced move for the next report next to how far the stock actually moved after past reports. */
/** Past reactions are compared only when the expiry closes within this many days of the report. */
export const REPORT_EXPIRY_LAG = 10;

export interface EarningsPricing {
  report: string;
  point: TermPoint;
  /** calendar days between the report and the expiry; a long gap also prices ordinary movement */
  lag: number;
  /** past reports: absolute moves (close before the release → close the session after) */
  past: { n: number; median: number; mean: number; /** how many moved more than today's priced move */ exceeded: number } | null;
}

export function earningsPricing(term: TermPoint[], report: string, asOf: string, pastMoves: number[]): EarningsPricing | null {
  const point = earningsImpliedMove(term, report, asOf);
  if (!point) return null;
  const lag = days(report, point.e);
  const abs = lag > REPORT_EXPIRY_LAG ? [] : pastMoves.filter((x) => Number.isFinite(x)).map(Math.abs).sort((a, b) => a - b);
  const past = abs.length
    ? {
        n: abs.length,
        median: abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2,
        mean: abs.reduce((a, b) => a + b, 0) / abs.length,
        exceeded: abs.filter((x) => x > point.m).length,
      }
    : null;
  return { report, point, lag, past };
}
