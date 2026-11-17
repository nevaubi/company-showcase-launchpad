// A company's options market: the move priced for the next report against past report reactions,
// implied vs realized volatility, skew, put/call positioning and the priced move to each expiry.
// Every figure opens the Cboe quote it came from; every past reaction opens its earnings 8-K.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { usePrices } from "@/lib/data";
import { earningsReactions } from "@/lib/markets/core";
import { cboeQuotePage, earningsPricing, ivRank, realizedVol, type TermPoint } from "@/lib/options/core";
import { optionsHistoryQuery, type OptionsRow } from "@/lib/options/data";
import type { NextEarnings } from "@/lib/company/catalysts";
import type { EarningsRelease } from "@/lib/financials/types";
import { fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const pts = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`);

export function OptionsPanel({ ticker, next, releases }: { ticker: string; next: NextEarnings | null; releases: EarningsRelease[] | undefined }) {
  const q = useQuery(optionsHistoryQuery(ticker));
  const prices = usePrices(ticker, "5y");
  const { open } = useSource();
  const rows = q.data ?? [];
  const s = rows[0];

  const reactions = useMemo(() => {
    const bars = prices.data?.bars;
    if (!bars?.length || !releases?.length) return [];
    return earningsReactions(bars, releases.map((r) => ({ filed: r.filed, accn: r.accn, doc: r.doc }))).slice(-12);
  }, [prices.data, releases]);
  const closes = useMemo(() => (prices.data?.bars ?? []).map((b) => b[5] || b[4]), [prices.data]);

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return null;
  if (!s)
    return (
      <Panel title="Options market" subtitle="Cboe delayed quotes" collapse={false}>
        <p className="px-3.5 py-4 text-sm text-muted-foreground">No options snapshot yet. Stocks with listed options are read every weekday evening from Cboe; this one either has no listed options or hasn't been read.</p>
      </Panel>
    );

  const ext = (label: string, value: number, unit: string, quote: string): SourceTarget => ({
    ticker,
    label,
    unit,
    value,
    periodLabel: fmtDate(s.date),
    external: { url: cboeQuotePage(ticker), date: s.date, quote },
  });
  const rank = s.iv30 != null ? ivRank(rows.slice(1).map((r) => r.iv30 ?? NaN), s.iv30) : null;
  const rv = realizedVol(closes, 20);
  const pricing = next ? earningsPricing(s.term, next.date, s.date, reactions.map((r) => r.move)) : null;

  return (
    <Panel
      title="Options market"
      subtitle={`Cboe delayed quotes · ${fmtDate(s.date)} · stock ${s.price.toFixed(2)}`}
      collapse={false}
      actions={
        <a href={cboeQuotePage(ticker)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Cboe quotes <ExternalLink className="size-3" />
        </a>
      }
    >
      <div data-section="Options market" className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
          {pricing ? (
            <ReportPricing ticker={ticker} s={s} p={pricing} next={next!} reactions={reactions} open={open} ext={ext} />
          ) : (
            <p className="border-b px-3.5 py-3 text-xs text-muted-foreground">
              {next ? `No listed expiry covers the ${fmtDate(next.date)} report yet.` : "No upcoming report date known."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            <Tile
              label="Implied vol · 30d"
              value={fmtPct(s.iv30, 1)}
              hint={rank ? `IV rank ${(rank.rank * 100).toFixed(0)} of ${rank.n + 1} days` : `recording since ${fmtDate(rows.at(-1)!.date, { month: "short", day: "numeric" })}`}
              onClick={s.iv30 != null ? () => open(ext("30-day implied volatility", s.iv30!, "pct", "Cboe IV30 for the stock")) : undefined}
            />
            <Tile
              label="Realized vol · 20d"
              value={fmtPct(rv, 1)}
              hint={rv && s.iv30 ? `implied ÷ realized ${(s.iv30 / rv).toFixed(2)}×` : "from daily closes"}
            />
            <Tile
              label="Put/call open interest"
              value={s.pc_oi != null ? s.pc_oi.toFixed(2) : "—"}
              hint={s.pc_vol != null ? `volume ${s.pc_vol.toFixed(2)} · ${(s.call_vol + s.put_vol).toLocaleString("en-US")} traded` : undefined}
              onClick={s.pc_oi != null ? () => open(ext("Put/call open interest", s.pc_oi!, "ratio", `${s.put_oi.toLocaleString("en-US")} puts ÷ ${s.call_oi.toLocaleString("en-US")} calls open`)) : undefined}
            />
            <Tile
              label="Skew · 25Δ, ~30d"
              value={pts(s.skew25)}
              hint={s.skew25 == null ? undefined : s.skew25 > 0 ? "puts priced above calls" : "calls priced above puts"}
              onClick={s.skew25 != null ? () => open(ext("25-delta skew (put IV − call IV)", s.skew25!, "pct", "25-delta put implied volatility minus 25-delta call implied volatility, expiry nearest 30 days")) : undefined}
            />
          </div>
          <IvHistory rows={rows} />
        </div>
        <TermTable s={s} report={pricing?.point.e ?? null} open={open} ext={ext} />
      </div>
    </Panel>
  );
}

function Tile({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      {onClick ? (
        <button type="button" onClick={onClick} className="num text-base font-semibold tabular-nums hover:underline">
          {value}
        </button>
      ) : (
        <p className="num text-base font-semibold tabular-nums">{value}</p>
      )}
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

type Ext = (label: string, value: number, unit: string, quote: string) => SourceTarget;

function ReportPricing({
  ticker,
  s,
  p,
  next,
  reactions,
  open,
  ext,
}: {
  ticker: string;
  s: OptionsRow;
  p: NonNullable<ReturnType<typeof earningsPricing>>;
  next: NextEarnings;
  reactions: ReturnType<typeof earningsReactions>;
  open: (t: SourceTarget) => void;
  ext: Ext;
}) {
  const m = p.point.m;
  const span = Math.max(m * 1.6, ...reactions.map((r) => Math.abs(r.move) * 1.1), 0.02);
  const x = (v: number) => 50 + (v / span) * 50;
  return (
    <div className="border-b px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next report · {fmtDate(next.date)}{next.estimated ? " (projected)" : ""}</p>
      <p className="mt-1 text-sm">
        Options price a{" "}
        <button type="button" className="num font-semibold tabular-nums hover:underline" onClick={() => open(ext(`Move priced through ${fmtDate(p.point.e)}`, m, "pct", `At-the-money straddle for the ${p.point.e} expiry ÷ stock price (${s.price.toFixed(2)})`))}>
          ±{fmtPct(m, 1)}
        </button>{" "}
        move (±${(m * s.price).toFixed(2)}) through the {fmtDate(p.point.e, { month: "short", day: "numeric" })} expiry, the first after the report.
        {p.past && (
          <>
            {" "}After the last {p.past.n} reports the stock moved a median <span className="num font-semibold tabular-nums">±{fmtPct(p.past.median, 1)}</span>;{" "}
            <span className="font-medium">
              {p.past.exceeded} of {p.past.n}
            </span>{" "}
            moved more than today's price.
          </>
        )}
      </p>
      {reactions.length > 0 && (
        <div className="mt-3">
          <div className="relative h-9" role="img" aria-label={`Past report moves against the ±${fmtPct(m, 1)} priced move`}>
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            <div className="absolute top-1 bottom-1 rounded-sm bg-primary/10 ring-1 ring-primary/30" style={{ left: `${x(-m)}%`, width: `${x(m) - x(-m)}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-foreground/40" style={{ left: "50%" }} />
            {reactions.map((r) => (
              <button
                key={r.date}
                type="button"
                title={`${fmtDate(r.date)}: ${fmtPct(r.move, 1, true)}`}
                onClick={() => open({ ticker, label: `Reaction to the ${fmtDate(r.date)} report`, unit: "pct", value: r.move, periodLabel: "close before → close after", doc: { accn: r.accn, doc: r.doc, form: "8-K", filed: r.date } })}
                className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", r.move >= 0 ? "bg-positive" : "bg-negative", Math.abs(r.move) > m && "size-3")}
                style={{ left: `${x(r.move)}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span className="num">−{fmtPct(span, 0)}</span>
            <span>shaded: priced move · dots: past reports (click for the 8-K)</span>
            <span className="num">+{fmtPct(span, 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function IvHistory({ rows }: { rows: OptionsRow[] }) {
  const pts = rows.filter((r) => r.iv30 != null).slice(0, 260).reverse();
  if (pts.length < 2)
    return <p className="px-3.5 py-3 text-[11px] text-muted-foreground">Implied-volatility history builds one reading per trading day; IV rank appears after 20 days.</p>;
  const w = 600;
  const h = 72;
  const ys = pts.map((r) => r.iv30!);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const path = pts.map((r, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 4 - ((r.iv30! - lo) / (hi - lo || 1)) * (h - 8)).toFixed(1)}`).join(" ");
  return (
    <div className="px-3.5 py-3">
      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
        <span>IV30 since {fmtDate(pts[0].date)}</span>
        <span className="num">{fmtPct(lo, 0)}–{fmtPct(hi, 0)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" aria-label="30-day implied volatility history">
        <path d={path} fill="none" className="stroke-primary" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function TermTable({ s, report, open, ext }: { s: OptionsRow; report: string | null; open: (t: SourceTarget) => void; ext: Ext }) {
  const term: TermPoint[] = s.term;
  if (!term.length) return <p className="px-3.5 py-4 text-sm text-muted-foreground">No two-sided at-the-money quotes to price a move.</p>;
  const max = Math.max(...term.map((t) => t.m));
  return (
    <div className="min-w-0">
      <p className="border-b px-3.5 py-2 text-[11px] text-muted-foreground">Move priced to each expiry: the at-the-money straddle ÷ the stock price, an expected size of move in either direction.</p>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="border-b px-3.5 py-1.5 text-left font-medium">Expiry</th>
            <th className="border-b px-2 py-1.5 text-right font-medium">Days</th>
            <th className="border-b px-2 py-1.5 text-right font-medium">Priced move</th>
            <th className="hidden border-b px-2 py-1.5 text-right font-medium sm:table-cell">± $</th>
            <th className="border-b px-3.5 py-1.5 text-right font-medium">ATM IV</th>
          </tr>
        </thead>
        <tbody>
          {term.map((t) => (
            <tr key={t.e} className={cn("group", t.e === report && "bg-primary/5")}>
              <td className="border-b px-3.5 py-1.5 whitespace-nowrap">
                {fmtDate(t.e, { month: "short", day: "numeric", year: "2-digit" })}
                {t.e === report && <span className="ml-1.5 rounded border border-primary/30 px-1 text-[10px] text-primary">after report</span>}
              </td>
              <td className="num border-b px-2 py-1.5 text-right tabular-nums text-muted-foreground">{t.d}</td>
              <td className="border-b px-2 py-1.5 text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-secondary sm:inline-block">
                    <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(t.m / max) * 100}%` }} />
                  </span>
                  <button type="button" className="num tabular-nums hover:underline" onClick={() => open(ext(`Move priced through ${fmtDate(t.e)}`, t.m, "pct", `At-the-money straddle (strike ${t.k}) for the ${t.e} expiry ÷ stock price (${s.price.toFixed(2)})`))}>
                    ±{fmtPct(t.m, 1)}
                  </button>
                </span>
              </td>
              <td className="num hidden border-b px-2 py-1.5 text-right tabular-nums text-muted-foreground sm:table-cell">{(t.m * s.price).toFixed(2)}</td>
              <td className="num border-b px-3.5 py-1.5 text-right tabular-nums">{t.iv != null ? fmtPct(t.iv, 1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
