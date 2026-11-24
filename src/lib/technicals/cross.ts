// Cross-section of covered companies and sector-peer correlations from the Filed Under quant pipeline
// (etl/quant.py): quant/cross.json (one row per covered symbol on one as-of date, with sector ranks)
// and quant/peers/{SYM}.json (252-day return correlations with the same-sector names).
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export interface CrossFile {
  generated: string;
  as_of: string;
  source?: string;
  cols: string[];
  rows: (string | number | boolean | null)[][];
  rank_keys: string[];
  ranks: Record<string, Record<string, [number, number]>>;
}
export interface PeersFile {
  sym: string;
  as_of: string;
  generated: string;
  window: string;
  n_names: number;
  top: [string, number, string][];
  bottom: [string, number, string][];
  matrix: { names: string[]; c: (number | null)[][]; basis: string };
  sector_median: number | null;
  all_median: number | null;
}
export type CrossRow = {
  sym: string;
  sector: string | null;
  kind: string;
  trend: string | null;
  [k: string]: string | number | boolean | null;
};

export const crossQuery = queryOptions({
  queryKey: ["quant", "cross"],
  queryFn: () => partnerFile<CrossFile>("quant/cross.json"),
  staleTime: 60 * 60_000,
  retry: 0,
});
export const peersQuery = (sym: string) =>
  queryOptions({
    queryKey: ["quant", "peers", sym],
    queryFn: () => partnerFile<PeersFile>(`quant/peers/${sym}.json`),
    staleTime: 60 * 60_000,
    retry: 0,
  });

const sgn = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(d)}%`;
const num = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "–" : v.toFixed(d);

/** Metric labels, formats and definitions, matching the old site's quant page. */
export const METRICS: Record<
  string,
  { label: string; fmt: (v: number | null) => string; def: string; signed?: boolean }
> = {
  r21: {
    label: "1M return",
    fmt: sgn,
    def: "Total return over the last 21 trading days.",
    signed: true,
  },
  r63: {
    label: "3M return",
    fmt: sgn,
    def: "Total return over the last 63 trading days.",
    signed: true,
  },
  r126: {
    label: "6M return",
    fmt: sgn,
    def: "Total return over the last 126 trading days.",
    signed: true,
  },
  r252: {
    label: "1Y return",
    fmt: sgn,
    def: "Total return over the last 252 trading days.",
    signed: true,
  },
  mom12_1: {
    label: "12-1 momentum",
    fmt: sgn,
    def: "Total return from day -252 to day -21 (skips the latest month).",
    signed: true,
  },
  vol60: {
    label: "60d volatility",
    fmt: pct,
    def: "Annualized standard deviation of the last 60 daily returns.",
  },
  beta: {
    label: "Beta vs SPY (252d)",
    fmt: (v) => num(v),
    def: "Slope of daily returns on SPY daily returns over 252 days.",
  },
  corr: {
    label: "Corr vs SPY (252d)",
    fmt: (v) => num(v),
    def: "Correlation of daily returns with SPY over 252 days.",
  },
  beta_sector: {
    label: "Beta vs sector ETF",
    fmt: (v) => num(v),
    def: "Slope of daily returns on the sector ETF's daily returns over 252 days.",
  },
  rs_spy63: {
    label: "3M RS vs SPY",
    fmt: sgn,
    def: "(1 + own 3M return) / (1 + SPY 3M return) - 1.",
    signed: true,
  },
  rs_spy252: {
    label: "1Y RS vs SPY",
    fmt: sgn,
    def: "(1 + own 1Y return) / (1 + SPY 1Y return) - 1.",
    signed: true,
  },
  rs_sector63: {
    label: "3M RS vs sector",
    fmt: sgn,
    def: "(1 + own 3M return) / (1 + sector ETF 3M return) - 1.",
    signed: true,
  },
  rs_sector252: {
    label: "1Y RS vs sector",
    fmt: sgn,
    def: "(1 + own 1Y return) / (1 + sector ETF 1Y return) - 1.",
    signed: true,
  },
  from_hi: {
    label: "From 52w high",
    fmt: sgn,
    def: "Last close / highest close of the last 252 days - 1.",
    signed: true,
  },
  sharpe1y: {
    label: "Sharpe 1y",
    fmt: (v) => num(v),
    def: "Annualized mean daily excess return / annualized volatility, last 252 days.",
  },
  maxdd: {
    label: "Max drawdown",
    fmt: pct,
    def: "Largest peak-to-trough fall of the total-return index over the last 252 days.",
  },
  hurst: {
    label: "Hurst",
    fmt: (v) => num(v),
    def: "Hurst exponent of daily returns (0.5 = random walk, above = trending).",
  },
  ff_r2: {
    label: "6-factor R² (3y)",
    fmt: (v) => num(v),
    def: "Share of daily return variance explained by the six Fama-French/momentum factors over 3 years.",
  },
  earn_abs: {
    label: "Avg |earnings reaction|",
    fmt: pct,
    def: "Mean absolute next-day return after the earnings releases on file.",
  },
  avg_corr: {
    label: "Avg corr to covered names",
    fmt: (v) => num(v),
    def: "Mean 252-day return correlation with every other covered company.",
  },
};
export const SCATTER_KEYS = Object.keys(METRICS);

export function rowsOf(X: CrossFile): CrossRow[] {
  return X.rows.map((r) => Object.fromEntries(X.cols.map((c, k) => [c, r[k]])) as CrossRow);
}

/** Linear-interpolated quantile of an already sorted array. */
export function quantileSorted(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const i = (xs.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
}

/** Ordinary least squares y = a + b x and the Pearson correlation. */
export function ols(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { a: NaN, b: NaN, r: NaN, n };
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN, n };
}

/** Share of sector names ranked below this one: rank 1 of m -> 1, rank m of m -> 0. */
export const percentileOfRank = (rank: number, of: number) =>
  of > 1 ? 1 - (rank - 1) / (of - 1) : 1;

/** Round tick values inside [lo, hi]: steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
  const raw = (hi - lo) / Math.max(1, count - 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * p).find((k) => k >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toFixed(12)));
  return out;
}
