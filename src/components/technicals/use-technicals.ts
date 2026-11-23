import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Bar, CompanyDataset } from "@/lib/financials/types";
import { BENCHMARKS, coverageOf } from "@/lib/coverage";
import { companyQuery, usePrices } from "@/lib/data";
import { barsFromPriceRows, type AnalysisInput, type Technicals } from "@/lib/technicals/analysis";
import { runAnalysis } from "@/lib/technicals/client";
import type { Bars } from "@/lib/technicals/conditions";
import { crossQuery, rowsOf, type CrossFile } from "@/lib/technicals/cross";
import { histQuery, signalsQuery, type Hist } from "@/lib/technicals/data";
import type { BenchSeries } from "@/lib/technicals/measures";

export interface SymbolHistory {
  /** Daily bars for the analysis */
  bars: Bars;
  /** The same bars as price-file rows, for the chart */
  rows: Bar[];
  /** "history": the stored long history (since 2008); "prices": the ten-year price file */
  source: "history" | "prices";
  /** Sessions appended from the price file after the stored history ends */
  appended: number;
  first: string;
  last: string;
}

/** Stored long history with the newest sessions appended from the price file; the price file alone when there is no stored history. */
export function mergeHistory(H: Hist | null | undefined, rows: Bar[] | null | undefined): SymbolHistory | null {
  const fresh = (rows ?? []).filter((b) => b[4] > 0 && b[0].length === 10);
  let bars: Bars | null = null;
  let appended = 0;
  if (H && H.n > 0) {
    bars = { d: [...H.d], o: [...H.o], h: [...H.h], l: [...H.l], c: [...H.c], v: [...H.v], tr: [...H.tr] };
    const last = H.d[H.n - 1];
    const k0 = fresh.findIndex((b) => b[0] > last);
    if (k0 >= 0)
      for (let k = k0; k < fresh.length; k++) {
        const b = fresh[k];
        const prev = fresh[k - 1];
        // Total return over the appended session: the adjusted close when the day before is in the price file too.
        const ratio = prev && prev[5] > 0 && b[5] > 0 ? b[5] / prev[5] : b[4] / bars.c[bars.c.length - 1];
        bars.d.push(b[0]);
        bars.o.push(b[1] || b[4]);
        bars.h.push(Math.max(b[2] || b[4], b[4]));
        bars.l.push(Math.min(b[3] || b[4], b[4]));
        bars.c.push(b[4]);
        bars.v.push(b[6] || 0);
        bars.tr.push(bars.tr[bars.tr.length - 1] * ratio);
        appended++;
      }
  } else if (fresh.length) bars = barsFromPriceRows(fresh);
  if (!bars || !bars.c.length) return null;
  const n = bars.c.length;
  const k = bars.c[n - 1] / bars.tr[n - 1];
  return {
    bars,
    rows: bars.d.map((d, i) => [d, bars.o[i], bars.h[i], bars.l[i], bars.c[i], bars.tr[i] * k, bars.v[i]]),
    source: H && H.n > 0 ? "history" : "prices",
    appended,
    first: bars.d[0],
    last: bars.d[n - 1],
  };
}

/** Earnings releases for the analysis and the chart: every 8-K reporting results (Item 2.02), newest first. */
export function earningsReleasesOf(co: CompanyDataset | null | undefined) {
  if (!co) return [];
  const seen = new Set<string>();
  const out: { filed: string; accn: string; doc: string }[] = [];
  const add = (filed: string, accn: string, doc: string) => {
    const day = filed.slice(0, 10);
    if (seen.has(day)) return;
    seen.add(day);
    out.push({ filed: day, accn, doc });
  };
  for (const r of co.earningsReleases ?? []) add(r.filed, r.accn, r.doc);
  for (const f of co.filings ?? []) if (f.form === "8-K" && (f.items ?? "").split(",").includes("2.02")) add(f.filed, f.accn, f.doc);
  return out.sort((a, b) => (a.filed < b.filed ? 1 : -1));
}

/** Where this symbol's 12-1 month return sits among covered companies in the cross-section file. */
export function universeRank(X: CrossFile | null | undefined, symbol: string) {
  if (!X) return null;
  const rows = rowsOf(X).filter((r) => r.kind === "stock" && typeof r.mom12_1 === "number");
  const me = rows.find((r) => r.sym === symbol);
  if (!me || rows.length < 30) return null;
  const v = me.mom12_1 as number;
  return { momPct: rows.filter((r) => (r.mom12_1 as number) <= v).length / rows.length, names: rows.length, asOf: X.as_of };
}

const benchOf = (sym: string, kind: BenchSeries["kind"], rows: Bar[] | undefined): BenchSeries | null => {
  if (!rows?.length) return null;
  const B = barsFromPriceRows(rows);
  return { sym, kind, d: B.d, tr: B.tr };
};

/**
 * Everything the Technicals views need for one symbol: the daily history (stored long history first, the
 * ten-year price file as the fallback, newest sessions appended) and the analysis computed from it in a
 * web worker. Optional inputs (benchmarks, earnings releases, cross-company statistics) are used when they
 * arrive and never block the price history.
 */
export function useTechnicals(symbol: string) {
  const covered = coverageOf(symbol);
  const stored = useQuery(histQuery(symbol));
  const prices = usePrices(symbol, "10y", "1d");
  const marketSym = symbol === "SPY" ? null : "SPY";
  const sectorSym = covered?.sectorEtf && covered.sectorEtf !== symbol ? covered.sectorEtf : null;
  const market = usePrices(marketSym ?? "SPY", "10y", "1d", !!marketSym);
  const sector = usePrices(sectorSym ?? "SPY", "10y", "1d", !!sectorSym);
  const company = useQuery({ ...companyQuery(symbol), enabled: !!covered });
  const pooled = useQuery(signalsQuery);
  const cross = useQuery({ ...crossQuery, enabled: !!covered });

  const historyReady = !stored.isPending && !prices.isPending;
  const history = useMemo(
    () => (historyReady ? mergeHistory(stored.data, prices.data?.bars) : null),
    [historyReady, stored.data, prices.data],
  );
  const benchReady = (!marketSym || !market.isPending) && (!sectorSym || !sector.isPending);
  const bench = useMemo(
    () =>
      [marketSym && benchOf(marketSym, "market", market.data?.bars), sectorSym && benchOf(sectorSym, "sector", sector.data?.bars)].filter(
        (b): b is BenchSeries => !!b,
      ),
    [marketSym, sectorSym, market.data, sector.data],
  );
  const releases = useMemo(() => earningsReleasesOf(company.data), [company.data]);
  const universe = useMemo(() => universeRank(cross.data, symbol), [cross.data, symbol]);

  const input = useMemo<AnalysisInput | null>(
    () => (history && benchReady ? { sym: symbol, bars: history.bars, bench, releases, pooled: pooled.data?.signals ?? null, universe } : null),
    [history, benchReady, symbol, bench, releases, pooled.data, universe],
  );
  const analysis = useQuery({
    queryKey: [
      "technicals",
      symbol,
      history?.last ?? "",
      history?.bars.c.length ?? 0,
      bench.map((b) => `${b.sym}:${b.d[b.d.length - 1]}`).join(","),
      releases.length,
      pooled.data?.as_of ?? "",
      universe?.asOf ?? "",
    ],
    queryFn: (): Promise<Technicals | null> => runAnalysis(input!),
    enabled: !!input,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: 0,
  });

  return {
    covered,
    /** Name of the benchmark entry when the symbol is an index, sector fund or macro series */
    benchmark: BENCHMARKS.find((b) => b.symbol === symbol) ?? null,
    history,
    historyLoading: !historyReady,
    /** The stored long history could not be read and the ten-year price file is in use */
    usingPriceFile: historyReady && history?.source === "prices",
    T: analysis.data && analysis.data.sym === symbol ? analysis.data : null,
    computing: !!input && analysis.isPending,
    error: analysis.error as Error | null,
    company: company.data ?? null,
    releases,
    cross: cross.data ?? null,
  };
}
