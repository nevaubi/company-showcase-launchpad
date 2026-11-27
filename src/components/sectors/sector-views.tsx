import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BREAKDOWN_METRICS,
  breakdown,
  bankRevenueEvidence,
  compQuery,
  fmtMetric,
  noteParts,
  historicalNotesQuery,
  overviewQuery,
  qLabel,
  type GroupFile,
  type Note,
  type Overview,
} from "@/lib/sectors/groups";
import { noteWeek, releaseNotes } from "@/lib/sectors/notes";
import { placeLabels } from "@/lib/sectors/labels";
import { Section, useWidth } from "./ui";

/* ---------- relative rotation graph ---------- */
const QUAD = [
  { l: "Leading", x: 1, y: 1, c: "var(--positive)" },
  { l: "Weakening", x: 1, y: -1, c: "var(--chart-4)" },
  { l: "Lagging", x: -1, y: -1, c: "var(--negative)" },
  { l: "Improving", x: -1, y: 1, c: "var(--chart-1)" },
];
const quadOf = (ratio: number, mom: number) => QUAD.find((q) => (ratio >= 100 ? q.x > 0 : q.x < 0) && (mom >= 100 ? q.y > 0 : q.y < 0))!;

/**
 * Weekly relative rotation of the sector ETFs against SPY. Trails are quiet; the latest point and its label
 * take the colour of the quadrant it sits in, so eleven sectors never need eleven hues.
 */
export function RotationGraph({ ov, tail, onTail }: { ov: Overview; tail: "4w" | "10w"; onTail: (t: "4w" | "10w") => void }) {
  const weeks = tail === "10w" ? 10 : 4;
  const [ref, W] = useWidth<HTMLDivElement>();
  const navigate = useNavigate();
  const sectors = ov.groups.filter((g) => g.kind === "sector" && g.etf && ov.etf_rrg?.[g.etf]?.length);
  const pts = sectors.flatMap((g) => ov.etf_rrg[g.etf!].slice(-weeks));
  if (!pts.length) return null;
  const H = 320;
  const m = 24;
  const xs = pts.map((p) => p[1]);
  const ys = pts.map((p) => p[2]);
  const span = Math.max(2, ...xs.map((v) => Math.abs(v - 100)), ...ys.map((v) => Math.abs(v - 100))) * 1.12;
  const x = (v: number) => m + ((v - (100 - span)) / (2 * span)) * (W - 2 * m);
  const y = (v: number) => m + ((100 + span - v) / (2 * span)) * (H - 2 * m);
  const week = pts.reduce((a, p) => (p[0] > a ? p[0] : a), "");
  // Labels beside their point, the furthest-right sector first, stepped by whole lines until no two boxes overlap.
  const order = [...sectors].sort((a, b) => ov.etf_rrg[b.etf!].at(-1)![1] - ov.etf_rrg[a.etf!].at(-1)![1]);
  const labels = new Map(
    placeLabels(
      order.map((g) => {
        const last = ov.etf_rrg[g.etf!].at(-1)!;
        return { id: g.slug, x: x(last[1]), y: y(last[2]), w: g.etf!.length * 7 + 1 };
      }),
      { left: 0, right: W, top: 0, bottom: H },
    ).map((l) => [l.id, l]),
  );
  return (
    <Section
      id="rotation"
      name="Sector rotation"
      title="Sector rotation"
      caption={`Weekly relative strength against SPY (across) and its momentum (up) · week of ${fmtDate(week)}`}
      actions={
        <Segmented
          size="xs"
          label="Rotation tail"
          value={tail}
          onChange={onTail}
          options={[
            { v: "4w", l: "4 wk" },
            { v: "10w", l: "10 wk" },
          ]}
        />
      }
    >
      <div ref={ref} className="px-3.5 py-2">
        {W > 0 && (
          <svg width={W} height={H} role="img" aria-label="Relative rotation graph of the sector ETFs">
            {QUAD.map((q) => (
              <g key={q.l}>
                <rect x={q.x > 0 ? x(100) : m} y={q.y > 0 ? m : y(100)} width={(W - 2 * m) / 2} height={(H - 2 * m) / 2} fill={q.c} opacity={0.045} />
                <text x={q.x > 0 ? W - m - 4 : m + 4} y={q.y > 0 ? m + 13 : H - m - 6} textAnchor={q.x > 0 ? "end" : "start"} fontSize={11} fontWeight={600} fill={q.c}>
                  {q.l}
                </text>
              </g>
            ))}
            <line x1={x(100)} x2={x(100)} y1={m} y2={H - m} stroke="var(--rule)" />
            <line x1={m} x2={W - m} y1={y(100)} y2={y(100)} stroke="var(--rule)" />
            {sectors.map((g) => {
              const tr = ov.etf_rrg[g.etf!].slice(-weeks);
              const last = tr[tr.length - 1];
              const c = quadOf(last[1], last[2]).c;
              const lab = labels.get(g.slug);
              return (
                <g
                  key={g.slug}
                  role="link"
                  tabIndex={0}
                  aria-label={`${g.name}, ${quadOf(last[1], last[2]).l.toLowerCase()}: open the sector`}
                  className="cursor-pointer outline-none [&:focus-visible>circle:last-of-type]:stroke-[var(--ring)]"
                  onClick={() => navigate({ to: "/app/sectors/$sector", params: { sector: g.sector } })}
                  onKeyDown={(e) => e.key === "Enter" && navigate({ to: "/app/sectors/$sector", params: { sector: g.sector } })}
                >
                  <path d={tr.map((p, k) => `${k ? "L" : "M"}${x(p[1])},${y(p[2])}`).join("")} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.45} />
                  {tr.slice(0, -1).map((p) => (
                    <circle key={p[0]} cx={x(p[1])} cy={y(p[2])} r={1.6} fill="var(--muted-foreground)" opacity={0.5} />
                  ))}
                  <circle cx={x(last[1])} cy={y(last[2])} r={4.5} fill={c} stroke="var(--background)" strokeWidth={1.5} />
                  <text x={lab?.x ?? x(last[1]) + 7} y={lab?.y ?? y(last[2]) + 3.5} textAnchor={lab?.anchor ?? "start"} fontSize={11} fontWeight={600} fill="var(--foreground)">
                    {g.etf}
                  </text>
                  <title>{`${g.name} (${g.etf}) · week of ${last[0]}: RS-ratio ${last[1].toFixed(1)}, RS-momentum ${last[2].toFixed(1)}`}</title>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="border-t px-3.5 py-2 text-[11px] leading-4 text-muted-foreground">
        Ratio above 100: ahead of SPY over 13 weeks. Momentum above 100: the lead is growing. Groups tend to turn clockwise through improving,
        leading, weakening and lagging. Grey trails show the last {weeks} weeks; click a sector to open it.
      </p>
    </Section>
  );
}

/* ---------- weekly notes ---------- */
/**
 * The current week's notes (the newest week in the file); earlier weeks are not shown. `only` keeps one
 * sector's note (a sector page, or an industry page showing its sector's note). Renders nothing when
 * there is no current note, so the caller can give its neighbour the row.
 */
type NoteFact = Note["facts"][string] | undefined;
const isAgg = (f: NoteFact): f is NonNullable<NoteFact> & { ref: { type: "agg"; metric: string; q?: string } } => f?.ref?.type === "agg" && !!f.ref.metric;

export function SectorNotes({ only, onlyName }: { only?: string; onlyName?: string }) {
  const q = useQuery(overviewQuery);
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const nw = useMemo(() => noteWeek(releaseNotes(q.data), { only }), [q.data, only]);
  const [viewHistory, setViewHistory] = useState(false);
  const history = useQuery({ ...historicalNotesQuery, enabled: viewHistory });
  const earlier = (history.data?.notes ?? []).filter((n) => (!only || n.slug === only) && n.week < (nw.week ?? "")).sort((a, b) => b.week.localeCompare(a.week));
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!nw.week || !nw.notes.length) return null;
  return (
    <Section
      id="notes"
      name="Weekly notes"
      title={only ? (onlyName ? `Sector note · ${onlyName}` : "Sector note") : "Sector notes"}
      caption={`Filing review as of ${fmtDate(nw.week)} · select a figure to inspect its contributors`}
    >
      <div className={cn("grid grid-cols-1 gap-px bg-border", !only && "md:grid-cols-2")}>
        {nw.notes.map((n) => (
          <article key={`${n.slug}-${n.week}`} className="min-w-0 bg-card px-3.5 py-3">
            <p className="text-[11px] text-muted-foreground">{n.sector}</p>
            <h3 className="mt-0.5 text-[13px] font-semibold leading-snug">
              <Link to="/app/sectors/$sector" params={{ sector: n.sector }} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {n.title}
              </Link>
            </h3>
            <p className="mt-1.5 text-[13px] leading-7 text-muted-foreground">
              {noteParts(n).map((p, i) =>
                typeof p === "string" ? (
                  <Fragment key={i}>{p}</Fragment>
                ) : !isAgg(n.facts[p.id]) && matchRoute({ to: "/app/sectors/$sector", params: { sector: n.sector } }) ? (
                  <span key={i} title={p.label} className="num font-medium text-foreground">
                    {p.text}
                  </span>
                ) : (
                  <button
                    key={i}
                    type="button"
                    title={p.label}
                    onClick={() => {
                      const f = n.facts[p.id];
                      const agg = isAgg(f) ? { m: f.ref.metric, q: f.ref.q } : null;
                      // On this sector's own page a figure only opens its breakdown: keep the view and the scroll position.
                      const here = !!matchRoute({ to: "/app/sectors/$sector", params: { sector: n.sector } });
                      if (here) {
                        if (agg) navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, ...agg }) as never, resetScroll: false });
                        return;
                      }
                      navigate({ to: "/app/sectors/$sector", params: { sector: n.sector }, search: agg ?? {} });
                    }}
                    className="num inline-flex h-7 items-center rounded-sm px-0.5 align-baseline font-medium text-foreground underline decoration-dotted underline-offset-2 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.text}
                  </button>
                ),
              )}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {n.model} · {fmtDate(n.generated_at.slice(0, 10))}
            </p>
          </article>
        ))}
      </div>
      <details className="border-t px-3.5 py-2 text-xs" onToggle={(e) => setViewHistory(e.currentTarget.open)}>
        <summary className="cursor-pointer text-muted-foreground">Earlier weekly commentary</summary>
        {viewHistory && (history.isLoading ? <Skeleton className="mt-2 h-8" /> : history.isError ? <p className="mt-2">Historical notes are unavailable.</p> :
          earlier.length ? earlier.slice(0, only ? 8 : 12).map((n) => <div key={n.slug + n.week} className="mt-2 border-t pt-2">
            <p className="text-muted-foreground">Archived · week of {fmtDate(n.week)} · {n.sector}</p>
            <p className="mt-1 font-medium">{n.title}</p>
            <p className="mt-1 leading-relaxed">{noteParts(n).map((p) => typeof p === "string" ? p : p.text).join("")}</p>
          </div>) : <p className="mt-2">No earlier dated commentary is available.</p>)}
      </details>
    </Section>
  );
}

/** Whether a note will show for this selection, so a page can lay out the row before the notes render. */
export function useHasNotes(only?: string) {
  const q = useQuery(overviewQuery);
  return q.isLoading ? null : noteWeek(releaseNotes(q.data), { only }).notes.length > 0;
}

/* ---------- quarterly aggregates with the breakdown behind each point ---------- */
export const TREND_METRICS = ["rev_growth", "ni_growth", "pct_rev_up", "gm", "om", "nm", "fcfm", "roic", "roe", "nd_ebitda", "pe", "ps", "pfcf"];
/** Short names for the metric buttons; the full name is the button's title and the chart's caption. */
const TREND_SHORT: Record<string, string> = {
  rev_growth: "Rev growth",
  ni_growth: "NI growth",
  pct_rev_up: "% growing",
  gm: "Gross m.",
  om: "Op m.",
  nm: "Net m.",
  fcfm: "FCF m.",
  roic: "ROIC",
  roe: "ROE",
  nd_ebitda: "ND/EBITDA",
  pe: "P/E",
  ps: "P/S",
  pfcf: "P/FCF",
};

export function AggregateTrends({
  g,
  metric,
  q,
  span,
  onSpan,
  onPick,
}: {
  g: GroupFile;
  metric: string;
  q?: string;
  span: "5y" | "10y" | "all";
  onSpan: (s: "5y" | "10y" | "all") => void;
  onPick: (m: string, q?: string) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const s = g.agg[metric];
  const unit = g.metrics[metric]?.unit;
  const idx = g.quarters.map((_, i) => i).filter((i) => s?.agg[i] != null);
  const show = span === "all" ? idx : idx.slice(span === "5y" ? -20 : -40);
  const vals = show.map((i) => s.agg[i]!).concat(show.map((i) => s.med[i]).filter((v): v is number => v != null));
  const H = 220;
  const m = { t: 12, r: 12, b: 24, l: 52 };
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals, 0);
  const pad = (hi - lo) * 0.08 || 0.01;
  const x = (k: number) => m.l + (k / Math.max(1, show.length - 1)) * (W - m.l - m.r);
  const y = (v: number) => m.t + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - m.t - m.b);
  const sel = q ? g.quarters.indexOf(q) : show[show.length - 1];
  const canBreak = BREAKDOWN_METRICS.has(metric);
  const last = show.at(-1);
  return (
    <Section
      id="trends"
      name="Quarterly aggregates"
      title="Quarterly aggregates"
      caption={`${g.metrics[metric]?.name ?? metric}: aggregate (solid), company median (dashed)${last != null ? ` · ${qLabel(g.quarters[last])}: ${s.n[last]} / ${g.constituents.length} companies` : ""}${canBreak ? " · click a quarter for the companies behind it" : ""}`}
      actions={
        <>
          <Segmented
            size="xs"
            label="Trend span"
            value={span}
            onChange={onSpan}
            options={[
              { v: "5y", l: "5Y" },
              { v: "10y", l: "10Y" },
              { v: "all", l: "All" },
            ]}
          />
        </>
      }
    >
      <div role="radiogroup" aria-label="Metric" className="flex flex-wrap gap-1 border-b px-3.5 py-2">
        {TREND_METRICS.filter((k) => g.agg[k]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === metric}
            title={g.metrics[k]?.name ?? k}
            onClick={() => onPick(k, q)}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-2 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              k === metric ? "bg-secondary font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {TREND_SHORT[k] ?? g.metrics[k]?.name ?? k}
          </button>
        ))}
      </div>
      <div ref={ref} className="px-3.5 py-2">
        {!s || show.length < 2 ? (
          <p className="py-6 text-center text-[12px] text-muted-foreground">Not enough quarters reported for this metric.</p>
        ) : (
          W > 0 && (
            <svg width={W} height={H} role="img" aria-label={`${g.name} ${g.metrics[metric]?.name}, latest ${fmtMetric(last != null ? s.agg[last] : null, unit)}`}>
              {[lo, (lo + hi) / 2, hi].map((v) => (
                <g key={v}>
                  <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
                  <text x={m.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                    {fmtMetric(v, unit, 0)}
                  </text>
                </g>
              ))}
              {lo < 0 && <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule)" />}
              <path
                d={show.map((i, k) => (s.med[i] == null ? "" : `${k && s.med[show[k - 1]] != null ? "L" : "M"}${x(k)},${y(s.med[i]!)}`)).join("")}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                strokeWidth={1.2}
              />
              <path d={show.map((i, k) => `${k ? "L" : "M"}${x(k)},${y(s.agg[i]!)}`).join("")} fill="none" stroke="var(--chart-1)" strokeWidth={1.8} />
              {show.map((i, k) => (
                <g
                  key={i}
                  className={canBreak ? "cursor-pointer outline-none [&:focus-visible>circle]:stroke-foreground [&:focus-visible>circle]:stroke-2" : undefined}
                  onClick={() => canBreak && onPick(metric, g.quarters[i])}
                  {...(canBreak
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-label": `${qLabel(g.quarters[i])}: ${fmtMetric(s.agg[i], unit)}, open the companies behind it`,
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onPick(metric, g.quarters[i]);
                          }
                        },
                      }
                    : {})}
                >
                  <rect x={x(k) - (W - m.l - m.r) / show.length / 2} y={m.t} width={(W - m.l - m.r) / show.length} height={H - m.t - m.b} fill="transparent" />
                  <circle cx={x(k)} cy={y(s.agg[i]!)} r={i === sel ? 4.5 : 2.5} fill="var(--chart-1)" stroke={i === sel ? "var(--background)" : undefined} />
                  <title>{`${qLabel(g.quarters[i])}: ${fmtMetric(s.agg[i], unit)} aggregate, ${fmtMetric(s.med[i], unit)} median · ${s.n[i]} of ${g.constituents.length} companies`}</title>
                </g>
              ))}
              {last != null && (
                <text x={W - m.r} y={Math.max(m.t + 10, y(s.agg[last]!) - 8)} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--chart-1)">
                  {fmtMetric(s.agg[last], unit)}
                </text>
              )}
              {[0, Math.floor((show.length - 1) / 2), show.length - 1].map((k, j) => (
                <text key={j} x={x(k)} y={H - 6} textAnchor={j === 0 ? "start" : j === 2 ? "end" : "middle"} fontSize={10} fill="var(--muted-foreground)">
                  {qLabel(g.quarters[show[k]])}
                </text>
              ))}
            </svg>
          )
        )}
      </div>
    </Section>
  );
}

function BankSourceDetail({ records }: { records: ReturnType<typeof bankRevenueEvidence> }) {
  const [selection, setSelection] = useState("");
  const selected = records.find((r) => r.ticker === selection) ?? records[0];
  if (!selected) return null;
  return (
    <details className="my-3 rounded-md border px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">Bank revenue filings · {records.length} companies</summary>
      <div className="mt-3 flex items-center justify-between gap-2">
        <label htmlFor="bank-source-issuer">Inspect filing inputs</label>
        <select id="bank-source-issuer" className="rounded border bg-background px-2 py-1" value={selected.ticker} onChange={(event) => setSelection(event.target.value)}>
          {records.map(({ ticker }) => <option key={ticker}>{ticker}</option>)}
        </select>
      </div>
      <p className="my-2 leading-relaxed text-muted-foreground">
        Each period adds GAAP net interest income before provisions and noninterest income from the same filing. Amounts in USD.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="border-b text-right text-muted-foreground"><tr><th className="py-1 text-left">Filing period</th><th>Net interest</th><th>Noninterest</th><th>Net revenue</th></tr></thead>
          <tbody>
            {selected.parts.map(({ label, point }) => (
              <tr key={point.accession + point.start + point.end} className="border-b">
                <td className="py-2 pr-2"><a href={point.filing_url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{label} · {point.form}</a>
                  <div className="mt-0.5 text-muted-foreground">{point.start} – {point.end}</div>
                </td>
                {[point.InterestIncomeExpenseNet, point.NoninterestIncome, point.net_revenue].map((v, index) => (
                  <td className="num whitespace-nowrap text-right" key={index} title={v.toLocaleString("en-US") + " USD"}>{fmtMetric(v, "usd")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected.trailing != null && <p className="mt-2 text-right font-medium">Trailing net revenue <span className="num">{fmtMetric(selected.trailing, "usd")}</span></p>}
    </details>
  );
}

export function BreakdownSheet({ g, metric, q, onClose }: { g: GroupFile; metric: string; q: string | null; onClose: () => void }) {
  const comp = useQuery({ ...compQuery(g.slug), enabled: !!q });
  const navigate = useNavigate();
  const b = useMemo(() => (q && comp.data ? breakdown(g, comp.data, metric, q) : null), [g, comp.data, metric, q]);
  const unit = g.metrics[metric]?.unit;
  const pub = q ? g.agg[metric]?.agg[g.quarters.indexOf(q)] : null;
  const growth = metric === "rev_growth" || metric === "ni_growth";
  return (
    <Sheet open={!!q} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-section="Aggregate breakdown">
        <SheetHeader>
          <SheetTitle>
            {g.name} · {g.metrics[metric]?.name} · {q ? qLabel(q) : ""}
          </SheetTitle>
          <SheetDescription>
            Published aggregate <span className="num font-medium text-foreground">{fmtMetric(pub, unit)}</span>
            {b && (
              <>
                {" "}
                · {b.rows.length} of {g.constituents.length} companies contributed: <span className="num font-medium text-foreground">{fmtMetric(b.value, unit)}</span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>
        {!b ? (
          comp.isError ? (
            <p className="mt-4 text-[12px] text-muted-foreground">The company inputs for this group are not available right now.</p>
          ) : (
            <Skeleton className="mt-4 h-64" />
          )
        ) : (
          <div className="mt-3">
            <p className="mb-2 text-[12px] text-muted-foreground">
              {growth ? `Σ ${b.numL} ÷ Σ ${b.denL} − 1` : `Σ ${b.numL} ÷ Σ ${b.denL}`}: {fmtMetric(b.rows.reduce((s, x) => s + x.num, 0), "usd")} ÷{" "}
              {fmtMetric(b.rows.reduce((s, x) => s + x.den, 0), "usd")}. Companies sorted by their weight in the denominator; each company's inputs come
              from its own filings for the fiscal quarter ending nearest the calendar quarter.
            </p>
            {comp.data && <BankSourceDetail records={bankRevenueEvidence(comp.data, b)} />}
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-[11px] text-muted-foreground">
                  <th className="h-8 pr-2 font-medium">Company</th>
                  <th className="h-8 pr-2 text-right font-medium">{b.numL}</th>
                  <th className="h-8 pr-2 text-right font-medium">{b.denL}</th>
                  <th className="h-8 pr-2 text-right font-medium">Own</th>
                  <th className="h-8 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr
                    key={r.tk}
                    className="cursor-pointer border-b transition-colors duration-150 hover:bg-secondary"
                    onClick={() => navigate({ to: "/app/companies/$ticker/financials", params: { ticker: r.tk } })}
                    title={`Open ${r.tk}'s filed statements${r.end ? ` (period ending ${r.end})` : ""}`}
                  >
                    <td className="h-7 pr-2">
                      <TickerMark ticker={r.tk} link={false}>
                        <span className="text-[11px] text-muted-foreground">{r.end ? fmtDate(r.end, { month: "short", year: "2-digit" }) : ""}</span>
                      </TickerMark>
                    </td>
                    <td className={cn("num pr-2 text-right", r.num < 0 && "text-negative")}>{fmtMetric(r.num, "usd")}</td>
                    <td className={cn("num pr-2 text-right", r.den < 0 && "text-negative")}>{fmtMetric(r.den, "usd")}</td>
                    <td className="num pr-2 text-right">{fmtMetric(r.own, unit)}</td>
                    <td className="num text-right">{(r.share * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
