import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { PriceChart, type ChartMarker, type Overlay } from "@/components/charts/price-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrices, type Range } from "@/lib/data";
import { marketsQuery } from "@/lib/markets/query";
import { performance, readTechnicals } from "@/lib/company/technicals";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import type { CompanyDataset } from "@/lib/financials/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSessionState } from "@/lib/use-session-state";

const RANGES: { id: Range; label: string }[] = [
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  { id: "10y", label: "10Y" },
];

type Layer = "averages" | "index" | "earnings" | "filings" | "insiders" | "levels";
const LAYERS: { id: Layer; label: string; dot: string }[] = [
  { id: "averages", label: "50/200-day avg", dot: "bg-chart-1" },
  { id: "index", label: "vs S&P 500", dot: "bg-chart-5" },
  { id: "earnings", label: "Earnings", dot: "bg-chart-2" },
  { id: "filings", label: "10-K / 10-Q", dot: "bg-chart-3" },
  { id: "insiders", label: "Insider buys/sells", dot: "bg-chart-4" },
  { id: "levels", label: "Support / resistance", dot: "bg-muted-foreground" },
];

/** Research price chart: area price with averages, index comparison, dated events and a plain-language read. */
export function ResearchChart({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const [range, setRange] = useSessionState<Range>(`fu:chart:${ticker}:range`, "1y");
  const [on, setOn] = useState<Set<Layer>>(new Set(["averages", "earnings", "levels"]));
  const view = usePrices(ticker, range);
  const long = usePrices(ticker, "5y");
  const spyLong = usePrices("SPY", "5y");
  const spyView = usePrices("SPY", range, "1d", on.has("index"));
  const m = useQuery(marketsQuery);
  const mc = m.data?.companies.find((c) => c.ticker === ticker);
  const toggle = (l: Layer) =>
    setOn((s) => {
      const n = new Set(s);
      n.has(l) ? n.delete(l) : n.add(l);
      return n;
    });

  const bars = view.data?.bars ?? [];
  const read = useMemo(
    () => readTechnicals((long.data?.bars ?? []) as never, (spyLong.data?.bars ?? []) as never),
    [long.data, spyLong.data],
  );
  const perf = useMemo(
    () => performance((long.data?.bars ?? []) as never, (spyLong.data?.bars ?? []) as never),
    [long.data, spyLong.data],
  );

  const markers: ChartMarker[] = useMemo(() => {
    const out: ChartMarker[] = [];
    if (on.has("earnings"))
      for (const r of data.earningsReleases)
        out.push({ time: r.filed, label: "E", color: "var(--chart-2)" });
    if (on.has("filings"))
      for (const f of data.filings)
        if (f.form === "10-K" || f.form === "10-Q")
          out.push({
            time: f.filed,
            label: f.form === "10-K" ? "K" : "Q",
            color: "var(--chart-3)",
            position: "belowBar",
          });
    if (on.has("insiders")) {
      // One marker per day and direction, labelled by net dollars.
      const days = new Map<string, number>();
      for (const t of data.insiders)
        if (t.code === "P" || t.code === "S")
          days.set(
            t.date,
            (days.get(t.date) ?? 0) + (t.code === "P" ? 1 : -1) * t.shares * (t.price ?? 0),
          );
      for (const [d, v] of days)
        if (Math.abs(v) > 250_000)
          out.push({
            time: d,
            label: v > 0 ? "B" : "S",
            color: v > 0 ? "var(--positive)" : "var(--negative)",
            position: "belowBar",
          });
    }
    return out;
  }, [on, data]);

  const px = bars.at(-1)?.[4] ?? null;
  const levels = useMemo(() => {
    if (!on.has("levels") || !mc || px == null) return [];
    const sup = mc.levels.support.filter((l) => l.price < px).sort((a, b) => b.price - a.price)[0];
    const res = mc.levels.resistance
      .filter((l) => l.price > px)
      .sort((a, b) => a.price - b.price)[0];
    return [
      ...(sup ? [{ price: sup.price, label: "Support", color: "var(--muted-foreground)" }] : []),
      ...(res ? [{ price: res.price, label: "Resistance", color: "var(--muted-foreground)" }] : []),
    ];
  }, [on, mc, px]);

  const overlays: Overlay[] =
    on.has("averages") && range !== "1mo" && range !== "3mo" ? ["sma50", "sma200"] : [];
  const first = bars[0]?.[4];
  const chg = first && px ? px / first - 1 : null;

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Activity className="size-3.5" /> Price & technical read
        </span>
      }
      subtitle={
        view.data
          ? `${RANGES.find((r) => r.id === range)?.label} ${chg != null ? fmtPct(chg, 1, true) : ""} · daily closes through ${fmtDate(bars.at(-1)?.[0])}`
          : "Loading…"
      }
      actions={
        <div className="flex rounded-md border bg-secondary/50 p-0.5">
          {RANGES.map((r) => (
            <Button
              variant="ghost"
              size="xs"
              key={r.id}
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={cn(
                "num h-6 rounded px-2 text-[11px]",
                range === r.id
                  ? "bg-card font-medium shadow-paper"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </Button>
          ))}
        </div>
      }
      bodyClassName="@container p-0"
      collapse={false}
    >
      <div className="grid grid-cols-1 @min-[900px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 border-b @min-[900px]:border-b-0 @min-[900px]:border-r">
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {LAYERS.map((l) => (
              <Button
                variant="ghost"
                size="xs"
                key={l.id}
                onClick={() => toggle(l.id)}
                aria-pressed={on.has(l.id)}
                className={cn(
                  "h-6 gap-1.5 rounded border px-2 text-[11px] transition-colors",
                  on.has(l.id)
                    ? "border-foreground/30 bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn("size-1.5 rounded-full", l.dot, !on.has(l.id) && "opacity-40")}
                />
                {l.label}
              </Button>
            ))}
          </div>
          <div className="p-2">
            {view.isError && !view.data ? (
              <div
                role="alert"
                className="grid h-[400px] place-content-center gap-3 text-sm text-muted-foreground"
              >
                Price history is temporarily unavailable.
                <Button size="sm" variant="outline" onClick={() => view.refetch()}>
                  Retry
                </Button>
              </div>
            ) : view.data && !bars.length ? (
              <div className="grid h-[400px] place-content-center text-sm text-muted-foreground">
                No price history available for this period.
              </div>
            ) : view.data ? (
              <PriceChart
                bars={bars}
                mode="area"
                height={400}
                overlays={overlays}
                markers={markers}
                levels={levels}
                compare={
                  on.has("index") && spyView.data
                    ? { label: "S&P 500", bars: spyView.data.bars }
                    : null
                }
              />
            ) : (
              <Skeleton className="h-[400px]" />
            )}
          </div>
          <div className="grid grid-cols-4 border-t @min-[650px]:grid-cols-7">
            {perf.map((p) => (
              <div key={p.label} className="min-w-0 border-r px-3 py-2 last:border-r-0">
                <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  {p.label}
                </p>
                <p
                  className={cn(
                    "num text-sm font-medium",
                    p.value == null
                      ? "text-muted-foreground"
                      : p.value >= 0
                        ? "text-positive"
                        : "text-negative",
                  )}
                >
                  {p.value == null ? "—" : fmtPct(p.value, 1, true)}
                </p>
                <p className="num truncate text-[10px] text-muted-foreground">
                  {p.vsIndex == null ? "" : `${fmtPct(p.vsIndex, 1, true)} vs S&P`}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-px border-b bg-border">
            {[
              { k: "50-day avg", v: fmtPrice(read.sma50) },
              { k: "200-day avg", v: fmtPrice(read.sma200) },
              { k: "RSI (14)", v: read.rsi14 != null ? read.rsi14.toFixed(0) : "—" },
              {
                k: "Volume vs 90d",
                v: read.volRatio != null ? `${(read.volRatio * 100).toFixed(0)}%` : "—",
              },
            ].map((s) => (
              <div key={s.k} className="bg-card px-3 py-2">
                <p className="text-[10.5px] text-muted-foreground">{s.k}</p>
                <p className="num text-sm font-medium">{s.v}</p>
              </div>
            ))}
          </div>
          {read.pos52 != null && (
            <div className="border-b px-3 py-3">
              <div className="flex justify-between text-[10.5px] text-muted-foreground">
                <span>52-wk low {fmtPrice(read.lo52)}</span>
                <span>high {fmtPrice(read.hi52)}</span>
              </div>
              <div className="relative mt-1.5 h-1.5 rounded-full bg-gradient-to-r from-negative/40 via-muted to-positive/40">
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow"
                  style={{ left: `${read.pos52 * 100}%` }}
                />
              </div>
            </div>
          )}
          <ul className="divide-y">
            {long.isLoading ? (
              <li className="p-3">
                <Skeleton className="h-40" />
              </li>
            ) : (
              read.insights.map((i) => (
                <li key={i.title} className="flex gap-2.5 px-3 py-2.5">
                  {i.tone === "positive" ? (
                    <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-positive" />
                  ) : i.tone === "negative" ? (
                    <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-negative" />
                  ) : (
                    <Minus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium">{i.title}</p>
                    <p className="text-[11.5px] leading-snug text-muted-foreground">{i.detail}</p>
                  </div>
                </li>
              ))
            )}
          </ul>
          <p className="border-t px-3 py-2 text-[10.5px] text-muted-foreground">
            Rules-based read of past prices, not a forecast.
          </p>
        </div>
      </div>
    </Panel>
  );
}
