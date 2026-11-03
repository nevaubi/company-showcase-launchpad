// Server-only fetchers for Yahoo Finance, FRED and the U.S. Treasury Fiscal Data API.
// Shared by the live server functions and the scheduled refresh jobs.
import type { Bar } from "@/lib/financials/types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RESEARCH_UA = "FiledUnder Research research@filedunder.ai";

export interface YahooChartResult {
  meta: {
    currency: string;
    symbol: string;
    longName?: string;
    shortName?: string;
    gmtoffset?: number;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketTime?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    exchangeName?: string;
    fullExchangeName?: string;
  };
  timestamp?: number[];
  indicators: {
    quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
    adjclose?: { adjclose: (number | null)[] }[];
  };
}

interface YahooChart {
  chart: { result?: YahooChartResult[]; error?: { description?: string } | null };
}

const YAHOO_HOSTS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"];

/** Yahoo rate-limits per host; try the alternate host on 429/5xx before giving up. */
export async function yahooGet(path: string) {
  let last = "";
  for (const host of YAHOO_HOSTS) {
    const res = await fetch(`${host}${path}`, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } });
    if (res.ok) return res;
    last = `Yahoo Finance responded ${res.status}`;
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(last);
}

export async function fetchYahoo(symbol: string, range: string, interval: string) {
  const res = await yahooGet(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`);
  const j = (await res.json()) as YahooChart;
  const r = j.chart.result?.[0];
  if (!r) throw new Error(j.chart.error?.description ?? `No data for ${symbol}`);
  return r;
}

export function toBars(r: YahooChartResult, intraday: boolean): Bar[] {
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const ts = r.timestamp ?? [];
  const bars: Bar[] = [];
  const f = (x: number) => Math.round(x * 10000) / 10000;
  ts.forEach((t, i) => {
    const c = q.close[i];
    if (c == null) return;
    const d = intraday ? new Date(t * 1000).toISOString() : new Date((t + (r.meta.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
    bars.push([d, f(q.open[i] ?? c), f(q.high[i] ?? c), f(q.low[i] ?? c), f(c), f(adj?.[i] ?? c), q.volume[i] ?? 0]);
  });
  return bars;
}

/** Run async work with a small concurrency limit (Yahoo throttles bursts; Workers allow six open requests). */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try {
          out[k] = { status: "fulfilled", value: await fn(items[k]) };
        } catch (e) {
          out[k] = { status: "rejected", reason: e };
        }
      }
    }),
  );
  return out;
}

export async function fetchFred(id: string, since?: string): Promise<[string, number][]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}${since ? `&cosd=${since}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": RESEARCH_UA } });
  if (!res.ok) throw new Error(`FRED responded ${res.status} for ${id}`);
  const text = await res.text();
  const out: [string, number][] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const [d, v] = line.split(",");
    const n = Number(v);
    if (d && v && v !== "." && Number.isFinite(n)) out.push([d, n]);
  }
  return out;
}

const FISCAL_API = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const TREASURY: Record<string, { path: string; field: string; filter?: string }> = {
  TSY_DEBT: { path: "/v2/accounting/od/debt_to_penny", field: "tot_pub_debt_out_amt" },
  TSY_DEBT_PUBLIC: { path: "/v2/accounting/od/debt_to_penny", field: "debt_held_public_amt" },
  TSY_AVG_RATE: { path: "/v2/accounting/od/avg_interest_rates", field: "avg_interest_rate_amt", filter: "security_desc:eq:Total Interest-bearing Debt" },
};

export const isTreasurySeries = (id: string) => id in TREASURY;

/** Observations straight from the Treasury's Fiscal Data API (Debt to the Penny, average interest rates). */
export async function fetchTreasury(id: string, since = "2005-01-01", maxPages = 3): Promise<[string, number][]> {
  const spec = TREASURY[id];
  if (!spec) throw new Error(`Unknown Treasury series ${id}`);
  const out: [string, number][] = [];
  for (let page = 1; page <= maxPages; page++) {
    const filter = [`record_date:gte:${since}`, spec.filter].filter(Boolean).join(",");
    const url = `${FISCAL_API}${spec.path}?fields=record_date,${spec.field}&filter=${encodeURIComponent(filter)}&sort=record_date&page[number]=${page}&page[size]=10000`;
    const res = await fetch(url, { headers: { "User-Agent": RESEARCH_UA } });
    if (!res.ok) throw new Error(`Treasury Fiscal Data responded ${res.status} for ${id}`);
    const j = (await res.json()) as { data: Record<string, string>[]; meta: { "total-pages": number } };
    for (const r of j.data) {
      const n = Number(r[spec.field]);
      if (Number.isFinite(n)) out.push([r.record_date, n]);
    }
    if (page >= j.meta["total-pages"]) break;
  }
  return out;
}
