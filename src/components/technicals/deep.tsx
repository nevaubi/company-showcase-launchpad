import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { MultiLine } from "@/components/charts/multi-line";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSource } from "@/components/source/source-context";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import TA, { type Analysis } from "@/lib/technicals/ta";
import {
  FACTOR_NAME,
  RULE_NAME,
  type BreadthFile,
  type Hist,
  type QuantFile,
  type QuantRead,
  type SignalsFile,
  type StateRow,
} from "@/lib/technicals/data";

/* ---------- formatting ---------- */
const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
export const pp = (v: number | null | undefined, d = 1) =>
  ok(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%` : "–";
export const pc = (v: number | null | undefined, d = 0) =>
  ok(v) ? `${(v * 100).toFixed(d)}%` : "–";
const f2 = (v: number | null | undefined, d = 2) => (ok(v) ? v.toFixed(d) : "–");
const tone = (v: number | null | undefined) =>
  !ok(v) || Math.abs(v) < 1e-9 ? "" : v > 0 ? "text-positive" : "text-negative";
const th = "px-3 py-2 text-[11px] font-medium text-muted-foreground";
const Note = ({ children }: { children: ReactNode }) => (
  <p className="border-t px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
    {children}
  </p>
);
function Chip({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-5 items-center rounded border px-1.5 text-[11px]", className)}
    >
      {children}
    </span>
  );
}
function Verdict({ ci, base }: { ci?: [number, number] | null; base: number }) {
  if (!ci) return null;
  if (ci[0] - base > 0)
    return (
      <Chip
        className="border-positive/40 text-positive"
        title="The interval lies above the all-days average"
      >
        above
      </Chip>
    );
  if (ci[1] - base < 0)
    return (
      <Chip
        className="border-negative/40 text-negative"
        title="The interval lies below the all-days average"
      >
        below
      </Chip>
    );
  return (
    <Chip className="text-muted-foreground" title="The interval includes the all-days average">
      no clear difference
    </Chip>
  );
}
function Num({
  children,
  onClick,
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  if (!onClick) return <span className={cn("num tabular-nums", className)}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? "Show the calculation"}
      className={cn(
        "num rounded-sm tabular-nums decoration-dotted underline-offset-2 hover:bg-highlight-soft hover:underline",
        className,
      )}
    >
      {children}
    </button>
  );
}
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ---------- calculation sheet: the rows behind any statistic ---------- */
export interface Calc {
  title: string;
  value: string;
  sub?: string;
  formula: string;
  cols: string[];
  rows: (string | number)[][];
  hi?: Set<number>;
  note?: string;
  link?: { url: string; label: string };
}
export function CalcSheet({ calc, onClose }: { calc: Calc | null; onClose: () => void }) {
  return (
    <Sheet open={!!calc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {calc && (
          <>
            <SheetHeader>
              <SheetTitle>{calc.title}</SheetTitle>
              <SheetDescription>
                <span className="num text-base font-medium text-foreground">{calc.value}</span>
                {calc.sub && <span className="ml-2">{calc.sub}</span>}
              </SheetDescription>
            </SheetHeader>
            <p className="mt-3 rounded-md border bg-secondary/50 px-3 py-2 text-[12.5px] leading-relaxed">
              {calc.formula}
            </p>
            {calc.note && <p className="mt-2 text-xs text-muted-foreground">{calc.note}</p>}
            <table className="mt-3 w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  {calc.cols.map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "py-1.5 pr-2 text-[11px] font-medium text-muted-foreground",
                        i > 0 && "text-right",
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calc.rows.map((r, k) => (
                  <tr key={k} className={cn("border-b", calc.hi?.has(k) && "bg-highlight-soft")}>
                    {r.map((x, i) => (
                      <td
                        key={i}
                        className={cn("num py-1 pr-2 tabular-nums", i > 0 && "text-right")}
                      >
                        {x}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {calc.link && (
              <a
                href={calc.link.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs text-link hover:underline"
              >
                {calc.link.label} ↗
              </a>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ---------- read: regime, computed summary, AI read ---------- */
const TREND_TONE: Record<string, string> = {
  up: "border-positive/40 text-positive",
  down: "border-negative/40 text-negative",
  transition: "text-muted-foreground",
};
export function SymbolRead({
  H,
  A,
  Q,
  read,
  recent,
  onSignals,
}: {
  H: Hist;
  A: Analysis;
  Q?: QuantFile | null;
  read?: QuantRead | null;
  recent: { type: string; date: string }[];
  onSignals: () => void;
}) {
  const st = A.state;
  const S = useMemo(
    () => TA.summary(st, { cone: A.cone, since: H.d[0].slice(0, 4), recent }),
    [st, A.cone, H.d, recent],
  );
  const bad = useMemo(
    () =>
      TA.validateSummary(S, {
        ...st,
        vol21: A.cone.find((c) => c.n === 21)?.current,
        vol21pct: A.cone.find((c) => c.n === 21)?.pct,
      }),
    [S, st, A.cone],
  );
  const R = Q?.regimes.current;
  const fwd = R ? Q!.regimes.table.find((t) => t.key === `${R.trend}|${R.vol}`) : undefined;
  const all = Q?.regimes.table.find((t) => t.key === "*|*");
  return (
    <Panel
      title="Technical read"
      subtitle={`Computed from ${H.n.toLocaleString()} daily bars since ${fmtDate(H.d[0])} · last bar ${fmtDate(H.d[H.n - 1])}${H.live ? ` (latest ${H.live} from live prices)` : ""}`}
      collapse={false}
    >
      <div className="grid gap-3 px-3.5 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-2">
          {R && (
            <div className="rounded-md border p-2.5">
              <p className="text-[11px] text-muted-foreground">Regime</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Chip className={TREND_TONE[R.trend]} title={`Trend regime since ${R.trend_since}`}>
                  trend: {R.trend}
                </Chip>
                <Chip
                  title={`20-day volatility ${pc(R.v20, 1)}, ${Math.round(R.vol_pct * 100)}th percentile of the trailing 3 years, since ${R.vol_since}`}
                >
                  volatility: {R.vol}
                </Chip>
                <span className="text-[11px] text-muted-foreground">
                  since {fmtDate(R.trend_since)}
                </span>
              </div>
              {fwd && all && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  In past{" "}
                  <b className="text-foreground">
                    {R.trend}/{R.vol}
                  </b>{" "}
                  periods ({fwd.days.toLocaleString()} days, {pc(fwd.share)} of history) the next 20
                  days returned{" "}
                  <span className={cn("num font-medium", tone(fwd.fwd20))}>{pp(fwd.fwd20)}</span> on
                  average, up {pc(fwd.hit)} of the time, against{" "}
                  <span className="num">{pp(all.fwd20)}</span> and {pc(all.hit)} for all days.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-center">
            {[
              ["vs 50-day", pp(st.vs50)],
              ["vs 200-day", pp(st.vs200)],
              ["RSI(14)", f2(st.rsi, 1)],
              ["ADX(14)", f2(st.adx, 1)],
              ["From 52w high", pp(st.fromHi)],
              ["ATR % price", pc(st.atrPct, 1)],
            ].map(([l, v]) => (
              <div key={l} className="bg-card px-2 py-1.5">
                <p className="text-[10.5px] text-muted-foreground">{l}</p>
                <p className="num text-[13px] font-medium tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          {recent.length > 0 && (
            <button
              type="button"
              onClick={onSignals}
              className="text-left text-[12px] text-link hover:underline"
            >
              {recent.length} signal{recent.length === 1 ? "" : "s"} in the last 30 sessions: how
              they were followed historically →
            </button>
          )}
        </div>
        <div className="space-y-2 text-[13px] leading-relaxed">
          <ul className="list-disc space-y-1 pl-4">
            {S.map((s, i) => (
              <li key={i}>{s.text}</li>
            ))}
          </ul>
          {bad.length > 0 && (
            <p className="text-[11px] text-negative">Check failed on: {bad.join(", ")}</p>
          )}
          {read && (
            <div className="rounded-md border-l-2 border-highlight bg-secondary/40 px-3 py-2 text-[12.5px]">
              <p className="mb-1 text-[11px] text-muted-foreground">
                {read.label} · {read.model.split("/").pop()} ·{" "}
                {fmtDate(read.generated.slice(0, 10))}
              </p>
              {read.sentences.map((s, i) => (
                <p key={i}>
                  {s.text}{" "}
                  {s.refs.map(
                    (r) =>
                      read.facts[r] && (
                        <Chip
                          key={r}
                          className="mr-1 text-muted-foreground"
                          title={read.facts[r][1]}
                        >
                          {read.facts[r][0]}
                        </Chip>
                      ),
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <Note>
        Every sentence is generated from the computed values and checked: each printed number must
        match a computed value. Descriptions of what happened, not forecasts.
      </Note>
    </Panel>
  );
}

/* ---------- signal scorecard ---------- */
export function SignalScorecard({ H, A, SG }: { H: Hist; A: Analysis; SG?: SignalsFile | null }) {
  const [hz, setHz] = useState<"5" | "20" | "60">("20");
  const [calc, setCalc] = useState<Calc | null>(null);
  const h = +hz;
  const bt = A.backtest;
  const base = bt.base[h];
  const sb = SG?.base?.[hz]?.all;
  const eventsCalc = (tp: string) => {
    const sg = TA.SIGNALS[tp],
      s = bt.signals[tp][h];
    const ev = A.events.filter((e) => e.type === tp && e.i >= 252);
    let lastI = -Infinity;
    const keep = new Set<number>();
    ev.forEach((e) => {
      if (e.i + h < H.n && e.i - lastI >= h) {
        keep.add(e.i);
        lastI = e.i;
      }
    });
    const rows = [...ev].reverse();
    setCalc({
      title: `${H.sym} · ${sg.name}, ${h}-day forward return`,
      value: `${pp(s.mean, 2)} average`,
      sub: `${s.n} events, ${s.n_eff} non-overlapping · median ${pp(s.median, 2)} · up ${pc(s.hit)}`,
      formula: `${sg.text}. Return = total return index ${h} trading days later ÷ on the signal day − 1. 95% interval: mean ± 1.96 × SD / √${s.n_eff}.`,
      cols: ["Signal day", "Close", `+${h}d`, "Return", "Independent"],
      rows: rows.map((e) => [
        e.i < H.n ? H.d[e.i] : "",
        H.c[e.i].toFixed(2),
        e.i + h < H.n ? H.d[e.i + h] : "pending",
        e.i + h < H.n ? pp(H.tr[e.i + h] / H.tr[e.i] - 1, 2) : "–",
        keep.has(e.i) ? "yes" : e.i + h < H.n ? "overlaps" : "",
      ]),
      hi: new Set(rows.map((e, k) => (keep.has(e.i) ? k : -1)).filter((k) => k >= 0)),
      note: "Highlighted rows are the non-overlapping events used for the interval.",
    });
  };
  const baseCalc = () => {
    const step = Math.max(1, Math.floor((H.n - 252) / 300));
    const rows: (string | number)[][] = [];
    for (let i = H.n - h - 1; i >= 252; i -= step)
      rows.push([
        H.d[i],
        H.tr[i].toFixed(4),
        H.d[i + h],
        H.tr[i + h].toFixed(4),
        pp(H.tr[i + h] / H.tr[i] - 1, 2),
      ]);
    setCalc({
      title: `${H.sym} · all days, ${h}-day forward return`,
      value: `${pp(base.mean, 2)} average`,
      sub: `${base.n.toLocaleString()} days · median ${pp(base.median, 2)} · up ${pc(base.hit)}`,
      formula: `Total return index (dividends reinvested) at day t+${h} ÷ at day t − 1, for every day from bar 253 that has ${h} days after it.`,
      cols: ["Day", "TR index", `+${h}d`, `TR +${h}d`, "Return"],
      rows,
      note:
        rows.length < base.n
          ? `A sample of ${rows.length} evenly spaced days; the average uses all ${base.n.toLocaleString()}.`
          : undefined,
    });
  };
  const pooledCalc = (tp: string | null) => {
    if (!SG) return;
    const P = tp ? SG.signals[tp][hz] : SG.base[hz].all;
    const by = tp
      ? ((P as (typeof SG.signals)[string][string]).by_period ?? {})
      : Object.fromEntries(Object.entries(SG.base[hz]).filter(([k]) => k !== "all"));
    setCalc({
      title: tp
        ? `Tracked companies · ${TA.SIGNALS[tp].name}, ${h}-day forward return`
        : `Tracked companies · all days, ${h}-day forward return`,
      value: `${pp(P.mean, 2)} average`,
      sub: tp
        ? `${P.n.toLocaleString()} events · ${SG.signals[tp].symbols} names · ${SG.signals[tp].first} to ${SG.signals[tp].last}`
        : `${P.n.toLocaleString()} symbol-days`,
      formula: tp
        ? `Mean forward total return over all events; excess = mean − all-days mean (${pp(SG.base[hz].all.mean, 2)}); 95% interval from a standard error clustered by calendar month.`
        : "Mean forward total return over every symbol-day from each name's 253rd bar.",
      cols: ["Period", "Events / days", "Average", "Vs all days", "Up share"],
      rows: Object.entries(by).map(([k, v]) => [
        k,
        (v.n ?? 0).toLocaleString(),
        pp(v.mean, 2),
        "excess" in v && v.excess != null ? pp(v.excess as number, 2) : "–",
        pc(v.hit),
      ]),
      note: `${SG.method} Generated ${fmtDate(SG.generated.slice(0, 10))}.`,
    });
  };
  return (
    <>
      <Panel
        title={`How ${H.sym} moved after each signal`}
        subtitle="Historical frequencies, not forecasts"
        actions={
          <Segmented
            size="xs"
            label="Horizon"
            value={hz}
            onChange={setHz}
            options={[
              { v: "5", l: "5 days" },
              { v: "20", l: "20 days" },
              { v: "60", l: "60 days" },
            ]}
          />
        }
        collapse={false}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Signal</th>
                <th className={cn(th, "text-right")}>Events</th>
                <th className={cn(th, "text-right")}>Avg {h}d</th>
                <th className={cn(th, "text-right")}>Median</th>
                <th className={cn(th, "text-right")}>Up share</th>
                <th className={cn(th, "text-right")}>Vs all days, 95% CI</th>
                <th className={cn(th, "border-l text-right")}>Tracked companies</th>
                <th className={cn(th, "text-right")}>Avg {h}d</th>
                <th className={cn(th, "text-right")}>Up share</th>
                <th className={cn(th, "text-right")}>Vs all days, 95% CI</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-secondary/60">
                <td className="px-3 py-1.5">
                  <b>All days (base rate)</b>
                  <span className="block text-[11px] text-muted-foreground">
                    {H.sym}, from bar 253
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Num onClick={baseCalc}>{base.n.toLocaleString()}</Num>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Num onClick={baseCalc}>{pp(base.mean, 2)}</Num>
                </td>
                <td className="num px-3 py-1.5 text-right">{pp(base.median, 2)}</td>
                <td className="num px-3 py-1.5 text-right">{pc(base.hit)}</td>
                <td />
                <td className="border-l px-3 py-1.5 text-right">
                  {sb ? <Num onClick={() => pooledCalc(null)}>{sb.n.toLocaleString()}</Num> : "–"}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {sb ? <Num onClick={() => pooledCalc(null)}>{pp(sb.mean, 2)}</Num> : "–"}
                </td>
                <td className="num px-3 py-1.5 text-right">{sb ? pc(sb.hit) : "–"}</td>
                <td />
              </tr>
              {Object.entries(TA.SIGNALS).map(([tp, sg]) => {
                const s = bt.signals[tp]?.[h];
                const P = SG?.signals?.[tp]?.[hz];
                return (
                  <tr key={tp} className="border-b last:border-0">
                    <td className="px-3 py-1.5">
                      <span className={sg.dir > 0 ? "text-positive" : "text-negative"}>
                        {sg.dir > 0 ? "▲" : "▼"}
                      </span>{" "}
                      {sg.name}
                      <span className="block text-[11px] text-muted-foreground">{sg.text}</span>
                    </td>
                    {s && s.n ? (
                      <>
                        <td className="px-3 py-1.5 text-right">
                          <Num onClick={() => eventsCalc(tp)}>{s.n}</Num>
                          {s.n_eff !== s.n && (
                            <span className="block text-[10.5px] text-muted-foreground">
                              {s.n_eff} indep.
                            </span>
                          )}
                          {s.label && <Chip className="border-highlight">{s.label}</Chip>}
                        </td>
                        <td className={cn("px-3 py-1.5 text-right", tone(s.mean))}>
                          <Num onClick={() => eventsCalc(tp)}>{pp(s.mean, 2)}</Num>
                        </td>
                        <td className="num px-3 py-1.5 text-right">{pp(s.median, 2)}</td>
                        <td className="num px-3 py-1.5 text-right">{pc(s.hit)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {s.ci && s.n_eff >= 10 ? (
                            <>
                              <Num onClick={() => eventsCalc(tp)}>
                                {pp(s.ci[0] - base.mean)} to {pp(s.ci[1] - base.mean)}
                              </Num>
                              <span className="block">
                                <Verdict ci={s.ci} base={base.mean} />
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              too few to estimate
                            </span>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {s?.pending ? `${s.pending} pending` : "0"}
                        </td>
                        <td />
                        <td />
                        <td />
                        <td />
                      </>
                    )}
                    {P && P.n ? (
                      <>
                        <td className="border-l px-3 py-1.5 text-right">
                          <Num onClick={() => pooledCalc(tp)}>{P.n.toLocaleString()}</Num>
                          <span className="block text-[10.5px] text-muted-foreground">
                            {SG!.signals[tp].symbols} names
                          </span>
                        </td>
                        <td className={cn("px-3 py-1.5 text-right", tone(P.mean))}>
                          <Num onClick={() => pooledCalc(tp)}>{pp(P.mean, 2)}</Num>
                        </td>
                        <td className="num px-3 py-1.5 text-right">{pc(P.hit)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {P.excess_ci ? (
                            <>
                              <Num onClick={() => pooledCalc(tp)}>
                                {pp(P.excess_ci[0])} to {pp(P.excess_ci[1])}
                              </Num>
                              <span className="block">
                                <Verdict ci={P.excess_ci} base={0} />
                              </span>
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="border-l px-3 py-1.5 text-right text-muted-foreground">
                          {SG ? "0" : "not published"}
                        </td>
                        <td />
                        <td />
                        <td />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Note>
          Forward total returns (dividends reinvested) after each signal, against the average over
          all days. A signal means something here only if its interval sits clearly above or below
          the all-days figure. Intervals use the standard error over non-overlapping events; fewer
          than 10 is too few, fewer than 30 a small sample. Pooled columns use every tracked company
          with history
          {SG ? `, as of ${fmtDate(SG.as_of)}, with intervals clustered by calendar month` : ""}.
          Click a number for the events behind it.
        </Note>
      </Panel>
      {SG && (
        <Panel title="Caveats for the cross-company statistics" collapse={false}>
          <div className="space-y-1.5 px-3.5 py-3 text-[12.5px]">
            {SG.caveats.map((c) => (
              <p key={c}>{c}</p>
            ))}
            <p className="text-[11px] text-muted-foreground">{SG.method}</p>
          </div>
        </Panel>
      )}
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </>
  );
}

/* ---------- risk ---------- */
function Histogram({
  bins,
  mean,
  sd,
}: {
  bins: { x0: number; x1: number; n: number }[];
  mean: number;
  sd: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  if (!bins.length) return null;
  const Hh = 170,
    m = { t: 8, b: 20, l: 8, r: 8 };
  const lo = bins[0].x0,
    hi = bins[bins.length - 1].x1,
    max = Math.max(...bins.map((b) => b.n));
  const total = bins.reduce((s, b) => s + b.n, 0),
    w = bins[0].x1 - bins[0].x0;
  const x = (v: number) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r);
  const y = (n: number) => Hh - m.b - (n / max) * (Hh - m.t - m.b);
  const normal = Array.from({ length: 80 }, (_, k) => {
    const v = lo + ((hi - lo) * k) / 79;
    return [
      v,
      (total * w * Math.exp(-((v - mean) ** 2) / (2 * sd * sd))) / (sd * Math.sqrt(2 * Math.PI)),
    ] as const;
  });
  return (
    <div ref={ref} className="px-3.5 pt-2">
      {W > 0 && (
        <svg width={W} height={Hh} role="img" aria-label="Distribution of daily returns">
          {bins.map((b) => (
            <rect
              key={b.x0}
              x={x(b.x0) + 0.5}
              width={Math.max(1, x(b.x1) - x(b.x0) - 1)}
              y={y(b.n)}
              height={Hh - m.b - y(b.n)}
              fill={b.x1 <= 0 ? "var(--negative)" : "var(--positive)"}
              opacity={0.55}
            >
              <title>{`${pp(b.x0, 2)} to ${pp(b.x1, 2)}: ${b.n} days`}</title>
            </rect>
          ))}
          <path
            d={normal.map(([v, n], k) => `${k ? "L" : "M"}${x(v)},${y(n)}`).join("")}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={1.2}
            strokeDasharray="3 2"
          />
          <line x1={x(0)} x2={x(0)} y1={m.t} y2={Hh - m.b} stroke="var(--rule)" />
          <text x={m.l} y={Hh - 5} fontSize={10} fill="var(--muted-foreground)">
            {pp(lo, 1)}
          </text>
          <text
            x={W - m.r}
            y={Hh - 5}
            fontSize={10}
            textAnchor="end"
            fill="var(--muted-foreground)"
          >
            {pp(hi, 1)}
          </text>
        </svg>
      )}
    </div>
  );
}

export function RiskView({ H, A, Q }: { H: Hist; A: Analysis; Q?: QuantFile | null }) {
  const [calc, setCalc] = useState<Calc | null>(null);
  const mo = A.moments,
    md = A.mdd;
  const coneCalc = (n: number) => {
    const z = A.cone.find((c) => c.n === n)!;
    const rv = TA.realizedVol(H.c, n),
      lr = TA.logRets(H.c);
    const rows: (string | number)[][] = [];
    for (let i = H.n - 1; i >= H.n - n - 5 && i > 0; i--)
      rows.push([
        H.d[i],
        H.c[i].toFixed(2),
        lr[i] == null ? "–" : `${(lr[i]! * 100).toFixed(3)}%`,
        rv[i] == null ? "–" : pc(rv[i], 1),
      ]);
    setCalc({
      title: `${H.sym} · ${n}-day realized volatility`,
      value: pc(z.current, 1),
      sub: `${Math.round((z.pct ?? 0) * 100)}th percentile of ${z.count.toLocaleString()} windows · median ${pc(z.p50, 1)}`,
      formula: `Sample SD of the last ${n} daily log returns × √252.`,
      cols: ["Day", "Close", "Log return", `${n}d vol`],
      rows,
      hi: new Set(Array.from({ length: n }, (_, k) => k)),
    });
  };
  const ddSeries = useMemo(() => {
    const step = Math.max(1, Math.floor(H.n / 900));
    const pts: { x: string; y: number }[] = [];
    for (let i = 0; i < H.n; i += step) pts.push({ x: H.d[i], y: A.dd[i] * 100 });
    pts.push({ x: H.d[H.n - 1], y: A.dd[H.n - 1] * 100 });
    return [{ key: "dd", label: "Drawdown", color: "var(--negative)", points: pts }];
  }, [H, A.dd]);
  const perf = Q?.stats.perf;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Realized volatility cone"
          subtitle={`Annualized, every rolling window since ${fmtDate(H.d[0])}`}
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Window</th>
                <th className={cn(th, "text-right")}>Now</th>
                <th className={cn(th, "text-right")}>Pctile</th>
                <th className={th}>10th – 90th, median tick, dot now</th>
                <th className={cn(th, "text-right")}>Max</th>
              </tr>
            </thead>
            <tbody>
              {A.cone.map((z) => {
                const lo = A.cone.reduce((m, c) => Math.min(m, c.p10), Infinity),
                  hi = A.cone.reduce((m, c) => Math.max(m, c.p90, c.current ?? 0), 0);
                const pos = (v: number) =>
                  `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
                return (
                  <tr key={z.n} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{z.n}d</td>
                    <td className="px-3 py-1.5 text-right">
                      <Num onClick={() => coneCalc(z.n)}>{pc(z.current, 1)}</Num>
                    </td>
                    <td className="num px-3 py-1.5 text-right">
                      {z.pct == null ? "–" : `${Math.round(z.pct * 100)}th`}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="relative h-2 w-full min-w-28 rounded-full bg-secondary">
                        <span
                          className="absolute inset-y-0 rounded-full bg-chart-1/25"
                          style={{ left: pos(z.p10), right: `calc(100% - ${pos(z.p90)})` }}
                        />
                        <span
                          className="absolute inset-y-0 rounded-full bg-chart-1/45"
                          style={{ left: pos(z.p25), right: `calc(100% - ${pos(z.p75)})` }}
                        />
                        <span
                          className="absolute -top-0.5 h-3 w-px bg-foreground/60"
                          style={{ left: pos(z.p50) }}
                        />
                        {z.current != null && (
                          <span
                            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground"
                            style={{ left: pos(z.current) }}
                          />
                        )}
                      </div>
                    </td>
                    <td className="num px-3 py-1.5 text-right">{pc(z.max, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Note>
            Close-to-close volatility of daily log returns. Bands: 10th–90th and 25th–75th
            percentiles of the history. Click a value for the returns behind it.
          </Note>
        </Panel>
        <Panel
          title="Drawdown from prior peak"
          subtitle={`Maximum ${pp(md.dd)} · ${fmtDate(H.d[md.peak])} to ${fmtDate(H.d[md.trough])}${md.recovered != null ? ` · recovered ${fmtDate(H.d[md.recovered])}` : " · not recovered"}`}
          collapse={false}
        >
          <div className="px-3 py-2">
            <MultiLine
              series={ddSeries}
              label="Drawdown"
              format={(v) => `${v.toFixed(0)}%`}
              baseline={0}
              height={180}
              xFormat={(x) => x.slice(0, 4)}
            />
          </div>
          {Q?.stats.dd.top && (
            <table className="w-full border-t text-[12px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Peak</th>
                  <th className={th}>Trough</th>
                  <th className={th}>Recovered</th>
                  <th className={cn(th, "text-right")}>Depth</th>
                  <th className={cn(th, "text-right")}>Days down / back</th>
                </tr>
              </thead>
              <tbody>
                {Q.stats.dd.top.slice(0, 5).map((d) => (
                  <tr key={d.peak} className="border-b last:border-0">
                    <td className="num px-3 py-1">{fmtDate(d.peak)}</td>
                    <td className="num px-3 py-1">{fmtDate(d.trough)}</td>
                    <td className="num px-3 py-1">
                      {d.recovered ? fmtDate(d.recovered) : "not yet"}
                    </td>
                    <td className="num px-3 py-1 text-right text-negative">{pp(d.depth)}</td>
                    <td className="num px-3 py-1 text-right">
                      {d.to_trough} / {d.to_recover ?? "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Note>Total return index (dividends reinvested) relative to its running maximum.</Note>
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Daily return distribution"
          subtitle={`${mo.n.toLocaleString()} days · dashed: a normal curve with the same mean and SD`}
          collapse={false}
        >
          <Histogram bins={A.hist} mean={mo.mean} sd={mo.sd} />
          <dl className="grid grid-cols-2 gap-x-6 px-3.5 py-2 text-[12.5px]">
            {[
              ["Mean / SD", `${pp(mo.mean, 3)} / ${pc(mo.sd, 2)}`],
              ["Skew / excess kurtosis", `${f2(mo.skew)} / ${f2(mo.kurt)}`],
              ["1st / 99th percentile", `${pp(mo.p1, 2)} / ${pp(mo.p99, 2)}`],
              ["Worst / best day", `${pp(mo.min, 2)} / ${pp(mo.max, 2)}`],
              ["Days beyond 3 SD", `${mo.beyond3} (normal ${mo.normal3.toFixed(1)})`],
              ["Days beyond 2 SD", `${mo.beyond2} (normal ${mo.normal2.toFixed(0)})`],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between border-b py-1">
                <dt className="text-muted-foreground">{l}</dt>
                <dd className="num tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <Note>
            More days beyond 3 SD than the normal count, and excess kurtosis above 0, mean fatter
            tails than a normal distribution.
          </Note>
        </Panel>
        {perf && (
          <Panel
            title="Risk-adjusted performance"
            subtitle="Excess over 13-week Treasury bills"
            collapse={false}
            bodyClassName="p-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Window</th>
                  <th className={cn(th, "text-right")}>Return, ann.</th>
                  <th className={cn(th, "text-right")}>Vol, ann.</th>
                  <th className={cn(th, "text-right")}>Sharpe</th>
                  <th className={cn(th, "text-right")}>Sortino</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(perf).map(([k, p]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="px-3 py-1.5">
                      {k}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        from {fmtDate(p.from)}
                      </span>
                    </td>
                    <td className={cn("num px-3 py-1.5 text-right", tone(p.ann_return))}>
                      {pp(p.ann_return)}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{pc(p.ann_vol, 1)}</td>
                    <td className="num px-3 py-1.5 text-right">{f2(p.sharpe)}</td>
                    <td className="num px-3 py-1.5 text-right">{f2(p.sortino)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Q?.stats.var && (
              <table className="w-full border-t text-[12.5px]">
                <thead>
                  <tr className="border-b text-left">
                    <th className={th}>One-day loss, historical</th>
                    <th className={cn(th, "text-right")}>VaR 95% / ES 95%</th>
                    <th className={cn(th, "text-right")}>VaR 99% / ES 99%</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(Q.stats.var).map(([k, v]) => (
                    <tr key={k} className="border-b last:border-0">
                      <td className="px-3 py-1.5">
                        {k === "full" ? "Full history" : k}{" "}
                        <span className="text-[11px] text-muted-foreground">
                          {v.n.toLocaleString()} days
                        </span>
                      </td>
                      <td className="num px-3 py-1.5 text-right">
                        {pc(v["95"][0], 1)} / {pc(v["95"][1], 1)}
                      </td>
                      <td className="num px-3 py-1.5 text-right">
                        {pc(v["99"][0], 1)} / {pc(v["99"][1], 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {Q?.stats.hurst && (
              <Note>
                Hurst exponent {f2(Q.stats.hurst.h)} (0.5 = random walk, above = trending, below =
                mean-reverting; R² {f2(Q.stats.hurst.r2)}). Variance ratios:{" "}
                {Q.stats.vr.map((v) => `${v.q}d ${f2(v.vr)} (p ${f2(v.p)})`).join(", ")}.
              </Note>
            )}
          </Panel>
        )}
      </div>
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </>
  );
}

/* ---------- quant: sensitivities, factors, earnings, regimes, rules, seasonality ---------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const sigTone = (p: number) => (p < 0.05 ? "font-medium" : "text-muted-foreground");

export function QuantView({
  Q,
  methods,
  ticker,
}: {
  Q: QuantFile;
  methods?: Record<string, string> | null;
  ticker: string;
}) {
  const [win, setWin] = useState(Object.keys(Q.corr.factors?.windows ?? {})[0] ?? "1y");
  const { open } = useSource();
  const F = Q.corr.factors?.windows?.[win];
  const E = Q.events.earnings;
  const col = (name: string) => Q.events.cols.indexOf(name);
  const curves = useMemo(() => {
    const d = Q.backtests.d;
    return Object.entries(Q.backtests.rules).map(([k, r], i) => ({
      key: k,
      label: RULE_NAME[k] ?? k,
      color: k === "bh" ? "var(--muted-foreground)" : `var(--chart-${i + 1})`,
      // Log scale: growth of $1 spans orders of magnitude for long winners.
      points: r.curve.map((v, j) => ({ x: d[j] ?? "", y: v > 0 ? Math.log10(v) : null })),
    }));
  }, [Q]);
  const bench = Object.entries(Q.corr.bench);
  const macro = Object.entries(Q.corr.macro);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Sensitivity to the market and macro"
          subtitle="Correlation and beta of daily returns"
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]" title={methods?.bench}>
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Against</th>
                <th className={cn(th, "text-right")}>Corr 63d</th>
                <th className={cn(th, "text-right")}>Corr 252d</th>
                <th className={cn(th, "text-right")}>Beta 252d</th>
                <th className={cn(th, "text-right")}>Beta, full</th>
                <th className={cn(th, "text-right")}>Up / down beta</th>
              </tr>
            </thead>
            <tbody>
              {bench.map(([k, b]) => (
                <tr key={k} className="border-b">
                  <td className="px-3 py-1.5 font-medium">{k}</td>
                  <td className="num px-3 py-1.5 text-right">{f2(b.c63)}</td>
                  <td className="num px-3 py-1.5 text-right">{f2(b.c252)}</td>
                  <td className="num px-3 py-1.5 text-right">{f2(b.b252)}</td>
                  <td
                    className="num px-3 py-1.5 text-right"
                    title={`${b.full.n.toLocaleString()} days from ${b.full.from}`}
                  >
                    {f2(b.full.beta)}
                  </td>
                  <td className="num px-3 py-1.5 text-right">
                    {b.updown ? `${f2(b.updown.beta_up)} / ${f2(b.updown.beta_down)}` : "–"}
                  </td>
                </tr>
              ))}
              {macro.map(([k, m]) => (
                <tr key={k} className="border-b last:border-0" title={m.transform}>
                  <td className="px-3 py-1.5">{m.label}</td>
                  <td className="px-3 py-1.5" />
                  <td className="num px-3 py-1.5 text-right">{f2(m.c252)}</td>
                  <td className="num px-3 py-1.5 text-right">{f2(m.b252)}</td>
                  <td className="num px-3 py-1.5 text-right">{f2(m.b_full)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            Rates use the daily change in yield (beta is return per 1 percentage point); others use
            daily percent changes. Up / down beta: beta on days the benchmark rose / fell over the
            last year.
          </Note>
        </Panel>
        {Q.corr.factors && F && (
          <Panel
            title="Factor exposure"
            subtitle={`Fama-French five factors plus momentum · ${F.from} to ${F.to}`}
            actions={
              <Segmented
                size="xs"
                label="Window"
                value={win}
                onChange={setWin}
                options={Object.keys(Q.corr.factors.windows).map((k) => ({ v: k, l: k }))}
              />
            }
            collapse={false}
            bodyClassName="p-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Factor</th>
                  <th className={th}>Loading</th>
                  <th className={cn(th, "text-right")}>Coef.</th>
                  <th className={cn(th, "text-right")}>t</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(F.coef).map(([k, v]) => {
                  const sig = Math.abs(F.t[k]) >= 2;
                  return (
                    <tr key={k} className="border-b">
                      <td className="px-3 py-1.5">{FACTOR_NAME[k] ?? k}</td>
                      <td className="w-40 px-3 py-1.5">
                        <div className="relative h-2 rounded-full bg-secondary">
                          <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" />
                          <span
                            className={cn(
                              "absolute inset-y-0 rounded-full",
                              v >= 0 ? "bg-positive" : "bg-negative",
                              !sig && "opacity-40",
                            )}
                            style={
                              v >= 0
                                ? { left: "50%", width: `${Math.min(50, Math.abs(v) * 25)}%` }
                                : { right: "50%", width: `${Math.min(50, Math.abs(v) * 25)}%` }
                            }
                          />
                        </div>
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-1.5 text-right",
                          sig ? "font-medium" : "text-muted-foreground",
                        )}
                      >
                        {f2(v)}
                      </td>
                      <td className="num px-3 py-1.5 text-right text-muted-foreground">
                        {f2(F.t[k], 1)}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="px-3 py-1.5">Alpha, annualized</td>
                  <td />
                  <td
                    className={cn(
                      "num px-3 py-1.5 text-right",
                      Math.abs(F.alpha_t) >= 2 ? "font-medium" : "text-muted-foreground",
                    )}
                  >
                    {pp(F.alpha_ann)}
                  </td>
                  <td className="num px-3 py-1.5 text-right text-muted-foreground">
                    {f2(F.alpha_t, 1)}
                  </td>
                </tr>
              </tbody>
            </table>
            <Note>
              R² {f2(F.r2)} over {F.n} days. Faded bars have |t| below 2 (not distinguishable from
              zero).{" "}
              <a
                href={Q.corr.factors.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                {Q.corr.factors.source}
              </a>
              , data to {Q.corr.factors.as_of}.
            </Note>
          </Panel>
        )}
      </div>

      {E && (
        <Panel
          title="Reaction to earnings releases"
          subtitle={E.basis}
          collapse={false}
          bodyClassName="p-0"
        >
          <div className="grid grid-cols-2 border-b sm:grid-cols-4 xl:grid-cols-6">
            {[
              ["Releases", String(E.stats.n)],
              ["Avg absolute move", pc(E.stats.mean_abs_cc, 1)],
              ["Vs a normal day", `${f2(E.stats.abs_ratio, 1)}×`],
              ["Up share", pc(E.stats.up_share)],
              ["Drift next 5d", `${pp(E.stats.drift5.mean)} (p ${f2(E.stats.drift5.p)})`],
              ["Drift next 20d", `${pp(E.stats.drift20.mean)} (p ${f2(E.stats.drift20.p)})`],
            ].map(([l, v]) => (
              <div key={l} className="border-r px-3.5 py-2 last:border-r-0">
                <p className="text-[11px] text-muted-foreground">{l}</p>
                <p className="num text-[15px] font-medium tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className="max-h-80 overflow-auto scrollbar-thin">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left">
                  <th className={th}>Filed</th>
                  <th className={th}>Timing</th>
                  <th className={cn(th, "text-right")}>Reaction</th>
                  <th className={cn(th, "text-right")}>Abnormal</th>
                  <th className={cn(th, "text-right")}>σ</th>
                  <th className={cn(th, "text-right")}>Next 20d</th>
                  <th className={th}>Filing</th>
                </tr>
              </thead>
              <tbody>
                {[...E.rows].reverse().map((r) => {
                  const accn = String(r[col("accession")]),
                    doc = String(r[col("doc")]);
                  const cc = r[col("cc")] as number | null,
                    abn = r[col("abn")] as number | null,
                    sg = r[col("sigma")] as number | null,
                    d20 = r[col("d20")] as number | null;
                  return (
                    <tr key={accn} className="border-b last:border-0">
                      <td className="num px-3 py-1">{fmtDate(String(r[col("filed")]))}</td>
                      <td className="px-3 py-1 text-muted-foreground">
                        {String(r[col("timing")] ?? "")}
                      </td>
                      <td className={cn("num px-3 py-1 text-right", tone(cc))}>{pp(cc)}</td>
                      <td className={cn("num px-3 py-1 text-right", tone(abn))}>{pp(abn)}</td>
                      <td className="num px-3 py-1 text-right">{f2(sg, 1)}</td>
                      <td className={cn("num px-3 py-1 text-right", tone(d20))}>{pp(d20)}</td>
                      <td className="px-3 py-1">
                        <button
                          type="button"
                          onClick={() =>
                            open({
                              ticker,
                              label: "Earnings release",
                              periodLabel: fmtDate(String(r[col("filed")])),
                              unit: "pct",
                              value: cc ?? 0,
                              doc: {
                                accn,
                                doc,
                                title: `${String(r[col("form")])} filed ${String(r[col("filed")])}`,
                              },
                            })
                          }
                          className="text-link hover:underline"
                        >
                          {String(r[col("form")])} ↗
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Note>
            Reaction: close-to-close over the first session that could trade on the release
            (after-close filings react the next day). Abnormal: minus beta × the sector ETF's move.
            σ: the abnormal move in units of the stock's typical daily abnormal move.{" "}
            {methods?.earnings ?? ""}
          </Note>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Regimes and what followed"
          subtitle="Forward 20-day return by trend and volatility regime"
          collapse={false}
          bodyClassName="p-0"
        >
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Trend · volatility</th>
                <th className={cn(th, "text-right")}>Days</th>
                <th className={cn(th, "text-right")}>Share</th>
                <th className={cn(th, "text-right")}>Next 20d avg</th>
                <th className={cn(th, "text-right")}>Up share</th>
              </tr>
            </thead>
            <tbody>
              {Q.regimes.table.map((t) => {
                const [tr, vo] = t.key.split("|");
                const now = t.key === `${Q.regimes.current.trend}|${Q.regimes.current.vol}`;
                return (
                  <tr
                    key={t.key}
                    className={cn(
                      "border-b last:border-0",
                      now && "bg-highlight-soft",
                      tr === "*" && vo === "*" && "font-medium",
                    )}
                  >
                    <td className="px-3 py-1">
                      {tr === "*" ? "any trend" : tr} · {vo === "*" ? "any volatility" : vo}
                      {now && <Chip className="ml-1.5 border-highlight">now</Chip>}
                    </td>
                    <td className="num px-3 py-1 text-right">{t.days.toLocaleString()}</td>
                    <td className="num px-3 py-1 text-right">{pc(t.share)}</td>
                    <td className={cn("num px-3 py-1 text-right", tone(t.fwd20))}>{pp(t.fwd20)}</td>
                    <td className="num px-3 py-1 text-right">{pc(t.hit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <RegimeStrip runs={Q.regimes.trend_runs} />
          <Note>
            {methods?.regimes ??
              "Trend: price against its 50- and 200-day averages. Volatility: 20-day realized volatility ranked against the trailing three years."}
          </Note>
        </Panel>
        <Panel
          title="Rule backtests"
          subtitle={`Growth of $1, log scale · long-only, daily, before costs · ${fmtDate(Q.backtests.start)} to ${fmtDate(Q.backtests.end)}`}
          collapse={false}
          bodyClassName="p-0"
        >
          <div className="px-3 py-2">
            <MultiLine
              series={curves}
              label="Growth of $1"
              format={(v) => {
                const x = 10 ** v;
                return x >= 10 ? `${x.toFixed(0)}×` : `${x.toFixed(x >= 1 ? 1 : 2)}×`;
              }}
              height={190}
              xFormat={(x) => x.slice(0, 4)}
            />
          </div>
          <table className="w-full border-t text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Rule</th>
                <th className={cn(th, "text-right")}>CAGR</th>
                <th className={cn(th, "text-right")}>Sharpe</th>
                <th className={cn(th, "text-right")}>Max DD</th>
                <th className={cn(th, "text-right")}>Exposure</th>
                <th className={cn(th, "text-right")}>Trades · hit</th>
                <th className={th}>Now</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(Q.backtests.rules).map(([k, r]) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{RULE_NAME[k] ?? k}</td>
                  <td className={cn("num px-3 py-1.5 text-right", tone(r.cagr))}>{pp(r.cagr)}</td>
                  <td className="num px-3 py-1.5 text-right">{f2(r.sharpe)}</td>
                  <td className="num px-3 py-1.5 text-right text-negative">{pp(r.maxdd, 0)}</td>
                  <td className="num px-3 py-1.5 text-right">{pc(r.exposure)}</td>
                  <td className="num px-3 py-1.5 text-right">
                    {k === "bh" ? "–" : `${r.trades} · ${pc(r.hit)}`}
                  </td>
                  <td className="px-3 py-1.5 text-[11px]">
                    {k === "bh" ? (
                      ""
                    ) : r.in_market ? (
                      <span className="text-positive">
                        in{r.open ? ` since ${fmtDate(r.open.entry)}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">out</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            {methods?.backtests ??
              "Signals act on the next day's close. Past rule performance on one symbol is a description, not a recommendation."}
          </Note>
        </Panel>
      </div>

      <Panel
        title="Seasonality"
        subtitle={`Month and weekday averages since ${fmtDate(Q.first)}, with significance tests`}
        collapse={false}
        bodyClassName="p-0"
      >
        <div className="grid gap-px bg-border lg:grid-cols-[3fr_2fr]">
          <SeasonBars
            cells={Q.season.month.map((m) => ({
              l: MONTHS[m.m - 1],
              mean: m.mean,
              n: m.n,
              hit: m.hit,
              p: m.p,
              sig: m.sig,
            }))}
          />
          <SeasonBars
            cells={Q.season.dow.map((d) => ({
              l: DOW[d.wd],
              mean: d.mean,
              n: d.n,
              hit: d.hit,
              p: d.p,
              sig: d.sig,
            }))}
          />
        </div>
        <Note>
          Month: month-end to month-end total return, about one observation per year per month.
          Weekday: close-to-close. Bold bars differ from zero at p &lt; 0.05; the label shows
          whether the month or day differs from the rest. Small samples: most patterns here are
          noise.
        </Note>
      </Panel>
    </>
  );
}

function SeasonBars({
  cells,
}: {
  cells: { l: string; mean: number; n: number; hit: number; p: number; sig: string }[];
}) {
  const max = Math.max(...cells.map((c) => Math.abs(c.mean)), 1e-9);
  return (
    <div className="flex h-44 items-stretch gap-1 bg-card px-3 py-2">
      {cells.map((c) => (
        <div
          key={c.l}
          className="flex flex-1 flex-col items-center"
          title={`${c.l}: average ${pp(c.mean, 2)}, up ${pc(c.hit)} of ${c.n}; p = ${f2(c.p, 3)}; ${c.sig}`}
        >
          <div className="relative w-full flex-1">
            <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
            <span
              className={cn(
                "absolute inset-x-1 rounded-sm",
                c.mean >= 0 ? "bg-positive" : "bg-negative",
                c.p < 0.05 ? "opacity-90" : "opacity-35",
              )}
              style={
                c.mean >= 0
                  ? { bottom: "50%", height: `${(Math.abs(c.mean) / max) * 48}%` }
                  : { top: "50%", height: `${(Math.abs(c.mean) / max) * 48}%` }
              }
            />
          </div>
          <span className={cn("num text-[10px]", sigTone(c.p))}>{pp(c.mean, 1)}</span>
          <span className="text-[10.5px] text-muted-foreground">{c.l}</span>
        </div>
      ))}
    </div>
  );
}

function RegimeStrip({ runs }: { runs: [string, string, string][] }) {
  if (!runs.length) return null;
  const t0 = Date.parse(runs[0][0]),
    t1 = Date.parse(runs[runs.length - 1][1]);
  const span = t1 - t0 || 1;
  return (
    <div className="border-t px-3.5 py-2">
      <p className="mb-1 text-[11px] text-muted-foreground">
        Trend regime history, {runs[0][0].slice(0, 4)} to {runs[runs.length - 1][1].slice(0, 4)}
      </p>
      <div className="flex h-3 overflow-hidden rounded-sm">
        {runs.map(([a, b, k]) => (
          <span
            key={a}
            title={`${k}: ${a} to ${b}`}
            style={{
              width: `${((Date.parse(b) - Date.parse(a) + 864e5) / span) * 100}%`,
              background:
                k === "up"
                  ? "var(--positive)"
                  : k === "down"
                    ? "var(--negative)"
                    : "var(--muted-foreground)",
              opacity: k === "transition" ? 0.35 : 0.7,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-3 text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-positive/70" />
          up
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-negative/70" />
          down
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-muted-foreground/35" />
          transition
        </span>
      </div>
    </div>
  );
}

/* ---------- market: evidence-backed setups and breadth ---------- */
export function MarketScan({
  SG,
  states,
  breadth,
  onPick,
}: {
  SG?: SignalsFile | null;
  states?: { as_of: string; rows: StateRow[] } | null;
  breadth?: BreadthFile | null;
  onPick: (sym: string) => void;
}) {
  const [hz, setHz] = useState<"5" | "20" | "60">("20");
  const [days, setDays] = useState<"5" | "10">("5");
  const cutoff = useMemo(() => {
    const ds = [...new Set((states?.rows ?? []).flatMap((r) => r.events.map((e) => e[1])))].sort();
    return ds[Math.max(0, ds.length - +days)] ?? "";
  }, [states, days]);
  // A setup is shown only when the pooled forward return after the signal differs from all days with the interval clear of zero.
  const setups = useMemo(() => {
    if (!SG || !states) return [];
    const out: {
      tp: string;
      P: SignalsFile["signals"][string][string];
      rows: { r: StateRow; date: string }[];
    }[] = [];
    for (const tp of Object.keys(TA.SIGNALS)) {
      const P = SG.signals[tp]?.[hz];
      if (!P?.excess_ci || (P.excess_ci[0] <= 0 && P.excess_ci[1] >= 0)) continue;
      const rows = states.rows.flatMap((r) =>
        r.events.filter((e) => e[0] === tp && e[1] >= cutoff).map((e) => ({ r, date: e[1] })),
      );
      if (rows.length) out.push({ tp, P, rows: rows.sort((a, b) => b.date.localeCompare(a.date)) });
    }
    return out.sort((a, b) => Math.abs(b.P.excess ?? 0) - Math.abs(a.P.excess ?? 0));
  }, [SG, states, hz, cutoff]);
  const series = useMemo(() => {
    if (!breadth) return [];
    const from = Math.max(0, breadth.d.length - 504);
    const pts = (num: number[], den: number[]) =>
      breadth.d
        .slice(from)
        .map((x, i) => ({ x, y: den[from + i] ? (num[from + i] / den[from + i]) * 100 : null }));
    return [
      {
        key: "a50",
        label: "> 50-day",
        color: "var(--chart-1)",
        points: pts(breadth.above50, breadth.n50),
      },
      {
        key: "a200",
        label: "> 200-day",
        color: "var(--chart-3)",
        points: pts(breadth.above200, breadth.n200),
      },
    ];
  }, [breadth]);
  const hl = useMemo(() => {
    if (!breadth) return [];
    const from = Math.max(0, breadth.d.length - 504);
    return [
      {
        key: "nhnl",
        label: "Highs − lows",
        color: "var(--chart-2)",
        points: breadth.d
          .slice(from)
          .map((x, i) => ({ x, y: breadth.new_high[from + i] - breadth.new_low[from + i] })),
      },
    ];
  }, [breadth]);
  return (
    <>
      <Panel
        title="Evidence-backed setups"
        subtitle={`Signals in the last ${days} sessions whose history across tracked companies shows a forward return clearly different from all days · as of ${states ? fmtDate(states.as_of) : "–"}`}
        actions={
          <div className="flex gap-1.5">
            <Segmented
              size="xs"
              label="Sessions"
              value={days}
              onChange={setDays}
              options={[
                { v: "5", l: "5 sessions" },
                { v: "10", l: "10" },
              ]}
            />
            <Segmented
              size="xs"
              label="Horizon"
              value={hz}
              onChange={setHz}
              options={[
                { v: "5", l: "5d" },
                { v: "20", l: "20d" },
                { v: "60", l: "60d" },
              ]}
            />
          </div>
        }
        collapse={false}
        bodyClassName="p-0"
      >
        {!SG || !states ? (
          <p className="p-4 text-sm text-muted-foreground">Loading the published statistics…</p>
        ) : !setups.length ? (
          <p className="p-4 text-sm text-muted-foreground">
            No signal with a clear historical edge at {hz} days fired in this window.
          </p>
        ) : (
          <div className="divide-y">
            {setups.map(({ tp, P, rows }) => {
              const sg = TA.SIGNALS[tp];
              return (
                <div key={tp} className="px-3.5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">
                      <span className={sg.dir > 0 ? "text-positive" : "text-negative"}>
                        {sg.dir > 0 ? "▲" : "▼"}
                      </span>{" "}
                      {sg.name}
                    </span>
                    <span className="text-[12px] text-muted-foreground">{sg.text}</span>
                    {(P.excess ?? 0) > 0 ? (
                      <Chip className="border-positive/40 text-positive">historically outperformed</Chip>
                    ) : (
                      <Chip className="border-negative/40 text-negative">historically lagged</Chip>
                    )}
                    <span className="num ml-auto text-[12px]">
                      {hz}d after: <b className={tone(P.mean)}>{pp(P.mean, 2)}</b> vs all days{" "}
                      {pp(SG.base[hz].all.mean, 2)} · excess{" "}
                      <b className={tone(P.excess)}>{pp(P.excess, 2)}</b> ({pp(P.excess_ci![0])} to{" "}
                      {pp(P.excess_ci![1])}) · up {pc(P.hit)} · {P.n.toLocaleString()} events,{" "}
                      {SG.signals[tp].symbols} names
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {rows.slice(0, 40).map(({ r, date }) => (
                      <button
                        key={`${r.t}-${date}`}
                        type="button"
                        onClick={() => onPick(r.t)}
                        title={`${r.t} · ${date} · ${r.sector} · RSI ${f2(r.rsi, 0)} · ${pp(r.vs200)} vs 200-day`}
                        className="num rounded border px-1.5 py-0.5 text-[11.5px] hover:bg-secondary"
                      >
                        {r.t} <span className="text-muted-foreground">{date.slice(5)}</span>
                      </button>
                    ))}
                    {rows.length > 40 && (
                      <span className="text-[11px] text-muted-foreground">
                        +{rows.length - 40} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Note>
          Only signals whose 95% interval of excess return (clustered by month) excludes zero are
          listed. That is evidence of a historical difference across tracked companies, not of an
          edge in any single name: check the symbol's own scorecard, and note survivorship bias.
        </Note>
      </Panel>
      {breadth && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel
            title="Breadth: share above moving averages"
            subtitle="Tracked companies, last two years"
            collapse={false}
          >
            <div className="px-3 py-2">
              <MultiLine
                series={series}
                label="Share of companies above their 50- and 200-day averages"
                format={(v) => `${v.toFixed(0)}%`}
                height={200}
                xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
              />
            </div>
            <Note>{breadth.caveat}</Note>
          </Panel>
          <Panel
            title="Breadth: new 52-week highs minus lows"
            subtitle="Tracked companies, last two years"
            collapse={false}
          >
            <div className="px-3 py-2">
              <MultiLine
                series={hl}
                label="New highs minus new lows"
                format={(v) => v.toFixed(0)}
                baseline={0}
                height={200}
                xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
              />
            </div>
            <Note>{breadth.source}.</Note>
          </Panel>
        </div>
      )}
      {states && <ScanTable rows={states.rows} onPick={onPick} />}
    </>
  );
}

function ScanTable({ rows, onPick }: { rows: StateRow[]; onPick: (s: string) => void }) {
  const [sort, setSort] = useState<{ k: keyof StateRow; d: 1 | -1 }>({ k: "r63", d: -1 });
  const [filter, setFilter] = useState<"all" | "up" | "down" | "squeeze" | "ob" | "os">("all");
  const list = rows
    .filter(
      (r) =>
        filter === "all" ||
        (filter === "up"
          ? r.trend === "up"
          : filter === "down"
            ? r.trend === "down"
            : filter === "squeeze"
              ? r.squeeze > 0
              : filter === "ob"
                ? (r.rsi ?? 0) >= 70
                : (r.rsi ?? 100) <= 30),
    )
    .sort((a, b) => {
      const x = a[sort.k] as number | null,
        y = b[sort.k] as number | null;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.d * (x - y);
    })
    .slice(0, 150);
  const cols: { k: keyof StateRow; l: string; f: (v: number | null) => string }[] = [
    { k: "r21", l: "1M", f: (v) => pp(v) },
    { k: "r63", l: "3M", f: (v) => pp(v) },
    { k: "r252", l: "1Y", f: (v) => pp(v) },
    { k: "vs50", l: "vs 50d", f: (v) => pp(v) },
    { k: "vs200", l: "vs 200d", f: (v) => pp(v) },
    { k: "from_hi", l: "From high", f: (v) => pp(v) },
    { k: "rsi", l: "RSI", f: (v) => f2(v, 0) },
    { k: "adx", l: "ADX", f: (v) => f2(v, 0) },
    { k: "vol21_pct", l: "Vol pctile", f: (v) => (v == null ? "–" : `${Math.round(v * 100)}`) },
  ];
  return (
    <Panel
      title="Technical scan"
      subtitle={`${rows.length.toLocaleString()} tracked companies, latest close`}
      actions={
        <Segmented
          size="xs"
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { v: "all", l: "All" },
            { v: "up", l: "Uptrend" },
            { v: "down", l: "Downtrend" },
            { v: "squeeze", l: "Squeeze" },
            { v: "ob", l: "RSI ≥ 70" },
            { v: "os", l: "RSI ≤ 30" },
          ]}
        />
      }
      collapse={false}
      bodyClassName="p-0"
    >
      <div className="max-h-[60vh] overflow-auto scrollbar-thin">
        <table className="w-full min-w-[900px] text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-left">
              <th className={th}>Company</th>
              <th className={th}>Trend</th>
              {cols.map((c) => (
                <th key={c.k} className={cn(th, "text-right")}>
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) => ({ k: c.k, d: s.k === c.k ? (-s.d as 1 | -1) : -1 }))
                    }
                    className="hover:text-foreground"
                  >
                    {c.l}
                    {sort.k === c.k ? (sort.d === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              <th className={th}>Recent signals</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr
                key={r.t}
                className="cursor-pointer border-b hover:bg-secondary"
                onClick={() => onPick(r.t)}
              >
                <td className="px-3 py-1">
                  <span className="num font-medium">{r.t}</span>{" "}
                  <span className="text-[11px] text-muted-foreground">{r.sector}</span>
                </td>
                <td className="px-3 py-1">
                  <Chip
                    className={
                      TREND_TONE[r.trend === "mixed" ? "transition" : (r.trend ?? "transition")]
                    }
                  >
                    {r.trend ?? "–"}
                  </Chip>
                  {r.squeeze > 0 && <Chip className="ml-1">squeeze {r.squeeze}</Chip>}
                </td>
                {cols.map((c) => {
                  const v = r[c.k] as number | null;
                  return (
                    <td
                      key={c.k}
                      className={cn(
                        "num px-3 py-1 text-right",
                        c.f === pp || ["r21", "r63", "r252", "vs50", "vs200"].includes(c.k)
                          ? tone(v)
                          : "",
                      )}
                    >
                      {c.f(v)}
                    </td>
                  );
                })}
                <td className="px-3 py-1 text-[11px] text-muted-foreground">
                  {r.events
                    .slice(-2)
                    .map((e) => `${TA.SIGNALS[e[0]]?.name ?? e[0]} ${e[1].slice(5)}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>
        Showing up to 150 rows. Click a row to open its technicals. Values are from each company's
        latest daily close in the stored history.
      </Note>
    </Panel>
  );
}
