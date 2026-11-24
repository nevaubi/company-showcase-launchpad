import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { IdeasTable } from "@/components/signals/ideas-table";
import { CAPTION, NUM, SideTag, TD, TH } from "@/components/signals/parts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useQuotes } from "@/lib/data";
import { paperReturn, type BacktestStats, type Direction, type Idea, type SignalKind } from "@/lib/signals/core";
import { count, dayLong, nameOf, pct, price } from "@/lib/signals/format";
import { ideasVerdict, IDEA_LIMITS, rankIdeas, READING_LABEL, ruleRecords, type RankedIdea } from "@/lib/signals/ideas";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/ideas")({
  head: () => ({
    meta: [
      { title: "Trade ideas · FiledUnder" },
      { name: "description", content: "Three-month ideas from filed fundamentals, valuation, insider buying and price trend, each with its rule's history against the S&P 500 and its SEC sources." },
      { property: "og:title", content: "Trade ideas · FiledUnder" },
      { property: "og:description", content: "Source-backed three-month ideas with each rule's history and paper tracking." },
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

type View = "short" | "all";
type Side = "all" | Direction;

function IdeasPage() {
  const { data, isLoading, error, refetch } = useQuery(signalsQuery);
  const trades = useQuery(tradesQuery);
  const qc = useQueryClient();
  const [view, setView] = useState<View>("short");
  const [side, setSide] = useState<Side>("all");
  const records = useMemo(() => ruleRecords(data?.pooled ?? {}), [data]);
  const ranking = useMemo(() => rankIdeas((data?.ideas ?? []).filter((i) => side === "all" || i.direction === side), data?.pooled ?? {}), [data, side]);
  const rows = view === "short" ? ranking.list : ranking.all;
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
      void qc.invalidateQueries({ queryKey: ["paper_trades"] });
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["paper_trades"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const scanned = data?.ideas[0]?.asOf ?? data?.generatedAt;
  // The scan is a published file: say how old it is, since stops and targets sit around the scan price.
  const age = scanned ? Math.floor((Date.now() - new Date(`${scanned.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000) : 0;
  const hidden = ranking.all.length - ranking.list.length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Signals"
        title="Trade ideas"
        description={`Three-month ideas from what companies file: valuation against their own history, revenue growth turning, insider buying, plus two price-trend rules, across ${data?.companies ?? "the"} curated companies. Short-term setups are a separate page: they hold days to weeks and use price and event rules. Not investment advice.`}
        actions={scanned ? <span className="text-[11px] text-muted-foreground">Scanned with prices through {dayLong(scanned)}{age > 7 ? `, ${age} days ago` : ""}</span> : undefined}
      />

      <Panel
        title="Ideas"
        subtitle="Held about three months, measured against the S&P 500"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Side> label="Side" size="xs" value={side} onChange={setSide} options={[{ v: "all", l: "Any side" }, { v: "long", l: "Long" }, { v: "short", l: "Short" }]} />
            <Segmented<View>
              label="Which ideas to show"
              size="xs"
              value={view}
              onChange={setView}
              options={[
                { v: "short", l: `Short list ${ranking.list.length}`, title: "Ideas resting on a rule that has made money against the S&P 500" },
                { v: "all", l: `Every idea ${ranking.all.length}`, title: "Every idea the scan found" },
              ]}
            />
          </div>
        }
        collapse={false}
      >
        <div data-section="Trade ideas" className="space-y-3">
          {error ? (
            <DataUnavailable compact title="Trade ideas could not load" error={error} onRetry={() => void refetch()} />
          ) : isLoading || !data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div>
                <p className="max-w-[60rem] text-[13px] font-medium leading-5">{ideasVerdict(records)}</p>
                <p className={cn(CAPTION, "mt-0.5 max-w-[60rem]")}>
                  {view === "short"
                    ? `The short list keeps an idea only when one of its reasons comes from a rule that has made money against the S&P 500 over ${IDEA_LIMITS.minFirings} or more firings. More such reasons rank higher; a signal pointing the other way cancels one. At most ${IDEA_LIMITS.max} ideas, ${IDEA_LIMITS.perSector} per sector.${hidden > 0 ? ` ${hidden} more are under Every idea.` : ""}`
                    : "Every idea the scan found, best-supported first. Ideas with a dash under Rules made rest only on rules that lost to the S&P 500 or have no history."}
                  {age > 7 ? ` The scan is ${age} days old, so stops and targets sit around the scan price: check the latest price first.` : ""}
                </p>
              </div>
              {rows.length ? (
                <IdeasTable rows={rows} priceOf={priceOf} onTrack={(i: RankedIdea) => track.mutate(i)} busy={track.isPending || quotes.isLoading} />
              ) : (
                <p className="border-t pt-3 text-[13px] leading-5 text-muted-foreground">{view === "short" ? `No ${side === "all" ? "" : `${side} `}idea rests on a rule that has made money.` : "The scan found no ideas."}</p>
              )}
            </>
          )}
        </div>
      </Panel>

      {data && (
        <Panel title="How each rule has done" subtitle="Every past firing across the curated companies since about 2016, held three months, against the S&P 500 (SPY)" collapse={false}>
          <div data-section="Rule record">
            <div className="-mx-3.5 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr className="border-b">
                    <th scope="col" className={cn(TH, "pl-3.5")}>Rule and when it fires</th>
                    <th scope="col" className={TH}>Side</th>
                    <th scope="col" className={cn(TH, "text-right")}>Fired</th>
                    <th scope="col" className={cn(TH, "text-right")} title="Average three-month return against the S&P 500, in the rule's direction">Avg vs S&P 500</th>
                    <th scope="col" className={cn(TH, "text-right")} title="Share of firings that beat the S&P 500">Beat it</th>
                    <th scope="col" className={cn(TH, "text-right")} title="The 95% range a fair coin gives over that many independent firings">Coin flip gives</th>
                    <th scope="col" className={cn(TH, "pr-3.5")}>Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.kind} className="border-b last:border-b-0">
                      <td className={cn(TD, "pl-3.5")}>
                        <div>{r.label}</div>
                        <div className={CAPTION}>{r.rule}</div>
                      </td>
                      <td className={TD}><SideTag side={r.dir === "long" ? 1 : -1} /></td>
                      <td className={cn(TD, NUM)}>{r.n ? count(r.n) : "–"}</td>
                      <td className={cn(TD, NUM, r.avgExcess == null ? "" : r.avgExcess > 0 ? "text-positive" : r.avgExcess < 0 ? "text-negative" : "")}>{pct(r.avgExcess, 1)}</td>
                      <td className={cn(TD, NUM)}>{pct(r.hitRate, 0, false)}</td>
                      <td className={cn(TD, NUM, "text-muted-foreground")}>{r.band == null || !r.n ? "–" : `${pct(0.5 - r.band, 0, false)} to ${pct(0.5 + r.band, 0, false)}`}</td>
                      <td className={cn(TD, "whitespace-nowrap pr-3.5", r.reading === "edge" ? "" : "text-muted-foreground")}>{READING_LABEL[r.reading]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={cn(CAPTION, "mt-2 max-w-[60rem]")}>
              The coin-flip range treats firings as independent. They are not: many companies fire in the same quarter, so the true range is wider and a rule needs to clear it by a margin. The file does not store the spread of returns, so the average has no error bar yet.
            </p>
          </div>
        </Panel>
      )}

      <Panel title="Your paper trades" subtitle="Ideas and setups you chose to track at live prices. No money involved." collapse={false}>
        <div data-section="Paper trades">
          {trades.isLoading ? (
            <Skeleton className="h-10" />
          ) : !trades.data?.length ? (
            <p className="text-[13px] leading-5 text-muted-foreground">Nothing tracked yet. Open an idea and press Paper trade.</p>
          ) : (
            <div className="-mx-3.5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b">
                    <th scope="col" className={cn(TH, "pl-3.5")}>Stock</th>
                    <th scope="col" className={TH}>Side</th>
                    <th scope="col" className={cn(TH, "text-right")}>Opened</th>
                    <th scope="col" className={cn(TH, "text-right")}>Entry</th>
                    <th scope="col" className={cn(TH, "text-right")}>Stop</th>
                    <th scope="col" className={cn(TH, "text-right")}>Target</th>
                    <th scope="col" className={cn(TH, "text-right")}>Now</th>
                    <th scope="col" className={cn(TH, "text-right")}>Return</th>
                    <th className={cn(TH, "pr-3.5")} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {trades.data.map((t) => {
                    const now = t.closed_price ?? priceOf(t.ticker);
                    const r = now == null ? null : paperReturn(t.direction, t.entry_price, now);
                    return (
                      <tr key={t.id} className="border-b last:border-b-0">
                        <td className={cn(TD, "max-w-[15rem] pl-3.5")}><TickerMark ticker={t.ticker} name={nameOf(t.ticker)} className="align-top" /></td>
                        <td className={TD}><SideTag side={t.direction === "long" ? 1 : -1} /></td>
                        <td className={cn(TD, NUM, "text-muted-foreground")}>{dayLong(t.entry_date)}</td>
                        <td className={cn(TD, NUM)}>{price(t.entry_price)}</td>
                        <td className={cn(TD, NUM)}>{price(t.stop)}</td>
                        <td className={cn(TD, NUM)}>{price(t.target)}</td>
                        <td className={cn(TD, NUM)}>
                          {price(now)}
                          {t.closed_at ? <span className="text-muted-foreground"> closed</span> : null}
                        </td>
                        <td className={cn(TD, NUM, "font-medium", r == null ? "" : r > 0 ? "text-positive" : r < 0 ? "text-negative" : "")}>{pct(r, 1)}</td>
                        <td className={cn(TD, "py-0 pr-3.5 text-right")}>
                          {!t.closed_at && (
                            <Button size="xs" variant="ghost" onClick={() => close.mutate(t)} disabled={close.isPending}>
                              <X aria-hidden /> Close
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
        </div>
      </Panel>
    </div>
  );
}
