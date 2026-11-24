import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BREAKDOWN_METRICS,
  breakdown,
  compQuery,
  fmtMetric,
  noteParts,
  notesQuery,
  qLabel,
  type GroupFile,
  type GroupSummary,
  type Overview,
} from "@/lib/sectors/groups";

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

/* ---------- scorecard ---------- */
const COLS: { id: string; l: string; hib: boolean | null }[] = [
  { id: "rev_growth", l: "Revenue YoY", hib: true },
  { id: "ni_growth", l: "Earnings YoY", hib: true },
  { id: "pct_rev_up", l: "% growing", hib: true },
  { id: "om", l: "Op margin", hib: true },
  { id: "fcfm", l: "FCF margin", hib: true },
  { id: "roic", l: "ROIC", hib: true },
  { id: "nd_ebitda", l: "ND/EBITDA", hib: false },
  { id: "pe", l: "P/E", hib: false },
];
const tint = (v: number | null | undefined, scale: number) =>
  v == null
    ? undefined
    : {
        background: `color-mix(in oklab, var(${v >= 0 ? "--positive" : "--negative"}) ${Math.round(Math.min(1, Math.abs(v) / scale) * 22)}%, transparent)`,
      };

export function SectorScorecard({ ov }: { ov: Overview }) {
  const [open, setOpen] = useState<string | null>(null);
  const [ret, setRet] = useState<"1M" | "3M" | "YTD" | "1Y">("3M");
  const sectors = ov.groups
    .filter((g) => g.kind === "sector")
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
  const inds = (s: string) =>
    ov.groups
      .filter((g) => g.kind === "industry" && g.sector === s)
      .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
  const row = (g: GroupSummary, child = false) => {
    const rr = g.returns?.cw?.[ret] ?? null,
      spy = ov.spy_returns[ret] ?? null;
    return (
      <tr key={g.slug} className={cn("group", child && "text-[12.5px]")}>
        <td
          className={cn(
            "sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 group-hover:bg-secondary",
            child && "pl-8",
          )}
        >
          <span className="flex items-center gap-1.5">
            {!child && (
              <button
                type="button"
                aria-label={open === g.slug ? "Hide industries" : "Show industries"}
                onClick={() => setOpen((o) => (o === g.slug ? null : g.slug))}
                className="rounded p-0.5 text-muted-foreground hover:bg-background"
              >
                {open === g.slug ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            )}
            <Link
              to="/app/sectors/g/$slug"
              params={{ slug: g.slug }}
              className={cn("hover:underline", !child && "font-medium")}
            >
              {g.name}
            </Link>
            <span className="text-[11px] text-muted-foreground">{g.n}</span>
          </span>
        </td>
        <td className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary">
          {fmtMetric(g.mcap, "usd")}
        </td>
        {COLS.map((c) => {
          const v = g.latest[c.id]?.[1] ?? null;
          const isG = c.id === "rev_growth" || c.id === "ni_growth";
          return (
            <td
              key={c.id}
              title={
                g.latest[c.id]
                  ? `${qLabel(g.latest[c.id][0])} · ${g.latest[c.id][2]} companies`
                  : undefined
              }
              className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary"
              style={isG ? tint(v, 0.3) : undefined}
            >
              {fmtMetric(v, c.id === "pe" || c.id === "nd_ebitda" ? "x" : "pct")}
            </td>
          );
        })}
        <td
          className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary"
          title={
            g.pe_range
              ? `10-year range ${g.pe_range.min.toFixed(1)}× – ${g.pe_range.max.toFixed(1)}×, median ${g.pe_range.med.toFixed(1)}×`
              : undefined
          }
        >
          {g.pe_range?.pct != null ? <PctBar p={g.pe_range.pct} /> : "–"}
        </td>
        <td
          className="num border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary"
          style={tint(rr != null && spy != null ? rr - spy : null, 0.15)}
        >
          {rr == null ? "–" : `${rr >= 0 ? "+" : ""}${(rr * 100).toFixed(1)}%`}
        </td>
      </tr>
    );
  };
  return (
    <Panel
      title="Sector and industry scorecard"
      subtitle={`Aggregates over each group's companies (Σ numerator ÷ Σ denominator) from their filings · latest calendar quarter · built ${fmtDate(ov.generated.slice(0, 10))}`}
      actions={
        <Segmented
          size="xs"
          label="Return window"
          value={ret}
          onChange={setRet}
          options={[
            { v: "1M", l: "1M" },
            { v: "3M", l: "3M" },
            { v: "YTD", l: "YTD" },
            { v: "1Y", l: "1Y" },
          ]}
        />
      }
      bodyClassName="p-0"
      collapse={false}
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="sticky left-0 z-20 border-b border-r bg-card px-3 py-2 text-left font-medium">
                Group · companies
              </th>
              <th className="border-b px-3 py-2 text-right font-medium">Market cap</th>
              {COLS.map((c) => (
                <th key={c.id} className="border-b px-3 py-2 text-right font-medium">
                  {c.l}
                </th>
              ))}
              <th
                className="border-b px-3 py-2 text-right font-medium"
                title="Where today's aggregate P/E sits in its own 10-year quarterly range"
              >
                P/E vs 10Y
              </th>
              <th
                className="border-b px-3 py-2 text-right font-medium"
                title="Cap-weighted return of the group's companies; shading is relative to SPY"
              >
                Return {ret}
              </th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => (
              <Fragment key={s.slug}>
                {row(s)}
                {open === s.slug && inds(s.sector).map((g) => row(g, true))}
              </Fragment>
            ))}
            <tr className="text-[12px] text-muted-foreground">
              <td className="sticky left-0 border-r bg-card px-3 py-1.5">S&P 500 (SPY)</td>
              <td colSpan={COLS.length + 2} />
              <td className="num px-3 py-1.5 text-right tabular-nums">
                {ov.spy_returns[ret] != null
                  ? `${ov.spy_returns[ret] >= 0 ? "+" : ""}${(ov.spy_returns[ret] * 100).toFixed(1)}%`
                  : "–"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Open a sector or industry for quarterly history, the company-by-company breakdown behind
        every aggregate, macro sensitivity, KPIs and constituents.
      </p>
    </Panel>
  );
}

function PctBar({ p }: { p: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`${ordinal(Math.round(p * 100))} percentile of its 10-year range`}
    >
      <span className="relative h-1.5 w-14 rounded-full bg-secondary">
        <span
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${p * 100}%`,
            background:
              p > 0.8 ? "var(--negative)" : p < 0.2 ? "var(--positive)" : "var(--foreground)",
          }}
        />
      </span>
      <span className="w-7 text-right text-[11px]">{Math.round(p * 100)}</span>
    </span>
  );
}

/* ---------- relative rotation graph ---------- */
const QUAD = [
  { l: "Leading", x: 1, y: 1, c: "var(--positive)" },
  { l: "Weakening", x: 1, y: -1, c: "var(--chart-4)" },
  { l: "Lagging", x: -1, y: -1, c: "var(--negative)" },
  { l: "Improving", x: -1, y: 1, c: "var(--chart-1)" },
];
export function RotationGraph({ ov }: { ov: Overview }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const navigate = useNavigate();
  const [tail, setTail] = useState<"4" | "10">("4");
  const sectors = ov.groups.filter((g) => g.kind === "sector" && g.etf && ov.etf_rrg[g.etf]);
  const pts = sectors.flatMap((g) => ov.etf_rrg[g.etf!].slice(-+tail));
  if (!pts.length) return null;
  const H = 340,
    m = 28;
  const xs = pts.map((p) => p[1]),
    ys = pts.map((p) => p[2]);
  const span =
    Math.max(2, ...xs.map((v) => Math.abs(v - 100)), ...ys.map((v) => Math.abs(v - 100))) * 1.12;
  const x = (v: number) => m + ((v - (100 - span)) / (2 * span)) * (W - 2 * m);
  const y = (v: number) => m + ((100 + span - v) / (2 * span)) * (H - 2 * m);
  return (
    <Panel
      title="Sector rotation"
      subtitle="Relative strength vs SPY (x) and its momentum (y), weekly, sector SPDR ETFs · tails show the path"
      actions={
        <Segmented
          size="xs"
          label="Tail"
          value={tail}
          onChange={setTail}
          options={[
            { v: "4", l: "4 wk" },
            { v: "10", l: "10 wk" },
          ]}
        />
      }
      collapse={false}
    >
      <div ref={ref} className="px-3 py-2">
        {W > 0 && (
          <svg width={W} height={H} role="img" aria-label="Relative rotation graph of sector ETFs">
            {QUAD.map((q) => (
              <g key={q.l}>
                <rect
                  x={q.x > 0 ? x(100) : m}
                  y={q.y > 0 ? m : y(100)}
                  width={(W - 2 * m) / 2}
                  height={(H - 2 * m) / 2}
                  fill={q.c}
                  opacity={0.05}
                />
                <text
                  x={q.x > 0 ? W - m - 4 : m + 4}
                  y={q.y > 0 ? m + 14 : H - m - 6}
                  textAnchor={q.x > 0 ? "end" : "start"}
                  fontSize={11}
                  fontWeight={600}
                  fill={q.c}
                  opacity={0.8}
                >
                  {q.l}
                </text>
              </g>
            ))}
            <line x1={x(100)} x2={x(100)} y1={m} y2={H - m} stroke="var(--rule)" />
            <line x1={m} x2={W - m} y1={y(100)} y2={y(100)} stroke="var(--rule)" />
            {sectors.map((g, i) => {
              const tr = ov.etf_rrg[g.etf!].slice(-+tail);
              const last = tr[tr.length - 1];
              const color = `var(--chart-${(i % 6) + 1})`;
              return (
                <g
                  key={g.slug}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/app/sectors/g/$slug", params: { slug: g.slug } })}
                >
                  <path
                    d={tr.map((p, k) => `${k ? "L" : "M"}${x(p[1])},${y(p[2])}`).join("")}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.4}
                    opacity={0.7}
                  />
                  {tr.slice(0, -1).map((p) => (
                    <circle
                      key={p[0]}
                      cx={x(p[1])}
                      cy={y(p[2])}
                      r={1.8}
                      fill={color}
                      opacity={0.6}
                    />
                  ))}
                  <circle
                    cx={x(last[1])}
                    cy={y(last[2])}
                    r={4.5}
                    fill={color}
                    stroke="var(--background)"
                  />
                  <text
                    x={x(last[1]) + 7}
                    y={y(last[2]) + 3.5}
                    fontSize={10.5}
                    fontWeight={600}
                    fill={color}
                  >
                    {g.etf}
                  </text>
                  <title>{`${g.name} (${g.etf}) · week of ${last[0]}: RS-ratio ${last[1].toFixed(1)}, RS-momentum ${last[2].toFixed(1)}`}</title>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Ratio above 100: outperforming SPY. Momentum above 100: the relative trend is improving.
        Groups usually rotate clockwise: improving, leading, weakening, lagging. Click a sector to
        open it.
      </p>
    </Panel>
  );
}

/* ---------- weekly notes ---------- */
export function SectorNotes({ only }: { only?: string }) {
  const q = useQuery(notesQuery);
  const navigate = useNavigate();
  if (q.isLoading) return <Skeleton className="h-40" />;
  const notes = (q.data?.notes ?? []).filter((n) => !only || n.slug === only);
  if (!notes.length) return null;
  return (
    <Panel
      title={only ? "This week's note" : "Weekly sector notes"}
      subtitle={`AI-written around stored figures: every number is a reference to an aggregate on the sector page · week of ${fmtDate(notes[0].week)}`}
      collapse={only ? false : 520}
    >
      <div className={cn("grid gap-px bg-border", !only && "md:grid-cols-2")}>
        {notes.map((n) => (
          <article key={n.slug} className="bg-card px-3.5 py-3">
            <p className="text-[11px] text-muted-foreground">{n.sector}</p>
            <h3 className="mt-0.5 text-[13.5px] font-semibold leading-snug">
              <Link to="/app/sectors/g/$slug" params={{ slug: n.slug }} className="hover:underline">
                {n.title}
              </Link>
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {noteParts(n).map((p, i) =>
                typeof p === "string" ? (
                  <Fragment key={i}>{p}</Fragment>
                ) : (
                  <button
                    key={i}
                    type="button"
                    title={p.label}
                    onClick={() => {
                      const f = n.facts[p.id];
                      navigate({
                        to: "/app/sectors/g/$slug",
                        params: { slug: n.slug },
                        search:
                          f?.ref?.type === "agg" && f.ref.metric
                            ? { m: f.ref.metric, q: f.ref.q }
                            : {},
                      });
                    }}
                    className="num rounded-sm px-0.5 font-medium text-foreground underline decoration-dotted underline-offset-2 hover:bg-highlight-soft"
                  >
                    {p.text}
                  </button>
                ),
              )}
            </p>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              {n.model} · {fmtDate(n.generated_at.slice(0, 10))}
            </p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

/* ---------- quarterly aggregates with the breakdown behind each point ---------- */
const TREND_METRICS = [
  "rev_growth",
  "ni_growth",
  "pct_rev_up",
  "gm",
  "om",
  "nm",
  "fcfm",
  "roic",
  "roe",
  "nd_ebitda",
  "pe",
  "ps",
  "pfcf",
];

export function AggregateTrends({
  g,
  metric,
  q,
  onPick,
}: {
  g: GroupFile;
  metric: string;
  q?: string;
  onPick: (m: string, q?: string) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [span, setSpan] = useState<"20" | "40" | "all">("20");
  const s = g.agg[metric];
  const unit = g.metrics[metric]?.unit;
  const idx = g.quarters.map((_, i) => i).filter((i) => s?.agg[i] != null);
  const show = span === "all" ? idx : idx.slice(-+span);
  const vals = show
    .map((i) => s.agg[i]!)
    .concat(show.map((i) => s.med[i]).filter((v): v is number => v != null));
  const H = 220,
    m = { t: 12, r: 12, b: 24, l: 48 };
  const lo = Math.min(0, ...vals),
    hi = Math.max(...vals, 0);
  const pad = (hi - lo) * 0.08 || 0.01;
  const x = (k: number) => m.l + (k / Math.max(1, show.length - 1)) * (W - m.l - m.r);
  const y = (v: number) => m.t + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - m.t - m.b);
  const sel = q ? g.quarters.indexOf(q) : show[show.length - 1];
  const canBreak = BREAKDOWN_METRICS.has(metric);
  return (
    <Panel
      title="Quarterly aggregates"
      subtitle={`${g.metrics[metric]?.name ?? metric} · aggregate (solid) and company median (dashed) by calendar quarter${canBreak ? " · click a quarter for the companies behind it" : ""}`}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Metric"
            value={metric}
            onChange={(e) => onPick(e.target.value, q)}
            className="h-7 rounded-md border bg-card px-2 text-xs"
          >
            {TREND_METRICS.filter((k) => g.agg[k]).map((k) => (
              <option key={k} value={k}>
                {g.metrics[k]?.name ?? k}
              </option>
            ))}
          </select>
          <Segmented
            size="xs"
            label="Span"
            value={span}
            onChange={setSpan}
            options={[
              { v: "20", l: "5Y" },
              { v: "40", l: "10Y" },
              { v: "all", l: "All" },
            ]}
          />
        </div>
      }
      collapse={false}
    >
      <div ref={ref} className="px-3 py-2">
        {W > 0 && s && show.length > 1 && (
          <svg width={W} height={H} role="img" aria-label={`${g.name} ${g.metrics[metric]?.name}`}>
            {[lo, (lo + hi) / 2, hi].map((v) => (
              <g key={v}>
                <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
                <text
                  x={m.l - 6}
                  y={y(v) + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {fmtMetric(v, unit, 0)}
                </text>
              </g>
            ))}
            {lo < 0 && <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule)" />}
            <path
              d={show
                .map((i, k) =>
                  s.med[i] == null
                    ? ""
                    : `${k && s.med[show[k - 1]] != null ? "L" : "M"}${x(k)},${y(s.med[i]!)}`,
                )
                .join("")}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeDasharray="3 3"
              strokeWidth={1.2}
            />
            <path
              d={show.map((i, k) => `${k ? "L" : "M"}${x(k)},${y(s.agg[i]!)}`).join("")}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={1.8}
            />
            {show.map((i, k) => (
              <g
                key={i}
                className={canBreak ? "cursor-pointer" : undefined}
                onClick={() => canBreak && onPick(metric, g.quarters[i])}
              >
                <rect
                  x={x(k) - (W - m.l - m.r) / show.length / 2}
                  y={m.t}
                  width={(W - m.l - m.r) / show.length}
                  height={H - m.t - m.b}
                  fill="transparent"
                />
                <circle
                  cx={x(k)}
                  cy={y(s.agg[i]!)}
                  r={i === sel ? 4.5 : 2.5}
                  fill="var(--chart-1)"
                  stroke={i === sel ? "var(--background)" : undefined}
                />
                <title>{`${qLabel(g.quarters[i])}: ${fmtMetric(s.agg[i], unit)} aggregate, ${fmtMetric(s.med[i], unit)} median · ${s.n[i]} companies`}</title>
              </g>
            ))}
            {[0, Math.floor((show.length - 1) / 2), show.length - 1].map((k, j) => (
              <text
                key={j}
                x={x(k)}
                y={H - 6}
                textAnchor={j === 0 ? "start" : j === 2 ? "end" : "middle"}
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {qLabel(g.quarters[show[k]])}
              </text>
            ))}
          </svg>
        )}
      </div>
    </Panel>
  );
}

export function BreakdownSheet({
  g,
  metric,
  q,
  onClose,
}: {
  g: GroupFile;
  metric: string;
  q: string | null;
  onClose: () => void;
}) {
  const comp = useQuery({ ...compQuery(g.slug), enabled: !!q });
  const navigate = useNavigate();
  const b = useMemo(
    () => (q && comp.data ? breakdown(g, comp.data, metric, q) : null),
    [g, comp.data, metric, q],
  );
  const unit = g.metrics[metric]?.unit;
  const pub = q ? g.agg[metric]?.agg[g.quarters.indexOf(q)] : null;
  const growth = metric === "rev_growth" || metric === "ni_growth";
  return (
    <Sheet open={!!q} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {g.name} · {g.metrics[metric]?.name} · {q ? qLabel(q) : ""}
          </SheetTitle>
          <SheetDescription>
            Published aggregate{" "}
            <span className="num font-medium text-foreground">{fmtMetric(pub, unit)}</span>
            {b && (
              <>
                {" "}
                · recomputed from {b.rows.length} companies:{" "}
                <span className="num font-medium text-foreground">{fmtMetric(b.value, unit)}</span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>
        {!b ? (
          <Skeleton className="mt-4 h-64" />
        ) : (
          <div className="mt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {growth ? `Σ ${b.numL} ÷ Σ ${b.denL} − 1` : `Σ ${b.numL} ÷ Σ ${b.denL}`}:{" "}
              {fmtMetric(
                b.rows.reduce((s, x) => s + x.num, 0),
                "usd",
              )}{" "}
              ÷{" "}
              {fmtMetric(
                b.rows.reduce((s, x) => s + x.den, 0),
                "usd",
              )}
              . Companies sorted by their weight in the denominator. Each company's inputs come from
              its own filings for the fiscal quarter ending nearest the calendar quarter.
            </p>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-left text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Company</th>
                  <th className="py-1.5 pr-2 text-right font-medium">{b.numL}</th>
                  <th className="py-1.5 pr-2 text-right font-medium">{b.denL}</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Own</th>
                  <th className="py-1.5 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr
                    key={r.tk}
                    className="cursor-pointer border-b hover:bg-secondary"
                    onClick={() =>
                      navigate({
                        to: "/app/companies/$ticker/financials",
                        params: { ticker: r.tk },
                      })
                    }
                    title={`Open ${r.tk}'s filed statements${r.end ? ` (period ending ${r.end})` : ""}`}
                  >
                    <td className="num py-1.5 pr-2 font-medium">
                      {r.tk}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {r.end ? fmtDate(r.end, { month: "short", year: "2-digit" }) : ""}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "num py-1.5 pr-2 text-right tabular-nums",
                        r.num < 0 && "text-negative",
                      )}
                    >
                      {fmtMetric(r.num, "usd")}
                    </td>
                    <td
                      className={cn(
                        "num py-1.5 pr-2 text-right tabular-nums",
                        r.den < 0 && "text-negative",
                      )}
                    >
                      {fmtMetric(r.den, "usd")}
                    </td>
                    <td className="num py-1.5 pr-2 text-right tabular-nums">
                      {fmtMetric(r.own, unit)}
                    </td>
                    <td className="num py-1.5 text-right tabular-nums">
                      {(r.share * 100).toFixed(1)}%
                    </td>
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
