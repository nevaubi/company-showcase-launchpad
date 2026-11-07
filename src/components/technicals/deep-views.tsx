import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import TA from "@/lib/technicals/ta";
import { usePrices } from "@/lib/data";
import {
  breadthQuery,
  histQuery,
  methodsQuery,
  quantQuery,
  quantReadQuery,
  signalsQuery,
  statesQuery,
  type Hist,
} from "@/lib/technicals/data";
import { MarketScan, QuantView, RiskView, SignalScorecard, SymbolRead } from "./deep";
import { EventLog, GapsAndLevels, IndicatorBoard, QuantExtras } from "./dense-views";

export type TechView = "chart" | "indicators" | "signals" | "risk" | "quant" | "market";

/** Long-history analysis for one symbol: computed once from the stored daily bars (2008 onward). */
export function useAnalysis(symbol: string) {
  const stored = useQuery(histQuery(symbol));
  // The stored history is appended nightly; sessions since then come from the live daily bars.
  const live = usePrices(symbol, "1mo", "1d", !!stored.data);
  const hist = useMemo(() => {
    const H = stored.data;
    const bars = live.data?.bars ?? [];
    if (!H) return { ...stored, data: H };
    const last = H.d[H.n - 1];
    const add = bars.filter((b) => b[0].slice(0, 10) > last && b[4] > 0);
    if (!add.length) return { ...stored, data: H };
    const d = [...H.d, ...add.map((b) => b[0].slice(0, 10))];
    const c = [...H.c, ...add.map((b) => b[4])];
    const tr = [...H.tr];
    for (let k = 0; k < add.length; k++) tr.push(tr[tr.length - 1] * (add[k][4] / c[H.n + k - 1]));
    const data: Hist = {
      ...H,
      n: d.length,
      d,
      c,
      tr,
      o: [...H.o, ...add.map((b) => b[1])],
      h: [...H.h, ...add.map((b) => b[2])],
      l: [...H.l, ...add.map((b) => b[3])],
      v: [...H.v, ...add.map((b) => b[6])],
      idx: new Map(d.map((x, i) => [x, i])),
      live: add.length,
    };
    return { ...stored, data };
  }, [stored, live.data]);
  const A = useMemo(
    () =>
      hist.data && hist.data.n > 260
        ? TA.analyze({
            o: hist.data.o,
            h: hist.data.h,
            l: hist.data.l,
            c: hist.data.c,
            v: hist.data.v,
            tr: hist.data.tr,
            d: hist.data.d,
          })
        : null,
    [hist.data],
  );
  return { hist, A };
}

function recentOf(H: Hist, events: { type: string; i: number }[], bars = 30) {
  return events.filter((e) => e.i >= H.n - bars).map((e) => ({ type: e.type, date: H.d[e.i] }));
}

function Missing({ symbol, what }: { symbol: string; what: string }) {
  return (
    <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      No stored long-run daily history for {symbol} yet, so {what} cannot be shown. The chart tab
      uses live prices.
    </p>
  );
}

/** The technical read shown above the chart: regime, checked summary sentences and the AI read of the quant statistics. */
export function TechnicalRead({ symbol, onSignals }: { symbol: string; onSignals: () => void }) {
  const { hist, A } = useAnalysis(symbol);
  const Q = useQuery(quantQuery(symbol));
  const read = useQuery(quantReadQuery(symbol));
  if (hist.isLoading) return <Skeleton className="h-48" />;
  if (!hist.data || !A) return null;
  return (
    <SymbolRead
      H={hist.data}
      A={A}
      Q={Q.data}
      read={read.data}
      recent={recentOf(hist.data, A.events)}
      onSignals={onSignals}
    />
  );
}

export function DeepViews({
  view,
  symbol,
  onPick,
}: {
  view: Exclude<TechView, "chart">;
  symbol: string;
  onPick: (s: string) => void;
}) {
  const { hist, A } = useAnalysis(symbol);
  const SG = useQuery({ ...signalsQuery, enabled: view === "signals" || view === "market" });
  const Q = useQuery({ ...quantQuery(symbol), enabled: view === "risk" || view === "quant" });
  const methods = useQuery({ ...methodsQuery, enabled: view === "quant" });
  const states = useQuery({ ...statesQuery, enabled: view === "market" });
  const breadth = useQuery({ ...breadthQuery, enabled: view === "market" });

  if (view === "market")
    return (
      <div className="grid gap-4">
        <MarketScan SG={SG.data} states={states.data} breadth={breadth.data} onPick={onPick} />
      </div>
    );
  if (hist.isLoading)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  if (!hist.data || !A)
    return (
      <Missing
        symbol={symbol}
        what={
          view === "indicators"
            ? "the indicator board"
            : view === "signals"
              ? "the signal scorecard"
              : view === "risk"
                ? "the risk statistics"
                : "the quant statistics"
        }
      />
    );
  if (view === "indicators")
    return (
      <div className="grid gap-4">
        <IndicatorBoard H={hist.data} A={A} />
        <GapsAndLevels H={hist.data} A={A} />
        <EventLog H={hist.data} A={A} />
      </div>
    );
  if (view === "signals")
    return (
      <div className="grid gap-4">
        <SignalScorecard H={hist.data} A={A} SG={SG.data} />
      </div>
    );
  if (view === "risk")
    return (
      <div className="grid gap-4">
        <RiskView H={hist.data} A={A} Q={Q.data} />
      </div>
    );
  if (Q.isLoading) return <Skeleton className="h-96" />;
  if (!Q.data) return <Missing symbol={symbol} what="the quant statistics" />;
  return (
    <div className="grid gap-4">
      <QuantView Q={Q.data} methods={methods.data} ticker={symbol} />
      <QuantExtras Q={Q.data} methods={methods.data} />
    </div>
  );
}

/** Company overview: the indicator board on demand (it loads the full stored history), with a link to the full view. */
export function CompanyIndicators({ ticker }: { ticker: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Panel
        title="Indicator board"
        subtitle="Trend, momentum, trend strength, volatility and volume indicators from the daily history since 2008"
        actions={
          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
              Show indicators
            </Button>
            <Link
              to="/app/markets"
              search={{ symbol: ticker, view: "indicators" }}
              className="text-[12px] text-link hover:underline"
            >
              Gaps, levels and event log →
            </Link>
          </div>
        }
        collapse={false}
      >
        <span className="sr-only">Indicator board hidden</span>
      </Panel>
    );
  return <CompanyIndicatorsLoaded ticker={ticker} />;
}

function CompanyIndicatorsLoaded({ ticker }: { ticker: string }) {
  const { hist, A } = useAnalysis(ticker);
  if (hist.isLoading) return <Skeleton className="h-64" />;
  if (!hist.data || !A) return <Missing symbol={ticker} what="the indicator board" />;
  return (
    <div className="grid gap-2">
      <IndicatorBoard H={hist.data} A={A} />
      <Link
        to="/app/markets"
        search={{ symbol: ticker, view: "indicators" }}
        className="px-1 text-[12px] text-link hover:underline"
      >
        Price gaps, support and resistance, trend lines and the full event log →
      </Link>
    </div>
  );
}
