import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

export interface Series {
  id: string;
  label: string;
  /** CSS colour, ideally a token such as var(--chart-1) */
  color: string;
  points: { date: Date; value: number }[];
  dashed?: boolean;
  area?: boolean;
  /** Plot against a right-hand axis (dual-axis comparisons) */
  axis?: "left" | "right";
}

interface Props {
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  /** Shaded bands, e.g. recessions */
  bands?: { start: Date; end: Date }[];
  zeroLine?: boolean;
  className?: string;
  endLabels?: boolean;
  yDomain?: [number, number];
  rightFormat?: (v: number) => string;
}

/** Datawrapper-style line chart: light grid, direct end labels, hover readout. */
export function TimeSeriesChart({ series, height = 260, yFormat = (v) => v.toFixed(1), bands, zeroLine, className, endLabels = true, yDomain, rightFormat }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ x: number; date: Date } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(240, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasRight = series.some((s) => s.axis === "right");
  const margin = { top: 12, right: endLabels ? 74 : hasRight ? 48 : 12, bottom: 24, left: 44 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;

  const { x, y, yR, all } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const x = d3
      .scaleUtc()
      .domain(d3.extent(all, (p) => p.date) as [Date, Date])
      .range([0, iw]);
    const scale = (pts: { value: number }[], fixed?: [number, number]) => {
      const [lo, hi] = fixed ?? (d3.extent(pts, (p) => p.value) as [number, number]);
      const pad = (hi - lo) * 0.08 || 1;
      return d3
        .scaleLinear()
        .domain([zeroLine ? Math.min(0, lo - pad) : lo - pad, zeroLine ? Math.max(0, hi + pad) : hi + pad])
        .nice()
        .range([ih, 0]);
    };
    const left = series.filter((s) => s.axis !== "right").flatMap((s) => s.points);
    const right = series.filter((s) => s.axis === "right").flatMap((s) => s.points);
    const y = scale(left.length ? left : all, yDomain);
    const yR = right.length ? scale(right) : y;
    return { x, y, yR, all };
  }, [series, iw, ih, zeroLine, yDomain]);
  const yOf = (s: Series) => (s.axis === "right" ? yR : y);

  if (!all.length) return <div ref={ref} style={{ height }} className={cn("w-full", className)} />;

  const lineFor = (s: Series) =>
    d3
      .line<{ date: Date; value: number }>()
      .x((p) => x(p.date))
      .y((p) => yOf(s)(p.value))
      .curve(d3.curveMonotoneX);
  const areaFor = (s: Series) =>
    d3
      .area<{ date: Date; value: number }>()
      .x((p) => x(p.date))
      .y0(ih)
      .y1((p) => yOf(s)(p.value))
      .curve(d3.curveMonotoneX);

  const yTicks = y.ticks(5);
  const xTicks = x.ticks(Math.max(2, Math.floor(iw / 110)));
  const bisect = d3.bisector((p: { date: Date }) => p.date).center;

  const readouts = hover
    ? series.map((s) => {
        const i = bisect(s.points, hover.date);
        return { s, p: s.points[i] };
      })
    : [];

  // Resolve end-label collisions: each label is two lines (value + name), so keep them a
  // full label apart, pushing down first and then back up if the stack runs off the plot.
  const ends = series
    .map((s) => ({ s, p: s.points[s.points.length - 1] }))
    .filter((e) => e.p)
    .map((e) => ({ ...e, y: yOf(e.s)(e.p.value) }))
    .sort((a, b) => a.y - b.y);
  const gap = 23;
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
  const floor = ih - 4;
  if (ends.length && ends[ends.length - 1].y > floor) {
    ends[ends.length - 1].y = floor;
    for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < gap) ends[i].y = ends[i + 1].y - gap;
  }

  return (
    <div ref={ref} className={cn("relative w-full select-none", className)}>
      <svg width={width} height={height} className="block overflow-visible">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {bands?.map((b, i) => (
            <rect
              key={i}
              x={x(b.start)}
              width={Math.max(1, x(b.end) - x(b.start))}
              y={0}
              height={ih}
              fill="var(--muted-foreground)"
              opacity={0.1}
            />
          ))}
          {yTicks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "2 3"} />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {zeroLine && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="var(--foreground)" strokeOpacity={0.5} />}
          {hasRight &&
            yR.ticks(5).map((t) => (
              <text key={`r${t}`} x={iw + 8} y={yR(t)} dy="0.32em" className="fill-muted-foreground font-mono text-[10px]">
                {(rightFormat ?? yFormat)(t)}
              </text>
            ))}
          {xTicks.map((t) => (
            <text key={+t} x={x(t)} y={ih + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
              {d3.utcFormat(iwSpanYears(x) > 3 ? "%Y" : "%b %y")(t)}
            </text>
          ))}
          {series.map((s) => (
            <g key={s.id}>
              {s.area && <path d={areaFor(s)(s.points) ?? ""} fill={s.color} opacity={0.08} />}
              <path
                d={lineFor(s)(s.points) ?? ""}
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                strokeLinejoin="round"
              />
            </g>
          ))}
          {endLabels &&
            ends.map((e) => (
              <g key={e.s.id} transform={`translate(${iw + 6},${e.y})`}>
                <circle r={2.5} cx={-6} cy={yOf(e.s)(e.p.value) - e.y} fill={e.s.color} />
                <text dy="0.32em" className="font-mono text-[10px] font-medium" fill={e.s.color}>
                  {(e.s.axis === "right" ? (rightFormat ?? yFormat) : yFormat)(e.p.value)}
                </text>
                <text dy="0.32em" dx={0} y={11} className="fill-muted-foreground text-[9px]">
                  {e.s.label.length > 12 ? e.s.label.slice(0, 11) + "…" : e.s.label}
                </text>
              </g>
            ))}
          {hover && (
            <g>
              <line x1={hover.x} x2={hover.x} y1={0} y2={ih} stroke="var(--foreground)" strokeOpacity={0.35} />
              {readouts.map(({ s, p }) =>
                p ? <circle key={s.id} cx={x(p.date)} cy={yOf(s)(p.value)} r={3.5} fill="var(--card)" stroke={s.color} strokeWidth={2} /> : null,
              )}
            </g>
          )}
          <rect
            width={iw}
            height={ih}
            fill="transparent"
            onMouseMove={(e) => {
              const [mx] = d3.pointer(e);
              setHover({ x: mx, date: x.invert(mx) });
            }}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hover && readouts.length > 0 && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift"
          style={{ left: Math.min(width - 170, Math.max(0, hover.x + margin.left + 10)) }}
        >
          <p className="num text-muted-foreground">{d3.utcFormat("%b %-d, %Y")(readouts[0].p?.date ?? hover.date)}</p>
          {readouts.map(({ s, p }) => (
            <p key={s.id} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="num ml-auto pl-3 font-medium">{p ? (s.axis === "right" ? (rightFormat ?? yFormat) : yFormat)(p.value) : "—"}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function iwSpanYears(x: d3.ScaleTime<number, number>) {
  const [a, b] = x.domain();
  return (b.getTime() - a.getTime()) / (365 * 86400000);
}
