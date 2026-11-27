// Risk and co-movement of the sector funds: annualised volatility, beta to the benchmark and the
// correlation of daily returns, all on one shared calendar so every pair uses the same sessions. Pure.
import { betaR2, pearson } from "@/lib/markets/core";

/** Bars as [date, adjusted close] pairs, oldest first. */
export type Closes = readonly (readonly [string, number])[];

export interface FundRisk {
  /** Symbols in the order given; the benchmark is among them. */
  symbols: string[];
  /** First and last session of the returns used, and how many returns. */
  from: string | null;
  to: string | null;
  sessions: number;
  /** Standard deviation of daily returns × √252. */
  vol: (number | null)[];
  /** OLS beta of each symbol's daily returns on the benchmark's; 1 for the benchmark itself. */
  beta: (number | null)[];
  /** Pearson correlation of daily returns; the diagonal is 1. */
  corr: (number | null)[][];
}

const sd = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Volatility, beta and correlations over the last `sessions` daily returns on the dates every series has.
 * Fewer than 20 shared returns give an empty result (figures on a handful of days would mislead).
 */
export function fundRisk(series: readonly { symbol: string; closes: Closes }[], bench: string, sessions = 252): FundRisk {
  const symbols = series.map((s) => s.symbol);
  const empty: FundRisk = { symbols, from: null, to: null, sessions: 0, vol: symbols.map(() => null), beta: symbols.map(() => null), corr: symbols.map(() => symbols.map(() => null)) };
  if (!series.length) return empty;
  const maps = series.map((s) => new Map(s.closes.filter(([, v]) => v > 0).map(([d, v]) => [d, v])));
  const bi = symbols.indexOf(bench);
  // Keep consecutive endpoints on the benchmark's calendar. A missing ETF
  // close invalidates two daily returns, even if both surrounding closes exist.
  const calendar = [...maps[bi >= 0 ? bi : 0].keys()].sort();
  const pairs = calendar.slice(1).map((to, i) => [calendar[i], to])
    .slice(-sessions)
    .filter(([from, to]) => maps.every((m) => m.has(from) && m.has(to)));
  if (pairs.length < 20) return empty;
  const rets = maps.map((m) => pairs.map(([from, to]) => m.get(to)! / m.get(from)! - 1));
  return {
    symbols,
    from: pairs[0][1],
    to: pairs[pairs.length - 1][1],
    sessions: pairs.length,
    vol: rets.map((r) => {
      const s = sd(r);
      return s == null ? null : s * Math.sqrt(252);
    }),
    beta: rets.map((r, i) => (bi < 0 ? null : i === bi ? 1 : (betaR2(r, rets[bi])?.beta ?? null))),
    corr: rets.map((a, i) => rets.map((b, j) => (i === j ? 1 : pearson(a, b)))),
  };
}
