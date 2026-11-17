import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Empty, PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { CompanyLogo } from "@/components/app/company-logo";
import { Stat } from "@/components/exposures/region-exposures";
import { median } from "@/components/exposures/open";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { useUniverse } from "@/lib/data";
import { earningsIndexQuery } from "@/lib/calendars/data";
import { cboeQuotePage, earningsPricing, impliedMoveBy, REPORT_EXPIRY_LAG } from "@/lib/options/core";
import { boardIvRank, optionsBoardQuery, reactionsQuery, volumeRatio, type OptionsBoardRow, type ReactionsFile } from "@/lib/options/data";
import { useSessionState } from "@/lib/use-session-state";
import { fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/options")({
  head: () => ({
    meta: [
      { title: "Options — Filed Under" },
      { name: "description", content: "What the options market prices for every covered stock: moves into the next earnings report against past reactions, implied volatility and its rank, put/call positioning, unusual volume and skew." },
      { property: "og:title", content: "Options — Filed Under" },
      { property: "og:description", content: "Priced earnings moves vs history, implied volatility, put/call and skew across every stock with listed options, from Cboe quotes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OptionsHub,
});

type View = "reports" | "vol" | "positioning" | "skew";
type Row = OptionsBoardRow & {
  name: string;
  report: string | null;
  reportEstimated: boolean;
  priced: { e: string; m: number; lag: number } | null;
  pastMedian: number | null;
  pastN: number | null;
  past: ReactionsFile["companies"][string] | null;
  m30: { e: string; m: number } | null;
  rank: number | null;
  vr: number | null;
  ivChg: number | null;
};
interface Col {
  k: string;
  label: string;
  title: string;
  get: (r: Row) => number | string | null;
  cell: (r: Row, open: (t: SourceTarget) => void) => React.ReactNode;
}

const ext = (r: Row, label: string, value: number, unit: string, quote: string): SourceTarget => ({
  ticker: r.ticker,
  label,
  unit,
  value,
  periodLabel: fmtDate(r.date),
  external: { url: cboeQuotePage(r.ticker), date: r.date, quote },
});
const btn = (onClick: () => void, text: string, cls?: string) => (
  <button type="button" onClick={onClick} className={cn("num whitespace-nowrap tabular-nums hover:underline", cls)}>
    {text}
  </button>
);
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
const dash = <span className="text-muted-foreground">—</span>;

const C: Record<string, Col> = {
  report: { k: "report", label: "Report", title: "Next earnings date (calendar date, or projected from past timing)", get: (r) => r.report, cell: (r) => (r.report ? <span className="whitespace-nowrap">{fmtDate(r.report, { month: "short", day: "numeric" })}{r.reportEstimated ? <span className="text-muted-foreground"> est.</span> : null}</span> : dash) },
  priced: {
    k: "priced",
    label: "Priced move",
    title: "At-the-money straddle of the first expiry after the report ÷ price",
    get: (r) => r.priced?.m ?? null,
    cell: (r, open) =>
      r.priced ? (
        <span className="inline-flex items-baseline gap-1.5" title={r.priced.lag > REPORT_EXPIRY_LAG ? `The first listed expiry after the report is ${r.priced.lag} days later, so this also prices ordinary movement and isn't compared with past reports` : undefined}>
          <span className={cn("text-[11px]", r.priced.lag > REPORT_EXPIRY_LAG ? "text-warning" : "text-muted-foreground")}>{fmtDate(r.priced.e, { month: "short", day: "numeric" })}</span>
          {btn(() => open(ext(r, `Move priced through ${fmtDate(r.priced!.e)}`, r.priced!.m, "pct", `At-the-money straddle for the ${r.priced!.e} expiry (first after the ${r.report} report) ÷ stock price ${r.price.toFixed(2)}`)), `±${fmtPct(r.priced.m, 1)}`)}
        </span>
      ) : (
        dash
      ),
  },
  past: {
    k: "past",
    label: "Past median",
    title: "Median absolute move after the last reports (close before the earnings 8-K → close the session after); the small number is how many reports",
    get: (r) => r.pastMedian,
    cell: (r, open) => (r.pastMedian != null && r.past ? btn(() => { const last = r.past!.moves.at(-1)!; open({ ticker: r.ticker, label: `Median move after the last ${r.pastN} reports`, unit: "pct", value: r.pastMedian!, periodLabel: `latest report ${fmtDate(last.d)}`, doc: { accn: last.a, doc: last.doc, form: "8-K", filed: last.d } }); }, `±${fmtPct(r.pastMedian, 1)}`) : dash),
  },
  beat: { k: "beat", label: "Moved more", title: "Past reports whose move was larger than today's priced move", get: (r) => (r.priced && r.past && r.priced.lag <= REPORT_EXPIRY_LAG ? r.past.moves.filter((x) => Math.abs(x.m) > r.priced!.m).length / r.past.n : null), cell: (r) => (r.priced && r.past && r.priced.lag <= REPORT_EXPIRY_LAG ? <span className="num tabular-nums">{r.past.moves.filter((x) => Math.abs(x.m) > r.priced!.m).length} of {r.past.n}</span> : dash) },
  ratio: { k: "ratio", label: "Priced ÷ past", title: "Priced move ÷ past median move: above 1 the market expects a bigger move than usual", get: (r) => (r.priced && r.pastMedian && r.priced.lag <= REPORT_EXPIRY_LAG ? r.priced.m / r.pastMedian : null), cell: (r) => (r.priced && r.pastMedian && r.priced.lag <= REPORT_EXPIRY_LAG ? <span className={cn("num tabular-nums", (r.priced.m / r.pastMedian >= 1.5 || r.priced.m / r.pastMedian <= 0.67) && "font-semibold")}>{(r.priced.m / r.pastMedian).toFixed(2)}×</span> : dash) },
  iv: { k: "iv", label: "IV30", title: "Cboe 30-day implied volatility", get: (r) => r.iv30, cell: (r, open) => (r.iv30 != null ? btn(() => open(ext(r, "30-day implied volatility", r.iv30!, "pct", "Cboe IV30")), fmtPct(r.iv30, 1)) : dash) },
  ivChg: { k: "ivChg", label: "1-day", title: "Change in IV30 since the previous recorded day, in volatility points", get: (r) => r.ivChg, cell: (r) => (r.ivChg != null ? <span className={cn("num tabular-nums", r.ivChg > 0.02 ? "text-negative" : r.ivChg < -0.02 && "text-positive")}>{pts(r.ivChg)}</span> : dash) },
  rank: { k: "rank", label: "IV rank", title: "Where IV30 sits in its recorded range over the last year (0 = low, 100 = high); needs 20 recorded days", get: (r) => r.rank, cell: (r) => (r.rank != null ? <span className="num tabular-nums">{(r.rank * 100).toFixed(0)}</span> : dash) },
  m30: { k: "m30", label: "~30d move", title: "Move priced to the first expiry at least four weeks out", get: (r) => r.m30?.m ?? null, cell: (r, open) => (r.m30 ? btn(() => open(ext(r, `Move priced through ${fmtDate(r.m30!.e)}`, r.m30!.m, "pct", `At-the-money straddle for the ${r.m30!.e} expiry ÷ stock price ${r.price.toFixed(2)}`)), `±${fmtPct(r.m30.m, 1)}`) : dash) },
  front: { k: "front", label: "Front − 30d IV", title: "Nearest expiry's at-the-money IV minus the ~30-day one: positive (inverted) means an event is priced close in", get: (r) => (r.term[0]?.iv != null && r.atm_iv != null ? r.term[0].iv - r.atm_iv : null), cell: (r) => { const v = r.term[0]?.iv != null && r.atm_iv != null ? r.term[0].iv - r.atm_iv : null; return v != null ? <span className={cn("num tabular-nums", v > 0.05 && "font-semibold")}>{pts(v)}</span> : dash; } },
  pcoi: { k: "pcoi", label: "Put/call OI", title: "Put open interest ÷ call open interest", get: (r) => r.pc_oi, cell: (r, open) => (r.pc_oi != null ? btn(() => open(ext(r, "Put/call open interest", r.pc_oi!, "ratio", `${r.put_oi.toLocaleString("en-US")} puts ÷ ${r.call_oi.toLocaleString("en-US")} calls open`)), r.pc_oi.toFixed(2)) : dash) },
  pcvol: { k: "pcvol", label: "Put/call vol", title: "Put volume ÷ call volume for the session", get: (r) => r.pc_vol, cell: (r) => (r.pc_vol != null ? <span className="num tabular-nums">{r.pc_vol.toFixed(2)}</span> : dash) },
  vol: { k: "vol", label: "Contracts", title: "Option contracts traded in the session", get: (r) => r.call_vol + r.put_vol, cell: (r) => <span className="num tabular-nums">{compact(r.call_vol + r.put_vol)}</span> },
  vr: { k: "vr", label: "vs 20-day avg", title: "Session option volume ÷ its average over up to 20 prior recorded days (needs 5)", get: (r) => r.vr, cell: (r) => (r.vr != null ? <span className={cn("num tabular-nums", r.vr >= 3 && "font-semibold")}>{r.vr.toFixed(1)}×</span> : dash) },
  oi: { k: "oi", label: "Open interest", title: "Calls plus puts open", get: (r) => r.call_oi + r.put_oi, cell: (r) => <span className="num tabular-nums">{compact(r.call_oi + r.put_oi)}</span> },
  skew: { k: "skew", label: "Skew 25Δ", title: "25-delta put IV − 25-delta call IV at the expiry nearest 30 days, in volatility points: positive = downside protection priced richer", get: (r) => r.skew25, cell: (r, open) => (r.skew25 != null ? btn(() => open(ext(r, "25-delta skew (put IV − call IV)", r.skew25!, "pct", "25-delta put IV minus 25-delta call IV, expiry nearest 30 days")), pts(r.skew25)) : dash) },
};
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));

const VIEWS: Record<View, { cols: string[]; sort: { c: string; d: 1 | -1 }; blurb: string }> = {
  reports: { cols: ["report", "priced", "past", "beat", "ratio", "iv"], sort: { c: "report", d: 1 }, blurb: "Reports in the next four weeks: the move options price through the report against the stock's usual reaction." },
  vol: { cols: ["iv", "ivChg", "rank", "m30", "front", "skew"], sort: { c: "iv", d: -1 }, blurb: "Implied volatility, its change and rank in its own recorded history, and the term structure." },
  positioning: { cols: ["pcoi", "pcvol", "vol", "vr", "oi", "iv"], sort: { c: "vol", d: -1 }, blurb: "Put/call open interest and volume, and sessions where option volume runs far above its recent average." },
  skew: { cols: ["skew", "iv", "pcoi", "m30"], sort: { c: "skew", d: -1 }, blurb: "How much more downside protection costs than upside calls, around 30 days out." },
};

function OptionsHub() {
  const q = useQuery(optionsBoardQuery);
  const cal = useQuery(earningsIndexQuery);
  const rx = useQuery(reactionsQuery);
  const uni = useUniverse();
  const { open } = useSource();
  const [view, setView] = useSessionState<View>("fu:options:view", "reports");
  const [sorts, setSorts] = useState<Partial<Record<View, { c: string; d: 1 | -1 }>>>({});
  const [text, setText] = useState("");
  const [limit, setLimit] = useState(100);
  const sort = sorts[view] ?? VIEWS[view].sort;

  const all = useMemo<Row[]>(() => {
    const names = new Map((uni.data?.companies ?? []).map((c) => [c.ticker, c.name]));
    const cals = new Map((cal.data?.companies ?? []).map((c) => [c.ticker, c]));
    return (q.data ?? []).map((r) => {
      const c = cals.get(r.ticker);
      const report = c?.next_earnings ?? null;
      const p = report ? earningsPricing(r.term, report, r.date, []) : null;
      const m30 = impliedMoveBy(r.term, 28);
      return {
        ...r,
        name: names.get(r.ticker) ?? r.ticker,
        report: report && report >= r.date ? report : null,
        reportEstimated: !!c?.earnings?.is_estimate,
        priced: p ? { e: p.point.e, m: p.point.m, lag: p.lag } : null,
        past: rx.data?.companies[r.ticker] ?? null,
        pastMedian: rx.data?.companies[r.ticker]?.median ?? null,
        pastN: rx.data?.companies[r.ticker]?.n ?? null,
        m30: m30 ? { e: m30.e, m: m30.m } : null,
        rank: boardIvRank(r)?.rank ?? null,
        vr: volumeRatio(r),
        ivChg: r.iv30 != null && r.iv_prev != null ? r.iv30 - r.iv_prev : null,
      };
    });
  }, [q.data, cal.data, uni.data, rx.data]);

  const latest = all.reduce((d, r) => (r.date > d ? r.date : d), "");
  const horizon = latest ? new Date(Date.parse(latest) + 28 * 86400000).toISOString().slice(0, 10) : "";
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    let out = all.filter((r) => !needle || r.ticker.toLowerCase().startsWith(needle) || r.name.toLowerCase().includes(needle));
    if (view === "reports") out = out.filter((r) => r.report && r.report <= horizon && r.priced);
    const col = C[sort.c];
    return [...out].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "string" ? va.localeCompare(String(vb)) : va - (vb as number)) * sort.d;
    });
  }, [all, text, view, sort, horizon]);

  const ivMed = median(all.map((r) => r.iv30).filter((x): x is number => x != null));
  const skewMed = median(all.map((r) => r.skew25).filter((x): x is number => x != null));
  const nReports = all.filter((r) => r.report && r.report <= horizon && r.priced).length;
  const days = Math.max(0, ...all.map((r) => (r.iv_n ?? 0) + 1));

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Markets"
        title="Options"
        description="What the options market prices for every covered stock with listed options: the move into each upcoming report next to how the stock usually reacts, implied volatility and its rank, put/call positioning and skew. From Cboe's delayed quotes, recorded every weekday evening; click a figure for its quote."
        actions={
          <Segmented
            label="Options view"
            value={view}
            onChange={(v) => { setView(v); setLimit(100); }}
            options={[
              { v: "reports", l: "Report moves" },
              { v: "vol", l: "Volatility" },
              { v: "positioning", l: "Positioning" },
              { v: "skew", l: "Skew" },
            ]}
          />
        }
      />
      {q.isLoading ? (
        <Skeleton className="mt-4 h-[520px]" />
      ) : q.error ? (
        <Empty title="Options data didn't load">{(q.error as Error).message}</Empty>
      ) : !all.length ? (
        <Empty title="No options snapshots yet">Snapshots are recorded every weekday evening from Cboe's delayed quotes.</Empty>
      ) : (
        <div className="mt-4 min-w-0" data-section="Options board">
          <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            <Stat label="Stocks with listed options" value={all.length.toLocaleString("en-US")} hint={`quotes from ${fmtDate(latest)}`} />
            <Stat label="Median implied vol · 30d" value={fmtPct(ivMed, 1)} />
            <Stat label="Median skew · 25Δ" value={skewMed != null ? `${pts(skewMed)} pts` : "—"} hint="put IV − call IV" />
            <Stat label="Reports in the next 4 weeks" value={String(nReports)} hint={days < 20 ? `IV rank after 20 days (${days} recorded)` : `${days} days recorded`} />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by ticker or name" className="h-8 pl-8 text-sm" aria-label="Filter stocks" />
            </div>
            <p className="text-[11px] text-muted-foreground">{VIEWS[view].blurb}</p>
          </div>
          {!rows.length ? (
            <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{view === "reports" ? "No covered stock with listed options reports in the next four weeks." : "No stock matches."}</p>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[560px] border-separate sm:min-w-[720px] border-spacing-0 text-[13px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 border-b border-r bg-card px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Company</th>
                      <th className="hidden border-b bg-card px-2.5 py-2 text-right text-[11px] font-medium text-muted-foreground sm:table-cell">Price</th>
                      {VIEWS[view].cols.map((k) => (
                        <th key={k} aria-sort={sort.c === k ? (sort.d === 1 ? "ascending" : "descending") : "none"} className="border-b bg-card px-2.5 py-2 text-right align-bottom">
                          <button
                            type="button"
                            title={C[k].title}
                            onClick={() => setSorts((s) => ({ ...s, [view]: { c: k, d: sort.c === k ? (-sort.d as 1 | -1) : k === "report" ? 1 : -1 } }))}
                            className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            {C[k].label}
                            {sort.c === k && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map((r) => (
                      <tr key={r.ticker} className="group">
                        <td className="sticky left-0 z-10 max-w-56 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary">
                          <Link to="/app/companies/$ticker/earnings" params={{ ticker: r.ticker }} className="flex min-w-0 items-center gap-2">
                            <CompanyLogo ticker={r.ticker} size="xs" />
                            <span className="num font-medium">{r.ticker}</span>
                            <span className="hidden truncate text-muted-foreground sm:inline">{r.name}</span>
                          </Link>
                        </td>
                        <td className="num hidden border-b px-2.5 py-1.5 text-right tabular-nums text-muted-foreground group-hover:bg-secondary sm:table-cell">{r.price.toFixed(2)}</td>
                        {VIEWS[view].cols.map((k) => (
                          <td key={k} className="border-b px-2.5 py-1.5 text-right group-hover:bg-secondary">
                            {C[k].cell(r, open)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {rows.length > limit && (
            <div className="mt-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 100)}>
                Show {Math.min(100, rows.length - limit)} more of {rows.length - limit}
              </Button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Priced move = at-the-money straddle ÷ stock price, the expected size of a move in either direction by that expiry; for a report it is read at the first expiry after the report date so either report time is covered. Past median = the median move after the last reports (close before the earnings 8-K → close the session after), compared only when the expiry closes within ten days of the report. IV rank and volume-vs-average use only days already recorded here, so they never look ahead. Delayed quotes, not a recommendation.
          </p>
        </div>
      )}
    </div>
  );
}
