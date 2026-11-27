// What a reader is told about where an options snapshot came from. Pure.
//
// A row keeps its source (`options_daily.source`), and nothing compares rows across sources: Cboe's
// IV30 is Cboe's own figure, the Yahoo rows' 30-day volatility is computed from the chain.
import { SOURCE_NAME, type Iv30Basis, type OptionsSource } from "./core";
import { newYork, yahooQuotePage } from "./yahoo";

const cboeSymbol = (ticker: string) => ticker.toUpperCase().replace(/-/g, ".");

/** How a snapshot was read; stored with the row (`options_daily.meta`). Cboe rows carry none. */
export interface OptionsMeta {
  /** market state when read (REGULAR, POST, POSTPOST, CLOSED) */
  state?: string;
  /** the stock quote's time, ISO */
  quoted?: string;
  /** annual rate used for discounting (fraction) and the day it was published */
  rate?: number;
  rateDate?: string | null;
  expiries?: number;
  contracts?: number;
  twoSided?: number;
  forwards?: number;
  iv30From?: Iv30Basis | null;
  /** direct from the source, or through the page reader when the source refused the collector */
  route?: "direct" | "reader";
}

export const sourceOf = (row: { source?: string | null } | null | undefined): OptionsSource => (row?.source === "yahoo" ? "yahoo" : "cboe");
export const sourceName = (row: { source?: string | null } | null | undefined): string => SOURCE_NAME[sourceOf(row)];
/** Short description of the quotes, for a panel subtitle. */
export const sourceQuotes = (row: { source?: string | null } | null | undefined): string => (sourceOf(row) === "yahoo" ? "Yahoo Finance quotes" : "Cboe delayed quotes");

/** Public page a reader can open to check the same quotes. */
export function quotePage(ticker: string, row: { source?: string | null } | null | undefined): string {
  return sourceOf(row) === "yahoo" ? yahooQuotePage(ticker) : `https://www.cboe.com/delayed_quotes/${cboeSymbol(ticker).toLowerCase()}/quote_table`;
}

/** The newest row's source and every older row of that same source (rows newest first). */
export function sameSource<T extends { source?: string | null }>(rows: readonly T[]): T[] {
  if (!rows.length) return [];
  const s = sourceOf(rows[0]);
  return rows.filter((r) => sourceOf(r) === s);
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * When the quotes were taken, in New York time, or null when the row does not say (Cboe rows).
 * `atClose`: the session was over when the chain was read, so the quotes are its last.
 */
export function quotedAt(meta: OptionsMeta | null | undefined): { time: string; atClose: boolean } | null {
  const ms = meta?.quoted ? Date.parse(meta.quoted) : NaN;
  if (!Number.isFinite(ms)) return null;
  const { minutes } = newYork(ms);
  return { time: hhmm(minutes), atClose: meta?.state !== "REGULAR" };
}

/** "close" or "quotes of 15:42 New York": what the snapshot's prices are, in a few words. */
export function quoteMoment(meta: OptionsMeta | null | undefined): string {
  const q = quotedAt(meta);
  return !q || q.atClose ? "close" : `${q.time} New York quotes`;
}

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

/** One sentence on how a row's 30-day implied volatility was obtained. */
export function iv30Basis(row: { source?: string | null; meta?: OptionsMeta | null }): string {
  if (sourceOf(row) === "cboe") return "Cboe's own 30-day implied volatility for the stock";
  const b = row.meta?.iv30From;
  if (b?.kind === "between")
    return `At-the-money implied volatility interpolated to 30 days in total variance between the ${b.lo.e} expiry (${b.lo.d} days, ${pc(b.lo.iv)}) and the ${b.hi.e} expiry (${b.hi.d} days, ${pc(b.hi.iv)}); each computed from the quoted call and put midpoints at the strikes around the stock price`;
  if (b?.kind === "single") return `At-the-money implied volatility of the ${b.at.e} expiry (${b.at.d} days, ${pc(b.at.iv)}), the only expiry listed near 30 days; computed from the quoted call and put midpoints at the strikes around the stock price`;
  return "At-the-money implied volatility near 30 days, computed from the quoted call and put midpoints";
}

/** One sentence on how implied volatility and delta are obtained for a row's source. */
export function volMethod(row: { source?: string | null; meta?: OptionsMeta | null }): string {
  if (sourceOf(row) === "cboe") return "implied volatility and delta as Cboe publishes them";
  const r = row.meta?.rate;
  return `implied volatility and delta computed from each quote's midpoint (Black 1976 on the forward read from the chain by put-call parity${r != null ? `, discounted at ${(r * 100).toFixed(2)}%` : ""})`;
}
