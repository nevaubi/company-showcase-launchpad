import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { partnerFile, useQuotes, useUniverse } from "@/lib/data";
import { COVERAGE_TICKERS } from "@/lib/coverage";
import {
  basicRow,
  fillFrom,
  rowsFromFile,
  withLive,
  type FieldDef,
  type Row,
  type ScreenerFile,
} from "./engine";
import { SERIES_FIELDS, seriesAsOf, withSeries, type SeriesRow } from "./series";
import { getScreenSeries } from "./series.functions";

export const screenerFileQuery = {
  queryKey: ["screener-file"],
  queryFn: () => partnerFile<ScreenerFile>("screener.json"),
  staleTime: 3600_000,
  retry: 1,
} as const;

/** Daily liquidity and short-volume fields (setup_series); the screener works without them. */
export const screenSeriesQuery = {
  queryKey: ["screener-series"],
  queryFn: async () => (await getScreenSeries()).rows,
  staleTime: 3600_000,
  retry: 1,
} as const;

/**
 * Screener rows for every company: screener.json values (live price applied, empty fundamentals filled
 * from the partner universe, daily liquidity fields added) plus fundamentals-only rows for companies
 * screener.json does not carry.
 */
export function useScreenRows(includeBasic = true) {
  const file = useQuery(screenerFileQuery);
  const series = useQuery(screenSeriesQuery);
  const uni = useUniverse();
  const quotes = useQuotes(COVERAGE_TICKERS);
  const hasSeries = !!series.data?.length;
  const F = useMemo(
    () =>
      new Map<string, FieldDef>(
        [...(file.data?.fields ?? []), ...(file.data && hasSeries ? SERIES_FIELDS : [])].map((f) => [f.id, f]),
      ),
    [file.data, hasSeries],
  );
  const rows = useMemo(() => {
    if (!file.data) return [] as Row[];
    const qs = new Map((quotes.data?.quotes ?? []).map((x) => [x.symbol, x]));
    const ss = new Map((series.data ?? []).map((s: SeriesRow) => [s.ticker, s]));
    const byTk = new Map((uni.data?.companies ?? []).filter((c) => c.f).map((c) => [c.ticker, c]));
    const rich = rowsFromFile(file.data).map((r) => {
      const live = withLive(r, qs.get(r.ticker));
      const u = byTk.get(r.ticker);
      const filled = u ? fillFrom(live, basicRow(u, typeof live.price === "number" ? live.price : null)) : live;
      return withSeries(filled, ss.get(r.ticker));
    });
    if (!includeBasic) return rich;
    const have = new Set(rich.map((r) => r.ticker));
    const extra = [...byTk.values()]
      .filter((c) => !have.has(c.ticker))
      .map((c) => withSeries(basicRow(c, qs.get(c.ticker)?.price ?? null), ss.get(c.ticker)));
    return [...rich, ...extra];
  }, [file.data, uni.data, quotes.data, series.data, includeBasic]);
  const seriesDate = useMemo(() => seriesAsOf(series.data ?? []), [series.data]);
  /** The series query has answered (rows or an error), so the field map is final. */
  const seriesSettled = series.isFetched || series.isError;
  return { file, uni, F, rows, seriesDate, seriesSettled };
}
