import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { X } from "lucide-react";
import { PageHeader, Panel, Stat } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CorrHeatmap, corrStyle } from "@/components/markets/corr-heatmap";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BENCHMARKS, COVERAGE } from "@/lib/coverage";
import { betaR2, correlationMatrix, downsideCorrelation, paired, pearson, rollingCorrelation } from "@/lib/markets/core";
import { returnMap, returnsQuery } from "@/lib/markets/query";

const WINDOWS = [
  { v: "63", l: "3M" },
  { v: "126", l: "6M" },
  { v: "252", l: "1Y" },
  { v: "756", l: "3Y" },
] as const;
type Win = (typeof WINDOWS)[number]["v"];

const PRESETS: Record<string, string[]> = {
  "Mega-cap tech": ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "TSLA"],
  Semis: ["NVDA", "AMD", "AVGO", "QCOM", "INTC", "TXN", "MU", "SMH"],
  "Banks & payments": ["JPM", "BAC", "WFC", "GS", "MS", "V", "MA", "XLF"],
  "Macro assets": ["SPY", "QQQ", "IWM", "TLT", "GLD", "USO", "UUP"],
  "Sector ETFs": BENCHMARKS.filter((b) => b.group === "sector").map((b) => b.symbol),
};

export const Route = createFileRoute("/_authenticated/app/correlations")({
  validateSearch: z.object({ syms: z.string().max(200).optional(), win: z.enum(["63", "126", "252", "756"]).default("252") }),
  head: () => ({
    meta: [
      { title: "Correlation explorer — Filed Under" },
      { name: "description", content: "Correlation matrix, rolling correlation, beta and downside correlation across 78 US stocks, sector ETFs and macro assets." },
      { property: "og:title", content: "Correlation explorer — Filed Under" },
      { property: "og:description", content: "How US stocks, sectors, bonds, gold and oil move together — and how that has changed." },
    ],
  }),
  component: Correlations,
});

function Correlations() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(returnsQuery);
  const syms = (s.syms?.split(",").filter(Boolean) ?? PRESETS["Mega-cap tech"]).slice(0, 16);
  const days = Number(s.win);
  const setSyms = (x: string[]) => navigate({ search: { ...s, syms: x.join(",") }, replace: true });
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [anchor, setAnchor] = useState("SPY");
  const all = q.data ? Object.keys(q.data.returns) : [];

  const maps = useMemo(() => (q.data ? new Map(all.map((x) => [x, returnMap(q.data!, x)])) : null), [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = syms.filter((x) => maps?.has(x));
  const m = useMemo(() => (maps ? correlationMatrix(live.map((x) => maps.get(x)!), days) : []), [maps, live.join(), days]); // eslint-disable-line react-hooks/exhaustive-deps

  const avgCorr = useMemo(() => {
    const v: number[] = [];
    m.forEach((r, i) => r.forEach((x, j) => j > i && x != null && v.push(x)));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }, [m]);
  // Same basket a year ago, to show whether things are moving together more.
  const avgThen = useMemo(() => {
    if (!maps || days > 252) return null;
    const v: number[] = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const p = paired(maps.get(live[i])!, maps.get(live[j])!);
        const end = p.a.length - 252;
        const c = end > days ? pearson(p.a.slice(end - days, end), p.b.slice(end - days, end)) : null;
        if (c != null) v.push(c);
      }
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }, [maps, live.join(), days]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranking = useMemo(() => {
    if (!maps?.has(anchor)) return [];
    const a = maps.get(anchor)!;
    return all
      .filter((x) => x !== anchor)
      .map((x) => {
        const p = paired(a, maps.get(x)!, days);
        return { sym: x, c: pearson(p.a, p.b) };
      })
      .filter((x): x is { sym: string; c: number } => x.c != null)
      .sort((x, y) => y.c - x.c);
  }, [maps, anchor, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const pp = pair ?? (live.length >= 2 ? ([live[0], live[1]] as [string, string]) : null);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Markets"
        title="Correlation explorer"
        description="Daily-return correlations from dividend-adjusted closes. Pick a basket, click any cell to see how that relationship has changed, and find what moves with — or against — any holding."
        actions={<Segmented label="Window" value={s.win as Win} options={WINDOWS.map((w) => ({ v: w.v, l: w.l }))} onChange={(v) => navigate({ search: { ...s, win: v }, replace: true })} />}
      />
      {!q.data || !maps ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel
              title="Matrix"
              subtitle={`${live.length} symbols · ${WINDOWS.find((w) => w.v === s.win)?.l} of daily returns`}
              className="min-w-0"
              actions={
                <Select value="" onValueChange={(v) => setSyms(PRESETS[v])}>
                  <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Load a basket" /></SelectTrigger>
                  <SelectContent>{Object.keys(PRESETS).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {live.map((x) => (
                  <span key={x} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]">
                    {x}
                    <button aria-label={`Remove ${x}`} onClick={() => setSyms(syms.filter((y) => y !== x))}><X className="size-3" /></button>
                  </span>
                ))}
                {live.length < 16 && <SymbolPicker all={all} value="" placeholder="+ Add" onChange={(v) => !syms.includes(v) && setSyms([...syms, v])} />}
              </div>
              <CorrHeatmap labels={live} m={m} picked={pp} onPick={(a, b) => setPair([a, b])} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Average pair correlation" value={avgCorr?.toFixed(2) ?? "—"} sub={avgCorr == null ? undefined : avgCorr > 0.6 ? "Basket moves as one — little diversification" : avgCorr < 0.3 ? "Well diversified" : "Moderately linked"} />
                <Stat label="Same window, a year earlier" value={avgThen?.toFixed(2) ?? "—"} sub={avgThen != null && avgCorr != null ? (avgCorr > avgThen + 0.05 ? "Moving together more than before" : avgCorr < avgThen - 0.05 ? "Decoupling vs a year ago" : "Roughly unchanged") : undefined} />
              </div>
            </Panel>
            {pp && <PairPanel a={pp[0]} b={pp[1]} maps={maps} days={days} />}
          </div>

          <Panel
            title={`What moves with ${anchor}`}
            subtitle="Every covered stock, sector ETF and macro asset, ranked by correlation · lowest are the best hedges"
            className="min-w-0"
            actions={<SymbolPicker all={all} value={anchor} onChange={setAnchor} />}
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {[{ t: "Most correlated", xs: ranking.slice(0, 12) }, { t: "Least correlated / hedges", xs: ranking.slice(-12).reverse() }].map((g) => (
                <div key={g.t}>
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{g.t}</div>
                  <ul className="grid gap-1">
                    {g.xs.map((x) => (
                      <li key={x.sym}>
                        <button onClick={() => setPair([anchor, x.sym])} className="flex w-full items-center justify-between rounded px-2 py-1 text-[13px] hover:bg-muted/60">
                          <span>{x.sym} <span className="text-muted-foreground">{label(x.sym)}</span></span>
                          <span className="num rounded px-1.5" style={corrStyle(x.c)}>{x.c.toFixed(2)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

const label = (s: string) => COVERAGE.find((c) => c.ticker === s)?.shortName ?? BENCHMARKS.find((b) => b.symbol === s)?.name ?? "";

function SymbolPicker({ all, value, onChange, placeholder }: { all: string[]; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const etfs = all.filter((x) => BENCHMARKS.some((b) => b.symbol === x));
  const cos = all.filter((x) => !etfs.includes(x)).sort();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectGroup><SelectLabel>ETFs & macro</SelectLabel>{etfs.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectGroup>
        <SelectGroup><SelectLabel>Companies</SelectLabel>{cos.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}

function PairPanel({ a, b, maps, days }: { a: string; b: string; maps: Map<string, Map<string, number>>; days: number }) {
  const ma = maps.get(a)!, mb = maps.get(b)!;
  const roll = useMemo(() => rollingCorrelation(ma, mb, 63), [ma, mb]);
  const p = paired(ma, mb, days);
  const br = betaR2(p.a, p.b);
  const ds = downsideCorrelation(p.a, p.b);
  const c = pearson(p.a, p.b);
  const vals = roll.map((r) => r.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (
    <Panel title={`${a} vs ${b}`} subtitle="Rolling 3-month correlation over the last 3 years" className="min-w-0">
      <TimeSeriesChart
        height={220}
        yDomain={[Math.min(-0.2, lo - 0.05), 1]}
        zeroLine
        yFormat={(v) => v.toFixed(1)}
        series={[{ id: "c", label: "corr", color: "var(--chart-1)", points: roll.map((r) => ({ date: new Date(`${r.date}T00:00:00Z`), value: r.value })) }]}
      />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Correlation" value={c?.toFixed(2) ?? "—"} sub={`3y range ${lo.toFixed(2)} to ${hi.toFixed(2)}`} />
        <Stat label={`Beta of ${a} to ${b}`} value={br?.beta.toFixed(2) ?? "—"} sub={br ? `${(br.r2 * 100).toFixed(0)}% of moves explained` : undefined} />
        <Stat
          label={`When ${b} falls`}
          value={ds.down?.toFixed(2) ?? "—"}
          sub={ds.up != null && ds.down != null ? (ds.down > ds.up + 0.1 ? `Tighter in sell-offs (up days ${ds.up.toFixed(2)})` : `Up days ${ds.up.toFixed(2)}`) : undefined}
        />
      </div>
    </Panel>
  );
}
