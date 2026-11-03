import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { Skeleton } from "@/components/ui/skeleton";
import { BENCHMARKS, COVERAGE } from "@/lib/coverage";
import { pricesQuery, useUniverse } from "@/lib/data";
import { alignByDate, annualizedVol, correlation, pctChangeOver, returns } from "@/lib/indicators";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import type { PriceSeries } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/sectors")({
  head: () => ({
    meta: [
      { title: "Sectors — Filed Under" },
      { name: "description", content: "Sector ETF performance, relative strength and correlations." },
      { property: "og:title", content: "Sectors — Filed Under" },
      { property: "og:description", content: "Sector ETF performance, relative strength and correlations." },
    ],
  }),
  component: Sectors,
});

const SECTORS = BENCHMARKS.filter((b) => b.group === "sector");
const PERIODS = [
  { id: "1d", l: "1D", n: 1 },
  { id: "1w", l: "1W", n: 5 },
  { id: "1m", l: "1M", n: 21 },
  { id: "3m", l: "3M", n: 63 },
  { id: "6m", l: "6M", n: 126 },
  { id: "1y", l: "1Y", n: 250 },
] as const;
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)"];

/** Diverging background for a return: green up, red down, intensity by magnitude. */
function heat(v: number | null, scale = 0.1) {
  if (v == null) return undefined;
  const a = Math.min(1, Math.abs(v) / scale) * 0.55;
  return { background: `color-mix(in oklab, var(${v >= 0 ? "--positive" : "--negative"}) ${(a * 100).toFixed(0)}%, transparent)` };
}

function Sectors() {
  const syms = ["SPY", ...SECTORS.map((s) => s.symbol)];
  const qs = useQueries({ queries: syms.map((s) => pricesQuery(s, "2y", "1d")) });
  const loaded = qs.every((q) => q.data);
  const data = new Map<string, PriceSeries>(qs.flatMap((q, i) => (q.data ? [[syms[i], q.data] as const] : [])));
  const [sortBy, setSortBy] = useState<(typeof PERIODS)[number]["id"]>("3m");
  const [picked, setPicked] = useState<string[]>(["XLK", "SMH", "XLE", "XLU"]);
  const universe = useUniverse();

  const rows = useMemo(() => {
    if (!loaded) return [];
    const spy = data.get("SPY")!.bars.map((b) => b[5]);
    return SECTORS.map((s) => {
      const bars = data.get(s.symbol)?.bars ?? [];
      const adj = bars.map((b) => b[5]);
      const perf = Object.fromEntries(PERIODS.map((p) => [p.id, pctChangeOver(adj, p.n)])) as Record<string, number | null>;
      const rel3m = perf["3m"] != null && pctChangeOver(spy, 63) != null ? perf["3m"]! - pctChangeOver(spy, 63)! : null;
      const vol = annualizedVol(returns(adj.slice(-252)));
      return { ...s, perf, rel3m, vol };
    }).sort((a, b) => (b.perf[sortBy] ?? -9) - (a.perf[sortBy] ?? -9));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sortBy, qs.map((q) => q.dataUpdatedAt).join()]);

  const corr = useMemo(() => {
    if (!loaded) return null;
    const list = SECTORS.map((s) => s.symbol);
    const series = list.map((s) => data.get(s)!.bars.slice(-253).map((b) => [b[0], b[5]] as [string, number]));
    const m: number[][] = list.map((_, i) =>
      list.map((__, j) => {
        if (i === j) return 1;
        const al = alignByDate(series[i], series[j]);
        return correlation(returns(al.a), returns(al.b));
      }),
    );
    return { list, m };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const rebased = useMemo(() => {
    if (!loaded) return [];
    return ["SPY", ...picked].map((s, i) => {
      const bars = data.get(s)!.bars.slice(-252);
      const base = bars[0]?.[5] ?? 1;
      return {
        id: s,
        label: s,
        color: s === "SPY" ? "var(--foreground)" : COLORS[i % COLORS.length],
        dashed: s === "SPY",
        points: bars.map((b) => ({ date: new Date(`${b[0]}T00:00:00Z`), value: (b[5] / base - 1) * 100 })),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, picked.join()]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader eyebrow="Rotation" title="Sectors" description="SPDR sector ETFs as a proxy for the eleven GICS sectors, plus semiconductors. Total returns use dividend-adjusted closes." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Performance heatmap" subtitle="Click a column to sort · click a row to chart it" bodyClassName="p-0">
          {!loaded ? (
            <Skeleton className="m-4 h-96" />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Sector</th>
                    {PERIODS.map((p) => (
                      <th key={p.id} className="px-1 py-2 text-right font-medium">
                        <button onClick={() => setSortBy(p.id)} className={cn("num rounded px-1.5 py-0.5", sortBy === p.id && "bg-ink text-ink-foreground")}>
                          {p.l}
                        </button>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium">vs SPY 3M</th>
                    <th className="px-4 py-2 text-right font-medium">Vol</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.symbol}
                      onClick={() => setPicked((p) => (p.includes(r.symbol) ? p.filter((x) => x !== r.symbol) : [...p.slice(-4), r.symbol]))}
                      className={cn("cursor-pointer border-b last:border-0 hover:bg-secondary/60", picked.includes(r.symbol) && "bg-highlight-soft/40")}
                    >
                      <td className="px-4 py-1.5">
                        <span className="num mr-2 inline-block w-10 text-xs font-semibold">{r.symbol}</span>
                        {r.name}
                      </td>
                      {PERIODS.map((p) => (
                        <td key={p.id} className="num px-2 py-1.5 text-right" style={heat(r.perf[p.id], p.n < 5 ? 0.02 : p.n < 30 ? 0.06 : 0.25)}>
                          {fmtPct(r.perf[p.id], 1, true)}
                        </td>
                      ))}
                      <td className={cn("num px-2 py-1.5 text-right", (r.rel3m ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(r.rel3m, 1, true)}</td>
                      <td className="num px-4 py-1.5 text-right text-muted-foreground">{fmtPct(r.vol, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Relative performance, 1 year" subtitle={`Rebased to 0% · S&P 500 dashed · ${picked.join(", ")}`}>
          {loaded ? <TimeSeriesChart series={rebased} height={360} yFormat={(v) => `${v.toFixed(0)}%`} zeroLine /> : <Skeleton className="h-[360px]" />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Correlation of daily returns" subtitle="Trailing 12 months — low numbers mean better diversification">
          {corr ? (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="text-[11px]">
                <thead>
                  <tr>
                    <th />
                    {corr.list.map((s) => (
                      <th key={s} className="num px-1 pb-1 font-medium text-muted-foreground">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corr.list.map((s, i) => (
                    <tr key={s}>
                      <th className="num pr-2 text-right font-medium text-muted-foreground">{s}</th>
                      {corr.m[i].map((v, j) => (
                        <td
                          key={j}
                          className="num size-10 text-center"
                          style={{ background: `color-mix(in oklab, var(--chart-1) ${Math.max(0, v * 70).toFixed(0)}%, transparent)`, color: v > 0.7 ? "var(--ink-foreground)" : undefined }}
                          title={`${s} / ${corr.list[j]}: ${v.toFixed(2)}`}
                        >
                          {v.toFixed(2).replace(/^0/, "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Skeleton className="h-96" />
          )}
        </Panel>
        <Panel title="Covered companies by sector" bodyClassName="p-0">
          <ul className="divide-y">
            {[...new Set(COVERAGE.map((c) => c.sector))].map((sec) => (
              <li key={sec} className="px-4 py-3">
                <p className="eyebrow">{sec}</p>
                <div className="mt-2 grid gap-1.5">
                  {COVERAGE.filter((c) => c.sector === sec).map((c) => {
                    const u = universe.data?.companies.find((x) => x.ticker === c.ticker);
                    return (
                      <Link key={c.ticker} to="/app/companies/$ticker" params={{ ticker: c.ticker }} className="flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-secondary">
                        <CompanyLogo ticker={c.ticker} size="xs" />
                        <span className="num w-12 text-xs font-semibold">{c.ticker}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{c.industry}</span>
                        <span className="num text-xs text-muted-foreground">{fmtCompactUsd(u?.revenueTTM)} rev</span>
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
