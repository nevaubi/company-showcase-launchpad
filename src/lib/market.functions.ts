import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Bar, MacroSeries, PriceSeries } from "@/lib/financials/types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const symbolSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[\^A-Za-z0-9.=-]+$/);

const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max"] as const;
const INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk", "1mo"] as const;

interface YahooChart {
  chart: {
    result?: {
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
    }[];
    error?: { description?: string } | null;
  };
}

const YAHOO_HOSTS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"];

/** Yahoo rate-limits per host; try the alternate host on 429/5xx before giving up. */
async function yahooGet(path: string) {
  let last = "";
  for (const host of YAHOO_HOSTS) {
    const res = await fetch(`${host}${path}`, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } });
    if (res.ok) return res;
    last = `Yahoo Finance responded ${res.status}`;
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(last);
}

async function fetchYahoo(symbol: string, range: string, interval: string) {
  const res = await yahooGet(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`);
  const j = (await res.json()) as YahooChart;
  const r = j.chart.result?.[0];
  if (!r) throw new Error(j.chart.error?.description ?? `No data for ${symbol}`);
  return r;
}

/** Run async work with a small concurrency limit (Yahoo throttles bursts). */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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

function toBars(r: NonNullable<YahooChart["chart"]["result"]>[number], intraday: boolean): Bar[] {
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const ts = r.timestamp ?? [];
  const bars: Bar[] = [];
  const f = (x: number) => Math.round(x * 10000) / 10000;
  ts.forEach((t, i) => {
    const c = q.close[i];
    if (c == null) return;
    const d = intraday
      ? new Date(t * 1000).toISOString()
      : new Date((t + (r.meta.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
    bars.push([d, f(q.open[i] ?? c), f(q.high[i] ?? c), f(q.low[i] ?? c), f(c), f(adj?.[i] ?? c), q.volume[i] ?? 0]);
  });
  return bars;
}

export const getPriceSeries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ symbol: symbolSchema, range: z.enum(RANGES).default("1y"), interval: z.enum(INTERVALS).default("1d") })
      .parse(d),
  )
  .handler(async ({ data }): Promise<PriceSeries> => {
    const r = await fetchYahoo(data.symbol, data.range, data.interval);
    const intraday = !["1d", "1wk", "1mo"].includes(data.interval);
    return {
      symbol: r.meta.symbol,
      name: r.meta.longName ?? r.meta.shortName,
      currency: r.meta.currency,
      interval: data.interval,
      bars: toBars(r, intraday),
      fetchedAt: new Date().toISOString(),
      source: "yahoo-live",
    };
  });

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  high52?: number;
  low52?: number;
  exchange?: string;
  marketTime?: string;
  spark: number[];
}

export const getQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ symbols: z.array(symbolSchema).min(1).max(40) }).parse(d))
  .handler(async ({ data }): Promise<{ quotes: Quote[]; errors: string[] }> => {
    const results = await pool(data.symbols, 4, async (s) => {
        const r = await fetchYahoo(s, "5d", "1d");
        const closes = (r.indicators.quote[0]?.close ?? []).filter((x): x is number => x != null);
        const price = r.meta.regularMarketPrice ?? closes.at(-1) ?? 0;
        const prev = closes.length >= 2 ? closes[closes.length - 2] : (r.meta.chartPreviousClose ?? price);
        const q: Quote = {
          symbol: r.meta.symbol,
          name: r.meta.longName ?? r.meta.shortName,
          price,
          previousClose: prev,
          change: price - prev,
          changePct: prev ? price / prev - 1 : 0,
          dayHigh: r.meta.regularMarketDayHigh,
          dayLow: r.meta.regularMarketDayLow,
          volume: r.meta.regularMarketVolume,
          high52: r.meta.fiftyTwoWeekHigh,
          low52: r.meta.fiftyTwoWeekLow,
          exchange: r.meta.fullExchangeName ?? r.meta.exchangeName,
          marketTime: r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : undefined,
          spark: closes,
        };
        return q;
    });
    const quotes: Quote[] = [];
    const errors: string[] = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? quotes.push(r.value) : errors.push(data.symbols[i])));
    return { quotes, errors };
  });

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  thumbnail?: string;
  tickers: string[];
}

export async function fetchYahooNews(query: string, count = 12): Promise<NewsItem[]> {
  const res = await yahooGet(`/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${count}&quotesCount=0&enableFuzzyQuery=false`);
  const j = (await res.json()) as {
    news?: {
      uuid: string;
      title: string;
      publisher: string;
      link: string;
      providerPublishTime: number;
      relatedTickers?: string[];
      thumbnail?: { resolutions?: { url: string; width: number }[] };
    }[];
  };
  return (j.news ?? []).map((n) => ({
    id: n.uuid,
    title: n.title,
    publisher: n.publisher,
    link: n.link,
    publishedAt: new Date(n.providerPublishTime * 1000).toISOString(),
    thumbnail: n.thumbnail?.resolutions?.sort((a, b) => a.width - b.width).find((r) => r.width >= 140)?.url,
    tickers: n.relatedTickers ?? [],
  }));
}

export const getNews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => ({ items: await fetchYahooNews(data.query, 12) }));

export async function fetchFred(id: string, since?: string): Promise<[string, number][]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}${since ? `&cosd=${since}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": "FiledUnder Research research@filedunder.ai" } });
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

export const getMacroSeries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().regex(/^[A-Z0-9]{2,24}$/),
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        title: z.string().max(120).default(""),
        units: z.string().max(80).default(""),
        frequency: z.string().max(30).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<MacroSeries> => {
    const observations = await fetchFred(data.id, data.since);
    return {
      id: data.id,
      title: data.title,
      units: data.units,
      frequency: data.frequency,
      observations,
      fetchedAt: new Date().toISOString(),
      source: "fred-live",
    };
  });
