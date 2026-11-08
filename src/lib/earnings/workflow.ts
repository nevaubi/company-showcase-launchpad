import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

/** Earnings workflow files published by the pipeline (etl/earnings.py): preview packs, 8-K scorecards, season view. */

export interface SeasonUpcoming {
  ticker: string;
  name: string;
  sector: string;
  date: string;
  is_estimate: boolean;
  eps: number | null;
  revenue: number | null;
  median_abs_move: number | null;
}

export interface SeasonReported {
  ticker: string;
  name: string;
  sector: string;
  filed: string;
  quarter_end: string;
  eps_actual: number | null;
  eps_estimate: number | null;
  surprise_pct: number | null;
  beat: 1 | 0 | -1 | null;
  move: number | null;
  move_date: string | null;
  spy_move: number | null;
  excess: number | null;
  report_url: string | null;
  score: boolean;
}

export interface SeasonSector {
  sector: string;
  n: number;
  beats: number;
  misses: number;
  inline: number;
  beat_rate: number;
  median_surprise: number | null;
  median_move: number | null;
}

export interface Season {
  generated: string;
  as_of: string;
  window_days: number;
  upcoming: SeasonUpcoming[];
  reported: SeasonReported[];
  sectors: SeasonSector[];
  drivers: {
    n_pairs: number;
    corr_surprise_move: number | null;
    beats: { n: number; median_move: number | null; share_down: number | null };
    misses: { n: number; median_move: number | null };
    basis: string;
  };
}

export interface ScoreMetric {
  id: string;
  label: string;
  value: number | null;
  printed: string | null;
  quote: string | null;
  method: string;
  conflict: string | null;
  yoy_printed: string | null;
  unconfirmed: boolean;
}

export interface Scorecard {
  ticker: string;
  name: string;
  generated: string;
  filed: string;
  accession: string;
  items: string[];
  filing_url: string;
  exhibit_url: string | null;
  quarter_end: string | null;
  metrics: ScoreMetric[];
  kpis: ScoreMetric[];
  guidance: {
    label?: string;
    text?: string;
    quote?: string;
    low?: number | null;
    high?: number | null;
    period?: string;
  }[];
  guided_for_quarter: {
    label?: string;
    low?: number | null;
    high?: number | null;
    actual?: number | null;
    result?: string;
  }[];
  consensus: { basis: string; end?: string; eps?: number | null; revenue?: number | null } | null;
  latency_seconds: number | null;
}

export interface PreviewKpi {
  id: string;
  name: string;
  unit: string;
  industry_kpi: boolean;
  points: { end: string; label: string; v: number; quote?: string }[];
}

export interface Preview {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  generated: string;
  report: {
    date: string;
    is_estimate: boolean;
    call_date: string | null;
    days_until: number;
    source?: { provider: string; url: string };
  };
  last_report: {
    quarter_end: string;
    eps_actual: number | null;
    eps_estimate: number | null;
    surprise_pct: number | null;
    filed: string;
    url: string;
    move: number | null;
  } | null;
  consensus: {
    period: { label: string; end: string };
    eps: {
      avg: number;
      low: number;
      high: number;
      n: number;
      year_ago: number | null;
      yoy: number | null;
    } | null;
    revenue: {
      avg: number;
      low: number;
      high: number;
      n: number;
      year_ago: number | null;
      yoy: number | null;
    } | null;
  } | null;
  street: {
    ratings?: { buy: number; hold: number; sell: number; other: number };
    target_median?: number | null;
    targets_n?: number;
    price?: number | null;
    price_date?: string;
    d90?: {
      since: string;
      count: number;
      upgrades: number;
      downgrades: number;
      initiations: number;
      target_raises: number;
      target_cuts: number;
      median_target_move: number | null;
    };
  } | null;
  kpis: PreviewKpi[];
  guidance:
    | {
        label?: string;
        low?: number | null;
        high?: number | null;
        actual?: number | null;
        result?: string;
        period?: string;
      }[]
    | null;
  reactions: {
    rows: {
      filed: string;
      day0: string;
      timing: string;
      abn: number | null;
      a5: number | null;
      a20: number | null;
    }[];
    summary?: Record<string, number | null>;
  } | null;
  filing_changes: {
    form: string;
    filed: string;
    url: string;
    totals: { added: number; removed: number; modified: number; numbers: number };
    top_sections: { title: string; counts: Record<string, number> }[];
  } | null;
  insiders: {
    since: string;
    buys: number;
    sells: number;
    buy_value: number;
    sell_value: number;
    plan_sells: number;
    discretionary_sell_value: number;
  } | null;
  listen_for: { text: string; refs: string[] }[];
  facts: { id: string; text: string }[];
}

export const seasonQuery = queryOptions({
  queryKey: ["earnings-season"],
  queryFn: () => partnerFile<Season>("earnings/season.json"),
  staleTime: 10 * 60_000,
  retry: false,
});

export const previewQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["earnings-preview", ticker],
    queryFn: () => partnerFile<Preview>(`earnings/preview/${ticker}.json`),
    staleTime: 10 * 60_000,
    retry: false,
  });

export const scoreQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["earnings-score", ticker],
    queryFn: () => partnerFile<Scorecard>(`earnings/score/${ticker}.json`),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "–" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

/** Upcoming reports grouped by date, earliest first. */
export function groupUpcoming(rows: SeasonUpcoming[], tickers?: Set<string>) {
  const map = new Map<string, SeasonUpcoming[]>();
  for (const r of rows) {
    if (tickers && !tickers.has(r.ticker)) continue;
    const list = map.get(r.date) ?? [];
    list.push(r);
    map.set(r.date, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
