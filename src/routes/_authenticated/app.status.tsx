import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { manifestQuery } from "@/lib/data";
import { fmtDate, fmtInt, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/status")({
  head: () => ({
    meta: [
      { title: "Data status — Filed Under" },
      { name: "description", content: "Where every number comes from, how often it refreshes, and when each scheduled refresh last ran." },
      { property: "og:title", content: "Data status — Filed Under" },
      { property: "og:description", content: "Sources, refresh schedules and the latest run of every data job." },
    ],
  }),
  component: Status,
});

const JOBS = [
  {
    id: "prices",
    title: "Prices",
    source: "Yahoo Finance daily bars",
    cadence: "Every 6 minutes during U.S. market hours, 10 symbols a run — each of the 99 symbols refreshes about hourly",
  },
  {
    id: "sec",
    title: "SEC filings & Form 4s",
    source: "SEC EDGAR submissions + Form 4 XML",
    cadence: "Every 6 minutes, 2 companies a run — each company is re-checked every ~4 hours",
  },
  {
    id: "macro",
    title: "Economic data",
    source: "FRED mirror of BLS, BEA, Census, Fed, EIA; U.S. Treasury Fiscal Data",
    cadence: "Every 20 minutes, 8 series a run — all 118 series refresh about every 5 hours",
  },
  {
    id: "filing-cache",
    title: "Filing mirror",
    source: "Latest 10-K and 10-Q documents, compressed into private storage",
    cadence: "Every 15 minutes, one document a run; documents opened in the app are mirrored on first view",
  },
] as const;

interface Run {
  id: number;
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  items: number;
  detail: Record<string, unknown> | null;
}

const runsQuery = {
  queryKey: ["job-runs"],
  queryFn: async (): Promise<Run[]> => {
    const { data, error } = await supabase.from("job_runs").select("*").order("started_at", { ascending: false }).limit(200);
    if (error) throw error;
    return (data ?? []) as Run[];
  },
  refetchInterval: 60_000,
};

const liveQuery = {
  queryKey: ["live-counts"],
  queryFn: async () => {
    const count = async (t: "market_bars" | "macro_observations" | "sec_filings" | "insider_trades" | "filing_documents") => {
      const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
      return count ?? 0;
    };
    const [bars, macro, filings, trades, docs] = await Promise.all([count("market_bars"), count("macro_observations"), count("sec_filings"), count("insider_trades"), count("filing_documents")]);
    const latest = async (t: "market_bars" | "sec_filings", col: "date" | "filed") => {
      const { data } = await supabase.from(t).select(col).order(col, { ascending: false }).limit(1);
      return (data?.[0] as Record<string, string> | undefined)?.[col] ?? null;
    };
    const [lastBar, lastFiling] = await Promise.all([latest("market_bars", "date"), latest("sec_filings", "filed")]);
    const { data: sizes } = await supabase.from("filing_documents").select("bytes").limit(1000);
    return { bars, macro, filings, trades, docs, lastBar, lastFiling, docBytes: (sizes ?? []).reduce((s, r) => s + (r.bytes ?? 0), 0) };
  },
  refetchInterval: 120_000,
};

function summary(detail: Run["detail"]) {
  if (!detail) return "";
  const d = detail as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]).slice(0, 10).join(", ") : "");
  if (d.symbols) return list("symbols");
  if (d.series) return list("series");
  if (d.companies) return `${list("companies")} · ${d.filings ?? 0} filings, ${d.trades ?? 0} trades`;
  if (d.ticker) return `${d.ticker} ${d.form ?? ""}${d.stored ? " stored" : d.skipped ? " already mirrored" : ""}`;
  if (d.error) return String(d.error);
  return "";
}

function Status() {
  const manifest = useQuery(manifestQuery);
  const runs = useQuery(runsQuery);
  const live = useQuery(liveQuery);
  const m = manifest.data;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Provenance"
        title="Data status"
        description="Every figure starts in a bundled snapshot built from primary sources; scheduled jobs then layer newer prices, filings, insider trades and economic prints on top."
      />

      <Panel title="Snapshot" subtitle={m ? `Built ${fmtDate(m.generatedAt)} (${fmtRelative(m.generatedAt)}) from SEC EDGAR, Yahoo Finance, FRED and the U.S. Treasury` : "Loading…"}>
        {m ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
            {[
              ["Companies", fmtInt(m.companies)],
              ["SEC filings indexed", fmtInt(m.filings)],
              ["Sourced statement values", fmtInt(m.statementValues)],
              ["Segment facts", fmtInt(m.segmentFacts)],
              ["Company fiscal years", fmtInt(m.fiscalYears), `back to FY${m.oldestFiscalYearEnd.slice(0, 4)}`],
              ["Form 4 transactions", fmtInt(m.insiderTransactions)],
              ["Economic series", fmtInt(m.macroSeries)],
              ["Price histories", fmtInt(m.priceSymbols)],
            ].map(([k, v, sub]) => (
              <div key={k}>
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="num mt-0.5 text-lg font-medium">{v}</dd>
                {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
              </div>
            ))}
          </dl>
        ) : (
          <Skeleton className="h-16" />
        )}
      </Panel>

      <Panel title="Scheduled refreshes" subtitle="Runs are recorded as they finish · this page refreshes every minute" bodyClassName="p-0">
        <div className="divide-y">
          {JOBS.map((j) => {
            const mine = (runs.data ?? []).filter((r) => r.job === j.id);
            const last = mine[0];
            const day = mine.filter((r) => Date.now() - new Date(r.started_at).getTime() < 86400000);
            const okRate = day.length ? day.filter((r) => r.ok).length / day.length : null;
            return (
              <div key={j.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[14rem_minmax(0,1fr)_12rem]">
                <div>
                  <p className="text-[13px] font-semibold">{j.title}</p>
                  <p className="text-[11px] text-muted-foreground">{j.source}</p>
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Clock3 className="size-3.5 shrink-0" /> {j.cadence}
                  </p>
                  {last && <p className="num mt-1 truncate text-[11px] text-muted-foreground">Last batch: {summary(last.detail)}</p>}
                  <div className="mt-2 flex h-4 items-end gap-px" aria-label="Recent runs">
                    {mine
                      .slice(0, 48)
                      .reverse()
                      .map((r) => (
                        <span
                          key={r.id}
                          title={`${fmtDate(r.started_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${r.ok ? "ok" : "failed"} · ${r.items} items`}
                          className={cn("w-1.5 rounded-sm", r.ok ? "bg-positive" : "bg-negative")}
                          style={{ height: `${Math.max(25, Math.min(100, 25 + r.items * 3))}%` }}
                        />
                      ))}
                  </div>
                </div>
                <div className="text-right">
                  {runs.isLoading ? (
                    <Skeleton className="ml-auto h-10 w-32" />
                  ) : last ? (
                    <>
                      <Badge variant={last.ok ? "outline" : "destructive"} className="gap-1">
                        {last.ok ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />} {last.ok ? "Healthy" : "Last run failed"}
                      </Badge>
                      <p className="mt-1 text-[11px] text-muted-foreground">{fmtRelative(last.finished_at ?? last.started_at)}</p>
                      {okRate != null && <p className="num text-[10px] text-muted-foreground">{Math.round(okRate * 100)}% ok · {day.length} runs in 24h</p>}
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No runs recorded yet — schedules run on the published app.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Fresh data stored by the jobs" subtitle="Merged over the snapshot wherever it's newer">
        {live.data ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {[
              ["Daily price bars", fmtInt(live.data.bars), live.data.lastBar ? `through ${fmtDate(live.data.lastBar)}` : ""],
              ["Economic observations", fmtInt(live.data.macro), ""],
              ["New SEC filings", fmtInt(live.data.filings), live.data.lastFiling ? `latest ${fmtDate(live.data.lastFiling)}` : ""],
              ["Parsed insider trades", fmtInt(live.data.trades), ""],
              ["Mirrored filings", fmtInt(live.data.docs), live.data.docBytes ? `${(live.data.docBytes / 1e6).toFixed(1)} MB original size` : ""],
            ].map(([k, v, sub]) => (
              <div key={k}>
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="num mt-0.5 text-lg font-medium">{v}</dd>
                {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
              </div>
            ))}
          </dl>
        ) : (
          <Skeleton className="h-16" />
        )}
      </Panel>
    </div>
  );
}
