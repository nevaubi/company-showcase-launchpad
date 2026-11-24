// Ownership and positioning on the Overview: what insiders did on the open market in the last 90 days, how much of
// the reported off-exchange volume was sold short lately, and what the options market prices. Each block states
// its date and what it is not (short volume is not short interest; options figures are context, not a signal).
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { useSource } from "@/components/source/source-context";
import { useNextEarnings } from "@/hooks/use-next-earnings";
import { supabase } from "@/integrations/supabase/client";
import { insiderSummary, insiderWindowCaption, fmtTradeUsd, roleLabel, tradeAmount } from "@/lib/company/insider-trades";
import { optionsContext, shortTrend } from "@/lib/company/positioning";
import type { CompanyDataset } from "@/lib/financials/types";
import { fmtDate, fmtPrice } from "@/lib/format";
import { cboeQuotePage, IV_RANK_MIN_DAYS } from "@/lib/options/core";
import { optionsHistoryQuery } from "@/lib/options/data";
import { cn } from "@/lib/utils";
import { Spark } from "./spark";

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const points = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(1)} pts`;
const FINRA_FILES = "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files";

const shortVolumeQuery = (ticker: string) => ({
  queryKey: ["short-volume", ticker],
  staleTime: 30 * 60_000,
  retry: 1,
  queryFn: async () => {
    const { data, error } = await supabase.from("short_volume").select("date, short_vol, total_vol").eq("symbol", ticker).order("date", { ascending: false }).limit(130);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ date: r.date, short: Number(r.short_vol), total: Number(r.total_vol) }));
  },
});

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <>
      <h3 className={IR.group}>{title}</h3>
      {note && <p className={IR.caption}>{note}</p>}
    </>
  );
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={IR.caption}>{label}</dt>
      <dd className="num text-[13px] font-medium leading-5 tabular-nums">{value}</dd>
      {sub && <dd className={IR.caption}>{sub}</dd>}
    </div>
  );
}

function Insiders({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  // one set of trades for the totals and the list: the window's, or the latest on file when the window is empty
  const s = useMemo(() => insiderSummary(data.insiders), [data.insiders]);
  const net = s.bought - s.sold;
  const n = s.inWindow.length;
  return (
    <div className="min-w-0 px-4 py-3" data-section="Insider activity">
      <Head title="Insiders" note={n ? `${insiderWindowCaption(s, fmtDate)} · ${n} trade${n === 1 ? "" : "s"}` : insiderWindowCaption(s, fmtDate)} />
      {n > 0 ? (
        <dl className="mt-2 grid grid-cols-3 gap-3">
          <Fact label={`Sales${s.sales ? ` (${s.sales})` : ""}`} value={s.sales ? fmtTradeUsd(s.sold) : "None"} />
          <Fact label={`Buys${s.purchases ? ` (${s.purchases})` : ""}`} value={s.purchases ? fmtTradeUsd(s.bought) : "None"} />
          <Fact label="Net" value={<span className={net > 0 ? "text-positive" : net < 0 ? "text-negative" : ""}>{`${net > 0 ? "+" : ""}${fmtTradeUsd(net)}`}</span>} sub={s.unpriced ? `${s.unpriced} without a price, not valued` : undefined} />
        </dl>
      ) : (
        <p className="mt-2 text-[13px] leading-5">No open-market trades in the last {s.days} days.</p>
      )}
      {s.list.length > 0 ? (
        <>
          <p className={cn("mt-2", IR.caption)}>{s.listTitle}</p>
          <ul aria-label={s.listTitle} className="mt-1 divide-y divide-border/60 border-t border-border/60">
            {s.list.map((t) => (
              <li key={`${t.accn}-${t.kind}`}>
                <button
                  type="button"
                  onClick={() => open({ ticker, label: `Form 4 · ${t.owner}`, periodLabel: t.date, unit: "usd", value: t.usd ?? 0, doc: { accn: t.accn, doc: t.doc, form: "4", filed: t.filed, title: `${t.owner}, ${t.role}` } })}
                  className="flex w-full items-baseline gap-2 py-1 text-left text-[13px] leading-5 transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Open the Form 4"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t.owner}
                    <span className={cn("ml-1.5", IR.caption)}>{roleLabel(t.role)}</span>
                  </span>
                  <span className={cn("num shrink-0 tabular-nums", t.kind === "purchase" ? "text-positive" : "text-negative")}>{tradeAmount(t)}</span>
                  <span className={cn("num w-[5.25rem] shrink-0 whitespace-nowrap text-right", IR.caption)}>{fmtDate(t.date)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={cn("mt-2", IR.caption)}>No open-market purchase or sale on file.</p>
      )}
      <p className={cn("mt-1.5", IR.caption)}>
        <Link to="/app/companies/$ticker/insiders" params={{ ticker }} className="text-link hover:underline">
          Ownership and every Form 4
        </Link>
      </p>
    </div>
  );
}

function ShortVolume({ ticker }: { ticker: string }) {
  const q = useQuery(shortVolumeQuery(ticker));
  const t = useMemo(() => shortTrend(q.data ?? []), [q.data]);
  // no recent daily files for the ticker: no block
  if (!t && !q.isLoading && !q.isError) return null;
  return (
    <div className="min-w-0 px-4 py-3" data-section="Short volume">
      <Head title="Short sale volume" note={t ? `${t.days} trading days to ${fmtDate(t.asOf)} · FINRA daily files` : q.isLoading ? "Loading" : "FINRA daily files"} />
      {t ? (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-3">
            <Fact label={`Last ${t.days} days`} value={pct(t.share)} sub="of reported volume" />
            <Fact label="20 days before" value={t.prior != null ? pct(t.prior) : DASH} sub={t.prior != null ? <span className="num">{points(t.share - t.prior)}</span> : "not enough days"} />
            <Fact label="Last 60 days" value={t.share60 != null ? pct(t.share60) : DASH} />
          </dl>
          <div className="mt-2 flex items-center gap-2">
            <Spark points={t.series.map((d) => ({ label: fmtDate(d.date), value: d.share, text: pct(d.share) }))} name="Daily share of reported volume sold short" width={200} height={28} />
            <span className={IR.caption}>daily share, {t.series.length} days</span>
          </div>
        </>
      ) : (
        <p className={cn("mt-2", IR.caption)}>{q.isLoading ? "Reading the daily files." : "The short sale volume could not be read just now."}</p>
      )}
      <p className={cn("mt-1.5", IR.caption)}>
        Short sales as a share of the off-exchange volume FINRA publishes each day. It includes market makers' hedging and is not short interest.{" "}
        <a href={FINRA_FILES} target="_blank" rel="noreferrer" className="text-link hover:underline">
          Source
        </a>
      </p>
    </div>
  );
}

function Options({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const q = useQuery(optionsHistoryQuery(ticker));
  const releases = useMemo(() => data.earningsReleases.map((r) => r.filed), [data.earningsReleases]);
  const next = useNextEarnings(ticker, releases);
  const c = useMemo(() => optionsContext(q.data ?? [], next && !next.estimated ? next.date : null), [q.data, next]);
  const last = q.data?.[0];
  // no recorded snapshot for the ticker: no block
  if (!c && !q.isLoading && !q.isError) return null;
  return (
    <div className="min-w-0 px-4 py-3" data-section="Options context">
      <Head title="Options" note={c ? `Close of ${fmtDate(c.asOf)}${last ? ` at ${fmtPrice(last.price)}` : ""} · Cboe delayed chain · ${c.recorded} recorded day${c.recorded === 1 ? "" : "s"}` : q.isLoading ? "Loading" : "Cboe delayed chain"} />
      {c ? (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-3">
            <Fact
              label="Implied volatility, 30 days"
              value={c.iv30 != null ? pct(c.iv30) : DASH}
              sub={c.ivChange ? <span className="num">{points(c.ivChange.points)} since {fmtDate(c.ivChange.from)}</span> : undefined}
            />
            <Fact
              label={c.implied?.through === "earnings" ? "Priced move, through the report" : "Priced move"}
              value={c.implied ? `±${pct(c.implied.move)}` : DASH}
              sub={c.implied ? `by ${fmtDate(c.implied.expiry)} (${c.implied.days} days), at-the-money straddle` : "no expiry far enough out"}
            />
            <Fact
              label="Rank in its range"
              value={c.rank ? pct(c.rank.rank, 0) : DASH}
              sub={c.rank ? `of ${c.rank.n} earlier days` : `needs ${IV_RANK_MIN_DAYS} recorded days`}
            />
            <Fact label="Put/call, open interest" value={c.putCallOpenInterest != null ? c.putCallOpenInterest.toFixed(2) : DASH} />
            <Fact label="Put/call, volume" value={c.putCallVolume != null ? c.putCallVolume.toFixed(2) : DASH} />
            <Fact label="25-delta skew" value={c.skew25 != null ? points(c.skew25) : DASH} sub="put less call volatility" />
          </dl>
        </>
      ) : (
        <p className={cn("mt-2", IR.caption)}>{q.isLoading ? "Reading the snapshots." : "The options snapshots could not be read just now."}</p>
      )}
      <p className={cn("mt-1.5", IR.caption)}>
        Context, not a signal: the history is only as long as the recorded days.{" "}
        <a href={cboeQuotePage(ticker)} target="_blank" rel="noreferrer" className="text-link hover:underline">
          Cboe chain
        </a>
      </p>
    </div>
  );
}

export function PositioningPanel({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  return (
    <IrPanel
      section="Ownership and positioning"
      title="Ownership and positioning"
      subtitle="Insider trades from Form 4, short sale volume from FINRA and options from Cboe where they are on file · each block states its date"
      bodyClassName="p-0"
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/companies/$ticker/insiders" params={{ ticker }}>
            Ownership
          </Link>
        </Button>
      }
    >
      <div className="grid grid-cols-1 divide-y lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none lg:divide-x lg:divide-y-0">
        <Insiders ticker={ticker} data={data} />
        <ShortVolume ticker={ticker} />
        <Options ticker={ticker} data={data} />
      </div>
    </IrPanel>
  );
}
