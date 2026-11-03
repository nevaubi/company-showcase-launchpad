import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CompanyDataset, MacroSeries, PriceSeries, Universe } from "@/lib/financials/types";
import { getMacroSeries, getNews, getPriceSeries, getQuotes } from "@/lib/market.functions";
import type { MacroDef } from "@/lib/coverage";
import { hydrateDataset } from "@/lib/financials/dataset";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

export const universeQuery = queryOptions({
  queryKey: ["universe"],
  queryFn: () => getJson<Universe>("/data/universe.json"),
  staleTime: Infinity,
});

export const companyQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["company", ticker.toUpperCase()],
    queryFn: async () => hydrateDataset(await getJson<CompanyDataset>(`/data/companies/${ticker.toUpperCase()}.json`)),
    staleTime: Infinity,
  });

export const useUniverse = () => useQuery(universeQuery);
export const useCompany = (ticker: string) => useQuery(companyQuery(ticker));

export type Range = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "ytd" | "1y" | "2y" | "5y" | "10y" | "max";
export type Interval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "1h" | "1d" | "1wk" | "1mo";

const RANGE_DAYS: Partial<Record<Range, number>> = { "5d": 7, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827 };

async function snapshotPrices(symbol: string, range: Range): Promise<PriceSeries> {
  const s = await getJson<PriceSeries>(`/data/prices/${symbolFile(symbol)}.json`);
  const days = range === "ytd" ? null : RANGE_DAYS[range];
  const last = s.bars.at(-1)?.[0];
  let bars = s.bars;
  if (last) {
    if (range === "ytd") bars = s.bars.filter((b) => b[0] >= `${last.slice(0, 4)}-01-01`);
    else if (days) {
      const cut = new Date(new Date(`${last}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
      bars = s.bars.filter((b) => b[0] >= cut);
    }
  }
  return { ...s, bars, source: "snapshot" };
}

/** Live Yahoo Finance bars, falling back to the bundled daily snapshot. */
export const pricesQuery = (symbol: string, range: Range = "1y", interval: Interval = "1d") =>
  queryOptions({
    queryKey: ["prices", symbol, range, interval],
    queryFn: async (): Promise<PriceSeries> => {
      try {
        const live = await getPriceSeries({ data: { symbol, range, interval } });
        if (live.bars.length) return live;
        throw new Error("empty");
      } catch (e) {
        if (interval !== "1d") throw e;
        return snapshotPrices(symbol, range);
      }
    },
    staleTime: interval === "1d" ? 5 * 60_000 : 60_000,
    retry: 1,
  });

export const usePrices = (symbol: string, range: Range = "1y", interval: Interval = "1d", enabled = true) =>
  useQuery({ ...pricesQuery(symbol, range, interval), enabled });

async function snapshotQuote(s: string) {
  const p = await snapshotPrices(s, "1mo");
  const closes = p.bars.map((b) => b[4]);
  const price = closes.at(-1) ?? 0;
  const prev = closes.at(-2) ?? price;
  return {
    symbol: s,
    name: p.name,
    price,
    previousClose: prev,
    change: price - prev,
    changePct: prev ? price / prev - 1 : 0,
    spark: closes.slice(-5),
    marketTime: p.bars.at(-1)?.[0],
    snapshot: true as const,
  };
}

/** Live quotes; any symbol the live source misses falls back to its last bundled close. */
export const quotesQuery = (symbols: string[]) =>
  queryOptions({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: async () => {
      let live: Awaited<ReturnType<typeof getQuotes>> = { quotes: [], errors: symbols };
      try {
        live = await getQuotes({ data: { symbols } });
      } catch {
        /* fall through to snapshots */
      }
      const have = new Set(live.quotes.map((q) => q.symbol.toUpperCase()));
      const missing = symbols.filter((s) => !have.has(s.toUpperCase()));
      const filled = await Promise.all(missing.map((s) => snapshotQuote(s).catch(() => null)));
      const bySym = new Map([...live.quotes, ...filled.filter((q): q is NonNullable<typeof q> => !!q)].map((q) => [q.symbol.toUpperCase(), q]));
      return { quotes: symbols.map((s) => bySym.get(s.toUpperCase())).filter((q): q is NonNullable<typeof q> => !!q), errors: missing.filter((s) => !bySym.has(s.toUpperCase())) };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

export const useQuotes = (symbols: string[]) => useQuery({ ...quotesQuery(symbols), enabled: symbols.length > 0 });

export const macroQuery = (def: Pick<MacroDef, "id" | "title" | "units" | "frequency"> & { since?: string }) =>
  queryOptions({
    queryKey: ["macro", def.id, def.since ?? ""],
    queryFn: async (): Promise<MacroSeries> => {
      try {
        const live = await getMacroSeries({
          data: { id: def.id, since: def.since, title: def.title, units: def.units, frequency: def.frequency },
        });
        if (live.observations.length) return live;
        throw new Error("empty");
      } catch {
        const s = await getJson<MacroSeries>(`/data/macro/${def.id}.json`);
        return { ...s, observations: def.since ? s.observations.filter((o) => o[0] >= def.since!) : s.observations };
      }
    },
    staleTime: 30 * 60_000,
  });

export const useMacro = (def: Pick<MacroDef, "id" | "title" | "units" | "frequency"> & { since?: string }) =>
  useQuery(macroQuery(def));

export const newsQuery = (query: string) =>
  queryOptions({
    queryKey: ["news", query],
    queryFn: () => getNews({ data: { query } }),
    staleTime: 10 * 60_000,
  });
