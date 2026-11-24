import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { MultiLine } from "@/components/charts/multi-line";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import { breadthQuery, signalsQuery, statesQuery, type BreadthFile, type SignalsFile, type StateRow } from "@/lib/technicals/data";
import { EVIDENCE, type Horizon } from "@/lib/technicals/evidence";
import { POOLED_REASON_TEXT, pooledFamily } from "@/lib/technicals/pooled";
import TA from "@/lib/technicals/ta";
import { cn } from "@/lib/utils";
import { CrossScatter } from "./cross-section";
import { fmtQ } from "@/lib/technicals/labels";
import { f2, Note, pc, pp, signTone, T as S, TableWrap, Tag, TechPanel, type NavItem } from "./ui";

export const MARKET_NAV: NavItem[] = [
  { id: "breadth", label: "Breadth" },
  { id: "pooled", label: "Events across companies" },
  { id: "scan", label: "Scan" },
  { id: "cross", label: "Cross-section" },
];

const share = (num: number | undefined, den: number | undefined) => (num != null && den ? num / den : null);

/* ---------- breadth ---------- */
function BreadthPanel({ breadth, loading }: { breadth: BreadthFile | null; loading: boolean }) {
  const n = breadth?.d.length ?? 0;
  const from = Math.max(0, n - 504);
  const above = useMemo(() => {
    if (!breadth) return [];
    const pts = (num: number[], den: number[]) => breadth.d.slice(from).map((x, i) => ({ x, y: den[from + i] ? (num[from + i] / den[from + i]) * 100 : null }));
    return [
      { key: "a50", label: "50-day", color: "var(--chart-1)", points: pts(breadth.above50, breadth.n50) },
      { key: "a200", label: "200-day", color: "var(--chart-3)", points: pts(breadth.above200, breadth.n200) },
    ];
  }, [breadth, from]);
  const net = useMemo(
    () =>
      breadth
        ? [{ key: "nhnl", label: "Net", color: "var(--chart-2)", points: breadth.d.slice(from).map((x, i) => ({ x, y: breadth.new_high[from + i] - breadth.new_low[from + i] })) }]
        : [],
    [breadth, from],
  );
  const at = (k: number) => {
    const i = n - 1 - k;
    if (!breadth || i < 0) return null;
    return {
      date: breadth.d[i],
      a50: share(breadth.above50[i], breadth.n50[i]),
      a200: share(breadth.above200[i], breadth.n200[i]),
      hi: breadth.new_high[i],
      lo: breadth.new_low[i],
      adv: breadth.adv[i],
      dec: breadth.dec[i],
      names: breadth.n50[i],
    };
  };
  const cols = [at(0), at(20), at(252)];
  const xf = (x: string) => fmtDate(x, { month: "short", year: "numeric" });
  return (
    <TechPanel
      section="Market breadth"
      id="breadth"
      tour="tech-breadth"
      title="Market breadth"
      subtitle={cols[0] ? `${cols[0].names.toLocaleString("en-US")} tracked companies, close of ${fmtDate(cols[0].date)}` : "Tracked companies"}
    >
      {!breadth ? (
        loading ? (
          <Skeleton className="m-3 h-48" />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>Breadth is not available right now. It is rebuilt every weekday evening.</p>
        )
      ) : (
        <>
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className={S.th}>Measure</th>
                  {cols.map((c, i) => (
                    <th key={i} className={cn(S.thNum, i === 2 && S.wide)}>
                      {c ? (i === 0 ? "Latest" : i === 1 ? "20 sessions ago" : "One year ago") : ""}
                      {c && <span className="block">{fmtDate(c.date)}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Above their 50-day average", (c) => pc(c.a50)],
                    ["Above their 200-day average", (c) => pc(c.a200)],
                    ["New 52-week highs", (c) => c.hi.toLocaleString("en-US")],
                    ["New 52-week lows", (c) => c.lo.toLocaleString("en-US")],
                    ["Rose on the day / fell", (c) => `${c.adv.toLocaleString("en-US")} / ${c.dec.toLocaleString("en-US")}`],
                  ] as [string, (c: NonNullable<ReturnType<typeof at>>) => string][]
                ).map(([l, f]) => (
                  <tr key={l} className={S.row}>
                    <td className={S.td}>{l}</td>
                    {cols.map((c, i) => (
                      <td key={i} className={cn(S.num, i === 0 && "font-medium", i === 2 && S.wide)}>
                        {c ? f(c) : "–"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="grid grid-cols-1 divide-y border-t xl:grid-cols-2 xl:divide-x xl:divide-y-0 [&>*]:min-w-0">
            <div className="px-3 py-2">
              <p className={S.group}>Share above their moving averages</p>
              <p className={S.caption}>Percent of tracked companies, last two years</p>
              <MultiLine series={above} label="Share of tracked companies above their 50-day and 200-day averages" format={(v) => `${v.toFixed(0)}%`} height={190} xFormat={xf} />
            </div>
            <div className="px-3 py-2">
              <p className={S.group}>New 52-week highs minus new lows</p>
              <p className={S.caption}>Number of companies, last two years</p>
              <MultiLine series={net} label="New 52-week highs minus new 52-week lows" format={(v) => (v < 0 ? `−${Math.abs(v).toFixed(0)}` : v.toFixed(0))} baseline={0} height={190} xFormat={xf} />
            </div>
          </div>
          <Note>
            {breadth.caveat} {breadth.source}.
          </Note>
        </>
      )}
    </TechPanel>
  );
}

/* ---------- events across companies ---------- */
const POOLED_SHORT: Record<string, string> = {
  ok: "reliable",
  small: "small sample",
  base: "no clear difference",
  cost: "smaller than costs",
  unstable: "not stable over time",
};
function PooledPanel({
  SG,
  states,
  loading,
  onPick,
}: {
  SG: SignalsFile | null;
  states: { as_of: string; rows: StateRow[] } | null;
  loading: boolean;
  onPick: (s: string) => void;
}) {
  const [hz, setHz] = useState<`${Horizon}`>("20");
  const [days, setDays] = useState<"5" | "10">("5");
  const family = useMemo(() => (SG ? pooledFamily(SG) : []), [SG]);
  const rows = useMemo(
    () => family.filter((r) => String(r.h) === hz).sort((a, b) => Number(b.verdict === "reliable") - Number(a.verdict === "reliable") || (a.q ?? 2) - (b.q ?? 2)),
    [family, hz],
  );
  const cutoff = useMemo(() => {
    const ds = [...new Set((states?.rows ?? []).flatMap((r) => r.events.map((e) => e[1])))].sort();
    return ds[Math.max(0, ds.length - +days)] ?? "";
  }, [states, days]);
  const fired = useMemo(() => {
    const m = new Map<string, { t: string; date: string }[]>();
    for (const r of states?.rows ?? []) for (const [tp, date] of r.events) if (date >= cutoff) m.set(tp, [...(m.get(tp) ?? []), { t: r.t, date }]);
    for (const list of m.values()) list.sort((a, b) => b.date.localeCompare(a.date) || a.t.localeCompare(b.t));
    return m;
  }, [states, cutoff]);
  const tested = family.filter((r) => r.q != null).length;
  const reliable = rows.filter((r) => r.verdict === "reliable");
  return (
    <TechPanel
      section="Events across companies"
      id="pooled"
      tour="tech-pooled"
      title="Events across companies"
      subtitle={
        SG
          ? reliable.length
            ? `${reliable.length} of ${rows.length} chart events have been followed by a ${hz}-day return reliably different from all days`
            : `No chart event has been followed by a ${hz}-day return reliably different from all days`
          : undefined
      }
      actions={
        <>
          <Segmented
            size="xs"
            label="Horizon"
            value={hz}
            onChange={setHz}
            options={EVIDENCE.horizons.map((h) => ({ v: String(h) as `${Horizon}`, l: `${h} days` }))}
          />
          <Segmented
            size="xs"
            label="Fired within"
            value={days}
            onChange={setDays}
            options={[
              { v: "5", l: "5 sessions" },
              { v: "10", l: "10 sessions" },
            ]}
          />
        </>
      }
    >
      {!SG ? (
        loading ? (
          <Skeleton className="m-3 h-64" />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>The cross-company statistics are not available right now. They are rebuilt every weekday evening.</p>
        )
      ) : (
        <>
          <TableWrap min={900}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className={S.th}>Event</th>
                  <th className={cn(S.th, S.wide)} title="How chart reading conventionally takes the event">
                    Read as
                  </th>
                  <th className={cn(S.thNum, S.wide)} title="Events with a complete forward window, and the companies they come from">
                    Events / companies
                  </th>
                  <th className={cn(S.thNum, S.wide)} title="Share of events followed by a rise, and the same share over all days">
                    Up share / all days
                  </th>
                  <th className={cn(S.thNum, S.wide)} title="Mean total return after the event, and over all days">
                    Mean after / all days
                  </th>
                  <th className={S.thNum}>Excess</th>
                  <th className={cn(S.thNum, S.wide)} title="Standard errors clustered by calendar month, because events fire together across companies">
                    95% interval
                  </th>
                  <th className={cn(S.thNum, S.wide)} title="p-value adjusted for every event-horizon pair in this table (Benjamini-Hochberg)">
                    q
                  </th>
                  <th className={S.thNum}>Fired</th>
                  <th className={S.th}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const list = fired.get(r.type) ?? [];
                  const ok = r.verdict === "reliable";
                  return (
                    <Fragment key={r.type}>
                      <tr className={cn("border-b", ok && list.length > 0 && "border-b-0")} title={r.text}>
                        <td className={cn(S.td, "sm:whitespace-nowrap", ok && "font-medium")}>{r.name}</td>
                        <td className={cn(S.td, S.wide, "text-[11px] text-muted-foreground")}>{r.dir > 0 ? "Bullish" : "Bearish"}</td>
                        <td className={cn(S.num, S.wide)}>
                          {r.n.toLocaleString("en-US")} <span className="text-muted-foreground">/ {r.symbols.toLocaleString("en-US")}</span>
                        </td>
                        <td className={cn(S.num, S.wide)}>
                          {pc(r.hit)} <span className="text-muted-foreground">/ {pc(r.baseHit)}</span>
                        </td>
                        <td className={cn(S.num, S.wide)}>
                          {pp(r.mean)} <span className="text-muted-foreground">/ {pp(r.base)}</span>
                        </td>
                        <td className={cn(S.num, "font-medium", ok && signTone(r.excess))}>{pp(r.excess, 2)}</td>
                        <td className={cn(S.num, S.wide)}>{r.ci ? `${pp(r.ci[0])} to ${pp(r.ci[1])}` : "–"}</td>
                        <td className={cn(S.num, S.wide)}>{r.q != null && r.q < 0.001 ? "<0.001" : fmtQ(r.q)}</td>
                        <td className={S.num}>{list.length ? list.length.toLocaleString("en-US") : "–"}</td>
                        <td className={S.td}>
                          {ok ? (
                            <Tag tone={(r.excess ?? 0) > 0 ? "positive" : "negative"}>{(r.excess ?? 0) > 0 ? "Outperformed" : "Lagged"}</Tag>
                          ) : (
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground" title={POOLED_REASON_TEXT[r.reason]}>
                              {POOLED_SHORT[r.reason]}
                            </span>
                          )}
                        </td>
                      </tr>
                      {ok && list.length > 0 && (
                        <tr className="border-b">
                          <td colSpan={10} className="px-3 pb-2 pt-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={S.caption}>Fired in the last {days} sessions:</span>
                              {list.slice(0, 60).map(({ t, date }) => (
                                <button
                                  key={`${t}-${date}`}
                                  type="button"
                                  data-agent-click
                                  onClick={() => onPick(t)}
                                  title={`Open ${t} in Technicals. Fired ${fmtDate(date)}.`}
                                  className="inline-flex h-6 items-center gap-1.5 rounded border px-1.5 transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                                >
                                  <TickerMark ticker={t} link={false} />
                                  <span className="num text-[11px] text-muted-foreground">{fmtDate(date, { month: "short", day: "numeric" })}</span>
                                </button>
                              ))}
                              {list.length > 60 && <span className={S.caption}>and {list.length - 60} more in the scan below</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <Note>
            An event counts only when its q is at most {EVIDENCE.fdr} across the {tested} event-horizon pairs with at least {EVIDENCE.minPooled} events, the excess is larger than a{" "}
            {pc(EVIDENCE.cost, 1)} round-trip cost, and the sign holds in each period the pipeline reports. That is a difference across tracked companies as a group, not an edge in any one name:
            the symbol view tests each stock against its own history. Fired counts read each company's latest three events. {SG.method} {SG.caveats.join(" ")} As of {fmtDate(SG.as_of)}.
          </Note>
        </>
      )}
    </TechPanel>
  );
}

/* ---------- scan ---------- */
type ScanFilter = "all" | "up" | "down" | "nearhi" | "nearlo" | "hivol" | "squeeze";
const SCAN_FILTERS: { v: ScanFilter; l: string; test: (r: StateRow) => boolean }[] = [
  { v: "all", l: "All", test: () => true },
  { v: "up", l: "Uptrend", test: (r) => r.trend === "up" },
  { v: "down", l: "Downtrend", test: (r) => r.trend === "down" },
  { v: "nearhi", l: "Within 2% of high", test: (r) => (r.from_hi ?? -1) >= -0.02 },
  { v: "nearlo", l: "Within 5% of low", test: (r) => (r.from_lo ?? 1) <= 0.05 },
  { v: "hivol", l: "Volatility in its top fifth", test: (r) => (r.vol21_pct ?? 0) >= 0.8 },
  { v: "squeeze", l: "Squeeze", test: (r) => r.squeeze > 0 },
];
const SCAN_COLS: { k: keyof StateRow; l: string; title: string; f: (v: number | null) => string; signed?: boolean }[] = [
  { k: "r21", l: "1 month", title: "Total return over 21 sessions", f: (v) => pp(v), signed: true },
  { k: "r63", l: "3 months", title: "Total return over 63 sessions", f: (v) => pp(v), signed: true },
  { k: "r252", l: "1 year", title: "Total return over 252 sessions", f: (v) => pp(v), signed: true },
  { k: "rs63", l: "vs SPY, 3 mo.", title: "63-session price change against SPY's: (1 + own) ÷ (1 + SPY) − 1", f: (v) => pp(v), signed: true },
  { k: "vs50", l: "vs 50-day", title: "Close ÷ 50-day average − 1", f: (v) => pp(v), signed: true },
  { k: "vs200", l: "vs 200-day", title: "Close ÷ 200-day average − 1", f: (v) => pp(v), signed: true },
  { k: "from_hi", l: "From high", title: "Close ÷ highest intraday high of the last 252 sessions − 1", f: (v) => pp(v) },
  { k: "rsi", l: "RSI", title: "14-day relative strength index", f: (v) => f2(v, 0) },
  { k: "vol21", l: "Volatility", title: "21-day realised volatility, annualised", f: (v) => pc(v, 0) },
  { k: "vol21_pct", l: "Vol. rank", title: "Percentile of the 21-day volatility in the company's own history (100 is its highest)", f: (v) => (v == null ? "–" : String(Math.round(v * 100))) },
];
/** Tighter cells than the shared table classes: twelve columns have to fit a laptop screen. */
const SC = {
  th: "px-2 py-1.5 text-left align-bottom text-[11px] font-normal leading-4 text-muted-foreground first:pl-3",
  thNum: "px-2 py-1.5 text-right align-bottom text-[11px] font-normal leading-4 text-muted-foreground whitespace-nowrap",
  td: "px-2 py-1 text-[13px] leading-5 first:pl-3",
  num: "num px-2 py-1 text-right text-[13px] leading-5 tabular-nums whitespace-nowrap",
};
const PAGE = 50;
const TREND_LABEL: Record<string, string> = { up: "Up", down: "Down", mixed: "Mixed" };

function ScanPanel({ states, loading, symbol, onPick }: { states: { as_of: string; rows: StateRow[] } | null; loading: boolean; symbol: string | null; onPick: (s: string) => void }) {
  const [sort, setSort] = useState<{ k: keyof StateRow; d: 1 | -1 }>({ k: "r63", d: -1 });
  const [filter, setFilter] = useState<ScanFilter>("all");
  const [page, setPage] = useState(0);
  const list = useMemo(() => {
    const test = SCAN_FILTERS.find((f) => f.v === filter)!.test;
    return (states?.rows ?? []).filter(test).sort((a, b) => {
      const x = a[sort.k] as number | null;
      const y = b[sort.k] as number | null;
      if (x == null && y == null) return a.t.localeCompare(b.t);
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.d * (x - y) || a.t.localeCompare(b.t);
    });
  }, [states, filter, sort]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = list.slice(p * PAGE, p * PAGE + PAGE);
  const pager = (
    <div className="flex items-center gap-2">
      <span className={cn("num", S.caption)}>
        {list.length ? `${(p * PAGE + 1).toLocaleString("en-US")} to ${Math.min(list.length, (p + 1) * PAGE).toLocaleString("en-US")} of ${list.length.toLocaleString("en-US")}` : "0 companies"}
      </span>
      {pages > 1 && (
        <>
          <button type="button" data-agent-click disabled={p === 0} onClick={() => setPage(p - 1)} className={PAGER_BTN}>
            Previous
          </button>
          <button type="button" data-agent-click disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className={PAGER_BTN}>
            Next
          </button>
        </>
      )}
    </div>
  );
  return (
    <TechPanel
      section="Technical scan"
      id="scan"
      tour="tech-scan"
      title="Scan"
      subtitle={states ? `${states.rows.length.toLocaleString("en-US")} tracked companies at the close of ${fmtDate(states.as_of)}` : "Tracked companies at their latest close"}
      actions={
        <Segmented
          size="xs"
          label="Show"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(0);
          }}
          options={SCAN_FILTERS.map(({ v, l }) => ({ v, l }))}
        />
      }
    >
      {!states ? (
        loading ? (
          <Skeleton className="m-3 h-64" />
        ) : (
          <p className={cn("px-3 py-4", S.caption)}>The scan is not available right now. It is rebuilt every weekday evening.</p>
        )
      ) : (
        <>
          <TableWrap min={980} always>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className={SC.th}>Company</th>
                  <th className={SC.th}>Trend</th>
                  {SCAN_COLS.map((c) => (
                    <th key={c.k} className={SC.thNum} aria-sort={sort.k === c.k ? (sort.d === 1 ? "ascending" : "descending") : undefined} title={c.title}>
                      <button
                        type="button"
                        data-agent-click
                        onClick={() => {
                          setSort((s) => ({ k: c.k, d: s.k === c.k ? (-s.d as 1 | -1) : -1 }));
                          setPage(0);
                        }}
                        className={cn("rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", sort.k === c.k && "font-medium text-foreground")}
                      >
                        {c.l}
                        {sort.k === c.k && <span aria-hidden> {sort.d === 1 ? "↑" : "↓"}</span>}
                      </button>
                    </th>
                  ))}
                  <th className={SC.th}>Latest event</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const ev = r.events[r.events.length - 1];
                  return (
                    <tr key={r.t} className={cn(S.row, r.t === symbol && "bg-highlight-soft/60")}>
                      <td className={SC.td}>
                        <button type="button" data-agent-click onClick={() => onPick(r.t)} title={`Open ${r.t} in Technicals`} className={cn(S.cellButton, "max-w-[12rem] text-left")}>
                          <TickerMark ticker={r.t} name link={false} />
                        </button>
                      </td>
                      <td className={cn(SC.td, "whitespace-nowrap")} title={r.squeeze > 0 ? `Squeeze for ${r.squeeze} sessions` : undefined}>
                        <span className={cn(r.trend === "up" && "text-positive", r.trend === "down" && "text-negative")}>{r.trend ? (TREND_LABEL[r.trend] ?? r.trend) : "–"}</span>
                        {r.squeeze > 0 && <span className="ml-1 text-[11px] text-muted-foreground">sq.</span>}
                      </td>
                      {SCAN_COLS.map((c) => {
                        const v = r[c.k] as number | null;
                        return (
                          <td key={c.k} className={cn(SC.num, c.signed && signTone(v))}>
                            {c.f(v)}
                          </td>
                        );
                      })}
                      <td className={cn(SC.td, "max-w-[11rem] truncate whitespace-nowrap text-[11px] text-muted-foreground")} title={r.events.map((e) => `${TA.SIGNALS[e[0]]?.name ?? e[0]} ${fmtDate(e[1])}`).join("; ") || undefined}>
                        {ev ? `${TA.SIGNALS[ev[0]]?.name ?? ev[0]}, ${fmtDate(ev[1], { month: "short", day: "numeric" })}` : "–"}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={SCAN_COLS.length + 3} className={cn("px-3 py-4", S.caption)}>
                      No tracked company matches this filter today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className={S.caption}>A column heading sorts; a company opens its technicals.</p>
            {pager}
          </div>
          <Note>
            Trend: up when the close is above the 50-day average and the 50-day is above the 200-day, down when both are reversed, mixed otherwise. "sq." marks a squeeze: Bollinger bands
            inside the Keltner channel. Returns are total returns; the comparison with SPY uses price changes. The latest event is listed as it fired; whether an event type has meant anything is tested above.
          </Note>
        </>
      )}
    </TechPanel>
  );
}
const PAGER_BTN =
  "inline-flex h-7 items-center rounded border px-2 text-xs transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none";

/**
 * The market-wide view: breadth, what chart events have meant across tracked companies, a sortable scan and
 * the cross-section. `symbol` is the symbol the page has open, picked out in the scan and the scatter; null
 * when none is chosen.
 */
export function MarketView({ symbol, onPick }: { symbol: string | null; onPick: (s: string) => void }) {
  const SG = useQuery(signalsQuery);
  const states = useQuery(statesQuery);
  const breadth = useQuery(breadthQuery);
  return (
    <div className="grid grid-cols-1 gap-4">
      <BreadthPanel breadth={breadth.data ?? null} loading={breadth.isPending} />
      <PooledPanel SG={SG.data ?? null} states={states.data ?? null} loading={SG.isPending} onPick={onPick} />
      <ScanPanel states={states.data ?? null} loading={states.isPending} symbol={symbol} onPick={onPick} />
      <CrossScatter symbol={symbol} onPick={onPick} />
    </div>
  );
}
