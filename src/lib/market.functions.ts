import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MacroSeries, PriceSeries } from "@/lib/financials/types";
import { fetchFred, fetchTreasury, fetchYahoo, isTreasurySeries, pool, toBars, yahooGet } from "@/lib/market-data.server";

const symbolSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[\^A-Za-z0-9.=-]+$/);

const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max"] as const;
const INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk", "1mo"] as const;

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
    const { COVERAGE } = await import("@/lib/coverage");
    const { fetchNasdaqDaily, fetchNasdaqQuote } = await import("@/lib/market-data.server");
    const stocks = new Set(COVERAGE.map((c) => c.ticker));
    const results = await pool(data.symbols, 4, async (s) => {
      try {
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
      } catch (e) {
        // Yahoo throttles shared IPs; Nasdaq covers U.S. stocks and ETFs (not indices).
        if (s.startsWith("^")) throw e;
        const kind = stocks.has(s) ? "stocks" : "etf";
        // Sequential: the pool already holds four requests open (the runtime allows six).
        const n = await fetchNasdaqQuote(s, kind);
        const bars = await fetchNasdaqDaily(s, kind, 10).catch(() => []);
        const q: Quote = {
          symbol: s,
          name: n.name,
          price: n.price,
          previousClose: n.previousClose,
          change: n.price - n.previousClose,
          changePct: n.previousClose ? n.price / n.previousClose - 1 : 0,
          high52: n.high52,
          low52: n.low52,
          exchange: n.exchange,
          spark: bars.map((b) => b[4]),
        };
        return q;
      }
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

export const getMacroSeries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().regex(/^[A-Z0-9_]{2,24}$/),
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
    const treasury = isTreasurySeries(data.id);
    const observations = treasury ? await fetchTreasury(data.id, data.since) : await fetchFred(data.id, data.since);
    return {
      id: data.id,
      title: data.title,
      units: data.units,
      frequency: data.frequency,
      observations,
      fetchedAt: new Date().toISOString(),
      source: treasury ? "treasury-live" : "fred-live",
    };
  });
