// Long daily history, per-symbol quant statistics and market-wide technical datasets from the Filed Under
// pipeline (etl/technicals.py, etl/quant.py), served through the partner data service.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

/** File key used by the pipeline: ^TNX → IDX_TNX, CL=F → CL_F. */
export const symKey = (s: string) => s.toUpperCase().replace("^", "IDX_").replace("=", "_");

interface BarsFile {
  meta: {
    symbol: string;
    source?: string;
    source_url?: string;
    retrieved?: string;
    updated?: string;
    start?: string;
    first_trade?: string;
  };
  d: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  div?: [string, number][];
  splits?: [string, string][];
}
export interface Hist {
  sym: string;
  n: number;
  d: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  /** Total-return index, dividends reinvested on the ex-date */
  tr: number[];
  idx: Map<string, number>;
  meta: BarsFile["meta"];
  splits: [string, string][];
  file: string;
  /** Sessions appended from live daily bars after the stored history ends */
  live?: number;
}

export function toHist(sym: string, p: BarsFile): Hist {
  const n = p.d.length;
  const dv = new Map<string, number>();
  for (const [d, a] of p.div ?? []) dv.set(d, (dv.get(d) ?? 0) + a);
  const tr = new Array<number>(n);
  let acc = 1;
  for (let i = 0; i < n; i++) {
    if (i) acc *= (p.c[i] + (dv.get(p.d[i]) ?? 0)) / p.c[i - 1];
    tr[i] = acc;
  }
  return {
    sym,
    n,
    d: p.d,
    o: p.o,
    h: p.h,
    l: p.l,
    c: p.c,
    v: p.v,
    tr,
    idx: new Map(p.d.map((x, i) => [x, i])),
    meta: p.meta,
    splits: p.splits ?? [],
    file: `tech/bars/${symKey(sym)}.json`,
  };
}

const H = 3600_000;
export const histQuery = (sym: string) =>
  queryOptions({
    queryKey: ["tech", "bars", sym],
    queryFn: async () => toHist(sym, await partnerFile<BarsFile>(`tech/bars/${symKey(sym)}.json`)),
    staleTime: H,
    retry: 0,
  });

export interface SignalStat {
  n: number;
  months: number;
  mean: number;
  median?: number;
  hit: number;
  ci?: [number, number];
  excess?: number;
  excess_ci?: [number, number];
  by_period?: Record<
    string,
    { n: number; months: number; mean: number; excess: number | null; hit: number }
  >;
}
export interface SignalsFile {
  generated: string;
  as_of: string;
  horizons: number[];
  method: string;
  caveats: string[];
  base: Record<string, Record<string, { n: number; mean: number; hit: number; median?: number }>>;
  signals: Record<
    string,
    { symbols: number; events: number; first: string; last: string } & Record<string, SignalStat>
  >;
}
export const signalsQuery = queryOptions({
  queryKey: ["tech", "signals"],
  queryFn: () => partnerFile<SignalsFile>("tech/signals.json"),
  staleTime: H,
  retry: 0,
});

export interface StateRow {
  t: string;
  sector: string;
  d: string;
  close: number;
  trend: "up" | "down" | "mixed" | null;
  rsi: number | null;
  vs50: number | null;
  vs200: number | null;
  from_hi: number | null;
  from_lo: number | null;
  squeeze: number;
  adx: number | null;
  st: number | null;
  macd_hist: number | null;
  vol21: number | null;
  vol21_pct: number | null;
  r21: number | null;
  r63: number | null;
  r252: number | null;
  rs63: number | null;
  events: [string, string][];
}
export const statesQuery = queryOptions({
  queryKey: ["tech", "states"],
  queryFn: () =>
    partnerFile<{ generated: string; as_of: string; rows: StateRow[] }>("tech/states.json"),
  staleTime: H,
  retry: 0,
});

export interface BreadthFile {
  generated: string;
  source: string;
  caveat: string;
  d: string[];
  n50: number[];
  above50: number[];
  n200: number[];
  above200: number[];
  n52: number[];
  new_high: number[];
  new_low: number[];
  adv: number[];
  dec: number[];
}
export const breadthQuery = queryOptions({
  queryKey: ["tech", "breadth"],
  queryFn: () => partnerFile<BreadthFile>("tech/breadth.json"),
  staleTime: H,
  retry: 0,
});

/* ---------- quant ---------- */
type Num = number | null;
export interface QuantFile {
  sym: string;
  name: string;
  sector_etf?: string;
  as_of: string;
  first: string;
  bars: number;
  generated: string;
  bars_source: string;
  rf_source: string;
  stats: {
    daily: {
      mean: number;
      sd: number;
      min: number;
      max: number;
      up: number;
      n: number;
      skew: number;
      kurt: number;
      beyond3: number;
      normal3: number;
    };
    vol: Record<
      string,
      {
        now: number;
        pct: number;
        p10: number;
        p50: number;
        p90: number;
        max: number;
        min: number;
        count: number;
        since: string;
      }
    >;
    dd: {
      top: {
        peak: string;
        trough: string;
        recovered: string | null;
        depth: number;
        to_trough: number;
        to_recover: number | null;
        length: number;
      }[];
    } & Record<string, unknown>;
    perf: Record<
      string,
      {
        n: number;
        sharpe: number;
        sortino: number;
        ann_return: number;
        ann_vol: number;
        ann_excess: number;
        rf_ann: number;
        from: string;
      }
    >;
    capture: Record<
      string,
      Record<
        string,
        {
          up: number;
          down: number;
          ratio: number;
          n_up: number;
          n_down: number;
          from: string;
          to: string;
        }
      >
    >;
    var: Record<string, { n: number; "95": [number, number]; "99": [number, number] }>;
    hurst: { h: number; r2: number; n: number };
    vr: { q: number; vr: number; z: number; p: number; n: number }[];
  } & Record<string, unknown>;
  corr: {
    bench: Record<
      string,
      {
        c63: Num;
        b63: Num;
        c252: Num;
        b252: Num;
        r2_252: Num;
        full: { corr: number; beta: number; n: number; from: string };
        updown?: { corr_up: number; corr_down: number; beta_up: number; beta_down: number };
      }
    >;
    macro: Record<
      string,
      {
        label: string;
        transform: string;
        c252: Num;
        b252: Num;
        c_full: Num;
        b_full: Num;
        n: number;
        from: string;
      }
    >;
    factors?: {
      as_of: string;
      source: string;
      source_url: string;
      windows: Record<
        string,
        {
          n: number;
          from: string;
          to: string;
          r2: number;
          adj_r2: number;
          alpha_ann: number;
          alpha_t: number;
          alpha_p: number;
          coef: Record<string, number>;
          t: Record<string, number>;
          p: Record<string, number>;
        }
      >;
    };
  };
  events: {
    source: string;
    cols: string[];
    typical_abs_ar: number;
    earnings?: {
      basis: string;
      stats: {
        n: number;
        mean_abs_cc: number;
        median_abs_cc: number;
        mean_cc: number;
        up_share: number;
        mean_abn: number;
        abn_t: number;
        abn_p: number;
        mean_abs_abn: number;
        abs_ratio: number;
        mean_abs_gap: number;
        drift5: { n: number; mean: number; t: number; p: number; hit: number };
        drift20: { n: number; mean: number; t: number; p: number; hit: number };
      };
      rows: (string | number | null)[][];
    };
    material?: {
      basis: string;
      items: {
        n: number;
        item: string;
        name: string;
        mean_abs_abn: number;
        abs_ratio: number;
        mean_abn: number;
        abn_p: number;
      }[];
    };
  };
  season: {
    month: {
      m: number;
      n: number;
      mean: number;
      median: number;
      hit: number;
      t: number;
      p: number;
      vs_rest: number;
      vs_rest_p: number;
      sig: string;
    }[];
    dow: {
      wd: number;
      n: number;
      mean: number;
      hit: number;
      t: number;
      p: number;
      vs_rest_p: number;
      sig: string;
    }[];
  } & Record<string, unknown>;
  regimes: {
    current: {
      trend: "up" | "down" | "transition";
      vol: "low" | "normal" | "high";
      vol_pct: number;
      v20: number;
      sma50: number;
      sma200: number;
      close: number;
      trend_since: string;
      vol_since: string;
    };
    table: { key: string; days: number; share: number; fwd20: number; hit: number }[];
    trend_runs: [string, string, string][];
    vol_runs?: [string, string, string][];
  };
  backtests: {
    start: string;
    end: string;
    days: number;
    d: string[];
    rules: Record<
      string,
      {
        cagr: number;
        vol: number;
        sharpe: number;
        maxdd: number;
        total: number;
        exposure: number;
        trades: number;
        hit: number | null;
        avg_trade: number | null;
        avg_hold: number | null;
        in_market: boolean;
        open?: { entry: string; ret: number; days: number } | null;
        last_trades: [string, string, number][];
        curve: number[];
      }
    >;
  };
}
export const quantQuery = (sym: string) =>
  queryOptions({
    queryKey: ["quant", sym],
    queryFn: () => partnerFile<QuantFile>(`quant/t/${symKey(sym)}.json`),
    staleTime: H,
    retry: 0,
  });
export const methodsQuery = queryOptions({
  queryKey: ["quant", "methods"],
  queryFn: () => partnerFile<Record<string, string>>("quant/methods.json"),
  staleTime: H,
  retry: 0,
});
export interface QuantRead {
  model: string;
  generated: string;
  as_of: string;
  sentences: { text: string; refs: string[] }[];
  facts: Record<string, [string, string]>;
  label: string;
}
export const quantReadQuery = (sym: string) =>
  queryOptions({
    queryKey: ["quant", "read", sym],
    queryFn: () => partnerFile<QuantRead>(`quant/read/${symKey(sym)}.json`),
    staleTime: H,
    retry: 0,
  });

export const RULE_NAME: Record<string, string> = {
  sma_cross: "50/200-day trend filter",
  rsi_mr: "RSI(2) mean reversion",
  breakout: "20-day breakout",
  bh: "Buy and hold",
};
export const FACTOR_NAME: Record<string, string> = {
  mkt_rf: "Market",
  smb: "Size (small minus big)",
  hml: "Value",
  rmw: "Profitability",
  cma: "Investment (conservative)",
  mom: "Momentum",
};
