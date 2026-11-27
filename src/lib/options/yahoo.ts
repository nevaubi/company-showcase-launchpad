// Yahoo Finance option chains → the chain shape `summarizeChain` reads. Pure: no fetches.
//
// Yahoo returns every expiry of a stock in one response (`getAllData=true`): bid, ask, volume and open
// interest per contract. Its own "impliedVolatility" is not used: it is computed from the last trade
// and is meaningless when a contract did not trade. Implied volatility and delta are computed here
// from the quoted midpoint (`pricing.ts`), on each expiry's forward read from its own quotes by
// put-call parity, discounted at the 3-month Treasury yield the caller passes in.
//
// Yahoo's quotes are two-sided only around the session (see `usableState`): a chain read before the
// open shows zero bids and is never stored.
import type { ChainOption, OptionChain } from "./core";
import { forwardDelta, impliedVol, parityForward, type Right } from "./pricing";

export interface YahooContract {
  contractSymbol: string;
  strike: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
}
export interface YahooOptionsResult {
  underlyingSymbol?: string;
  expirationDates?: number[];
  quote?: { regularMarketPrice?: number; regularMarketTime?: number; marketState?: string; regularMarketPreviousClose?: number };
  options?: { expirationDate: number; calls?: YahooContract[]; puts?: YahooContract[] }[];
}

export const YAHOO_HOSTS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"] as const;
/** Our tickers and Yahoo's both write share classes with a dash (BRK-B). */
export const yahooSymbol = (ticker: string) => ticker.toUpperCase().replace(/\./g, "-");
export const yahooOptionsPath = (ticker: string, crumb: string) => `/v7/finance/options/${encodeURIComponent(yahooSymbol(ticker))}?getAllData=true&crumb=${encodeURIComponent(crumb)}`;
/** Public page a reader can open to check the same quotes. */
export const yahooQuotePage = (ticker: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol(ticker))}/options/`;

const NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** New York calendar day and minutes past midnight of an instant. */
export function newYork(ms: number): { date: string; minutes: number } {
  const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p["year"]}-${p["month"]}-${p["day"]}`, minutes: Number(p["hour"]) * 60 + Number(p["minute"]) };
}

const CLOSE_MIN = 16 * 60;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const isoDay = (epochS: number) => new Date(epochS * 1000).toISOString().slice(0, 10);
/** Same rule as the summary's: a two-sided quote tight enough to trust its midpoint. */
const tight = (c: YahooContract | undefined): c is YahooContract & { bid: number; ask: number } =>
  !!c && (c.bid ?? 0) > 0 && (c.ask ?? 0) >= (c.bid ?? 0) && ((c.ask ?? 0) - (c.bid ?? 0)) / (((c.ask ?? 0) + (c.bid ?? 0)) / 2) <= 0.6;
const midOf = (c: { bid: number; ask: number }) => (c.bid + c.ask) / 2;

export interface YahooRead {
  chain: OptionChain;
  /** what the chain held and how it was read: stored with the row so a figure can be reproduced */
  meta: {
    /** Yahoo's market state when read (REGULAR, POST, POSTPOST, CLOSED, PREPRE, PRE) */
    state: string;
    /** the stock quote's time, ISO */
    quoted: string;
    /** annual rate used for discounting (fraction), and the day it was published */
    rate: number;
    rateDate: string | null;
    expiries: number;
    contracts: number;
    /** contracts with a tight two-sided quote */
    twoSided: number;
    /** expiries whose forward could be read from a call and put at one strike */
    forwards: number;
  };
}

/**
 * Read a Yahoo options result. Null when it lists no contract at all (the stock has no listed
 * options). `rate` is the annualised risk-free rate as a fraction (0.0436).
 */
export function yahooChain(result: YahooOptionsResult | null | undefined, rate: number, rateDate: string | null = null): YahooRead | null {
  const q = result?.quote;
  const price = q?.regularMarketPrice ?? 0;
  const at = q?.regularMarketTime ?? 0;
  const blocks = result?.options ?? [];
  if (!(price > 0) || !(at > 0) || !blocks.some((b) => (b.calls?.length ?? 0) + (b.puts?.length ?? 0) > 0)) return null;
  const now = newYork(at * 1000);
  // time left today until the options close, as a fraction of a day; none once the session is over
  // (an early close ends before 16:00, so the state decides, not the clock)
  const today = q?.marketState === "REGULAR" ? Math.max(0, CLOSE_MIN - now.minutes) / 1440 : 0;
  const out: ChainOption[] = [];
  let contracts = 0;
  let twoSided = 0;
  let forwards = 0;
  for (const b of blocks) {
    const expiry = isoDay(b.expirationDate);
    const d = dayDiff(now.date, expiry);
    const t = (d + today) / 365;
    const df = t > 0 ? Math.exp(-rate * t) : 1;
    const calls = b.calls ?? [];
    const puts = b.puts ?? [];
    contracts += calls.length + puts.length;
    // forward: parity at the strike where the call and the put are closest in price
    let forward: number | null = null;
    if (t > 0) {
      const putAt = new Map(puts.filter(tight).map((p) => [p.strike, p]));
      let gap = Infinity;
      for (const c of calls) {
        const p = putAt.get(c.strike);
        if (!tight(c) || !p) continue;
        const g = Math.abs(midOf(c) - midOf(p));
        if (g < gap) {
          gap = g;
          forward = parityForward(c.strike, midOf(c), midOf(p), df);
        }
      }
      if (forward != null && !(forward > 0)) forward = null;
      if (forward != null) forwards++;
    }
    const add = (c: YahooContract, right: Right) => {
      const ok = tight(c);
      if (ok) twoSided++;
      const iv = ok && forward != null ? impliedVol(right, midOf(c), forward, c.strike, t, df) : null;
      out.push({
        option: c.contractSymbol,
        bid: c.bid ?? 0,
        ask: c.ask ?? 0,
        iv: iv ?? 0,
        open_interest: c.openInterest ?? 0,
        volume: c.volume ?? 0,
        delta: iv != null && forward != null ? forwardDelta(right, forward, c.strike, t, iv) : 0,
      });
    };
    for (const c of calls) add(c, "C");
    for (const p of puts) add(p, "P");
  }
  const hh = String(Math.floor(now.minutes / 60)).padStart(2, "0");
  const mm = String(now.minutes % 60).padStart(2, "0");
  return {
    chain: {
      symbol: result?.underlyingSymbol ?? "",
      current_price: price,
      ...(q?.regularMarketPreviousClose != null ? { prev_day_close: q.regularMarketPreviousClose } : {}),
      last_trade_time: `${now.date}T${hh}:${mm}:00`,
      options: out,
    },
    meta: { state: q?.marketState ?? "", quoted: new Date(at * 1000).toISOString(), rate, rateDate, expiries: blocks.length, contracts, twoSided, forwards },
  };
}
