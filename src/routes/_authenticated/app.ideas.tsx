import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, FileText, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuotes } from "@/lib/data";
import { fmtDate, fmtPct, fmtPrice, fmtInt, toneClass, toneOf } from "@/lib/format";
import { paperReturn, SIGNAL_META, type BacktestStats, type Direction, type Idea, type SignalKind } from "@/lib/signals/core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/ideas")({
  head: () => ({
    meta: [
      { title: "Trade ideas — Filed Under" },
      { name: "description", content: "Long and short setups from filed fundamentals, valuation, insider buying and price trends, each with its historical hit rate and SEC sources." },
      { property: "og:title", content: "Trade ideas — Filed Under" },
      { property: "og:description", content: "Source-backed trade setups with point-in-time hit rates and paper tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IdeasPage,
});

interface SignalsFile {
  generatedAt: string;
  companies: number;
  pooled: Partial<Record<SignalKind, BacktestStats>>;
  ideas: Idea[];
}

const signalsQuery = {
  queryKey: ["signals"],
  queryFn: async () => {
    const r = await fetch("/data/signals.json");
    if (!r.ok) throw new Error(`signals ${r.status}`);
    return (await r.json()) as SignalsFile;
  },
  staleTime: 30 * 60_000,
};

interface PaperTrade {
  id: string;
  ticker: string;
  direction: Direction;
  entry_price: number;
  entry_date: string;
  stop: number | null;
  target: number | null;
  signals: SignalKind[];
  closed_price: number | null;
  closed_at: string | null;
}

const tradesQuery = {
  queryKey: ["paper_trades"],
  queryFn: async () => {
    const { data, error } = await supabase.from("paper_trades").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((t) => ({ ...t, entry_price: Number(t.entry_price), stop: t.stop == null ? null : Number(t.stop), target: t.target == null ? null : Number(t.target), closed_price: t.closed_price == null ? null : Number(t.closed_price) })) as unknown as PaperTrade[];
  },
};

function Stat({ s, label }: { s: BacktestStats; label: string }) {
  if (!s.n) return <span className="text-muted-foreground">{label}: not enough history</span>;
  return (
    <span>
      {label}: <b className={toneClass[toneOf(s.avgExcess)]}>{fmtPct(s.avgExcess, 1, true)}</b> vs S&P over 3 mo, beat it {fmtPct(s.hitRate, 0)} of {fmtInt(s.n)} times
    </span>
  );
}

function IdeasPage() {
  const { data, isLoading } = useQuery(signalsQuery);
  const trades = useQuery(tradesQuery);
  const qc = useQueryClient();
  const [dir, setDir] = useState<"all" | Direction>("all");
  const ideas = useMemo(() => (data?.ideas ?? []).filter((i) => dir === "all" || i.direction === dir), [data, dir]);
  const quoteSyms = useMemo(() => [...new Set([...(data?.ideas ?? []).map((i) => i.ticker), ...(trades.data ?? []).map((t) => t.ticker)])], [data, trades.data]);
  const quotes = useQuotes(quoteSyms);
  const priceOf = (t: string) => quotes.data?.quotes.find((q) => q.symbol === t)?.price;

  const track = useMutation({
    mutationFn: async (idea: Idea) => {
      const entry = priceOf(idea.ticker) ?? idea.price;
      const shift = entry - idea.price;
      const { error } = await supabase.from("paper_trades").insert({
        ticker: idea.ticker,
        direction: idea.direction,
        entry_price: entry,
        stop: idea.plan.stop + shift,
        target: idea.plan.target + shift,
        signals: idea.signals.map((s) => s.kind),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added to your paper trades");
      qc.invalidateQueries({ queryKey: ["paper_trades"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const close = useMutation({
    mutationFn: async (t: PaperTrade) => {
      const p = priceOf(t.ticker);
      if (p == null) throw new Error("No live price right now");
      const { error } = await supabase.from("paper_trades").update({ closed_price: p, closed_at: new Date().toISOString() }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper_trades"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Markets"
        title="Trade ideas"
        description={`Setups found by fixed rules across ${data?.companies ?? "our"} covered companies. Each rule is replayed over 10 years using only data public at the time, so you can see how often it actually worked. Not investment advice.`}
      />

      <Panel title="Your paper trades" subtitle="Track ideas with live prices — no money involved">
        {trades.isLoading ? (
          <Skeleton className="h-16" />
        ) : !trades.data?.length ? (
          <p className="text-sm text-muted-foreground">Nothing tracked yet. Press "Paper trade" on any idea below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3">Ticker</th>
                  <th className="pr-3">Side</th>
                  <th className="pr-3">Opened</th>
                  <th className="pr-3 text-right">Entry</th>
                  <th className="pr-3 text-right">Stop / target</th>
                  <th className="pr-3 text-right">Now</th>
                  <th className="pr-3 text-right">Return</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trades.data.map((t) => {
                  const now = t.closed_price ?? priceOf(t.ticker);
                  const r = now == null ? null : paperReturn(t.direction, t.entry_price, now);
                  return (
                    <tr key={t.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-medium">
                        <Link to="/app/companies/$ticker" params={{ ticker: t.ticker }}>{t.ticker}</Link>
                      </td>
                      <td className="pr-3 capitalize">{t.direction}</td>
                      <td className="pr-3">{fmtDate(t.entry_date)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPrice(t.entry_price)}</td>
                      <td className="pr-3 text-right tabular-nums text-muted-foreground">{fmtPrice(t.stop)} / {fmtPrice(t.target)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPrice(now)}{t.closed_at ? " (closed)" : ""}</td>
                      <td className={cn("pr-3 text-right tabular-nums font-medium", toneClass[toneOf(r)])}>{fmtPct(r, 1, true)}</td>
                      <td className="text-right">
                        {!t.closed_at && (
                          <Button size="sm" variant="ghost" onClick={() => close.mutate(t)} disabled={close.isPending}>
                            <X className="mr-1 h-3.5 w-3.5" /> Close
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "long", "short"] as const).map((d) => (
          <Button key={d} size="sm" variant={dir === d ? "default" : "outline"} onClick={() => setDir(d)} className="capitalize">
            {d === "all" ? "All ideas" : `${d}s`}
          </Button>
        ))}
        {data && <span className="ml-auto text-xs text-muted-foreground">Scanned with prices through {fmtDate(data.ideas[0]?.asOf ?? data.generatedAt)}</span>}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ideas.map((idea) => <IdeaCard key={idea.ticker} idea={idea} live={priceOf(idea.ticker)} onTrack={() => track.mutate(idea)} busy={track.isPending || quotes.isLoading} />)}
        </div>
      )}

      {data && (
        <Panel title="How each rule has done" subtitle="Every firing since ~2016 across all covered companies, held 3 months, measured against the S&P 500 (SPY)">
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            {(Object.keys(SIGNAL_META) as SignalKind[]).map((k) => (
              <div key={k} className="min-w-0 rounded-md border border-border p-3">
                <div className="font-medium">{SIGNAL_META[k].label} <span className="text-xs text-muted-foreground">({SIGNAL_META[k].dir})</span></div>
                <div className="text-xs text-muted-foreground">{SIGNAL_META[k].rule}</div>
                <div className="mt-1 text-xs"><Stat s={data.pooled[k] ?? { n: 0, avg: null, avgExcess: null, hitRate: null }} label="History" /></div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function IdeaCard({ idea, live, onTrack, busy }: { idea: Idea; live?: number; onTrack: () => void; busy: boolean }) {
  const { open } = useSource();
  const long = idea.direction === "long";
  return (
    <Panel
      className="min-w-0"
      title={
        <Link to="/app/companies/$ticker" params={{ ticker: idea.ticker }} className="flex items-center gap-2">
          <CompanyLogo ticker={idea.ticker} size="sm" />
          <span>{idea.ticker}</span>
          <span className="truncate text-sm font-normal text-muted-foreground">{idea.name}</span>
        </Link>
      }
      actions={
        <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold uppercase", long ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative")}>
          {long ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {idea.direction} · {idea.signals.length} signal{idea.signals.length > 1 ? "s" : ""}
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        {idea.signals.map((s) => (
          <div key={s.kind} className="rounded-md border border-border p-2.5">
            <div className="font-medium">{SIGNAL_META[s.kind].label}</div>
            <div className="text-muted-foreground">{s.detail}</div>
            <div className="mt-1 space-y-0.5 text-xs">
              <div><Stat s={s.stats} label="All companies" /></div>
              <div><Stat s={s.own} label={idea.ticker} /></div>
            </div>
            {s.evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.evidence.map((e, k) => (
                  <button
                    key={k}
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs hover:bg-muted"
                    onClick={() =>
                      open({ ticker: idea.ticker, label: e.label, periodLabel: e.periodLabel, unit: e.unit, value: e.value, src: e.src, derived: e.derived, doc: e.doc })
                    }
                  >
                    <FileText className="h-3 w-3" />
                    {e.label}{e.periodLabel ? ` · ${e.periodLabel}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div><div className="text-muted-foreground">Price</div><div className="tabular-nums font-medium">{fmtPrice(live ?? idea.price)}</div></div>
          <div><div className="text-muted-foreground">Stop</div><div className="tabular-nums">{fmtPrice(idea.plan.stop)}</div></div>
          <div><div className="text-muted-foreground">Target</div><div className="tabular-nums">{fmtPrice(idea.plan.target)}</div></div>
          <div className="flex items-end justify-end">
            <Button size="sm" variant="outline" onClick={onTrack} disabled={busy}><Plus className="mr-1 h-3.5 w-3.5" /> Paper trade</Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Stop is 2× the 14-day average daily range from the scan price; target is twice that risk.</p>
      </div>
    </Panel>
  );
}
