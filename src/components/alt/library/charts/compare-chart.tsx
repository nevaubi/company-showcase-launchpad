import { useMemo, useState, type KeyboardEvent } from "react";
import * as d3 from "d3";
import type { ScaleAxis } from "@/lib/sources/boards/scale";
import type { TileLine, TilePoint } from "@/lib/sources/boards/types";
import { tickFormat } from "../boards/tile-chart";
import { SeriesLegend, SeriesReadout, day, slot, timeTicks, useWidth } from "./primitives";

/**
 * Several series on one time axis. One plotted unit: one chart, a 2px line per series in its fixed slot, an end dot
 * with a surface ring and its value at the line's end (labels that would collide are left to the legend and the
 * readout), a legend row above. Several units: small multiples, one panel per series with its own axis and unit on
 * the shared time axis, never two scales on one plot. The crosshair snaps to the nearest period and the readout lists
 * every series there; a click (or Enter) opens the record of the series nearest the pointer at that period. The arrow
 * keys move the crosshair. A gap is a break in the line, never a zero.
 */
type Props = {
  lines: TileLine[];
  layout: "overlay" | "multiples";
  /** Accessible name of the chart. */
  label: string;
  /** The address of a record of one series' table. */
  recordHref: (line: TileLine, row: number) => string;
  onOpen: (href: string) => void;
  height: number;
  /** A reader-scale axis for an overlay whose series share a whitelisted unit (values divided, labels from `axisDisplay`). */
  axis?: ScaleAxis;
};

type Mark = { line: number; p: TilePoint; t: number; v: number | null };

/** The union of the series' dates, in order, each with the point of every series on it (or the nearest earlier one within its own spacing). */
function dates(lines: TileLine[]): number[] {
  const all = new Set<number>();
  for (const l of lines) for (const p of l.points) if (p.date) all.add(day(p.date).getTime());
  return [...all].sort((a, b) => a - b);
}

function atDate(line: TileLine, t: number): TilePoint | null {
  let best: TilePoint | null = null;
  for (const p of line.points) {
    if (!p.date) continue;
    const pt = day(p.date).getTime();
    if (pt <= t && (!best || pt > day(best.date).getTime())) best = p;
  }
  return best;
}

export function CompareChart(props: Props) {
  return props.layout === "multiples" ? <Multiples {...props} /> : <Overlay {...props} />;
}

function Overlay({ lines, label, recordHref, onOpen, height, axis }: Props) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const valueOf = (p: TilePoint) => (p.value === null ? null : axis ? p.value / axis.divisor : p.value);
  const textOf = (p: TilePoint) => (axis ? (p.axisDisplay ?? p.display) : p.display);
  const ends = lines.map((l) => [...l.points].reverse().find((p) => p.value !== null) ?? null);
  const widest = Math.max(0, ...ends.map((e) => (e ? textOf(e).length : 0)));
  const margin = { top: 8, right: Math.max(28, widest * 6.4 + 12), bottom: 20, left: 40 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = Math.max(40, height - margin.top - margin.bottom);
  const times = useMemo(() => dates(lines), [lines]);
  const { x, y, ticks, step } = useMemo(() => {
    const values = lines.flatMap((l) => l.points.map(valueOf)).filter((v): v is number => v !== null);
    const x = d3.scaleUtc().domain([new Date(times[0] ?? 0), new Date(times[times.length - 1] ?? 1)]).range([0, iw]);
    const lo = d3.min(values) ?? 0;
    const hi = d3.max(values) ?? 1;
    const y = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).nice(4).range([ih, 0]);
    const ticks = y.ticks(4);
    return { x, y, ticks, step: ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1 };
    // valueOf depends on axis only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, times, iw, ih, axis]);
  const paths = lines.map((l) =>
    d3
      .line<TilePoint>()
      .defined((p) => p.value !== null)
      .x((p) => x(day(p.date)))
      .y((p) => y(valueOf(p) as number))(l.points),
  );
  // end labels: kept where they sit at least 11px from every label already placed (the legend names the rest)
  const placed: number[] = [];
  const endLabels = ends.map((e) => {
    if (!e) return null;
    const ey = y(valueOf(e) as number);
    if (placed.some((p) => Math.abs(p - ey) < 11)) return { e, ey, show: false };
    placed.push(ey);
    return { e, ey, show: true };
  });
  const { ticks: xt, format } = timeTicks(x, width);
  const t = hover === null ? null : times[hover];
  const marks: Mark[] = t === null ? [] : lines.map((l, i) => {
    const p = atDate(l, t);
    return p ? { line: i, p, t, v: valueOf(p) } : null;
  }).filter((m): m is Mark => m !== null);
  const nearest = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left - margin.left;
    let best = 0;
    for (let i = 1; i < times.length; i += 1) if (Math.abs(x(new Date(times[i])) - mx) < Math.abs(x(new Date(times[best])) - mx)) best = i;
    return best;
  };
  const open = (i: number, clientY?: number, rect?: DOMRect) => {
    const at = times[i];
    const candidates = lines.map((l, k) => ({ k, p: atDate(l, at) })).filter((c) => c.p && c.p.value !== null);
    if (!candidates.length) return;
    let pick = candidates[0];
    if (clientY !== undefined && rect) {
      const my = clientY - rect.top - margin.top;
      pick = candidates.reduce((best, c) => (Math.abs(y(valueOf(c.p!) as number) - my) < Math.abs(y(valueOf(best.p!) as number) - my) ? c : best), candidates[0]);
    }
    onOpen(recordHref(lines[pick.k], pick.p!.row));
  };
  const keys = (e: KeyboardEvent) => {
    const at = hover ?? times.length - 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover(Math.max(0, at - 1)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setHover(Math.min(times.length - 1, at + 1)); }
    else if (e.key === "Home") { e.preventDefault(); setHover(0); }
    else if (e.key === "End") { e.preventDefault(); setHover(times.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); open(at); }
  };
  const dateLabel = (p: TilePoint) => p.label;
  return (
    <div>
      <SeriesLegend items={lines.map((l, i) => ({ key: l.key, label: l.label, color: slot(i) }))} />
      <div ref={ref} className="relative" style={{ height }}>
        <svg
          width={width}
          height={height}
          className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={keys}
          onBlur={() => setHover(null)}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((v) => (
              <g key={v} transform={`translate(0,${y(v)})`}>
                <line x1={0} x2={iw} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={0.7} />
                <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                  {tickFormat(v, step)}
                </text>
              </g>
            ))}
            {xt.map((d) => (
              <text key={+d} x={x(d)} y={ih + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                {format(d)}
              </text>
            ))}
            {paths.map((d, i) => d && <path key={lines[i].key} d={d} fill="none" stroke={slot(i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {endLabels.map((l, i) =>
              l ? (
                <g key={`end-${lines[i].key}`}>
                  <circle cx={x(day(l.e.date))} cy={l.ey} r={4} fill={slot(i)} stroke="var(--card)" strokeWidth={2} />
                  {l.show && (
                    <text x={x(day(l.e.date)) + 8} y={l.ey} dy="0.32em" className="fill-foreground font-mono text-[10px] font-medium">
                      {textOf(l.e)}
                    </text>
                  )}
                </g>
              ) : null,
            )}
            {t !== null && (
              <g pointerEvents="none">
                <line x1={x(new Date(t))} x2={x(new Date(t))} y1={0} y2={ih} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} />
                {marks.map((m) => (m.v === null ? null : <circle key={m.line} cx={x(day(m.p.date))} cy={y(m.v)} r={4} fill={slot(m.line)} stroke="var(--card)" strokeWidth={2} />))}
              </g>
            )}
            <rect
              width={iw}
              height={ih}
              fill="transparent"
              className="cursor-pointer"
              onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                open(nearest(e.clientX, rect), e.clientY, rect);
              }}
            />
          </g>
        </svg>
        {t !== null && marks.length > 0 && (
          <SeriesReadout
            x={x(new Date(t)) + margin.left}
            width={width}
            title={`${dateLabel(marks[0].p)}, ${lines[0].plotUnit}`}
            rows={marks.map((m) => ({ key: lines[m.line].key, color: slot(m.line), label: `${lines[m.line].label}${m.p.label !== marks[0].p.label ? `, ${m.p.label}` : ""}`, value: m.p.value === null ? "–" : m.p.display }))}
          />
        )}
      </div>
    </div>
  );
}

/** One small panel per series, its own axis and unit, on the shared time axis. */
function Multiples({ lines, label, recordHref, onOpen, height }: Props) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const times = useMemo(() => dates(lines), [lines]);
  const gap = 6;
  const panel = Math.max(48, Math.floor((height - gap * (lines.length - 1) - 16) / lines.length));
  const margin = { left: 40, right: 64 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const x = d3.scaleUtc().domain([new Date(times[0] ?? 0), new Date(times[times.length - 1] ?? 1)]).range([0, iw]);
  const { ticks: xt, format } = timeTicks(x, width);
  const nearest = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left - margin.left;
    let best = 0;
    for (let i = 1; i < times.length; i += 1) if (Math.abs(x(new Date(times[i])) - mx) < Math.abs(x(new Date(times[best])) - mx)) best = i;
    return best;
  };
  const t = hover === null ? null : times[hover];
  return (
    <div ref={ref} role="group" aria-label={label} className="relative" style={{ height }}>
      {lines.map((l, i) => {
        const values = l.points.map((p) => p.value).filter((v): v is number => v !== null);
        const lo = d3.min(values) ?? 0;
        const hi = d3.max(values) ?? 1;
        const y = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).nice(2).range([panel - 14, 4]);
        const ticks = y.ticks(2);
        const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
        const d = d3
          .line<TilePoint>()
          .defined((p) => p.value !== null)
          .x((p) => x(day(p.date)))
          .y((p) => y(p.value as number))(l.points);
        const end = [...l.points].reverse().find((p) => p.value !== null) ?? null;
        const at = t === null ? null : atDate(l, t);
        return (
          <svg
            key={l.key}
            width={width}
            height={panel}
            className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ marginTop: i ? gap : 0 }}
            role="img"
            tabIndex={0}
            aria-label={`${l.label}, ${l.plotUnit}${end ? `, ${end.display} in ${end.label}` : ""}`}
            onKeyDown={(e) => {
              const cur = hover ?? times.length - 1;
              if (e.key === "ArrowLeft") { e.preventDefault(); setHover(Math.max(0, cur - 1)); }
              else if (e.key === "ArrowRight") { e.preventDefault(); setHover(Math.min(times.length - 1, cur + 1)); }
              else if (e.key === "Enter" && end) { e.preventDefault(); onOpen(recordHref(l, (at ?? end).row)); }
            }}
            onBlur={() => setHover(null)}
          >
            <text x={margin.left} y={9} className="fill-muted-foreground text-[10px]">
              <tspan className="fill-foreground font-medium">{l.label}</tspan>
              <tspan>{`  ${l.plotUnit}`}</tspan>
            </text>
            <g transform={`translate(${margin.left},4)`}>
              {ticks.map((v) => (
                <g key={v} transform={`translate(0,${y(v)})`}>
                  <line x1={0} x2={iw} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={0.7} />
                  <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                    {tickFormat(v, step)}
                  </text>
                </g>
              ))}
              {d && <path d={d} fill="none" stroke={slot(i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {end && (
                <>
                  <circle cx={x(day(end.date))} cy={y(end.value as number)} r={4} fill={slot(i)} stroke="var(--card)" strokeWidth={2} />
                  <text x={x(day(end.date)) + 8} y={y(end.value as number)} dy="0.32em" className="fill-foreground font-mono text-[10px] font-medium">
                    {end.display}
                  </text>
                </>
              )}
              {at && at.value !== null && t !== null && (
                <g pointerEvents="none">
                  <line x1={x(new Date(t))} x2={x(new Date(t))} y1={0} y2={panel - 14} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} />
                  <circle cx={x(day(at.date))} cy={y(at.value)} r={4} fill={slot(i)} stroke="var(--card)" strokeWidth={2} />
                </g>
              )}
              <rect
                width={iw}
                height={panel - 10}
                fill="transparent"
                className="cursor-pointer"
                onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
                onPointerLeave={() => setHover(null)}
                onClick={(e) => {
                  const p = atDate(l, times[nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())]);
                  if (p) onOpen(recordHref(l, p.row));
                }}
              />
            </g>
          </svg>
        );
      })}
      <svg width={width} height={16} className="block" aria-hidden>
        <g transform={`translate(${margin.left},0)`}>
          {xt.map((d) => (
            <text key={+d} x={x(d)} y={12} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
              {format(d)}
            </text>
          ))}
        </g>
      </svg>
      {t !== null && (
        <SeriesReadout
          x={x(new Date(t)) + margin.left}
          width={width}
          title={atDate(lines[0], t)?.label ?? ""}
          rows={lines.flatMap((l, i) => {
            const p = atDate(l, t);
            return p ? [{ key: l.key, color: slot(i), label: `${l.label}, ${l.plotUnit}`, value: p.value === null ? "–" : p.display }] : [];
          })}
          boxWidth={230}
        />
      )}
    </div>
  );
}
