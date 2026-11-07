import { useMemo, useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { MultiLine } from "@/components/charts/multi-line";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import TA, { type Analysis } from "@/lib/technicals/ta";
import type { Hist, QuantFile } from "@/lib/technicals/data";
import {
  eventRows,
  gapRows,
  gapStats,
  indicatorBoard,
  levelRows,
  trendLineRows,
  type BoardRow,
} from "@/lib/technicals/dense";
import { CalcSheet, pc, pp, type Calc } from "./deep";

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const f = (v: number | null | undefined, d = 2) => (ok(v) ? v.toFixed(d) : "–");
const th = "px-3 py-2 text-[11px] font-medium text-muted-foreground";
const td = "px-3 py-1.5";
const toneCls = (t?: number | null) => (!t ? "" : t > 0 ? "text-positive" : "text-negative");
const signTone = (v: number | null | undefined) =>
  !ok(v) || v === 0 ? "" : v > 0 ? "text-positive" : "text-negative";
const Note = ({ children }: { children: ReactNode }) => (
  <p className="border-t px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
    {children}
  </p>
);
const Arrow = ({ dir }: { dir: number }) => (
  <span
    className={dir > 0 ? "text-positive" : "text-negative"}
    aria-label={dir > 0 ? "up" : "down"}
  >
    {dir > 0 ? "▲" : "▼"}
  </span>
);
function NumBtn({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  if (!onClick) return <span className={cn("num tabular-nums", className)}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show the calculation"
      className={cn(
        "num rounded-sm tabular-nums decoration-dotted underline-offset-2 hover:bg-highlight-soft hover:underline",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- indicator board ---------- */
export function IndicatorBoard({ H, A }: { H: Hist; A: Analysis }) {
  const groups = useMemo(() => indicatorBoard(H, A), [H, A]);
  const [calc, setCalc] = useState<Calc | null>(null);
  const open = (r: BoardRow) =>
    setCalc({
      title: `${H.sym} · ${r.label}`,
      value: r.value,
      sub: r.read,
      formula: r.formula,
      cols: r.calc?.cols ?? ["Day"],
      rows: r.calc?.rows ?? [],
      note: r.calc ? "The last 30 sessions, newest first." : undefined,
    });
  return (
    <>
      <Panel
        title="Indicator board"
        subtitle={`Every indicator at the close of ${fmtDate(H.d[H.n - 1])} · computed from ${H.n.toLocaleString()} daily bars`}
        collapse={false}
        bodyClassName="p-0"
      >
        <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title} className="bg-card">
              <p className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.title}
              </p>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.key} className="border-b last:border-0 align-top">
                      <td className="w-[38%] px-3 py-1.5 text-muted-foreground">{r.label}</td>
                      <td className="px-3 py-1.5">
                        <NumBtn
                          onClick={() => open(r)}
                          className={cn("font-medium", toneCls(r.tone))}
                        >
                          {r.value}
                        </NumBtn>
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                          {r.read}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <Note>
          Colour shows which side of the usual threshold a value sits on, not a recommendation.
          Click a value for its formula and the last 30 sessions of inputs. Same library as the
          signal scorecard, so every value here matches the one the statistics use.
        </Note>
      </Panel>
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </>
  );
}

/* ---------- gaps, levels, trend lines ---------- */
export function GapsAndLevels({ H, A }: { H: Hist; A: Analysis }) {
  const gaps = useMemo(() => gapRows(H, A), [H, A]);
  const stats = useMemo(() => gapStats(gaps), [gaps]);
  const levels = useMemo(() => levelRows(H, A), [H, A]);
  const lines = useMemo(() => trendLineRows(H, A), [H, A]);
  const [show, setShow] = useState<"open" | "all">("open");
  const shown = show === "open" ? gaps.filter((g) => g.filledDate == null) : gaps;
  const close = H.c[H.n - 1];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel
        title="Price gaps"
        subtitle={`${stats.total} gaps of 2% or more since ${fmtDate(H.d[0])} · ${stats.open} still open · ${stats.up} up, ${stats.down} down`}
        actions={
          <Segmented
            size="xs"
            label="Gaps"
            value={show}
            onChange={setShow}
            options={[
              { v: "open", l: `Open (${stats.open})` },
              { v: "all", l: `All (${stats.total})` },
            ]}
          />
        }
        collapse={520}
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-3 gap-px border-b bg-border text-center">
          {[
            ["Filled", pc(stats.filledShare)],
            [
              "Median bars to fill",
              stats.medianBarsToFill == null ? "–" : String(stats.medianBarsToFill),
            ],
            ["Filled within 5 bars", pc(stats.filledWithin5)],
          ].map(([l, v]) => (
            <div key={l} className="bg-card px-2 py-1.5">
              <p className="text-[10.5px] text-muted-foreground">{l}</p>
              <p className="num text-[13px] font-medium tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="px-3.5 py-6 text-sm text-muted-foreground">
            No open gaps: every gap in the history has been filled.
          </p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Date</th>
                  <th className={th}>Direction</th>
                  <th className={cn(th, "text-right")}>Open vs prior close</th>
                  <th className={cn(th, "text-right")}>Gap zone</th>
                  <th className={cn(th, "text-right")}>Fill level</th>
                  <th className={cn(th, "text-right")}>Filled</th>
                  <th className={cn(th, "text-right")}>Close vs fill level</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map((g) => (
                  <tr
                    key={g.i}
                    className={cn(
                      "border-b last:border-0",
                      g.filledDate == null && "bg-highlight-soft/40",
                    )}
                  >
                    <td className={cn(td, "num")}>{g.date}</td>
                    <td className={td}>
                      <Arrow dir={g.dir} /> {g.dir > 0 ? "Gap up" : "Gap down"}
                    </td>
                    <td className={cn(td, "num text-right", signTone(g.size))}>{pp(g.size)}</td>
                    <td className={cn(td, "num text-right")}>
                      {f(g.bottom)}–{f(g.top)}
                    </td>
                    <td className={cn(td, "num text-right")}>{f(g.edge)}</td>
                    <td className={cn(td, "num text-right")}>
                      {g.filledDate ? (
                        <>
                          {g.filledDate}
                          <span className="block text-[10.5px] text-muted-foreground">
                            {g.barsToFill} bar{g.barsToFill === 1 ? "" : "s"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">open, {H.n - 1 - g.i} bars</span>
                      )}
                    </td>
                    <td className={cn(td, "num text-right")}>
                      {g.distance == null ? "–" : pp(-g.distance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Note>
          A gap: the open is beyond the prior bar's high (or low) and at least 2% from the prior
          close. It fills when price later trades back through that prior high (low), the fill
          level. Close vs fill level is how far today's close ({f(close)}) sits from it.
        </Note>
      </Panel>
      <div className="grid content-start gap-4">
        <Panel
          title="Support and resistance"
          subtitle="Clusters of swing highs and lows over the last two years, nearest six"
          collapse={false}
          bodyClassName="p-0"
        >
          {levels.length === 0 ? (
            <p className="px-3.5 py-6 text-sm text-muted-foreground">
              No level with two or more touches.
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Level</th>
                  <th className={th}>Kind</th>
                  <th className={cn(th, "text-right")}>Touches</th>
                  <th className={cn(th, "text-right")}>First / last</th>
                  <th className={cn(th, "text-right")}>vs close</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((L) => (
                  <tr key={L.price} className="border-b last:border-0">
                    <td className={cn(td, "num font-medium")}>{f(L.price)}</td>
                    <td
                      className={cn(td, L.kind === "support" ? "text-positive" : "text-negative")}
                    >
                      {L.kind}
                    </td>
                    <td className={cn(td, "num text-right")}>
                      {L.touches}
                      <span className="block text-[10.5px] text-muted-foreground">
                        {L.highs} highs, {L.lows} lows
                      </span>
                    </td>
                    <td className={cn(td, "num text-right")}>
                      {L.first}
                      <span className="block text-[10.5px] text-muted-foreground">
                        {L.last} ({L.age} bars ago)
                      </span>
                    </td>
                    <td className={cn(td, "num text-right")}>{pp(L.distance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Note>
            Swing points use 5 bars either side; points within max(1% of price, 0.75 × ATR) are
            grouped. Kind is relative to today's close.
          </Note>
        </Panel>
        <Panel
          title="Trend lines"
          subtitle="Best rising support and falling resistance over the last year"
          collapse={false}
          bodyClassName="p-0"
        >
          {lines.length === 0 ? (
            <p className="px-3.5 py-6 text-sm text-muted-foreground">
              No unbroken trend line in the last year.
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Line</th>
                  <th className={cn(th, "text-right")}>Anchors</th>
                  <th className={cn(th, "text-right")}>Slope / bar</th>
                  <th className={cn(th, "text-right")}>Touches</th>
                  <th className={cn(th, "text-right")}>Today</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((t) => (
                  <tr key={t.side} className="border-b last:border-0">
                    <td
                      className={cn(td, t.side === "support" ? "text-positive" : "text-negative")}
                    >
                      {t.side === "support" ? "Rising support" : "Falling resistance"}
                    </td>
                    <td className={cn(td, "num text-right")}>
                      {t.from} at {f(t.p1)}
                      <span className="block text-[10.5px] text-muted-foreground">
                        {t.to} at {f(t.p2)}
                      </span>
                    </td>
                    <td className={cn(td, "num text-right")}>{pp(t.slopePct, 2)}</td>
                    <td className={cn(td, "num text-right")}>{t.touches}</td>
                    <td className={cn(td, "num text-right")}>
                      {f(t.now)}
                      <span className="block text-[10.5px] text-muted-foreground">
                        {pp(t.distance)} vs close
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Note>
            Lines through two swing points at least 10 bars apart that no later close breaks by more
            than half an ATR; ranked by touches.
          </Note>
        </Panel>
      </div>
    </div>
  );
}

/* ---------- event log ---------- */
export function EventLog({ H, A }: { H: Hist; A: Analysis }) {
  const rows = useMemo(() => eventRows(H, A), [H, A]);
  const [type, setType] = useState<string>("all");
  const [calc, setCalc] = useState<Calc | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = type === "all" ? rows : rows.filter((r) => r.type === type);
  const base = A.backtest.base;
  const show = (r: (typeof rows)[number]) => {
    const k0 = r.i;
    const out: (string | number)[][] = [];
    for (let k = k0; k <= Math.min(H.n - 1, k0 + 60); k++)
      out.push([H.d[k], H.c[k].toFixed(2), H.tr[k].toFixed(4), pp(H.tr[k] / H.tr[k0] - 1, 2)]);
    setCalc({
      title: `${H.sym} · ${r.name} on ${r.date}`,
      value: `${pp(r.fwd[20], 2)} after 20 days`,
      sub: `5 days ${pp(r.fwd[5], 2)} · 60 days ${pp(r.fwd[60], 2)}`,
      formula: `${TA.SIGNALS[r.type]?.text ?? r.type}. Forward return = total return index N days later ÷ on the event day − 1.`,
      cols: ["Day", "Close", "TR index", "Since event"],
      rows: out,
      hi: new Set([5, 20, 60].filter((h) => h < out.length)),
      note: "Highlighted rows are the 5-, 20- and 60-day marks.",
    });
  };
  return (
    <>
      <Panel
        title="Event log"
        subtitle={`${rows.length.toLocaleString()} signals detected since ${fmtDate(H.d[0])}, newest first, with what followed`}
        actions={
          <select
            aria-label="Signal type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-7 rounded-md border bg-card px-2 text-[12px]"
          >
            <option value="all">All signals ({rows.length})</option>
            {Object.entries(TA.SIGNALS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.name} ({counts.get(k) ?? 0})
              </option>
            ))}
          </select>
        }
        collapse={560}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="border-b text-left">
                <th className={th}>Date</th>
                <th className={th}>Signal</th>
                <th className={cn(th, "text-right")}>Close</th>
                <th className={cn(th, "text-right")}>+5 days</th>
                <th className={cn(th, "text-right")}>+20 days</th>
                <th className={cn(th, "text-right")}>+60 days</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((r) => (
                <tr key={`${r.type}-${r.i}`} className="border-b last:border-0">
                  <td className={cn(td, "num")}>{r.date}</td>
                  <td className={td}>
                    <Arrow dir={r.dir} /> {r.name}
                  </td>
                  <td className={cn(td, "num text-right")}>{f(r.close)}</td>
                  {[5, 20, 60].map((h) => (
                    <td key={h} className={cn(td, "text-right", signTone(r.fwd[h]))}>
                      {r.fwd[h] == null ? (
                        <span className="text-[11px] text-muted-foreground">pending</span>
                      ) : (
                        <NumBtn onClick={() => show(r)}>{pp(r.fwd[h], 1)}</NumBtn>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t bg-secondary/60">
                <td className={td} colSpan={3}>
                  <b>All days (base rate)</b>
                </td>
                {[5, 20, 60].map((h) => (
                  <td key={h} className={cn(td, "num text-right")}>
                    {base[h] ? pp(base[h].mean, 1) : "–"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <Note>
          Forward total returns (dividends reinvested). One event says little; the Signals tab pools
          every event of a type and tests it against the base rate.{" "}
          {shown.length > 300 ? `Showing the latest 300 of ${shown.length}.` : ""}
        </Note>
      </Panel>
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </>
  );
}

/* ---------- quant extras: everything in quant/t/{T}.json the other views do not show ---------- */
interface Dist {
  mean: number;
  sd: number;
  min: number;
  max: number;
  up: number;
  n: number;
  skew: number;
  kurt: number;
  pct?: Record<string, number>;
  beyond3: number;
  normal3: number;
}
interface CalTest {
  n: number;
  n_other: number;
  mean: number;
  mean_other: number;
  diff: number;
  t: number;
  p: number;
  hit: number;
  hit_other?: number;
  sig: string;
  dates?: string[];
}
interface MacroEv {
  title: string;
  time: string;
  source_url: string;
  n: number;
  mean: number;
  mean_abs: number;
  base_abs: number;
  abs_ratio: number;
  abs_diff_p: number;
  up_share: number;
  mean_abn: number;
  abn_p: number;
  first: string;
  last: string;
  rows: (string | number | null)[][];
}
interface MaterialItem {
  n: number;
  item: string;
  name: string;
  mean_abs_abn: number;
  abs_ratio: number;
  mean_abn: number;
  abn_p: number;
  up_share?: number;
  mean_abs_gap?: number;
}
interface Extras {
  daily?: Dist;
  daily1y?: Dist;
  acf?: { n: number; rho: number[]; band: number; lb_q: number; lb_p: number; from: string };
  vov?: { sd: number; mean: number; rel: number | null; chg_sd_ann: number | null; n: number };
  volSeries?: { d: string[]; v20: number[]; v60: number[]; v252: number[] };
  tom?: CalTest;
  pre?: CalTest;
  post?: CalTest;
  years?: [string, number, boolean, string][];
  macroRoll?: Record<string, (number | null)[] | string[]> & { d: string[] };
  benchRoll: [
    string,
    {
      d: string[];
      c63: (number | null)[];
      b63: (number | null)[];
      c252: (number | null)[];
      b252: (number | null)[];
    },
  ][];
  macroEv: [string, MacroEv][];
  macroCols: string[];
  material?: { basis: string; items: MaterialItem[] };
}
export function quantExtras(Q: QuantFile): Extras {
  const s = Q.stats as Record<string, unknown>;
  const se = Q.season as Record<string, unknown>;
  const ev = Q.events as unknown as Record<string, unknown>;
  const corr = Q.corr as unknown as Record<string, unknown>;
  const macro = (ev.macro ?? {}) as Record<string, unknown>;
  const bench = (corr.bench ?? {}) as Record<string, { roll?: Extras["benchRoll"][number][1] }>;
  return {
    daily: s.daily as Dist | undefined,
    daily1y: s.daily_1y as Dist | undefined,
    acf: s.acf as Extras["acf"],
    vov: s.vov as Extras["vov"],
    volSeries: s.vol_series as Extras["volSeries"],
    tom: se.tom as CalTest | undefined,
    pre: se.pre_holiday as CalTest | undefined,
    post: se.post_holiday as CalTest | undefined,
    years: se.years as Extras["years"],
    macroRoll: corr.macro_roll as Extras["macroRoll"],
    benchRoll: Object.entries(bench)
      .filter(([, v]) => v.roll?.d?.length)
      .map(([k, v]) => [k, v.roll!]),
    macroEv: Object.entries(macro).filter(
      ([k, v]) => k !== "cols" && v && typeof v === "object" && "n" in (v as object),
    ) as [string, MacroEv][],
    macroCols: (macro.cols as string[]) ?? [],
    material: ev.material as Extras["material"],
  };
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const sigTone = (p: number | null | undefined) =>
  ok(p) && p < 0.05 ? "font-medium" : "text-muted-foreground";

export function QuantExtras({
  Q,
  methods,
}: {
  Q: QuantFile;
  methods?: Record<string, string> | null;
}) {
  const X = useMemo(() => quantExtras(Q), [Q]);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [benchWin, setBenchWin] = useState<"252" | "63">("252");
  const macroLabel = (k: string) => Q.corr.macro[k]?.label ?? k;
  const volLines = useMemo(
    () =>
      X.volSeries
        ? (["v20", "v60", "v252"] as const).map((k, j) => ({
            key: k,
            label: k === "v20" ? "20-day" : k === "v60" ? "60-day" : "252-day",
            color: PALETTE[j],
            points: X.volSeries!.d.map((x, i) => ({ x, y: X.volSeries![k][i] ?? null })),
          }))
        : [],
    [X.volSeries],
  );
  const macroLines = useMemo(
    () =>
      X.macroRoll
        ? Object.keys(X.macroRoll)
            .filter((k) => k !== "d")
            .map((k, j) => ({
              key: k,
              label: macroLabel(k),
              color: PALETTE[j % PALETTE.length],
              points: X.macroRoll!.d.map((x, i) => ({
                x,
                y: (X.macroRoll![k] as (number | null)[])[i] ?? null,
              })),
            }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [X.macroRoll],
  );
  const benchLines = useMemo(
    () =>
      X.benchRoll.flatMap(([k, r], j) => [
        {
          key: `${k}-b`,
          label: `${k} beta`,
          color: PALETTE[(2 * j) % PALETTE.length],
          points: r.d.map((x, i) => ({ x, y: (benchWin === "252" ? r.b252 : r.b63)[i] ?? null })),
        },
        {
          key: `${k}-c`,
          label: `${k} corr`,
          color: PALETTE[(2 * j + 1) % PALETTE.length],
          points: r.d.map((x, i) => ({ x, y: (benchWin === "252" ? r.c252 : r.c63)[i] ?? null })),
        },
      ]),
    [X.benchRoll, benchWin],
  );
  const macroCalc = (k: string, m: MacroEv) => {
    const c = (n: string) => X.macroCols.indexOf(n);
    setCalc({
      title: `${Q.sym} · ${m.title} release days`,
      value: `${pp(m.mean, 2)} average`,
      sub: `${m.n} releases, ${m.first} to ${m.last} · ${m.time}`,
      formula:
        methods?.macro_events ??
        "Same-day total return on the first trading day on or after each release; abnormal = r − beta × r_SPY.",
      cols: ["Release", "Trading day", "Return", "SPY", "Abnormal"],
      rows: [...m.rows]
        .reverse()
        .map((r) => [
          String(r[c("release")] ?? ""),
          String(r[c("day0")] ?? ""),
          pp(r[c("ret")] as number, 2),
          pp(r[c("spy")] as number, 2),
          pp(r[c("abn")] as number, 2),
        ]),
      link: { url: m.source_url, label: "Release calendar" },
    });
  };
  const distRows: [string, (d: Dist) => string][] = [
    ["Days", (d) => d.n.toLocaleString()],
    ["Mean", (d) => pp(d.mean, 3)],
    ["SD", (d) => pc(d.sd, 2)],
    ["Up share", (d) => pc(d.up)],
    ["Skew", (d) => f(d.skew)],
    ["Excess kurtosis", (d) => f(d.kurt)],
    ["1st percentile", (d) => pp(d.pct?.["1"], 2)],
    ["5th percentile", (d) => pp(d.pct?.["5"], 2)],
    ["Median", (d) => pp(d.pct?.["50"], 2)],
    ["95th percentile", (d) => pp(d.pct?.["95"], 2)],
    ["99th percentile", (d) => pp(d.pct?.["99"], 2)],
    ["Worst / best day", (d) => `${pp(d.min, 1)} / ${pp(d.max, 1)}`],
    ["Days beyond 3 SD (normal)", (d) => `${d.beyond3} (${f(d.normal3, 1)})`],
  ];
  const cal: [string, CalTest | undefined][] = [
    ["Turn of month (last day + first 3)", X.tom],
    ["Day before a market holiday", X.pre],
    ["Day after a market holiday", X.post],
  ];
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        {(X.daily || X.daily1y) && (
          <Panel
            title="Daily return distribution"
            subtitle="Full history against the last year"
            collapse={false}
            bodyClassName="p-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Statistic</th>
                  <th className={cn(th, "text-right")}>Full history</th>
                  <th className={cn(th, "text-right")}>Last 252 days</th>
                </tr>
              </thead>
              <tbody>
                {distRows.map(([l, fn]) => (
                  <tr key={l} className="border-b last:border-0">
                    <td className={cn(td, "text-muted-foreground")}>{l}</td>
                    <td className={cn(td, "num text-right")}>{X.daily ? fn(X.daily) : "–"}</td>
                    <td className={cn(td, "num text-right")}>{X.daily1y ? fn(X.daily1y) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>
              {methods?.daily_1y ?? "Daily total returns."} Kurtosis is excess over the normal (0 =
              normal tails).
            </Note>
          </Panel>
        )}
        {(X.acf || X.vov) && (
          <Panel
            title="Return dependence"
            subtitle="Do daily returns carry over into the next days?"
            collapse={false}
            bodyClassName="p-0"
          >
            {X.acf && (
              <div className="px-3.5 py-3">
                <div
                  className="flex h-24 items-center gap-1"
                  role="img"
                  aria-label="Autocorrelation by lag"
                >
                  {X.acf.rho.map((r, k) => {
                    const hgt = Math.min(1, Math.abs(r) / Math.max(X.acf!.band * 2, 0.1));
                    const out = Math.abs(r) > X.acf!.band;
                    return (
                      <div
                        key={k}
                        className="flex h-full flex-1 flex-col items-center"
                        title={`Lag ${k + 1}: ${f(r, 3)}`}
                      >
                        <div className="flex h-1/2 w-full items-end justify-center">
                          {r > 0 && (
                            <div
                              className={cn(
                                "w-3/5 rounded-t-sm",
                                out ? "bg-foreground" : "bg-muted-foreground/40",
                              )}
                              style={{ height: `${hgt * 100}%` }}
                            />
                          )}
                        </div>
                        <div className="h-px w-full bg-border" />
                        <div className="flex h-1/2 w-full items-start justify-center">
                          {r < 0 && (
                            <div
                              className={cn(
                                "w-3/5 rounded-b-sm",
                                out ? "bg-foreground" : "bg-muted-foreground/40",
                              )}
                              style={{ height: `${hgt * 100}%` }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 flex gap-1 text-center text-[10px] text-muted-foreground">
                  {X.acf.rho.map((_, k) => (
                    <span key={k} className="flex-1">
                      {k + 1}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[12px]">
                  Ljung-Box Q(10) <span className="num">{f(X.acf.lb_q, 1)}</span>, p{" "}
                  <span className={cn("num", sigTone(X.acf.lb_p))}>{f(X.acf.lb_p, 3)}</span>:{" "}
                  {X.acf.lb_p < 0.05
                    ? "returns are autocorrelated beyond chance at some lag."
                    : "no autocorrelation beyond chance."}{" "}
                  Dark bars sit outside ±{f(X.acf.band, 3)} (95% band), {X.acf.n.toLocaleString()}{" "}
                  returns since {fmtDate(X.acf.from)}.
                </p>
              </div>
            )}
            <table className="w-full border-t text-[12.5px]">
              <tbody>
                {Q.stats.vr?.map((v) => (
                  <tr key={v.q} className="border-b">
                    <td className={cn(td, "text-muted-foreground")}>Variance ratio, {v.q} days</td>
                    <td className={cn(td, "num text-right")}>{f(v.vr)}</td>
                    <td className={cn(td, "num text-right", sigTone(v.p))}>p {f(v.p, 3)}</td>
                  </tr>
                ))}
                {Q.stats.hurst && (
                  <tr className="border-b">
                    <td className={cn(td, "text-muted-foreground")}>Hurst exponent</td>
                    <td className={cn(td, "num text-right")}>{f(Q.stats.hurst.h)}</td>
                    <td className={cn(td, "num text-right text-muted-foreground")}>
                      R² {f(Q.stats.hurst.r2)}
                    </td>
                  </tr>
                )}
                {X.vov && (
                  <tr>
                    <td className={cn(td, "text-muted-foreground")}>
                      Volatility of 20-day volatility
                    </td>
                    <td className={cn(td, "num text-right")}>{pc(X.vov.sd, 1)}</td>
                    <td className={cn(td, "num text-right text-muted-foreground")}>
                      {X.vov.rel != null ? `${f(X.vov.rel)}× its mean` : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Note>
              Variance ratio 1 and Hurst 0.5 match a random walk; above means moves tend to
              continue, below that they tend to reverse. {methods?.vov ?? ""}
            </Note>
          </Panel>
        )}
      </div>

      {volLines.length > 0 && (
        <Panel
          title="Realized volatility over time"
          subtitle="Annualized, weekly samples"
          collapse={false}
          bodyClassName="p-2"
        >
          <MultiLine
            series={volLines}
            height={220}
            format={(v) => pc(v, 0)}
            xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
            label={`${Q.sym} realized volatility`}
          />
        </Panel>
      )}

      {(benchLines.length > 0 || macroLines.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {benchLines.length > 0 && (
            <Panel
              title="Rolling beta and correlation"
              subtitle="Against the market and the sector fund"
              actions={
                <Segmented
                  size="xs"
                  label="Window"
                  value={benchWin}
                  onChange={setBenchWin}
                  options={[
                    { v: "252", l: "1 year" },
                    { v: "63", l: "3 months" },
                  ]}
                />
              }
              collapse={false}
              bodyClassName="p-2"
            >
              <MultiLine
                series={benchLines}
                height={220}
                format={(v) => f(v)}
                xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
                label="Rolling beta and correlation"
              />
            </Panel>
          )}
          {macroLines.length > 0 && (
            <Panel
              title="Rolling correlation with macro markets"
              subtitle="252-day window of daily changes, monthly samples"
              collapse={false}
              bodyClassName="p-2"
            >
              <MultiLine
                series={macroLines}
                height={220}
                format={(v) => f(v)}
                baseline={0}
                xFormat={(x) => fmtDate(x, { month: "short", year: "2-digit" })}
                label="Rolling macro correlations"
              />
            </Panel>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {cal.some(([, c]) => c) && (
          <Panel
            title="Calendar effects"
            subtitle="Average daily return on these days against all others"
            collapse={false}
            bodyClassName="p-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Days</th>
                  <th className={cn(th, "text-right")}>n</th>
                  <th className={cn(th, "text-right")}>Average</th>
                  <th className={cn(th, "text-right")}>Other days</th>
                  <th className={cn(th, "text-right")}>Up share</th>
                  <th className={cn(th, "text-right")}>p</th>
                </tr>
              </thead>
              <tbody>
                {cal.map(([l, c]) =>
                  c ? (
                    <tr key={l} className="border-b last:border-0">
                      <td className={td}>
                        {l}
                        <span className="block text-[10.5px] text-muted-foreground">{c.sig}</span>
                      </td>
                      <td className={cn(td, "num text-right")}>{c.n.toLocaleString()}</td>
                      <td className={cn(td, "num text-right", signTone(c.mean))}>
                        {pp(c.mean, 3)}
                      </td>
                      <td className={cn(td, "num text-right")}>{pp(c.mean_other, 3)}</td>
                      <td className={cn(td, "num text-right")}>{pc(c.hit)}</td>
                      <td className={cn(td, "num text-right", sigTone(c.p))}>{f(c.p, 3)}</td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
            <Note>
              Welch t test of the difference in means. With many calendar tests, an occasional p
              below 0.05 is expected by chance.
            </Note>
          </Panel>
        )}
        {X.years && X.years.length > 0 && (
          <Panel
            title="Calendar-year returns"
            subtitle="Total return, dividends reinvested"
            collapse={false}
            bodyClassName="p-0"
          >
            <div className="grid grid-cols-4 gap-px bg-border sm:grid-cols-5">
              {[...X.years].reverse().map(([y, r, partial, last]) => (
                <div
                  key={y}
                  className="bg-card px-2.5 py-1.5"
                  title={partial ? `First year, from the first bar to ${last}` : `To ${last}`}
                >
                  <p className="text-[10.5px] text-muted-foreground">
                    {y}
                    {partial || last.slice(5) < "12-24" ? " (part)" : ""}
                  </p>
                  <p className={cn("num text-[13px] font-medium", signTone(r))}>{pp(r, 1)}</p>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {X.macroEv.length > 0 && (
          <Panel
            title="Macro release days"
            subtitle="Same-day moves on CPI, jobs report and FOMC days"
            collapse={false}
            bodyClassName="p-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Release</th>
                  <th className={cn(th, "text-right")}>n</th>
                  <th className={cn(th, "text-right")}>Average</th>
                  <th className={cn(th, "text-right")}>Abs. move vs other days</th>
                  <th className={cn(th, "text-right")}>Abnormal</th>
                </tr>
              </thead>
              <tbody>
                {X.macroEv.map(([k, m]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className={td}>
                      {m.title}
                      <span className="block text-[10.5px] text-muted-foreground">{m.time}</span>
                    </td>
                    <td className={cn(td, "text-right")}>
                      <NumBtn onClick={() => macroCalc(k, m)}>{m.n}</NumBtn>
                    </td>
                    <td className={cn(td, "text-right", signTone(m.mean))}>
                      <NumBtn onClick={() => macroCalc(k, m)}>{pp(m.mean, 2)}</NumBtn>
                      <span className="block text-[10.5px] text-muted-foreground">
                        up {pc(m.up_share)}
                      </span>
                    </td>
                    <td className={cn(td, "num text-right")}>
                      {f(m.abs_ratio)}×
                      <span className={cn("block text-[10.5px]", sigTone(m.abs_diff_p))}>
                        p {f(m.abs_diff_p, 3)}
                      </span>
                    </td>
                    <td className={cn(td, "num text-right", signTone(m.mean_abn))}>
                      {pp(m.mean_abn, 2)}
                      <span className={cn("block text-[10.5px]", sigTone(m.abn_p))}>
                        p {f(m.abn_p, 3)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>
              Abs. move ratio above 1 means the stock moves more on release days than on other days.
              Click a count for every release.
            </Note>
          </Panel>
        )}
        {X.material && X.material.items.length > 0 && (
          <Panel
            title="Reactions to other 8-K filings"
            subtitle="By item code, excluding earnings (Item 2.02)"
            collapse={420}
            bodyClassName="p-0"
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left">
                  <th className={th}>Item</th>
                  <th className={cn(th, "text-right")}>Filings</th>
                  <th className={cn(th, "text-right")}>Avg abnormal</th>
                  <th className={cn(th, "text-right")}>Abs. vs typical day</th>
                </tr>
              </thead>
              <tbody>
                {[...X.material.items]
                  .sort((a, b) => b.n - a.n)
                  .map((m) => (
                    <tr key={m.item} className="border-b last:border-0">
                      <td className={td}>
                        <span className="num">{m.item}</span> {m.name}
                      </td>
                      <td className={cn(td, "num text-right")}>{m.n}</td>
                      <td className={cn(td, "num text-right", signTone(m.mean_abn))}>
                        {pp(m.mean_abn, 2)}
                        <span className={cn("block text-[10.5px]", sigTone(m.abn_p))}>
                          p {f(m.abn_p, 3)}
                        </span>
                      </td>
                      <td className={cn(td, "num text-right")}>
                        {f(m.abs_ratio)}×
                        <span className="block text-[10.5px] text-muted-foreground">
                          {pc(m.mean_abs_abn, 2)} avg abs.
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <Note>
              {X.material.basis}. {methods?.material ?? ""}
            </Note>
          </Panel>
        )}
      </div>
      <CalcSheet calc={calc} onClose={() => setCalc(null)} />
    </>
  );
}
