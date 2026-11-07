import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { marketsQuery } from "@/lib/markets/query";
import { PATTERN_META } from "@/lib/markets/core";
import { z } from "zod";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Stat } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { DeepViews, TechnicalRead } from "@/components/technicals/deep-views";
import { CrossSection } from "@/components/technicals/cross-section";
import { ShortAndFlows } from "@/components/technicals/short-flows";
import { PriceChart, type Overlay } from "@/components/charts/price-chart";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getChartInsight } from "@/lib/ai.functions";
import { BENCHMARKS, COVERAGE, coverageOf } from "@/lib/coverage";
import { useCompany, usePrices, useQuotes, type Interval, type Range } from "@/lib/data";
import {
  alignByDate,
  annualizedVol,
  beta,
  bollinger,
  correlation,
  macd,
  maxDrawdown,
  pctChangeOver,
  returns,
  rsi,
  sma,
} from "@/lib/indicators";
import { fmtDate, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES: { r: Range; i: Interval; l: string }[] = [
  { r: "1d", i: "5m", l: "1D" },
  { r: "5d", i: "15m", l: "5D" },
  { r: "1mo", i: "1d", l: "1M" },
  { r: "3mo", i: "1d", l: "3M" },
  { r: "6mo", i: "1d", l: "6M" },
  { r: "ytd", i: "1d", l: "YTD" },
  { r: "1y", i: "1d", l: "1Y" },
  { r: "2y", i: "1d", l: "2Y" },
  { r: "5y", i: "1wk", l: "5Y" },
  { r: "max", i: "1mo", l: "Max" },
];

const pageSearch = z.object({
  symbol: z.string().max(12).default("NVDA"),
  range: z.enum(["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"]).default("1y"),
  view: z.enum(["chart", "signals", "risk", "quant", "cross", "market"]).default("chart"),
});

export const Route = createFileRoute("/_authenticated/app/markets")({
  validateSearch: pageSearch,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Technicals — Filed Under" },
      {
        name: "description",
        content: "Candlestick charts, moving averages, RSI, MACD and AI chart reads.",
      },
      { property: "og:title", content: "Technicals — Filed Under" },
      {
        property: "og:description",
        content: "Candlestick charts, moving averages, RSI, MACD and AI chart reads.",
      },
    ],
  }),
  component: Markets,
});

const OVERLAYS: { id: Overlay; l: string }[] = [
  { id: "sma20", l: "SMA 20" },
  { id: "sma50", l: "SMA 50" },
  { id: "sma200", l: "SMA 200" },
  { id: "ema21", l: "EMA 21" },
  { id: "bb", l: "Bollinger" },
];

function Markets() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const symbol = s.symbol.toUpperCase();
  const rr = RANGES.find((x) => x.r === s.range) ?? RANGES[6];
  const [mode, setMode] = useState<"candles" | "area">("candles");
  const [overlays, setOverlays] = useState<Overlay[]>(["sma50", "sma200"]);
  const covered = coverageOf(symbol);
  const sectorEtf = covered?.sectorEtf;
  const [compareSym, setCompareSym] = useState<string>("none");

  const series = usePrices(symbol, rr.r, rr.i);
  const daily = usePrices(symbol, "2y", "1d");
  const spy = usePrices("SPY", "2y", "1d");
  const cmp = usePrices(
    compareSym === "none" ? "SPY" : compareSym,
    rr.r,
    rr.i,
    compareSym !== "none",
  );
  const quote = useQuotes([symbol]).data?.quotes[0];
  const company = useCompany(covered ? symbol : "AAPL");
  const releases = covered ? (company.data?.earningsReleases ?? []) : [];

  const bars = series.data?.bars ?? [];
  const closes = bars.map((b) => b[4]);
  const dates = bars.map((b) => new Date(b[0].length > 10 ? b[0] : `${b[0]}T00:00:00Z`));

  const rsiVals = useMemo(() => rsi(closes, 14), [series.data]);
  const m = useMemo(() => macd(closes), [series.data]);

  const stats = useMemo(() => {
    const db = daily.data?.bars ?? [];
    if (db.length < 30) return null;
    const c = db.map((b) => b[4]);
    const adj = db.map((b) => b[5]);
    const last = c.at(-1)!;
    const s50 = sma(c, 50).at(-1);
    const s200 = sma(c, 200).at(-1);
    const r = rsi(c, 14).at(-1);
    const bb = bollinger(c, 20, 2);
    const mm = macd(c);
    const yr = db.slice(-252);
    const ret = returns(yr.map((b) => b[5]));
    let b: number | null = null;
    let corr: number | null = null;
    if (spy.data) {
      const al = alignByDate(
        yr.map((x) => [x[0], x[5]] as [string, number]),
        spy.data.bars.map((x) => [x[0], x[5]] as [string, number]),
      );
      const ra = returns(al.a);
      const rb = returns(al.b);
      b = beta(ra, rb);
      corr = correlation(ra, rb);
    }
    const spyAdj = spy.data?.bars.map((x) => x[5]) ?? [];
    const rel3m =
      pctChangeOver(adj, 63) != null && pctChangeOver(spyAdj, 63) != null
        ? pctChangeOver(adj, 63)! - pctChangeOver(spyAdj, 63)!
        : null;
    const hi52 = Math.max(...yr.map((x) => x[2]));
    const lo52 = Math.min(...yr.map((x) => x[3]));
    const avgVol = yr.slice(-50).reduce((a, x) => a + x[6], 0) / Math.min(50, yr.length);
    // Earnings reactions: first session after the 8-K (releases come after the close)
    const reactions = releases
      .map((rel) => {
        const i = db.findIndex((x) => x[0] > rel.filed);
        if (i < 1) return null;
        const d1 = c[i] / c[i - 1] - 1;
        const d5 = i + 4 < c.length ? c[i + 4] / c[i - 1] - 1 : null;
        const gap = db[i][1] / c[i - 1] - 1;
        return { filed: rel.filed, date: db[i][0], d1, d5, gap, accn: rel.accn };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return {
      last,
      s50,
      s200,
      rsi: r,
      bbUpper: bb.upper.at(-1),
      bbLower: bb.lower.at(-1),
      macd: mm.line.at(-1),
      macdSignal: mm.signal.at(-1),
      ret1m: pctChangeOver(adj, 21),
      ret3m: pctChangeOver(adj, 63),
      ret6m: pctChangeOver(adj, 126),
      ret1y: pctChangeOver(adj, 252),
      vol: annualizedVol(ret),
      mdd: maxDrawdown(yr.map((x) => x[5])),
      beta: b,
      corr,
      rel3m,
      hi52,
      lo52,
      avgVol,
      lastVol: db.at(-1)![6],
      asOf: db.at(-1)![0],
      reactions,
    };
  }, [daily.data, spy.data, releases]);

  const insight = useMutation({
    mutationFn: () => {
      const st = stats!;
      const round = (x: number | null | undefined, d = 2) =>
        x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d));
      return getChartInsight({
        data: {
          symbol,
          asOf: st.asOf,
          stats: {
            lastClose: round(st.last),
            sma50: round(st.s50),
            sma200: round(st.s200),
            pctAboveSma50: round(st.s50 ? (st.last / st.s50 - 1) * 100 : null, 1),
            pctAboveSma200: round(st.s200 ? (st.last / st.s200 - 1) * 100 : null, 1),
            rsi14: round(st.rsi, 1),
            bollingerUpper: round(st.bbUpper),
            bollingerLower: round(st.bbLower),
            macd: round(st.macd, 3),
            macdSignal: round(st.macdSignal, 3),
            return1mPct: round((st.ret1m ?? NaN) * 100, 1),
            return3mPct: round((st.ret3m ?? NaN) * 100, 1),
            return1yPct: round((st.ret1y ?? NaN) * 100, 1),
            relativeVsSpy3mPct: round((st.rel3m ?? NaN) * 100, 1),
            annualizedVolPct: round(st.vol * 100, 1),
            maxDrawdown1yPct: round(st.mdd * 100, 1),
            betaVsSpy: round(st.beta),
            high52w: round(st.hi52),
            low52w: round(st.lo52),
            volumeVs50dAvg: round(st.lastVol / st.avgVol, 2),
            lastEarningsReactions:
              st.reactions
                .slice(0, 4)
                .map(
                  (r) =>
                    `${r.date}: ${(r.d1 * 100).toFixed(1)}% next day, ${r.d5 != null ? (r.d5 * 100).toFixed(1) + "% over 5d" : "n/a"}`,
                )
                .join("; ") || null,
          },
        },
      });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (o: Overlay) =>
    setOverlays((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : [...xs, o]));
  const markers =
    rr.i === "1d" || rr.i === "1wk"
      ? releases.map((r) => ({ time: r.filed, label: "E", color: "var(--chart-2)" }))
      : [];
  const name =
    covered?.shortName ??
    BENCHMARKS.find((b) => b.symbol === symbol)?.name ??
    series.data?.name ??
    symbol;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Technical analysis"
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            {name}
            <span className="num text-2xl text-muted-foreground">{symbol}</span>
          </span>
        }
        description={
          quote ? (
            <span className="num">
              {fmtPrice(quote.price)}{" "}
              <span className={quote.change >= 0 ? "text-positive" : "text-negative"}>
                {fmtPct(quote.changePct, 2, true)}
              </span>
              {quote.marketTime && (
                <span className="text-muted-foreground"> · {fmtRelative(quote.marketTime)}</span>
              )}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Select
              value={symbol}
              onValueChange={(v) => navigate({ search: (p) => ({ ...p, symbol: v }) })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Companies</SelectLabel>
                  {COVERAGE.map((c) => (
                    <SelectItem key={c.ticker} value={c.ticker}>
                      {c.ticker} · {c.shortName}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Indices, sectors & macro</SelectLabel>
                  {BENCHMARKS.map((b) => (
                    <SelectItem key={b.symbol} value={b.symbol}>
                      {b.symbol} · {b.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {covered && (
              <Button variant="outline" asChild>
                <Link to="/app/companies/$ticker" params={{ ticker: symbol }}>
                  Fundamentals
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={s.view}
          onChange={(v) => navigate({ search: (p) => ({ ...p, view: v }) })}
          options={[
            { v: "chart", l: "Chart" },
            { v: "signals", l: "Signals" },
            { v: "risk", l: "Risk" },
            { v: "quant", l: "Quant" },
            { v: "cross", l: "Cross-section" },
            { v: "market", l: "Market scan" },
          ]}
        />
        <span className="text-[11px] text-muted-foreground">
          {s.view === "market"
            ? "Across every tracked company"
            : "Signals, risk and quant use the stored daily history since 2008"}
        </span>
      </div>

      {s.view === "cross" ? (
        <CrossSection
          symbol={symbol}
          onPick={(t) => navigate({ search: (p) => ({ ...p, symbol: t, view: "cross" }) })}
        />
      ) : s.view !== "chart" ? (
        <DeepViews
          view={s.view}
          symbol={symbol}
          onPick={(t) => navigate({ search: (p) => ({ ...p, symbol: t, view: "signals" }) })}
        />
      ) : (
        <>
          <TechnicalRead
            symbol={symbol}
            onSignals={() => navigate({ search: (p) => ({ ...p, view: "signals" }) })}
          />

          <Panel
            bodyClassName="p-2"
            title={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border bg-secondary/50 p-0.5">
                  {RANGES.map((x) => (
                    <button
                      key={x.r}
                      onClick={() =>
                        navigate({
                          search: (p) => ({
                            ...p,
                            range: x.r as z.infer<typeof pageSearch>["range"],
                          }),
                        })
                      }
                      className={cn(
                        "num rounded px-2 py-0.5 text-[11px]",
                        s.range === x.r
                          ? "bg-card font-medium shadow-paper"
                          : "text-muted-foreground",
                      )}
                    >
                      {x.l}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-md border bg-secondary/50 p-0.5">
                  {(["candles", "area"] as const).map((x) => (
                    <button
                      key={x}
                      onClick={() => setMode(x)}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] capitalize",
                        mode === x ? "bg-card font-medium shadow-paper" : "text-muted-foreground",
                      )}
                    >
                      {x}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {OVERLAYS.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => toggle(o.id)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-normal",
                        overlays.includes(o.id)
                          ? "border-foreground bg-ink text-ink-foreground"
                          : "bg-card text-muted-foreground",
                      )}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
            }
            actions={
              <Select value={compareSym} onValueChange={setCompareSym}>
                <SelectTrigger className="h-7 w-40 text-xs">
                  <SelectValue placeholder="Compare" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No comparison</SelectItem>
                  {[
                    "SPY",
                    "QQQ",
                    ...(sectorEtf ? [sectorEtf] : []),
                    ...COVERAGE.map((c) => c.ticker).filter((t) => t !== symbol),
                  ].map((x) => (
                    <SelectItem key={x} value={x}>
                      vs {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            {series.isError ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Price data is unavailable for this range right now.
              </p>
            ) : bars.length ? (
              <>
                <PriceChart
                  bars={bars}
                  mode={mode}
                  overlays={overlays}
                  markers={markers}
                  height={420}
                  compare={
                    compareSym !== "none" && cmp.data
                      ? { label: compareSym, bars: cmp.data.bars }
                      : null
                  }
                />
                <div className="grid grid-cols-1 gap-1 border-t pt-1 md:grid-cols-2">
                  <div>
                    <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      RSI 14 <span className="num normal-case">{rsiVals.at(-1)?.toFixed(1)}</span>
                    </p>
                    <TimeSeriesChart
                      height={120}
                      endLabels={false}
                      yDomain={[0, 100]}
                      yFormat={(v) => v.toFixed(0)}
                      series={[
                        {
                          id: "rsi",
                          label: "RSI",
                          color: "var(--chart-1)",
                          points: dates.flatMap((d, i) =>
                            rsiVals[i] == null ? [] : [{ date: d, value: rsiVals[i]! }],
                          ),
                        },
                        {
                          id: "70",
                          label: "70",
                          color: "var(--negative)",
                          dashed: true,
                          points: dates.length
                            ? [
                                { date: dates[0], value: 70 },
                                { date: dates.at(-1)!, value: 70 },
                              ]
                            : [],
                        },
                        {
                          id: "30",
                          label: "30",
                          color: "var(--positive)",
                          dashed: true,
                          points: dates.length
                            ? [
                                { date: dates[0], value: 30 },
                                { date: dates.at(-1)!, value: 30 },
                              ]
                            : [],
                        },
                      ]}
                    />
                  </div>
                  <div>
                    <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      MACD 12·26·9
                    </p>
                    <TimeSeriesChart
                      height={120}
                      endLabels={false}
                      zeroLine
                      yFormat={(v) => v.toFixed(1)}
                      series={[
                        {
                          id: "macd",
                          label: "MACD",
                          color: "var(--chart-1)",
                          points: dates.flatMap((d, i) =>
                            m.line[i] == null ? [] : [{ date: d, value: m.line[i]! }],
                          ),
                        },
                        {
                          id: "sig",
                          label: "Signal",
                          color: "var(--chart-2)",
                          points: dates.flatMap((d, i) =>
                            m.signal[i] == null ? [] : [{ date: d, value: m.signal[i]! }],
                          ),
                        },
                        {
                          id: "hist",
                          label: "Histogram",
                          color: "var(--chart-5)",
                          area: true,
                          points: dates.flatMap((d, i) =>
                            m.hist[i] == null ? [] : [{ date: d, value: m.hist[i]! }],
                          ),
                        },
                      ]}
                    />
                  </div>
                </div>
              </>
            ) : (
              <Skeleton className="h-[540px]" />
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="grid grid-cols-1 content-start gap-3">
              {stats ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat
                    label="1M / 3M"
                    value={fmtPct(stats.ret1m, 1, true)}
                    sub={`${fmtPct(stats.ret3m, 1, true)} over 3M`}
                    tone={(stats.ret1m ?? 0) >= 0 ? "positive" : "negative"}
                  />
                  <Stat
                    label="1Y return"
                    value={fmtPct(stats.ret1y, 1, true)}
                    sub={
                      stats.rel3m != null
                        ? `${fmtPct(stats.rel3m, 1, true)} vs SPY (3M)`
                        : undefined
                    }
                    tone={(stats.ret1y ?? 0) >= 0 ? "positive" : "negative"}
                  />
                  <Stat
                    label="vs 50 / 200-day"
                    value={stats.s50 ? fmtPct(stats.last / stats.s50 - 1, 1, true) : "—"}
                    sub={
                      stats.s200
                        ? `${fmtPct(stats.last / stats.s200 - 1, 1, true)} vs 200-day`
                        : undefined
                    }
                  />
                  <Stat
                    label="RSI 14"
                    value={stats.rsi?.toFixed(1) ?? "—"}
                    sub={
                      stats.rsi == null
                        ? undefined
                        : stats.rsi > 70
                          ? "overbought"
                          : stats.rsi < 30
                            ? "oversold"
                            : "neutral"
                    }
                  />
                  <Stat
                    label="Volatility (1Y)"
                    value={fmtPct(stats.vol, 1)}
                    sub={`max drawdown ${fmtPct(stats.mdd, 1)}`}
                  />
                  <Stat
                    label="Beta / corr. vs SPY"
                    value={stats.beta?.toFixed(2) ?? "—"}
                    sub={stats.corr != null ? `ρ = ${stats.corr.toFixed(2)}` : undefined}
                  />
                  <Stat
                    label="52-week range"
                    value={`${fmtPrice(stats.lo52)} – ${fmtPrice(stats.hi52)}`}
                    sub={`${fmtPct(stats.last / stats.hi52 - 1, 1, true)} from high`}
                  />
                  <Stat
                    label="Volume vs 50-day"
                    value={`${(stats.lastVol / stats.avgVol).toFixed(2)}×`}
                    sub={`${(stats.avgVol / 1e6).toFixed(1)}M avg`}
                  />
                </div>
              ) : (
                <Skeleton className="h-44" />
              )}
              {covered && stats && stats.reactions.length > 0 && (
                <Panel
                  title="Earnings reactions"
                  subtitle="First session after each 8-K results release"
                  bodyClassName="p-0"
                >
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Release</th>
                        <th className="px-2 py-2 text-right font-medium">Gap</th>
                        <th className="px-2 py-2 text-right font-medium">Day 1</th>
                        <th className="px-4 py-2 text-right font-medium">Day 5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.reactions.map((r) => (
                        <tr key={r.accn} className="border-b last:border-0">
                          <td className="num px-4 py-2 text-xs">{fmtDate(r.filed)}</td>
                          {[r.gap, r.d1, r.d5].map((v, i) => (
                            <td
                              key={i}
                              className={cn(
                                "num px-2 py-2 text-right last:px-4",
                                v == null
                                  ? "text-muted-foreground"
                                  : v >= 0
                                    ? "text-positive"
                                    : "text-negative",
                              )}
                            >
                              {fmtPct(v, 1, true)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              )}
            </div>
            <Panel
              title={
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5" /> AI chart read
                </span>
              }
              subtitle="Written from the statistics on this page — no invented numbers"
              actions={
                <Button
                  size="xs"
                  variant={insight.data ? "outline" : "ink"}
                  disabled={!stats || insight.isPending}
                  title={!stats ? "Available once the price history has loaded" : undefined}
                  onClick={() => insight.mutate()}
                >
                  {insight.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}{" "}
                  {insight.data ? "Refresh" : "Analyze"}
                </Button>
              }
            >
              {insight.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-24" />
                </div>
              ) : insight.data ? (
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        insight.data.bias === "bullish"
                          ? "positive"
                          : insight.data.bias === "bearish"
                            ? "negative"
                            : "outline"
                      }
                      className="capitalize"
                    >
                      {insight.data.bias}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      as of {fmtDate(stats?.asOf)}
                    </span>
                  </div>
                  <p className="font-display text-xl leading-snug">{insight.data.headline}</p>
                  <ul className="space-y-2">
                    {insight.data.bullets.map((b) => (
                      <li key={b} className="flex gap-2 text-[13px] leading-relaxed">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-chart-2" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  {insight.data.levels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {insight.data.levels.map((l) => (
                        <span
                          key={l.label}
                          className="rounded border bg-secondary/60 px-2 py-1 text-[11px]"
                        >
                          {l.label}: <span className="num font-medium">{l.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">Not investment advice.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Get a plain-English read of trend, momentum, volatility and earnings behaviour for{" "}
                  {symbol}.
                </p>
              )}
            </Panel>
          </div>
          {covered && <ShortAndFlows symbol={symbol} />}
        </>
      )}
    </div>
  );
}
