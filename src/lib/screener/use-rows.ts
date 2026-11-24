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

export const screenerFileQuery = {
  queryKey: ["screener-file"],
  queryFn: () => partnerFile<ScreenerFile>("screener.json"),
  staleTime: 3600_000,
  retry: 1,
} as const;

/**
 * Screener rows for every company: screener.json values (live price applied, empty fundamentals filled
 * from the partner universe) plus fundamentals-only rows for companies screener.json does not carry.
 */
export function useScreenRows(includeBasic = true) {
  const file = useQuery(screenerFileQuery);
  const uni = useUniverse();
  const quotes = useQuotes(COVERAGE_TICKERS);
  const F = useMemo(
    () => new Map<string, FieldDef>((file.data?.fields ?? []).map((f) => [f.id, f])),
    [file.data],
  );
  const rows = useMemo(() => {
    if (!file.data) return [] as Row[];
    const qs = new Map((quotes.data?.quotes ?? []).map((x) => [x.symbol, x]));
    const byTk = new Map((uni.data?.companies ?? []).filter((c) => c.f).map((c) => [c.ticker, c]));
    const rich = rowsFromFile(file.data).map((r) => {
      const live = withLive(r, qs.get(r.ticker));
      const u = byTk.get(r.ticker);
      return u
        ? fillFrom(live, basicRow(u, typeof live.price === "number" ? live.price : null))
        : live;
    });
    if (!includeBasic) return rich;
    const have = new Set(rich.map((r) => r.ticker));
    const extra = [...byTk.values()]
      .filter((c) => !have.has(c.ticker))
      .map((c) => basicRow(c, qs.get(c.ticker)?.price ?? null));
    return [...rich, ...extra];
  }, [file.data, uni.data, quotes.data, includeBasic]);
  return { file, uni, F, rows };
}
