import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FileText, Loader2, Newspaper, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, Stat } from "@/components/app/page-header";
import { PriceChart, type ChartMarker } from "@/components/charts/price-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { useSource } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useCompany, usePrices, useQuotes, type Range } from "@/lib/data";
import { getNarratives } from "@/lib/ai.functions";
import { cellTarget, ratioTarget, ttmTarget } from "@/lib/financials/targets";
import { latestYoY, ttm } from "@/lib/financials/metrics";
import { alignByDate, annualizedVol, beta, maxDrawdown, returns } from "@/lib/indicators";
import { fiscalYearEndLabel, fmtCompactUsd, fmtDate, fmtPct, fmtPrice, fmtRelative, SEC_FORM_LABEL, titleCase } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/")({
  component: Overview,
});

const RANGES: Range[] = ["1mo", "6mo", "ytd", "1y", "5y"];

function Overview() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  if (!company.data) return <OverviewSkeleton />;
  return <OverviewBody ticker={ticker} data={company.data} />;
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

function OverviewBody({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const [range, setRange] = useState<Range>("1y");
  const prices = usePrices(ticker, range);
  const year = usePrices(ticker, "1y");
  const spy = usePrices("SPY", "1y");
  const quote = useQuotes([ticker]).data?.quotes[0];
  const { open } = useSource();
  const q = data.statements.quarterly;
  const a = data.statements.annual;
  const p = data.profile;

  const price = quote?.price ?? year.data?.bars.at(-1)?.[4] ?? null;
  const shares = p.sharesOutstanding;
  const mcap = price && shares ? price * shares : null;
  const epsTTM = ttm(q.income, "epsDiluted");
  const revT = ttmTarget(ticker, q.income, "revenue", "Revenue");
  const niT = ttmTarget(ticker, q.income, "netIncome", "Net income");
  const fcfT = ttmTarget(ticker, q.cashflow, "fcf", "Free cash flow");
  const gpT = ttmTarget(ticker, q.income, "grossProfit", "Gross profit");
  const epsT = ttmTarget(ticker, q.income, "epsDiluted", "Diluted EPS");
  const gmT = gpT && revT ? ratioTarget(ticker, "Gross margin (TTM)", revT.periodLabel ?? "", gpT, revT) : null;
  const yoy = latestYoY(q.income, "revenue");
  const lastQ = q.income.periods.length - 1;

  const stats = useMemo(() => {
    const bars = year.data?.bars ?? [];
    const closes = bars.map((b) => b[4]);
    const hi = bars.length ? Math.max(...bars.map((b) => b[2])) : null;
    const lo = bars.length ? Math.min(...bars.map((b) => b[3])) : null;
    let b: number | null = null;
    if (spy.data && bars.length) {
      const al = alignByDate(
        bars.map((x) => [x[0], x[5]] as [string, number]),
        spy.data.bars.map((x) => [x[0], x[5]] as [string, number]),
      );
      b = beta(returns(al.a), returns(al.b));
    }
    const ret1y = closes.length > 1 ? closes[closes.length - 1] / closes[0] - 1 : null;
    return { hi, lo, beta: b, vol: closes.length > 20 ? annualizedVol(returns(closes)) : null, mdd: closes.length ? maxDrawdown(closes) : null, ret1y };
  }, [year.data, spy.data]);

  const markers: ChartMarker[] = useMemo(
    () =>
      data.earningsReleases.map((r) => ({
        time: r.filed,
        label: "E",
        color: "var(--chart-2)",
      })),
    [data.earningsReleases],
  );

  const sharesTarget = shares && p.sharesOutstandingAccn
    ? {
        ticker,
        label: "Shares outstanding (cover page)",
        periodLabel: p.sharesOutstandingAsOf ? `as of ${fmtDate(p.sharesOutstandingAsOf)}` : undefined,
        unit: "shares",
        value: shares,
        src: { accn: p.sharesOutstandingAccn, concept: "dei:EntityCommonStockSharesOutstanding", end: p.sharesOutstandingAsOf ?? "", value: shares },
      }
    : null;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <Stat label="Market cap" value={fmtCompactUsd(mcap)} sub={shares ? `${(shares / 1e9).toFixed(2)}B shares` : "—"} target={sharesTarget} />
        <Stat
          label="P/E (TTM)"
          value={price && epsTTM ? `${(price / epsTTM).toFixed(1)}×` : "—"}
          sub={epsTTM ? `EPS ${fmtPrice(epsTTM)}` : undefined}
          target={epsT}
        />
        <Stat label="Revenue (TTM)" value={fmtCompactUsd(revT?.value)} sub={yoy != null ? `${fmtPct(yoy, 1, true)} YoY (latest qtr)` : undefined} tone={yoy != null && yoy >= 0 ? "positive" : "negative"} target={revT} />
        <Stat label="Net income (TTM)" value={fmtCompactUsd(niT?.value)} sub={niT && revT ? `${fmtPct(niT.value / revT.value)} margin` : undefined} target={niT} />
        <Stat label="Free cash flow (TTM)" value={fmtCompactUsd(fcfT?.value)} sub={fcfT && mcap ? `${fmtPct(fcfT.value / mcap)} FCF yield` : undefined} tone={fcfT && fcfT.value < 0 ? "negative" : "neutral"} target={fcfT} />
        <Stat label="Gross margin (TTM)" value={fmtPct(gmT?.value)} target={gmT} />
        <Stat
          label="52-week range"
          value={stats.lo != null ? `${stats.lo.toFixed(0)}–${stats.hi?.toFixed(0)}` : "—"}
          sub={stats.ret1y != null ? `${fmtPct(stats.ret1y, 1, true)} over 1Y` : undefined}
          tone={stats.ret1y != null && stats.ret1y >= 0 ? "positive" : "negative"}
        />
        <Stat label="Beta vs S&P 500" value={stats.beta != null ? stats.beta.toFixed(2) : "—"} sub={stats.vol != null ? `${fmtPct(stats.vol, 0)} ann. vol` : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="Price"
          subtitle={
            prices.data
              ? `${prices.data.source === "yahoo-live" ? "Live · Yahoo Finance" : "Snapshot"} · E = earnings release (8-K 2.02)`
              : "Loading…"
          }
          actions={
            <div className="flex rounded-md border bg-secondary/50 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn("num rounded px-2 py-0.5 text-[11px] uppercase", range === r ? "bg-card font-medium shadow-paper" : "text-muted-foreground")}
                >
                  {r}
                </button>
              ))}
            </div>
          }
          bodyClassName="p-2"
        >
          {prices.data ? (
            <PriceChart bars={prices.data.bars} mode="area" markers={markers} height={320} overlays={range === "1y" || range === "5y" ? ["sma50", "sma200"] : []} />
          ) : (
            <Skeleton className="h-[320px]" />
          )}
        </Panel>
        <NarrativesPanel ticker={ticker} name={p.name} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RevenueBars ticker={ticker} data={data} />
        <MarginLines data={data} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <Panel title="Company profile" subtitle="SEC EDGAR submissions">
          <p className="text-sm leading-relaxed">{p.description}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Headquarters</dt>
            <dd>
              {titleCase(p.address.street)}, {titleCase(p.address.city)}, {p.address.state} {p.address.zip}
            </dd>
            <dt className="text-muted-foreground">Phone</dt>
            <dd>{p.phone}</dd>
            {p.ceo && (
              <>
                <dt className="text-muted-foreground">Chief executive</dt>
                <dd>{p.ceo} <span className="text-xs text-muted-foreground">(per Form 4)</span></dd>
              </>
            )}
            <dt className="text-muted-foreground">Founded</dt>
            <dd>{p.founded}</dd>
            <dt className="text-muted-foreground">Fiscal year end</dt>
            <dd>{fiscalYearEndLabel(p.fiscalYearEnd)}</dd>
            <dt className="text-muted-foreground">Incorporated</dt>
            <dd>{p.stateOfIncorporation}</dd>
            <dt className="text-muted-foreground">SIC</dt>
            <dd>
              {p.sic} · {titleCase(p.sicDescription)}
            </dd>
            <dt className="text-muted-foreground">CIK / EIN</dt>
            <dd className="num text-xs">
              {p.cik} / {p.ein}
            </dd>
            <dt className="text-muted-foreground">Filer status</dt>
            <dd>{p.filerCategory}</dd>
            {p.formerNames.length > 0 && (
              <>
                <dt className="text-muted-foreground">Former names</dt>
                <dd className="text-xs">{p.formerNames.map((f) => f.name).join(" · ")}</dd>
              </>
            )}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="xs" variant="outline" asChild>
              <a href={p.website} target="_blank" rel="noreferrer">
                Website <ArrowUpRight />
              </a>
            </Button>
            <Button size="xs" variant="outline" asChild>
              <a href={p.investorRelations} target="_blank" rel="noreferrer">
                Investor relations <ArrowUpRight />
              </a>
            </Button>
          </div>
        </Panel>

        <Panel
          title="Recent filings"
          actions={
            <Button size="xs" variant="ghost" asChild>
              <Link to="/app/companies/$ticker/filings" params={{ ticker }}>
                All filings
              </Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {data.filings
              .filter((f) => ["10-K", "10-Q", "8-K", "DEF 14A"].includes(f.form))
              .slice(0, 8)
              .map((f) => (
                <li key={f.accn}>
                  <button
                    onClick={() =>
                      open({ ticker, label: SEC_FORM_LABEL[f.form] ?? f.form, periodLabel: f.report ?? f.filed, unit: "usd", value: 0, doc: { accn: f.accn, doc: f.doc, title: f.desc } })
                    }
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary"
                  >
                    <Badge variant="outline" className="w-14 justify-center">
                      {f.form}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{f.items?.includes("2.02") ? "Results of operations" : (SEC_FORM_LABEL[f.form] ?? f.desc)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {f.report ? `Period ${fmtDate(f.report)} · ` : ""}filed {fmtDate(f.filed)}
                      </span>
                    </span>
                    <FileText className="size-3.5 text-muted-foreground" />
                  </button>
                </li>
              ))}
          </ul>
        </Panel>

        <InsiderSummary ticker={ticker} data={data} price={price} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Fundamentals through {q.income.periods[lastQ]?.label} ({fmtDate(q.income.periods[lastQ]?.end)}) and {a.income.periods.at(-1)?.label}. Dataset generated{" "}
        {fmtDate(data.generatedAt)}. Click any figure to open its filing.
      </p>
    </div>
  );
}

function NarrativesPanel({ ticker, name }: { ticker: string; name: string }) {
  const q = useQuery({
    queryKey: ["narratives", ticker],
    queryFn: () => getNarratives({ data: { ticker, name } }),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const news = q.data?.news ?? [];
  const byId = new Map(news.map((n) => [n.id, n]));
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> Trending narratives
        </span>
      }
      subtitle={q.data ? `AI-clustered from ${news.length} recent ${q.data.via === "web" ? "articles found by web search" : "headlines"} · ${fmtRelative(q.data.cachedAt)}` : "Clustering recent headlines…"}
      bodyClassName="p-0"
    >
      {q.isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="p-4 text-sm text-muted-foreground">
          Couldn't build narratives right now. {(q.error as Error).message}
          <Button size="xs" variant="outline" className="ml-2" onClick={() => q.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          <ul className="divide-y">
            {(q.data?.narratives ?? []).map((n) => (
              <li key={n.title} className="px-4 py-3">
                <p className="flex items-start gap-2 text-[13px] font-semibold">
                  {n.sentiment === "bullish" ? (
                    <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-positive" />
                  ) : n.sentiment === "bearish" ? (
                    <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-negative" />
                  ) : (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-chart-2" />
                  )}
                  {n.title}
                </p>
                <p className="mt-1 pl-5.5 text-[13px] leading-relaxed text-muted-foreground">{n.summary}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5.5">
                  {n.headlineIds.slice(0, 3).map((id) => {
                    const h = byId.get(id);
                    return h ? (
                      <a key={id} href={h.link} target="_blank" rel="noreferrer" className="max-w-full truncate rounded border bg-card px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground">
                        {h.publisher}: {h.title}
                      </a>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
          {news.length > 0 && (
            <div className="border-t px-4 py-3">
              <p className="eyebrow flex items-center gap-1.5">
                <Newspaper className="size-3" /> Latest headlines
              </p>
              <ul className="mt-2 space-y-1.5">
                {news.slice(0, 6).map((n) => (
                  <li key={n.id} className="text-[12.5px]">
                    <a href={n.link} target="_blank" rel="noreferrer" className="hover:underline">
                      {n.title}
                    </a>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {n.publisher} · {fmtRelative(n.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function RevenueBars({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const st = data.statements.quarterly.income;
  const rev = st.rows.find((r) => r.key === "revenue");
  const ni = st.rows.find((r) => r.key === "netIncome");
  const n = st.periods.length;
  const idx = Array.from({ length: Math.min(12, n) }, (_, i) => n - Math.min(12, n) + i);
  const bars = idx.map((i) => ({
    key: st.periods[i].key,
    label: st.periods[i].label.replace(" FY", "'"),
    parts: [{ id: "Revenue", value: rev?.cells[i]?.v ?? 0, color: "var(--chart-1)" }],
  }));
  const niBars = idx.map((i) => ({
    key: st.periods[i].key,
    label: st.periods[i].label.replace(" FY", "'"),
    parts: [{ id: "Net income", value: ni?.cells[i]?.v ?? 0, color: "var(--chart-2)" }],
  }));
  return (
    <Panel title="Revenue and net income" subtitle="Quarterly · click a bar for its filing" bodyClassName="grid gap-2 p-3">
      <BarChart
        data={bars}
        height={170}
        yFormat={(v) => fmtCompactUsd(v, 0)}
        onSelect={(d) => {
          const i = st.periods.findIndex((p) => p.key === d.key);
          const t = cellTarget(ticker, st, "revenue", i);
          if (t) open(t);
        }}
      />
      <BarChart
        data={niBars}
        height={130}
        yFormat={(v) => fmtCompactUsd(v, 0)}
        onSelect={(d) => {
          const i = st.periods.findIndex((p) => p.key === d.key);
          const t = cellTarget(ticker, st, "netIncome", i);
          if (t) open(t);
        }}
      />
    </Panel>
  );
}

function MarginLines({ data }: { data: CompanyDataset }) {
  const k = data.statements.quarterly.kpis;
  const take = (key: string) => {
    const r = k.rows.find((x) => x.key === key);
    return k.periods
      .map((p, i) => ({ date: new Date(`${p.end}T00:00:00Z`), value: r?.cells[i]?.v }))
      .filter((x): x is { date: Date; value: number } => x.value != null && Number.isFinite(x.value))
      .slice(-24);
  };
  const series = [
    { id: "gm", label: "Gross", color: "var(--chart-1)", points: take("grossMargin") },
    { id: "om", label: "Operating", color: "var(--chart-2)", points: take("operatingMargin") },
    { id: "nm", label: "Net", color: "var(--chart-3)", points: take("netMargin") },
  ].filter((s) => s.points.length > 1);
  return (
    <Panel title="Margins" subtitle="Quarterly, last six years · from the KPI table">
      <TimeSeriesChart series={series} height={300} yFormat={(v) => `${(v * 100).toFixed(0)}%`} />
    </Panel>
  );
}

function InsiderSummary({ ticker, data, price }: { ticker: string; data: CompanyDataset; price: number | null }) {
  const { open } = useSource();
  const open90 = data.insiders.filter((t) => ["S", "P"].includes(t.code));
  const sold = open90.filter((t) => t.code === "S").reduce((s, t) => s + t.shares * (t.price ?? 0), 0);
  const bought = open90.filter((t) => t.code === "P").reduce((s, t) => s + t.shares * (t.price ?? 0), 0);
  const recent = data.insiders.slice(0, 6);
  return (
    <Panel
      title="Insider activity"
      subtitle={`Last ${new Set(data.insiders.map((t) => t.accn)).size} Form 4 filings`}
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/companies/$ticker/insiders" params={{ ticker }}>
            Details
          </Link>
        </Button>
      }
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-2 border-b">
        <div className="border-r px-4 py-3">
          <p className="text-[11px] text-muted-foreground">Open-market sales</p>
          <p className="num text-lg font-medium text-negative">{fmtCompactUsd(sold)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] text-muted-foreground">Open-market buys</p>
          <p className="num text-lg font-medium text-positive">{fmtCompactUsd(bought)}</p>
        </div>
      </div>
      <ul className="divide-y">
        {recent.map((t, i) => (
          <li key={`${t.accn}-${i}`}>
            <button
              onClick={() => open({ ticker, label: `Form 4 · ${t.owner}`, periodLabel: t.date, unit: "usd", value: 0, doc: { accn: t.accn, doc: t.doc, title: `${t.owner} — ${t.role}` } })}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-[12.5px] transition-colors hover:bg-secondary"
            >
              <span className={cn("num w-5 text-center font-semibold", t.acquired ? "text-positive" : "text-negative")}>{t.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{t.owner}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.role}</span>
              </span>
              <span className="num text-right text-[11px]">
                {t.shares.toLocaleString()} sh
                <span className="block text-muted-foreground">{t.price ? fmtPrice(t.price) : "—"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {price == null && <Loader2 className="hidden" />}
    </Panel>
  );
}
