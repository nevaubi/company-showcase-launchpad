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
import { optionsContext, shortTrend } from "@/lib/company/positioning";
import { fmtFig } from "@/lib/company/read";
import type { CompanyDataset } from "@/lib/financials/types";
import { fmtDate, fmtPrice } from "@/lib/format";
import { insiderWindow, insiderWindowLabel } from "@/lib/insiders/window";
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
      <dt className={cn("truncate", IR.caption)}>{label}</dt>
      <dd className="num text-[13px] font-medium leading-5 tabular-nums">{value}</dd>
      {sub && <dd className={IR.caption}>{sub}</dd>}
    </div>
  );
}

function Insiders({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const w = useMemo(() => insiderWindow(data.insiders), [data.insiders]);
  const trades = useMemo(() => data.insiders.filter((t) => t.code === "S" || t.code === "P").slice(0, 4), [data.insiders]);
  const net = w.bought - w.sold;
  return (
    <div className="min-w-0 px-4 py-3" data-section="Insider activity">
      <Head title="Insiders" note={`${insiderWindowLabel(w, fmtDate)} · ${w.filings} Form 4 filing${w.filings === 1 ? "" : "s"}`} />
      <dl className="mt-2 grid grid-cols-3 gap-3">
        <Fact label={`Sales${w.sales ? ` (${w.sales})` : ""}`} value={fmtFig(w.sold, "usd")} />
        <Fact label={`Buys${w.buys ? ` (${w.buys})` : ""}`} value={fmtFig(w.bought, "usd")} />
        <Fact label="Net" value={<span className={net > 0 ? "text-positive" : net < 0 ? "text-negative" : ""}>{net === 0 ? "$0" : `${net > 0 ? "+" : ""}${fmtFig(net, "usd")}`}</span>} />
      </dl>
      {trades.length > 0 ? (
        <ul className="mt-2 divide-y divide-border/60 border-t border-border/60">
          {trades.map((t, i) => (
            <li key={`${t.accn}-${i}`}>
              <button
                type="button"
                onClick={() => open({ ticker, label: `Form 4 · ${t.owner}`, periodLabel: t.date, unit: "usd", value: t.shares * (t.price ?? 0), doc: { accn: t.accn, doc: t.doc, form: "4", filed: t.filed, title: `${t.owner}, ${t.role}` } })}
                className="flex w-full items-baseline gap-2 py-1 text-left text-[13px] leading-5 transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Open the Form 4"
              >
                <span className="min-w-0 flex-1 truncate">
                  {t.owner}
                  <span className={cn("ml-1.5", IR.caption)}>{t.role}</span>
                </span>
                <span className={cn("num shrink-0 tabular-nums", t.code === "P" ? "text-positive" : "text-negative")}>
                  {t.code === "P" ? "bought" : "sold"} {t.price ? fmtFig(t.shares * t.price, "usd") : `${t.shares.toLocaleString("en-US")} sh`}
                </span>
                <span className={cn("num w-16 shrink-0 text-right", IR.caption)}>{fmtDate(t.date)}</span>
              </button>
            </li>
          ))}
        </ul>
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
        <p className={cn("mt-2", IR.caption)}>{q.isLoading ? "Reading the daily files." : q.isError ? "The short sale volume could not be read just now." : `No recent daily short sale volume is stored for ${ticker}.`}</p>
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
  return (
    <div className="min-w-0 px-4 py-3" data-section="Options context">
      <Head title="Options" note={c ? `Close of ${fmtDate(c.asOf)}${last ? ` at ${fmtPrice(last.price)}` : ""} · Cboe delayed chain · ${c.recorded} recorded day${c.recorded === 1 ? "" : "s"}` : q.isLoading ? "Loading" : "Cboe delayed chain"} />
      {c ? (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-3">
            <Fact
              label="30-day implied volatility"
              value={c.iv30 != null ? pct(c.iv30) : DASH}
              sub={c.ivChange ? <span className="num">{points(c.ivChange.points)} since {fmtDate(c.ivChange.from)}</span> : undefined}
            />
            <Fact
              label={c.implied?.through === "earnings" ? "Priced move through the report" : "Priced move"}
              value={c.implied ? `±${pct(c.implied.move)}` : DASH}
              sub={c.implied ? `by ${fmtDate(c.implied.expiry)} (${c.implied.days} days), at-the-money straddle` : "no expiry far enough out"}
            />
            <Fact
              label="Rank in recorded range"
              value={c.rank ? pct(c.rank.rank, 0) : DASH}
              sub={c.rank ? `of ${c.rank.n} earlier days` : `needs ${IV_RANK_MIN_DAYS} recorded days`}
            />
            <Fact label="Put/call open interest" value={c.putCallOpenInterest != null ? c.putCallOpenInterest.toFixed(2) : DASH} />
            <Fact label="Put/call volume" value={c.putCallVolume != null ? c.putCallVolume.toFixed(2) : DASH} />
            <Fact label="25-delta skew" value={c.skew25 != null ? points(c.skew25) : DASH} sub="put less call volatility" />
          </dl>
        </>
      ) : (
        <p className={cn("mt-2", IR.caption)}>{q.isLoading ? "Reading the snapshots." : q.isError ? "The options snapshots could not be read just now." : `No options snapshot is recorded for ${ticker} yet.`}</p>
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
      subtitle="Insider trades from Form 4, short sale volume from FINRA, options from Cboe · each block states its date"
      bodyClassName="p-0"
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/companies/$ticker/insiders" params={{ ticker }}>
            Ownership
          </Link>
        </Button>
      }
    >
      <div className="grid grid-cols-1 divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <Insiders ticker={ticker} data={data} />
        <ShortVolume ticker={ticker} />
        <Options ticker={ticker} data={data} />
      </div>
    </IrPanel>
  );
}
