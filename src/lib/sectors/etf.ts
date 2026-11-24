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
  const shared = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  const dates = shared.slice(-(sessions + 1));
  if (dates.length < 21) return empty;
  const rets = maps.map((m) => {
    const out: number[] = [];
    for (let i = 1; i < dates.length; i++) out.push(m.get(dates[i])! / m.get(dates[i - 1])! - 1);
    return out;
  });
  const bi = symbols.indexOf(bench);
  return {
    symbols,
    from: dates[1],
    to: dates[dates.length - 1],
    sessions: dates.length - 1,
    vol: rets.map((r) => {
      const s = sd(r);
      return s == null ? null : s * Math.sqrt(252);
    }),
    beta: rets.map((r, i) => (bi < 0 ? null : i === bi ? 1 : (betaR2(r, rets[bi])?.beta ?? null))),
    corr: rets.map((a, i) => rets.map((b, j) => (i === j ? 1 : pearson(a, b)))),
  };
}
