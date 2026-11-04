import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { FileText } from "lucide-react";
import { PageHeader, Panel, Stat } from "@/components/app/page-header";
import { CompanyLogo } from "@/components/app/company-logo";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { fmtDate, fmtPct } from "@/lib/format";
import { marketsQuery, type MarketCompany } from "@/lib/markets/query";
import type { Reaction } from "@/lib/markets/core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/reactions")({
  validateSearch: z.object({ ticker: z.string().max(10).optional(), sector: z.string().max(40).optional() }),
  head: () => ({
    meta: [
      { title: "Earnings reactions — Filed Under" },
      { name: "description", content: "How every covered stock has moved on its earnings releases: size of move, vs the S&P 500, run-up and post-earnings drift." },
      { property: "og:title", content: "Earnings reactions — Filed Under" },
      { property: "og:description", content: "Earnings-day moves, excess return vs SPY and post-earnings drift for 78 US companies." },
    ],
  }),
  component: Reactions,
});

type SortKey = "avgAbsMove" | "avgSigma" | "upRate" | "avgExcess" | "continuation" | "avgDrift20";
const SORTS: { v: SortKey; l: string; title: string }[] = [
  { v: "avgAbsMove", l: "Avg move", title: "Average absolute two-day move" },
  { v: "avgSigma", l: "σ", title: "Move size in units of the stock's normal volatility" },
  { v: "upRate", l: "Up %", title: "Share of prints that closed higher" },
  { v: "avgExcess", l: "vs SPY", title: "Average move minus the S&P 500" },
  { v: "continuation", l: "Follow-through", title: "Share of prints where the next 20 days kept going the same direction" },
  { v: "avgDrift20", l: "20d drift", title: "Average return over the 20 sessions after the reaction" },
];

const tone = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "");

function Reactions() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(marketsQuery);
  const [sort, setSort] = useState<SortKey>("avgAbsMove");
  const sectors = [...new Set(COVERAGE.map((c) => c.sector))].sort();

  const rows = useMemo(() => {
    const cs = (q.data?.companies ?? []).filter((c) => c.stats.n >= 4 && (!s.sector || c.sector === s.sector));
    return [...cs].sort((a, b) => ((b.stats[sort] as number | null) ?? -9) - ((a.stats[sort] as number | null) ?? -9));
  }, [q.data, sort, s.sector]);
  const sel = q.data?.companies.find((c) => c.ticker === (s.ticker ?? rows[0]?.ticker));

  const all = useMemo(() => (q.data?.companies ?? []).flatMap((c) => c.reactions.map((r) => ({ ...r, ticker: c.ticker }))), [q.data]);
  const recent = useMemo(() => [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12), [all]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        eyebrow="Markets"
        title="Earnings reactions"
        description="How each stock moved around its earnings release (dated by the 8-K filed with the SEC): close before the release to close the day after, compared with the S&P 500, plus the run-up into the print and the drift after it."
        actions={
          <Select value={s.sector ?? "all"} onValueChange={(v) => navigate({ search: { ...s, sector: v === "all" ? undefined : v }, replace: true })}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sectors</SelectItem>
              {sectors.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {!q.data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Panel title="Leaderboard" subtitle={`${rows.length} companies · last ${Math.max(...rows.map((r) => r.stats.n), 0)} prints · click a row`} bodyClassName="p-0" className="min-w-0">
              <div className="border-b px-4 py-2">
                <Segmented label="Sort by" value={sort} options={SORTS} onChange={setSort} size="xs" />
              </div>
              <div className="max-h-[560px] overflow-auto scrollbar-thin">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Company</th>
                      {SORTS.map((x) => <th key={x.v} title={x.title} className="px-2 py-2 text-right font-medium">{x.l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr
                        key={c.ticker}
                        onClick={() => navigate({ search: { ...s, ticker: c.ticker }, replace: true })}
                        className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/50", sel?.ticker === c.ticker && "bg-highlight/40")}
                      >
                        <td className="px-4 py-1.5">
                          <span className="flex items-center gap-2"><CompanyLogo ticker={c.ticker} className="size-5" /><span className="font-medium">{c.ticker}</span></span>
                        </td>
                        <td className="num px-2 text-right">{fmtPct(c.stats.avgAbsMove)}</td>
                        <td className="num px-2 text-right">{c.stats.avgSigma?.toFixed(1) ?? "—"}</td>
                        <td className="num px-2 text-right">{fmtPct(c.stats.upRate, 0)}</td>
                        <td className={cn("num px-2 text-right", tone(c.stats.avgExcess))}>{fmtPct(c.stats.avgExcess, 1, true)}</td>
                        <td className="num px-2 text-right">{fmtPct(c.stats.continuation, 0)}</td>
                        <td className={cn("num px-2 text-right", tone(c.stats.avgDrift20))}>{fmtPct(c.stats.avgDrift20, 1, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            {sel && <CompanyReactions c={sel} />}
          </div>

          <Panel title="Latest prints across coverage" subtitle="Most recent earnings releases and how the stock took them" bodyClassName="p-0" className="min-w-0">
            <div className="overflow-x-auto scrollbar-thin">
              <ReactionTable rows={recent} showTicker />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function CompanyReactions({ c }: { c: MarketCompany }) {
  const st = c.stats;
  const name = coverageOf(c.ticker)?.shortName ?? c.ticker;
  const maxAbs = Math.max(...c.reactions.map((r) => Math.abs(r.move)), 0.01);
  const ordered = [...c.reactions].reverse();
  const read =
    st.continuation != null && st.continuation >= 0.66
      ? "Moves tend to keep going after the print — the first day has under-reacted."
      : st.continuation != null && st.continuation <= 0.34
        ? "Moves tend to reverse within a month — the first day has over-reacted."
        : "No consistent follow-through after the print.";
  return (
    <Panel
      title={<Link to="/app/companies/$ticker" params={{ ticker: c.ticker }} className="hover:underline">{name} · earnings profile</Link>}
      subtitle={`${st.n} releases since ${fmtDate(ordered[0]?.date)}`}
      className="min-w-0"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Avg move" value={fmtPct(st.avgAbsMove)} sub={st.avgSigma ? `${st.avgSigma.toFixed(1)}σ of a normal 2 days` : undefined} />
        <Stat label="Closed higher" value={fmtPct(st.upRate, 0)} sub={`median ${fmtPct(st.medianMove, 1, true)}`} />
        <Stat label="vs S&P 500" value={fmtPct(st.avgExcess, 1, true)} tone={st.avgExcess == null ? undefined : st.avgExcess > 0 ? "positive" : "negative"} />
        <Stat label="20-day drift" value={fmtPct(st.avgDrift20, 1, true)} sub={st.continuation != null ? `${fmtPct(st.continuation, 0)} follow-through` : undefined} />
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">{read} Run-up into prints averages {fmtPct(st.avgPreRun, 1, true)}.</p>
      <div className="mt-4 flex h-36 items-center gap-1" aria-label="Reaction per release, oldest to newest">
        {ordered.map((r) => (
          <div key={r.date} className="flex h-full flex-1 flex-col justify-center" title={`${fmtDate(r.date)}: ${fmtPct(r.move, 1, true)}`}>
            <div className="flex h-1/2 items-end">{r.move > 0 && <div className="w-full rounded-t-sm bg-positive" style={{ height: `${(r.move / maxAbs) * 100}%` }} />}</div>
            <div className="flex h-1/2 items-start border-t">{r.move < 0 && <div className="w-full rounded-b-sm bg-negative" style={{ height: `${(-r.move / maxAbs) * 100}%` }} />}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 -mx-4 overflow-x-auto scrollbar-thin border-t">
        <ReactionTable rows={c.reactions.map((r) => ({ ...r, ticker: c.ticker }))} />
      </div>
    </Panel>
  );
}

function ReactionTable({ rows, showTicker }: { rows: (Reaction & { ticker: string })[]; showTicker?: boolean }) {
  const { open } = useSource();
  return (
    <table className="w-full min-w-[640px] text-[13px]">
      <thead>
        <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
          {showTicker && <th className="px-4 py-2 text-left font-medium">Company</th>}
          <th className="px-4 py-2 text-left font-medium">Release</th>
          <th className="px-2 py-2 text-right font-medium" title="Close before → close the day after">Move</th>
          <th className="px-2 py-2 text-right font-medium">vs SPY</th>
          <th className="px-2 py-2 text-right font-medium">Gap</th>
          <th className="px-2 py-2 text-right font-medium" title="5 sessions before">Run-up</th>
          <th className="px-2 py-2 text-right font-medium">+5d</th>
          <th className="px-2 py-2 text-right font-medium">+20d</th>
          <th className="px-2 py-2 text-right font-medium" title="Volume vs 20-day average">Volume</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ticker + r.date} className="border-b last:border-0">
            {showTicker && (
              <td className="px-4 py-1.5">
                <Link to="/app/reactions" search={{ ticker: r.ticker }} className="flex items-center gap-2 font-medium hover:underline"><CompanyLogo ticker={r.ticker} className="size-5" />{r.ticker}</Link>
              </td>
            )}
            <td className="px-4 py-1.5">{fmtDate(r.date)}</td>
            <td className={cn("num px-2 text-right font-medium", tone(r.move))}>{fmtPct(r.move, 1, true)}</td>
            <td className={cn("num px-2 text-right", tone(r.excess))}>{fmtPct(r.excess, 1, true)}</td>
            <td className={cn("num px-2 text-right", tone(r.gap))}>{fmtPct(r.gap, 1, true)}</td>
            <td className={cn("num px-2 text-right", tone(r.preRun))}>{fmtPct(r.preRun, 1, true)}</td>
            <td className={cn("num px-2 text-right", tone(r.drift5))}>{fmtPct(r.drift5, 1, true)}</td>
            <td className={cn("num px-2 text-right", tone(r.drift20))}>{fmtPct(r.drift20, 1, true)}</td>
            <td className="num px-2 text-right">{r.volRatio ? `${r.volRatio.toFixed(1)}×` : "—"}</td>
            <td className="px-4 text-right">
              <button
                type="button"
                aria-label="Open the earnings release"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => open({ ticker: r.ticker, label: `${r.ticker} earnings release`, unit: "usd", value: 0, doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.date, title: `${r.ticker} earnings release · ${r.date}` } })}
              >
                <FileText className="size-4" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
