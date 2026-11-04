import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowUpRight } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { Sparkline } from "@/components/charts/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { BENCHMARKS, COVERAGE, MACRO_TILES } from "@/lib/coverage";
import { macroSummariesQuery, pricesQuery, useQuotes, useUniverse } from "@/lib/data";
import { aggregateSectors, companyMetrics, type SectorAggregate } from "@/lib/financials/sectors";
import { alignByDate, annualizedVol, correlation, pctChangeOver, returns } from "@/lib/indicators";
import { changeText, displayUnits, fmtMacro } from "@/lib/macro";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import type { PriceSeries } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

const pageSearch = z.object({ sector: z.string().max(40).optional() });

export const Route = createFileRoute("/_authenticated/app/sectors")({
  validateSearch: pageSearch,
  head: () => ({
    meta: [
      { title: "Sectors — Filed Under" },
      { name: "description", content: "Sector performance, fundamentals rolled up from SEC filings, government industry drivers and correlations." },
      { property: "og:title", content: "Sectors — Filed Under" },
      { property: "og:description", content: "Sector performance, fundamentals from SEC filings, government industry drivers and correlations." },
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

const fmtX = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(v >= 100 ? 0 : 1)}×`);

function Sectors() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const syms = ["SPY", ...SECTORS.map((x) => x.symbol)];
  const qs = useQueries({ queries: syms.map((x) => pricesQuery(x, "5y", "1d")) });
  const loaded = qs.every((q) => q.data);
  const data = useMemo(() => new Map<string, PriceSeries>(qs.flatMap((q, i) => (q.data ? [[syms[i], q.data] as const] : []))), [qs.map((q) => q.dataUpdatedAt).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sortBy, setSortBy] = useState<(typeof PERIODS)[number]["id"]>("3m");
  const [picked, setPicked] = useState<string[]>(["XLK", "SMH", "XLE", "XLU"]);
  const universe = useUniverse();
  const quotes = useQuotes(COVERAGE.map((c) => c.ticker));

  const sectors = useMemo(() => {
    if (!universe.data) return [];
    const px = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol.toUpperCase(), q.price]));
    return aggregateSectors(universe.data.companies.map((u) => companyMetrics(u, px.get(u.ticker))));
  }, [universe.data, quotes.data]);
  const selected = sectors.find((x) => x.sector === s.sector) ?? sectors[0];

  const rows = useMemo(() => {
    if (!loaded) return [];
    const spy = data.get("SPY")!.bars.map((b) => b[5]);
    return SECTORS.map((x) => {
      const adj = (data.get(x.symbol)?.bars ?? []).map((b) => b[5]);
      const perf = Object.fromEntries(PERIODS.map((p) => [p.id, pctChangeOver(adj, p.n)])) as Record<string, number | null>;
      const rel3m = perf["3m"] != null && pctChangeOver(spy, 63) != null ? perf["3m"]! - pctChangeOver(spy, 63)! : null;
      const vol = annualizedVol(returns(adj.slice(-252)));
      return { ...x, perf, rel3m, vol };
    }).sort((a, b) => (b.perf[sortBy] ?? -9) - (a.perf[sortBy] ?? -9));
  }, [loaded, sortBy, data]);

  const corr = useMemo(() => {
    if (!loaded) return null;
    const list = SECTORS.map((x) => x.symbol);
    const series = list.map((x) => data.get(x)!.bars.slice(-253).map((b) => [b[0], b[5]] as [string, number]));
    const m: number[][] = list.map((_, i) =>
      list.map((__, j) => {
        if (i === j) return 1;
        const al = alignByDate(series[i], series[j]);
        return correlation(returns(al.a), returns(al.b));
      }),
    );
    return { list, m };
  }, [loaded, data]);

  const rebased = useMemo(() => {
    if (!loaded) return [];
    return ["SPY", ...picked].map((x, i) => {
      const bars = data.get(x)!.bars.slice(-252);
      const base = bars[0]?.[5] ?? 1;
      return {
        id: x,
        label: x,
        color: x === "SPY" ? "var(--foreground)" : COLORS[i % COLORS.length],
        dashed: x === "SPY",
        points: bars.map((b) => ({ date: new Date(`${b[0]}T00:00:00Z`), value: (b[5] / base - 1) * 100 })),
      };
    });
  }, [loaded, picked, data]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow={`Rotation · ${COVERAGE.length} covered companies`}
        title="Sectors"
        description="SPDR sector ETFs for price action; fundamentals rolled up from each covered company's SEC filings; government series that drive each sector's revenue."
      />

      <SectorFundamentals sectors={sectors} loading={!universe.data} selected={selected?.sector} onSelect={(x) => navigate({ search: { sector: x }, replace: true })} />

      {selected && <SectorDetail agg={selected} data={data} loaded={loaded} />}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Performance heatmap" subtitle="Total return from dividend-adjusted closes · click a column to sort · click a row to chart it" bodyClassName="p-0">
          {!loaded ? (
            <Skeleton className="m-4 h-96" />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[620px] text-[13px]">
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

      <Panel title="Correlation of daily returns" subtitle="Trailing 12 months — low numbers mean better diversification">
        {corr ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="text-[11px]">
              <thead>
                <tr>
                  <th />
                  {corr.list.map((x) => (
                    <th key={x} className="num px-1 pb-1 font-medium text-muted-foreground">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corr.list.map((x, i) => (
                  <tr key={x}>
                    <th className="num pr-2 text-right font-medium text-muted-foreground">{x}</th>
                    {corr.m[i].map((v, j) => (
                      <td
                        key={j}
                        className="num size-10 text-center"
                        style={{ background: `color-mix(in oklab, var(--chart-1) ${Math.max(0, v * 70).toFixed(0)}%, transparent)`, color: v > 0.7 ? "var(--ink-foreground)" : undefined }}
                        title={`${x} / ${corr.list[j]}: ${v.toFixed(2)}`}
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
    </div>
  );
}

function SectorFundamentals({ sectors, loading, selected, onSelect }: { sectors: SectorAggregate[]; loading: boolean; selected?: string; onSelect: (s: string) => void }) {
  return (
    <Panel title="Sector fundamentals" subtitle="Trailing twelve months, cap-weighted across covered companies (Σ numerator ÷ Σ denominator) · click a sector for detail" bodyClassName="p-0">
      {loading ? (
        <Skeleton className="m-4 h-80" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 text-right font-medium">Cos.</th>
                <th className="px-3 py-2 text-right font-medium">Market cap</th>
                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                <th className="px-3 py-2 text-right font-medium">Median growth</th>
                <th className="px-3 py-2 text-right font-medium">3Y CAGR</th>
                <th className="px-3 py-2 text-right font-medium">Op. margin</th>
                <th className="px-3 py-2 text-right font-medium">Net margin</th>
                <th className="px-3 py-2 text-right font-medium">FCF margin</th>
                <th className="px-3 py-2 text-right font-medium">P/E</th>
                <th className="px-3 py-2 text-right font-medium">FCF yield</th>
                <th className="px-4 py-2 text-right font-medium">Net debt / EBITDA</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((x) => (
                <tr
                  key={x.sector}
                  onClick={() => onSelect(x.sector)}
                  className={cn("cursor-pointer border-b last:border-0 hover:bg-secondary/60", selected === x.sector && "bg-highlight-soft")}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{x.sector}</span>
                      <span className="flex -space-x-1.5">
                        {x.members.slice(0, 4).map((m) => (
                          <CompanyLogo key={m.ticker} ticker={m.ticker} size="xs" className="ring-2 ring-card" />
                        ))}
                      </span>
                    </div>
                  </td>
                  <td className="num px-3 py-2 text-right text-muted-foreground">{x.count}</td>
                  <td className="num px-3 py-2 text-right">{x.mcap ? fmtCompactUsd(x.mcap) : "—"}</td>
                  <td className="num px-3 py-2 text-right">{fmtCompactUsd(x.revenue)}</td>
                  <td className={cn("num px-3 py-2 text-right", (x.medianGrowth ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(x.medianGrowth, 1, true)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(x.medianCagr3y, 1)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(x.opMargin, 1)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(x.netMargin, 1)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(x.fcfMargin, 1)}</td>
                  <td className="num px-3 py-2 text-right">{fmtX(x.pe)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(x.fcfYield, 1)}</td>
                  <td className="num px-4 py-2 text-right">{fmtX(x.netDebtToEbitda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SectorDetail({ agg, data, loaded }: { agg: SectorAggregate; data: Map<string, PriceSeries>; loaded: boolean }) {
  const etf = SECTORS.find((b) => b.sector === agg.sector);
  const [span, setSpan] = useState<"1" | "3" | "5">("3");
  const summaries = useQuery(macroSummariesQuery);
  const drivers = MACRO_TILES.filter((d) => d.sectors?.includes(agg.sector));
  const chart = useMemo(() => {
    if (!loaded || !etf) return [];
    const days = Number(span) * 252;
    return ["SPY", etf.symbol].map((x) => {
      const bars = data.get(x)?.bars.slice(-days) ?? [];
      const base = bars[0]?.[5] ?? 1;
      return {
        id: x,
        label: x === "SPY" ? "S&P 500" : `${etf.name} (${x})`,
        color: x === "SPY" ? "var(--foreground)" : "var(--chart-1)",
        dashed: x === "SPY",
        area: x !== "SPY",
        points: bars.map((b) => ({ date: new Date(`${b[0]}T00:00:00Z`), value: (b[5] / base - 1) * 100 })),
      };
    });
  }, [loaded, etf, span, data]);

  return (
    <section className="grid grid-cols-1 gap-5 rounded-xl border bg-secondary/30 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">Sector detail</p>
          <h2 className="font-display text-3xl">{agg.sector}</h2>
        </div>
        <Link to="/app/sectors/$sector" params={{ sector: agg.sector }} className="mb-1 inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-[12px] font-medium hover:bg-muted">
          Deep dive <ArrowUpRight className="size-3.5" />
        </Link>
        <p className="num pb-1 text-xs text-muted-foreground">
          {agg.count} companies · {agg.mcap ? fmtCompactUsd(agg.mcap) : "—"} market cap · P/E {fmtX(agg.pe)} · op. margin {fmtPct(agg.opMargin, 1)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Panel
          title={etf ? `${etf.name} vs. S&P 500` : "Sector ETF"}
          subtitle="Total return, rebased to 0%"
          actions={<Segmented size="xs" label="Chart span" value={span} onChange={setSpan} options={[{ v: "1", l: "1Y" }, { v: "3", l: "3Y" }, { v: "5", l: "5Y" }]} />}
        >
          {chart.length ? <TimeSeriesChart series={chart} height={260} yFormat={(v) => `${v.toFixed(0)}%`} zeroLine /> : <Skeleton className="h-[260px]" />}
        </Panel>

        <Panel title="Government industry drivers" subtitle={drivers.length ? "Official series that lead this sector's revenue and costs · open one in Macro" : "No sector-specific series"} bodyClassName="p-0">
          <ul className="divide-y">
            {drivers.map((d) => {
              const r = summaries.data?.get(d.id);
              return (
                <li key={d.id}>
                  <Link to="/app/macro" search={{ group: d.group === "curve" ? "rates" : d.group, series: d.id }} className="flex items-center gap-3 px-4 py-2 hover:bg-secondary/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{d.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {displayUnits(d)} · {d.agency}
                      </p>
                    </div>
                    {r ? (
                      <>
                        <Sparkline values={r.spark.map((o) => o[1])} tone="ink" className="h-6 w-20 shrink-0" />
                        <div className="w-28 shrink-0 text-right">
                          <p className="num text-[13px] font-medium">{fmtMacro(d, r.latest)}</p>
                          <p className="num truncate text-[10px] text-muted-foreground">
                            {changeText(d, r).replace(/ vs .*/, "")} · {fmtDate(r.date, { month: "short", year: "2-digit" })}
                          </p>
                        </div>
                      </>
                    ) : (
                      <Skeleton className="h-8 w-40" />
                    )}
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel title="Companies" subtitle="Trailing-twelve-month figures from SEC filings · live market cap" bodyClassName="p-0">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Industry</th>
                <th className="px-3 py-2 text-right font-medium">Market cap</th>
                <th className="px-3 py-2 text-right font-medium">Weight</th>
                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                <th className="px-3 py-2 text-right font-medium">Growth</th>
                <th className="px-3 py-2 text-right font-medium">Op. margin</th>
                <th className="px-3 py-2 text-right font-medium">P/E</th>
                <th className="px-4 py-2 text-right font-medium">FCF yield</th>
              </tr>
            </thead>
            <tbody>
              {agg.members.map((m) => (
                <tr key={m.ticker} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2">
                    <Link to="/app/companies/$ticker" params={{ ticker: m.ticker }} className="flex items-center gap-2 hover:underline">
                      <CompanyLogo ticker={m.ticker} size="sm" />
                      <span className="num font-semibold">{m.ticker}</span>
                      <span className="truncate text-muted-foreground">{COVERAGE.find((c) => c.ticker === m.ticker)?.shortName ?? m.name}</span>
                    </Link>
                  </td>
                  <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">{m.industry}</td>
                  <td className="num px-3 py-2 text-right">{m.mcap ? fmtCompactUsd(m.mcap) : "—"}</td>
                  <td className="px-3 py-2">
                    <span className="ml-auto flex w-20 items-center justify-end gap-1.5">
                      <span className="h-1.5 rounded-full bg-chart-1" style={{ width: `${agg.mcap && m.mcap ? Math.max(2, (m.mcap / agg.mcap) * 56) : 0}px` }} />
                      <span className="num text-[11px] text-muted-foreground">{agg.mcap && m.mcap ? fmtPct(m.mcap / agg.mcap, 0) : "—"}</span>
                    </span>
                  </td>
                  <td className="num px-3 py-2 text-right">{fmtCompactUsd(m.revenue)}</td>
                  <td className={cn("num px-3 py-2 text-right", (m.growth ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(m.growth, 1, true)}</td>
                  <td className="num px-3 py-2 text-right">{fmtPct(m.opMargin, 1)}</td>
                  <td className="num px-3 py-2 text-right">{fmtX(m.pe)}</td>
                  <td className="num px-4 py-2 text-right">{m.bank ? "—" : fmtPct(m.fcfYield, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}
