// Charts of the Securitized credit view, drawn to the dataviz rules: one axis, a zero baseline for
// bars, hairline solid grid, 2 px lines, 4 px rounded data-ends, a 2 px surface gap between touching
// marks, a crosshair that snaps to a period with every series in its readout, the same readout on
// keyboard focus, and a legend only for two or more series. Colours are the app's chart tokens; the
// days-past-due ramp is one hue (--chart-4) stepped toward the surface and toward the text ink, checked
// with the dataviz validator in both themes.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

/** Days past due, least to most: 30 to 59, 60 to 89, 90 to 119, 120 or more. */
export const DUE_RAMP = [
  "color-mix(in oklab, var(--chart-4) 60%, var(--card))",
  "color-mix(in oklab, var(--chart-4) 80%, var(--card))",
  "var(--chart-4)",
  "color-mix(in oklab, var(--chart-4) 70%, var(--foreground))",
];

function useWidth<T extends HTMLElement>(min = 240): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(min, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(min, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [setEl, width];
}

const parseDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** Tick labels that stay distinct on a narrow range: more decimals only where the caller's format repeats a label. */
function tickLabels(ticks: number[], format: (v: number) => string): string[] {
  const own = ticks.map(format);
  if (new Set(own).size === own.length) return own;
  for (const digits of [1, 2, 3]) {
    const f = d3.format(`,.${digits}f`);
    const out = ticks.map((t) => f(t).replace("-", "\u2212"));
    if (new Set(out).size === out.length) return out;
  }
  return own;
}
const monthTick = d3.utcFormat("%b %y");
const yearTick = d3.utcFormat("%Y");

/** A readout row: value first, then what it is. */
export type Readout = { color?: string; label: string; value: string };

function Tooltip({ x, width, title, rows, foot }: { x: number; width: number; title: string; rows: Readout[]; foot?: ReactNode }) {
  const w = 200;
  const left = Math.max(0, Math.min(width - w, x + 12 > width - w ? x - w - 12 : x + 12));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-2 text-[11px] text-popover-foreground shadow-md"
      style={{ left, width: w }}
      role="status"
    >
      <p className="mb-1 text-muted-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-baseline gap-1.5">
          {r.color && <span className="mt-[5px] inline-block h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />}
          <span className="num font-semibold text-foreground">{r.value}</span>
          <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
        </p>
      ))}
      {foot && <div className="mt-1 border-t pt-1 text-[10.5px] text-muted-foreground">{foot}</div>}
    </div>
  );
}

export function Legend({ items, shape = "line" }: { items: { label: string; color: string }[]; shape?: "line" | "rect" }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={shape === "line" ? "inline-block h-0.5 w-3 rounded-full" : "inline-block size-2.5 rounded-[2px]"}
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------- lines over periods ---------- */

export type LinePoint = { x: string; y: number | null; foot?: ReactNode };
export type LineSeries = { id: string; label: string; color: string; points: LinePoint[] };

/** Lines over reporting periods on one axis. A period a series lacks breaks its line. */
export function PeriodLines({
  series,
  yFormat,
  height = 200,
  zero = false,
  label,
}: {
  series: LineSeries[];
  yFormat: (v: number) => string;
  height?: number;
  zero?: boolean;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const xs = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(), [series]);
  const values = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null);
  const margin = { top: 10, right: series.length <= 2 ? 64 : 12, bottom: 22, left: 52 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = height - margin.top - margin.bottom;
  const x = d3
    .scaleUtc()
    .domain(xs.length > 1 ? [parseDay(xs[0]), parseDay(xs[xs.length - 1])] : [d3.utcDay.offset(parseDay(xs[0] ?? "2000-01-01"), -15), d3.utcDay.offset(parseDay(xs[0] ?? "2000-01-01"), 15)])
    .range([0, iw]);
  const lo = d3.min(values) ?? 0;
  const hi = d3.max(values) ?? 1;
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
  const y = d3
    .scaleLinear()
    .domain([zero ? Math.min(0, lo) : lo - pad, zero ? Math.max(0, hi) + pad * 0.5 : hi + pad])
    .nice(4)
    .range([ih, 0]);
  const line = d3
    .line<LinePoint>()
    .defined((p) => p.y != null)
    .x((p) => x(parseDay(p.x)))
    .y((p) => y(p.y!));
  const spanYears = xs.length > 1 ? (parseDay(xs[xs.length - 1]).getTime() - parseDay(xs[0]).getTime()) / 3.15e10 : 0;
  const ticks = x.ticks(Math.max(2, Math.min(xs.length, Math.floor(iw / 80))));
  const move = (clientX: number, box: DOMRect) => {
    const px = clientX - box.left - margin.left;
    let best = 0;
    for (let i = 1; i < xs.length; i++)
      if (Math.abs(x(parseDay(xs[i])) - px) < Math.abs(x(parseDay(xs[best])) - px)) best = i;
    setAt(best);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!xs.length) return;
    if (e.key === "ArrowLeft") setAt((i) => Math.max(0, (i ?? xs.length) - 1));
    else if (e.key === "ArrowRight") setAt((i) => Math.min(xs.length - 1, (i ?? -1) + 1));
    else return;
    e.preventDefault();
  };
  const hoverX = at != null ? xs[at] : null;
  const rows: Readout[] =
    hoverX == null
      ? []
      : series.map((s) => {
          const p = s.points.find((q) => q.x === hoverX);
          return { color: s.color, label: s.label, value: p?.y == null ? "–" : yFormat(p.y) };
        });
  const foot = hoverX == null ? null : series.map((s) => s.points.find((q) => q.x === hoverX)?.foot).find(Boolean);
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setAt((i) => i ?? xs.length - 1)}
        onBlur={() => setAt(null)}
        onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setAt(null)}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {y.ticks(4).map((t, i, all) => (
            <g key={t} transform={`translate(0,${Math.round(y(t)) + 0.5})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeOpacity={t === 0 ? 1 : 0.7} shapeRendering="crispEdges" />
              <text x={-6} dy="0.32em" textAnchor="end" className="num fill-muted-foreground text-[10px]">
                {tickLabels(all, yFormat)[i]}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={+t} x={x(t)} y={ih + 15} textAnchor="middle" className="num fill-muted-foreground text-[10px]">
              {spanYears > 3 ? yearTick(t) : monthTick(t)}
            </text>
          ))}
          {hoverX && (
            <line x1={x(parseDay(hoverX))} x2={x(parseDay(hoverX))} y1={0} y2={ih} stroke="var(--muted-foreground)" strokeOpacity={0.5} shapeRendering="crispEdges" />
          )}
          {series.map((s) => {
            const pts = s.points.filter((p) => p.y != null);
            const end = pts[pts.length - 1];
            const hovered = hoverX ? s.points.find((p) => p.x === hoverX && p.y != null) : undefined;
            return (
              <g key={s.id}>
                <path d={line(s.points) ?? ""} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.length === 1 && <circle cx={x(parseDay(pts[0].x))} cy={y(pts[0].y!)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />}
                {end && (
                  <>
                    <circle cx={x(parseDay(end.x))} cy={y(end.y!)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                    {series.length <= 2 && (
                      <text x={x(parseDay(end.x)) + 8} y={y(end.y!)} dy="0.32em" className="num fill-foreground text-[10.5px]">
                        {yFormat(end.y!)}
                      </text>
                    )}
                  </>
                )}
                {hovered && <circle cx={x(parseDay(hovered.x))} cy={y(hovered.y!)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />}
              </g>
            );
          })}
        </g>
      </svg>
      {hoverX && <Tooltip x={x(parseDay(hoverX)) + margin.left} width={width} title={hoverX} rows={rows} foot={foot} />}
    </div>
  );
}

/* ---------- columns over periods ---------- */

export type ColumnKey = { id: string; label: string; color: string };
export type ColumnDatum = { x: string; values: Record<string, number | null>; foot?: ReactNode };

/** A rectangle with 4 px rounding on the end away from the baseline. */
function bar(x: number, y0: number, y1: number, w: number, round: boolean): string {
  const top = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  const r = round ? Math.min(4, w / 2, h) : 0;
  const up = y1 <= y0; // grows upward from y0
  if (!r) return `M${x},${top}h${w}v${h}h${-w}Z`;
  return up
    ? `M${x},${top + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}Z`
    : `M${x},${top}v${h - r}a${r},${r} 0 0 0 ${r},${r}h${w - 2 * r}a${r},${r} 0 0 0 ${r},${-r}v${-(h - r)}Z`;
}

/**
 * Columns per reporting period: stacked (parts of one whole, all at or above zero) or side by side
 * (amounts that can be negative, drawn from a zero baseline). Each column is its own hover target.
 */
export function PeriodColumns({
  data,
  keys,
  mode,
  yFormat,
  height = 200,
  label,
}: {
  data: ColumnDatum[];
  keys: ColumnKey[];
  mode: "stack" | "group";
  yFormat: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const margin = { top: 10, right: 12, bottom: 22, left: 52 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = height - margin.top - margin.bottom;
  const band = d3.scaleBand<string>().domain(data.map((d) => d.x)).range([0, iw]).paddingInner(0.25).paddingOuter(0.1);
  const totals = data.map((d) => keys.reduce((s, k) => s + Math.max(0, d.values[k.id] ?? 0), 0));
  const all = data.flatMap((d) => keys.map((k) => d.values[k.id] ?? 0));
  const hi = mode === "stack" ? (d3.max(totals) ?? 0) : Math.max(0, d3.max(all) ?? 0);
  const lo = mode === "stack" ? 0 : Math.min(0, d3.min(all) ?? 0);
  const y = d3.scaleLinear().domain([lo, hi > lo ? hi : lo + 1]).nice(4).range([ih, 0]);
  const colW = Math.min(24, band.bandwidth());
  const groupW = mode === "group" ? Math.min(24, (band.bandwidth() - 2) / keys.length) : colW;
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 64))));
  const onKey = (e: KeyboardEvent) => {
    if (!data.length) return;
    if (e.key === "ArrowLeft") setAt((i) => Math.max(0, (i ?? data.length) - 1));
    else if (e.key === "ArrowRight") setAt((i) => Math.min(data.length - 1, (i ?? -1) + 1));
    else return;
    e.preventDefault();
  };
  const hovered = at != null ? data[at] : null;
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setAt((i) => i ?? data.length - 1)}
        onBlur={() => setAt(null)}
        onPointerLeave={() => setAt(null)}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {y.ticks(4).map((t, i, all) => (
            <g key={t} transform={`translate(0,${Math.round(y(t)) + 0.5})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeOpacity={t === 0 ? 1 : 0.7} shapeRendering="crispEdges" />
              <text x={-6} dy="0.32em" textAnchor="end" className="num fill-muted-foreground text-[10px]">
                {tickLabels(all, yFormat)[i]}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = band(d.x) ?? 0;
            const marks: ReactNode[] = [];
            if (mode === "stack") {
              let base = 0;
              const parts = keys.map((k) => ({ k, v: Math.max(0, d.values[k.id] ?? 0) })).filter((p) => p.v > 0);
              parts.forEach((p, j) => {
                const y0 = y(base);
                const y1 = y(base + p.v);
                base += p.v;
                // the surface gap: each segment gives up 2 px at its top edge
                const gapTop = j < parts.length - 1 && y0 - y1 > 3 ? 2 : 0;
                marks.push(
                  <path key={p.k.id} d={bar(x0 + (band.bandwidth() - colW) / 2, y0, y1 + gapTop, colW, j === parts.length - 1)} fill={p.k.color} />,
                );
              });
            } else {
              keys.forEach((k, j) => {
                const v = d.values[k.id];
                if (v == null || v === 0) return;
                const gx = x0 + (band.bandwidth() - (groupW * keys.length + 2 * (keys.length - 1))) / 2 + j * (groupW + 2);
                marks.push(<path key={k.id} d={bar(gx, y(0), y(v), groupW, true)} fill={k.color} />);
              });
            }
            return (
              <g key={d.x} opacity={at != null && at !== i ? 0.55 : 1}>
                {marks}
                <rect
                  x={x0 - (band.step() - band.bandwidth()) / 2}
                  width={band.step()}
                  y={0}
                  height={ih}
                  fill="transparent"
                  onPointerEnter={() => setAt(i)}
                  onPointerMove={() => setAt(i)}
                />
                {i % every === 0 && (
                  <text x={x0 + band.bandwidth() / 2} y={ih + 15} textAnchor="middle" className="num fill-muted-foreground text-[10px]">
                    {monthTick(parseDay(d.x))}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && (
        <Tooltip
          x={(band(hovered.x) ?? 0) + margin.left + band.bandwidth() / 2}
          width={width}
          title={hovered.x}
          rows={keys.map((k) => ({ color: k.color, label: k.label, value: hovered.values[k.id] == null ? "–" : yFormat(hovered.values[k.id]!) }))}
          foot={hovered.foot}
        />
      )}
    </div>
  );
}

/* ---------- a row's small trend ---------- */

/** A sparkline for a table row: the de-emphasis ink, the newest period in the accent. */
export function Spark({ values, labels, format, width = 84, height = 22 }: { values: (number | null)[]; labels: string[]; format: (v: number) => string; width?: number; height?: number }) {
  const [at, setAt] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2)
    return (
      <span className="text-[10.5px] text-muted-foreground/80" title={known.length ? "One period stored: no trend yet" : "No share in any stored period"}>
        {known.length ? "one period" : "–"}
      </span>
    );
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([3, width - 3]);
  const y = d3.scaleLinear().domain([0, Math.max(d3.max(known) ?? 0, 1e-9)]).range([height - 3, 3]);
  const line = d3
    .line<number | null>()
    .defined((v) => v != null)
    .x((_, i) => x(i))
    .y((v) => y(v!));
  const last = values.length - 1;
  const name = `${labels[0]}: ${values[0] == null ? "–" : format(values[0])} to ${labels[last]}: ${values[last] == null ? "–" : format(values[last])}`;
  return (
    <span className="relative inline-block align-middle">
      <svg
        ref={ref}
        width={width}
        height={height}
        role="img"
        aria-label={name}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setAt(Math.max(0, Math.min(last, Math.round(x.invert(e.clientX - box.left)))));
        }}
        onPointerLeave={() => setAt(null)}
        className="block"
      >
        <line x1={3} x2={width - 3} y1={height - 2.5} y2={height - 2.5} stroke="var(--border)" />
        <path d={line(values) ?? ""} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.75} strokeWidth={1.5} strokeLinejoin="round" />
        {values[last] != null && <circle cx={x(last)} cy={y(values[last]!)} r={3} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={1.5} />}
        {at != null && values[at] != null && <circle cx={x(at)} cy={y(values[at]!)} r={3} fill="var(--foreground)" stroke="var(--card)" strokeWidth={1.5} />}
      </svg>
      {at != null && (
        <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1 whitespace-nowrap rounded-sm border bg-popover px-1.5 py-0.5 text-[10.5px] text-popover-foreground shadow-sm">
          <span className="num font-semibold">{values[at] == null ? "–" : format(values[at]!)}</span>{" "}
          <span className="text-muted-foreground">{labels[at]}</span>
        </span>
      )}
    </span>
  );
}

/* ---------- ranked bars ---------- */

export type MeterItem = { key: string; label: string; value: number | null; share: number | null; detail?: string };

/**
 * Parts of one whole as bars on one baseline, one hue: name, bar and figure per row. Largest first
 * unless the parts have an order of their own (the caller orders them).
 */
export function MeterList({ items, format, color = "var(--chart-1)", label }: { items: MeterItem[]; format: (share: number | null) => string; color?: string; label: string }) {
  const max = Math.max(...items.map((i) => i.share ?? 0), 1e-9);
  return (
    <ul className="grid gap-px" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="grid min-h-7 grid-cols-[minmax(96px,34%)_minmax(0,1fr)_56px] items-center gap-2 text-[12px]" title={i.detail}>
          <span className="truncate" title={i.label}>
            {i.label}
          </span>
          <span className="relative h-2.5 rounded-[2px] bg-muted/60" aria-hidden>
            {i.share != null && i.share > 0 && (
              <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (i.share / max) * 100)}%`, background: color }} />
            )}
          </span>
          <span className={cn("num text-right", i.share == null && "text-muted-foreground")}>{format(i.share)}</span>
        </li>
      ))}
    </ul>
  );
}
