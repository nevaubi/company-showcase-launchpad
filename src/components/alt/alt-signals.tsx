import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AltEventList } from "@/components/alt/alt-views";
import { altBucketsQuery, altCellQuery, altRedFlagsQuery, altSourceStatsQuery, DATASETS } from "@/lib/alt/query";
import { computeSignals, heat, NO_SIGNAL, RED_FLAG_ITEMS, signalLabel, topChanges, type Signal } from "@/lib/alt/signals";
import { cn } from "@/lib/utils";

const EVENT_SETS = ["ownership", "events", "capital", "contracts", "regulatory", "fda", "trials", "recalls", "consumer"];
const SHORT: Record<string, string> = { ownership: "13D/G", events: "8-K", contracts: "Contracts", regulatory: "Fed. Reg.", fda: "FDA", recalls: "NHTSA", capital: "Capital", trials: "Trials", consumer: "CPSC" };

function ago(iso: string | null) {
  if (!iso) return "—";
  const d = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 864e5));
  return d === 0 ? "today" : d === 1 ? "1 day ago" : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} mo ago`;
}

export function SourceStrip() {
  const q = useQuery(altSourceStatsQuery());
  if (q.isLoading) return <Skeleton className="mb-5 h-20" />;
  const by = new Map((q.data ?? []).map((r) => [r.dataset, r]));
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      {Object.entries(DATASETS).map(([k, v]) => {
        const s = by.get(k);
        const stale = s?.latest && Date.now() - new Date(s.latest).getTime() > 120 * 864e5;
        return (
          <Link key={k} to="/app/alt-data" search={{ d: k }} className="min-w-0 rounded-md border bg-card px-3 py-2 transition-colors hover:border-foreground/30">
            <div className="truncate text-[11px] font-medium">{v.label}</div>
            <div className="num mt-0.5 text-[15px] font-semibold">{s ? Number(s.rows).toLocaleString() : "0"}</div>
            <div className="truncate text-[10px] text-muted-foreground">{s ? `${s.tickers} cos · latest ${ago(s.latest)}` : "not loaded"}</div>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", !s ? "bg-muted-foreground/40" : stale ? "bg-warning" : "bg-positive")} />
              {v.source}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Spark({ h }: { h: number[] }) {
  const max = Math.max(1, ...h);
  return (
    <div className="flex h-5 items-end gap-px" aria-hidden>
      {h.map((v, i) => <span key={i} className={cn("w-1.5 rounded-[1px]", i === h.length - 1 ? "bg-foreground" : "bg-muted-foreground/35")} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />)}
    </div>
  );
}

export function useSignals() {
  const q = useQuery(altBucketsQuery());
  const signals = useMemo(() => computeSignals(q.data ?? []), [q.data]);
  return { ...q, signals };
}

export function AltSignalsSection() {
  const { signals, isLoading } = useSignals();
  const [cell, setCell] = useState<{ ticker: string; dataset: string } | null>(null);
  const changes = useMemo(() => topChanges(signals, 14), [signals]);
  return (
    <>
      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel title="What changed" subtitle="Last 90 days vs each company's own prior two years" bodyClassName="p-0" className="min-w-0">
          {isLoading ? <Skeleton className="m-4 h-64" /> : !changes.length ? <p className="px-4 py-6 text-sm text-muted-foreground">Nothing unusual right now.</p> : (
            <ul className="divide-y">
              {changes.map((s) => <ChangeRow key={s.ticker + s.dataset} s={s} onOpen={() => setCell(s)} />)}
            </ul>
          )}
        </Panel>
        <RedFlags />
      </div>
      <Heatmap signals={signals} loading={isLoading} onOpen={setCell} />
      <CellSheet cell={cell} signal={cell ? signals.find((s) => s.ticker === cell.ticker && s.dataset === cell.dataset) : undefined} onClose={() => setCell(null)} />
    </>
  );
}

function ChangeRow({ s, onOpen }: { s: Signal; onOpen: () => void }) {
  const up = s.z > 0;
  return (
    <li>
      <button onClick={onOpen} className="grid w-full grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-secondary/60">
        <span className="font-semibold">{s.ticker}</span>
        <span className="min-w-0">
          <span className="block truncate">{DATASETS[s.dataset]?.label ?? s.dataset}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{s.recent} in 90d · {signalLabel(s)}</span>
        </span>
        <Spark h={s.history} />
        <span className={cn("num flex w-14 items-center justify-end gap-0.5 text-[12px] font-medium", up ? "text-positive" : "text-negative")}>
          {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(s.z).toFixed(1)}σ
        </span>
      </button>
    </li>
  );
}

function RedFlags() {
  const items = Object.keys(RED_FLAG_ITEMS);
  const q = useQuery(altRedFlagsQuery(items));
  const rows = q.data ?? [];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r.dataset === "ownership" ? "Activist 13D" : RED_FLAG_ITEMS[r.meta?.item] ?? "Other"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), [rows]);
  return (
    <Panel title="Material filings" subtitle="Activist stakes and market-moving 8-K items, last 90 days" bodyClassName="p-0" className="min-w-0">
      {q.isLoading ? <Skeleton className="m-4 h-64" /> : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5">
            {counts.map(([k, n]) => <Badge key={k} variant="outline" className="text-[10px]">{k} <span className="num ml-1 font-semibold">{n}</span></Badge>)}
          </div>
          <div className="max-h-[440px] overflow-y-auto scrollbar-thin"><AltEventList rows={sorted} showTicker max={300} /></div>
        </>
      )}
    </Panel>
  );
}

const HEAT_CLS: Record<number, string> = {
  3: "bg-positive/80 text-background", 2: "bg-positive/50", 1: "bg-positive/20", 0: "bg-muted/40",
  [-1]: "bg-negative/20", [-2]: "bg-negative/45",
};

function Heatmap({ signals, loading, onOpen }: { signals: Signal[]; loading: boolean; onOpen: (c: { ticker: string; dataset: string }) => void }) {
  const [sort, setSort] = useState<string>("score");
  const grid = useMemo(() => {
    const by = new Map<string, Map<string, Signal>>();
    for (const s of signals) if (EVENT_SETS.includes(s.dataset)) (by.get(s.ticker) ?? by.set(s.ticker, new Map()).get(s.ticker)!).set(s.dataset, s);
    const rows = [...by.entries()].map(([ticker, m]) => ({ ticker, m, score: [...m.values()].reduce((a, s) => a + (NO_SIGNAL.has(s.dataset) ? 0 : Math.max(0, s.z)), 0) }));
    return rows.sort((a, b) => sort === "score" ? b.score - a.score : sort === "ticker" ? a.ticker.localeCompare(b.ticker) : (b.m.get(sort)?.z ?? -9) - (a.m.get(sort)?.z ?? -9));
  }, [signals, sort]);
  return (
    <Panel title="Activity heatmap" subtitle="Each cell: events in the last 90 days, shaded by how unusual that is for the company. Click to see the records." bodyClassName="p-0" className="mb-5 min-w-0">
      {loading ? <Skeleton className="m-4 h-72" /> : (
        <div className="max-h-[560px] overflow-auto scrollbar-thin">
          <table className="w-full table-fixed text-[12px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-24 px-4 py-2 text-left font-medium"><button onClick={() => setSort("ticker")} className={cn(sort === "ticker" && "text-foreground")}>Company</button></th>
                {EVENT_SETS.map((d) => <th key={d} className="px-1 py-2 font-medium"><button onClick={() => setSort(d)} className={cn(sort === d && "text-foreground")}>{SHORT[d]}</button></th>)}
                <th className="w-20 px-4 py-2 text-right font-medium"><button onClick={() => setSort("score")} className={cn(sort === "score" && "text-foreground")}>Score</button></th>
              </tr>
            </thead>
            <tbody>
              {grid.map((r) => (
                <tr key={r.ticker} className="border-b last:border-0">
                  <td className="px-4 py-1"><Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="font-medium hover:underline">{r.ticker}</Link></td>
                  {EVENT_SETS.map((d) => {
                    const s = r.m.get(d);
                    if (!s) return <td key={d} className="px-1 py-1"><div className="h-6 rounded-sm bg-muted/20" /></td>;
                    return (
                      <td key={d} className="px-1 py-1">
                        <button onClick={() => onOpen({ ticker: r.ticker, dataset: d })} title={`${s.recent} in 90d · ${signalLabel(s)}`} className={cn("num h-6 w-full rounded-sm text-[11px] transition hover:ring-1 hover:ring-foreground/40", HEAT_CLS[NO_SIGNAL.has(d) ? 0 : heat(s.z)])}>
                          {s.recent || "·"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num px-4 text-right text-muted-foreground">{r.score.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function CellSheet({ cell, signal, onClose }: { cell: { ticker: string; dataset: string } | null; signal?: Signal; onClose: () => void }) {
  const q = useQuery({ ...altCellQuery(cell?.ticker ?? "", cell?.dataset ?? "", 180), enabled: !!cell });
  return (
    <Sheet open={!!cell} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {cell && (
          <>
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle>{cell.ticker} · {DATASETS[cell.dataset]?.label}</SheetTitle>
              <SheetDescription>{DATASETS[cell.dataset]?.source} · last 180 days</SheetDescription>
              {signal && (
                <div className="mt-2 flex items-center gap-4 text-[12px]">
                  <Spark h={signal.history} />
                  <span><span className="num font-semibold">{signal.recent}</span> in 90d</span>
                  <span className="text-muted-foreground">avg <span className="num">{signal.baseline.toFixed(1)}</span> per 90d</span>
                  <span className={cn("num font-medium", signal.z >= 0 ? "text-positive" : "text-negative")}>{signal.z >= 0 ? "+" : ""}{signal.z.toFixed(1)}σ</span>
                </div>
              )}
              <Link to="/app/companies/$ticker/alt-data" params={{ ticker: cell.ticker }} className="mt-2 inline-flex items-center gap-1 text-[12px] underline">Full alt data for {cell.ticker} <ExternalLink className="size-3" /></Link>
            </SheetHeader>
            {q.isLoading ? <Skeleton className="m-4 h-64" /> : <AltEventList rows={q.data ?? []} max={200} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
