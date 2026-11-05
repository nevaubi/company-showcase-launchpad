import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, FileSpreadsheet, FileText, Flag, Star } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMacro, useQuotes, useUniverse } from "@/lib/data";
import { BENCHMARKS, MACRO_SERIES } from "@/lib/coverage";
import { changeText, fmtMacro, reading } from "@/lib/macro";
import { fmtCompactUsd, fmtDate, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { useProfile, useWatchlist } from "@/lib/workspace";
import { ThesisList } from "@/components/app/thesis-list";
import { DailyBrief } from "@/components/app/daily-brief";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Filed Under" },
      { name: "description", content: "Your watchlist, theses, filings and macro at a glance." },
      { property: "og:title", content: "Dashboard — Filed Under" },
      { property: "og:description", content: "Your watchlist, theses, filings and macro at a glance." },
    ],
  }),
  component: Dashboard,
});

const MACRO_TILES = ["DGS10", "T10Y2Y", "CPIAUCSL", "UNRATE", "FEDFUNDS", "BAMLH0A0HYM2"];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Dashboard() {
  const me = useProfile();
  const watch = useWatchlist();
  const universe = useUniverse();
  const tickers = (watch.data ?? []).map((w) => w.ticker);
  const quotes = useQuotes(tickers);
  const sectorSyms = BENCHMARKS.filter((b) => b.group !== "macro" || b.symbol === "^VIX").map((b) => b.symbol);
  const sectorQuotes = useQuotes(sectorSyms);

  const theses = useQuery({
    queryKey: ["theses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("theses").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const recent = useQuery({
    queryKey: ["recent-work"],
    queryFn: async () => {
      const [docs, sessions] = await Promise.all([
        supabase.from("documents").select("id, title, kind, ticker, updated_at").order("updated_at", { ascending: false }).limit(5),
        supabase.from("research_sessions").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(5),
      ]);
      if (docs.error) throw docs.error;
      if (sessions.error) throw sessions.error;
      return { docs: docs.data, sessions: sessions.data };
    },
  });

  const name = me.data?.profile?.display_name || me.data?.user.email?.split("@")[0] || "";
  const qmap = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]));
  const umap = new Map((universe.data?.companies ?? []).map((c) => [c.ticker, c]));
  const allQuotes = new Map([...(sectorQuotes.data?.quotes ?? []), ...(quotes.data?.quotes ?? [])].map((q) => [q.symbol, q]));

  const filingsFeed = useMemo(
    () =>
      (universe.data?.companies ?? [])
        .filter((c) => c.lastFiling)
        .sort((a, b) => (a.lastFiling!.filed < b.lastFiling!.filed ? 1 : -1)),
    [universe.data],
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          <h1 className="mt-1.5 font-display text-[2.4rem] leading-none">
            {greeting()}
            {name ? `, ${name}` : ""}.
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/research">
              <Bot /> Ask the research agent
            </Link>
          </Button>
          <Button variant="ink" size="sm" asChild>
            <Link to="/app/theses">
              <Flag /> New thesis
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {["SPY", "QQQ", "DIA", "IWM", "^VIX", "XLK", "SMH", "XLE"].map((s) => {
          const q = allQuotes.get(s);
          const b = BENCHMARKS.find((x) => x.symbol === s);
          return (
            <Link key={s} to="/app/markets" search={{ symbol: s }} className="rounded-lg border bg-card px-3 py-2 shadow-paper transition-colors hover:bg-secondary/60">
              <p className="truncate text-[11px] text-muted-foreground">{b?.name.replace(/ \(.*\)/, "") ?? s}</p>
              <p className="num text-sm font-medium">{q ? fmtPrice(q.price) : "—"}</p>
              <p className={cn("num text-[11px]", (q?.changePct ?? 0) >= 0 ? "text-positive" : "text-negative")}>{q ? fmtPct(q.changePct, 2, true) : ""}</p>
            </Link>
          );
        })}
      </div>

      {watch.isSuccess && <DailyBrief tickers={tickers} />}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          title="Watchlist"
          subtitle={`${tickers.length} companies you follow`}
          actions={
            <Button size="xs" variant="ghost" asChild>
              <Link to="/app/companies">
                Browse coverage <ArrowRight />
              </Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          {watch.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !tickers.length ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Star className="mx-auto mb-2 size-5" />
              Follow companies from the coverage list to see them here.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-2 py-2 text-right font-medium">Price</th>
                  <th className="px-2 py-2 text-right font-medium">Day</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">5D</th>
                  <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Rev TTM</th>
                  <th className="px-4 py-2 text-right font-medium">Rev YoY</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map((t) => {
                  const q = qmap.get(t);
                  const u = umap.get(t);
                  return (
                    <tr key={t} className="border-b last:border-0 hover:bg-secondary/60">
                      <td className="px-4 py-2">
                        <Link to="/app/companies/$ticker" params={{ ticker: t }} className="flex items-center gap-2.5">
                          <CompanyLogo ticker={t} src={u?.logo} size="sm" />
                          <span>
                            <span className="num block font-semibold">{t}</span>
                            <span className="block text-[11px] text-muted-foreground">{u?.name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="num px-2 py-2 text-right">{fmtPrice(q?.price)}</td>
                      <td className={cn("num px-2 py-2 text-right", (q?.changePct ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(q?.changePct, 2, true)}</td>
                      <td className="hidden px-2 py-2 sm:table-cell">
                        <Sparkline values={q?.spark ?? []} tone={(q?.changePct ?? 0) >= 0 ? "positive" : "negative"} className="h-6 w-16" />
                      </td>
                      <td className="num hidden px-2 py-2 text-right sm:table-cell">{fmtCompactUsd(u?.revenueTTM)}</td>
                      <td className={cn("num px-4 py-2 text-right", (u?.revenueGrowthYoY ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtPct(u?.revenueGrowthYoY, 1, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title="Theses"
          subtitle="Tracked against the live price"
          actions={
            <Button size="xs" variant="ghost" asChild>
              <Link to="/app/theses">
                All theses <ArrowRight />
              </Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          <ThesisList theses={theses.data ?? []} loading={theses.isLoading} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel
          title="Macro"
          subtitle="FRED"
          actions={
            <Button size="xs" variant="ghost" asChild>
              <Link to="/app/macro">
                Dashboard <ArrowRight />
              </Link>
            </Button>
          }
          bodyClassName="grid grid-cols-2 gap-px bg-border p-0"
        >
          {MACRO_TILES.map((id) => (
            <MacroTile key={id} id={id} />
          ))}
        </Panel>

        <Panel title="Latest filings" subtitle="Most recent SEC filing per covered company" bodyClassName="p-0">
          <ul className="divide-y">
            {filingsFeed.map((c) => (
              <li key={c.ticker}>
                <Link to="/app/companies/$ticker/filings" params={{ ticker: c.ticker }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60">
                  <CompanyLogo ticker={c.ticker} src={c.logo} size="xs" />
                  <span className="num w-12 text-xs font-semibold">{c.ticker}</span>
                  <Badge variant="outline">{c.lastFiling!.form}</Badge>
                  <span className="num ml-auto text-xs text-muted-foreground">{fmtDate(c.lastFiling!.filed)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Recent work" bodyClassName="p-0">
          <ul className="divide-y">
            {(recent.data?.sessions ?? []).slice(0, 3).map((s) => (
              <li key={s.id}>
                <Link to="/app/research" search={{ session: s.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60">
                  <Bot className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                  <span className="text-[11px] text-muted-foreground">{fmtRelative(s.updated_at)}</span>
                </Link>
              </li>
            ))}
            {(recent.data?.docs ?? []).map((d) => (
              <li key={d.id}>
                <Link to="/app/docs/$id" params={{ id: d.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60">
                  {d.kind === "sheet" ? <FileSpreadsheet className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate text-[13px]">{d.title}</span>
                  <span className="text-[11px] text-muted-foreground">{fmtRelative(d.updated_at)}</span>
                </Link>
              </li>
            ))}
            {recent.data && !recent.data.docs.length && !recent.data.sessions.length && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">Docs, sheets and research chats you create show up here.</li>
            )}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function MacroTile({ id }: { id: string }) {
  const def = MACRO_SERIES.find((m) => m.id === id)!;
  const since = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
  const q = useMacro({ ...def, since: def.transform === "yoy" ? new Date(Date.now() - 4 * 365 * 86400000).toISOString().slice(0, 10) : since });
  const r = q.data ? reading(def, q.data.observations) : null;
  const short: Record<string, string> = { DGS10: "10Y yield", T10Y2Y: "10Y–2Y", CPIAUCSL: "CPI y/y", UNRATE: "Unemployment", FEDFUNDS: "Fed funds", BAMLH0A0HYM2: "HY spread" };
  return (
    <Link to="/app/macro" className="bg-card px-4 py-3 transition-colors hover:bg-secondary/60">
      <p className="text-[11px] text-muted-foreground">{short[id]}</p>
      {r ? (
        <>
          <p className="num text-lg font-medium">{fmtMacro(def, r.latest)}</p>
          <p className="num truncate text-[10.5px] text-muted-foreground">
            {changeText(def, r)} · {fmtDate(r.date, { month: "short", year: "2-digit", day: def.frequency === "Daily" ? "numeric" : undefined })}
          </p>
        </>
      ) : (
        <Skeleton className="mt-1 h-9" />
      )}
    </Link>
  );
}
