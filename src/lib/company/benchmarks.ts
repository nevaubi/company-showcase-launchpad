// Company vs peers / industry / sector medians, from the SEC-built universe snapshot. Pure.
import type { UniverseEntry } from "@/lib/financials/types";

export type MetricKey = "mcap" | "pe" | "evEbitda" | "growth" | "cagr5" | "gm" | "opm" | "nm" | "fcfYield" | "roe" | "leverage" | "shYield";

export const METRICS: { key: MetricKey; label: string; kind: "usd" | "x" | "pct"; better: "high" | "low" }[] = [
  { key: "mcap", label: "Market cap", kind: "usd", better: "high" },
  { key: "pe", label: "P/E", kind: "x", better: "low" },
  { key: "evEbitda", label: "EV / EBITDA", kind: "x", better: "low" },
  { key: "growth", label: "Revenue growth", kind: "pct", better: "high" },
  { key: "cagr5", label: "5Y revenue CAGR", kind: "pct", better: "high" },
  { key: "gm", label: "Gross margin", kind: "pct", better: "high" },
  { key: "opm", label: "Operating margin", kind: "pct", better: "high" },
  { key: "nm", label: "Net margin", kind: "pct", better: "high" },
  { key: "fcfYield", label: "FCF yield", kind: "pct", better: "high" },
  { key: "roe", label: "Return on equity", kind: "pct", better: "high" },
  { key: "leverage", label: "Net debt / EBITDA", kind: "x", better: "low" },
  { key: "shYield", label: "Shareholder yield", kind: "pct", better: "high" },
];

export type Metrics = Record<MetricKey, number | null>;

const div = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null);

export function metricsOf(c: UniverseEntry, price: number | null): Metrics {
  const t = c.f?.ttm ?? {};
  const bs = c.f?.bs ?? {};
  const mcap = price && c.sharesOutstanding ? price * c.sharesOutstanding : null;
  const ev = mcap != null ? mcap + (bs.netDebt ?? 0) : null;
  const pe = div(price, c.epsTTM);
  const ebitda = t.ebitda ?? null;
  const equity = bs.equity ?? null;
  return {
    mcap,
    pe: pe != null && pe > 0 ? pe : null,
    evEbitda: ebitda && ebitda > 0 ? div(ev, ebitda) : null,
    growth: c.revenueGrowthYoY,
    cagr5: c.f?.revenueCagr5y ?? null,
    gm: c.grossMarginTTM,
    opm: div(t.operatingIncome, t.revenue),
    nm: div(t.netIncome, t.revenue),
    fcfYield: div(t.fcf, mcap),
    roe: equity && equity > 0 ? div(t.netIncome, equity) : null,
    leverage: ebitda && ebitda > 0 && bs.netDebt != null ? bs.netDebt / ebitda : null,
    shYield: mcap ? ((t.buybacks ?? 0) + (t.dividends ?? 0)) / mcap : null,
  };
}

export function median(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function medians(rows: Metrics[]): Metrics {
  return Object.fromEntries(METRICS.map((m) => [m.key, median(rows.map((r) => r[m.key]))])) as Metrics;
}

/** Rank of `value` in `group` (1 = best), with the group size. */
export function rankIn(value: number | null, group: (number | null)[], better: "high" | "low"): { rank: number; of: number } | null {
  if (value == null) return null;
  const v = group.filter((x): x is number => x != null && Number.isFinite(x));
  const rank = 1 + v.filter((x) => (better === "high" ? x > value : x < value)).length;
  return { rank, of: v.length };
}
