// Earnings on the Overview: when the next report is due, how the stock has moved on past reports, and how the last
// print compared with the consensus. The reactions are measured on the daily bars the page already holds
// (src/lib/company/setup.ts), so they are current for every covered company; nothing here is a forecast.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/components/source/source-context";
import { useNextEarnings } from "@/hooks/use-next-earnings";
import { earningsRead } from "@/lib/company/setup";
import { usePrices } from "@/lib/data";
import { beatStats } from "@/lib/estimates/core";
import { getEstimates } from "@/lib/estimates.functions";
import type { Bar, CompanyDataset } from "@/lib/financials/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (v: number, digits = 1) => `${(Math.abs(v) * 100).toFixed(digits)}%`;
const signedPct = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(v, digits)}`;
const tone = (v: number) => (v > 0 ? "text-positive" : v < 0 ? "text-negative" : "");

function Block({ label, value, sub, title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0 px-4 py-3" title={title}>
      <p className={cn("truncate", IR.caption)}>{label}</p>
      <p className={cn("mt-0.5 truncate", IR.stat)}>{value}</p>
      {sub && <p className={cn("mt-0.5", IR.caption)}>{sub}</p>}
    </div>
  );
}

export function EarningsSection({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const long = usePrices(ticker, "5y");
  const spy = usePrices("SPY", "5y");
  const releases = useMemo(() => data.earningsReleases.map((r) => r.filed), [data.earningsReleases]);
  const next = useNextEarnings(ticker, releases);
  const fetchEstimates = useServerFn(getEstimates);
  const est = useQuery({ queryKey: ["estimates", ticker], queryFn: () => fetchEstimates({ data: { ticker } }), staleTime: 3600_000, retry: 1 });
  const read = useMemo(() => earningsRead((long.data?.bars ?? []) as Bar[], data.earningsReleases, spy.data?.bars as Bar[] | undefined), [long.data, spy.data, data.earningsReleases]);
  const s = read.stats;
  const last = read.reactions[0];
  const shown = useMemo(() => read.reactions.slice(0, 12).reverse(), [read.reactions]);
  const max = Math.max(0.01, ...shown.map((r) => Math.abs(r.move)));
  const surprises = est.data?.estimates?.surprises ?? [];
  const lastSurprise = [...surprises].filter((x) => x.actual != null && x.estimate != null).sort((a, b) => b.quarter.localeCompare(a.quarter))[0];
  const beats = beatStats(surprises);
  const today = new Date().toISOString().slice(0, 10);
  const days = next ? Math.round((Date.parse(next.date) - Date.parse(today)) / 86_400_000) : null;
  const ups = read.reactions.filter((r) => r.move > 0).length;
  const openRelease = (r: { accn: string; doc: string; date: string }) => open({ ticker, label: "Earnings release", periodLabel: r.date, unit: "usd", value: 0, doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.date, title: "Earnings release (8-K)" } });

  return (
    <IrPanel
      section="Earnings"
      title="Earnings"
      subtitle={
        read.asOf
          ? `Stock moves run from the close before a release to the close after it · daily bars through ${fmtDate(read.asOf)} · past reactions, not a forecast`
          : long.isLoading
            ? "Loading prices"
            : "No price history to measure reactions on"
      }
      bodyClassName="p-0"
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/companies/$ticker/earnings" params={{ ticker }}>
            Earnings detail
          </Link>
        </Button>
      }
    >
      <div className="grid grid-cols-2 divide-x divide-y divide-border/60 md:grid-cols-3 2xl:grid-cols-6 2xl:divide-y-0">
        <Block
          label="Next report"
          value={next ? fmtDate(next.date) : DASH}
          sub={next ? `${days != null && days >= 0 ? `in ${days} day${days === 1 ? "" : "s"}` : ""}${next.estimated ? `${days != null && days >= 0 ? " · " : ""}projected: ${next.basis}` : " · from the earnings calendar"}` : "no release history to project from"}
        />
        <Block label="Average two-day move" value={s ? `±${pct(s.avgAbsMove)}` : DASH} sub={s ? `${s.n} reports since ${fmtDate(read.reactions[read.reactions.length - 1].date)}` : long.isLoading ? "measuring" : "no measured reports"} />
        <Block label="Up after reporting" value={s ? `${ups} of ${s.n}` : DASH} sub={s ? `median move ${signedPct(s.medianMove)}` : undefined} />
        <Block
          label="Kept direction over 20 days"
          value={s?.continuation != null ? pct(s.continuation, 0) : DASH}
          sub={s?.avgDrift20 != null ? `average drift ${signedPct(s.avgDrift20)} in the 20 sessions after` : undefined}
          title="Share of reports where the 20-session move after the reaction had the reaction's sign"
        />
        <div className="min-w-0 px-4 py-3">
          <p className={cn("truncate", IR.caption)}>Last report</p>
          {last ? (
            <>
              <button type="button" onClick={() => openRelease(last)} title="Open the earnings release" className={cn("-ml-1 mt-0.5 rounded-sm px-1 transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", IR.stat, tone(last.move))}>
                {signedPct(last.move)}
              </button>
              <p className={cn("mt-0.5", IR.caption)}>
                {fmtDate(last.date)}
                {last.sigma != null ? ` · ${last.sigma.toFixed(1)} times a normal two-day move` : ""}
                {last.excess != null ? ` · ${signedPct(last.excess)} against the S&P 500` : ""}
              </p>
            </>
          ) : (
            <p className={cn("mt-0.5", IR.stat)}>{DASH}</p>
          )}
        </div>
        <div className="min-w-0 px-4 py-3">
          <p className={cn("truncate", IR.caption)}>Last EPS against consensus</p>
          {est.isLoading ? (
            <Skeleton className="mt-1 h-6 w-24" />
          ) : lastSurprise ? (
            <>
              <p className={cn("mt-0.5 truncate", IR.stat)}>
                ${lastSurprise.actual!.toFixed(2)} <span className="text-[13px] font-normal text-muted-foreground">against ${lastSurprise.estimate!.toFixed(2)}</span>
              </p>
              <p className={cn("mt-0.5", IR.caption)}>
                {lastSurprise.surprisePct != null && <span className={cn("num", tone(lastSurprise.surprisePct))}>{signedPct(lastSurprise.surprisePct)}</span>} quarter to {fmtDate(lastSurprise.quarter)}
                {beats ? ` · above consensus in ${beats.beats} of ${beats.n}` : ""} ·{" "}
                <Link to="/app/companies/$ticker/estimates" params={{ ticker }} className="text-link hover:underline">
                  estimates
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className={cn("mt-0.5", IR.stat)}>{DASH}</p>
              <p className={cn("mt-0.5", IR.caption)}>no consensus history stored for {ticker}</p>
            </>
          )}
        </div>
      </div>
      {shown.length > 0 && (
        <div className="border-t px-4 py-3" data-section="Earnings reactions">
          <p className={IR.caption}>
            Last {shown.length} reports, oldest first: two-day move after each release (bars reach ±{pct(max)}). Click a bar for the release.
          </p>
          <div className="mt-2 w-fit max-w-full">
            <div className="flex h-20 items-stretch gap-[2px]">
              {shown.map((r) => (
                <button
                  key={r.accn}
                  type="button"
                  onClick={() => openRelease(r)}
                  title={`${fmtDate(r.date)}: ${signedPct(r.move)}${r.excess != null ? `, ${signedPct(r.excess)} against the S&P 500` : ""}`}
                  aria-label={`Earnings release ${fmtDate(r.date)}: stock ${signedPct(r.move)} over two days`}
                  className="group flex w-6 min-w-0 shrink flex-col rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-7"
                >
                  <span className="flex flex-1 items-end">{r.move >= 0 && <span className="w-full rounded-t-[3px] bg-positive group-hover:opacity-80" style={{ height: `${Math.max(2, (r.move / max) * 100)}%` }} />}</span>
                  <span className="h-px bg-border" />
                  <span className="flex flex-1 items-start">{r.move < 0 && <span className="w-full rounded-b-[3px] bg-negative group-hover:opacity-80" style={{ height: `${Math.max(2, (-r.move / max) * 100)}%` }} />}</span>
                </button>
              ))}
            </div>
            <p className={cn("mt-1 flex justify-between gap-4", IR.caption)}>
              <span>{fmtDate(shown[0].date)}</span>
              {shown.length > 1 && <span>{fmtDate(shown[shown.length - 1].date)}</span>}
            </p>
          </div>
        </div>
      )}
    </IrPanel>
  );
}
