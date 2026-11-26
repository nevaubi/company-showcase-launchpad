import { useState } from "react";
import * as d3 from "d3";
import type { TilePoint } from "@/lib/sources/boards/types";
import { tickFormat } from "../boards/tile-chart";
import { QUIET, SeriesLegend, SeriesReadout, slot, useWidth } from "./primitives";

/**
 * One period's values across an ordered category (maturities, size classes), in the publisher's order on a point
 * scale: the latest period as a 2px line with 8px dots, the same period a year earlier as a quieter line, the value at
 * the last category labelled. Hover, focus or the arrow keys show both values of a category; a click or Enter opens
 * the latest record of that category.
 */
type Props = {
  latest: TilePoint[];
  earlier: TilePoint[] | null;
  latestLabel: string;
  earlierLabel: string | null;
  unit: string;
  label: string;
  /** The record of a category's point (each category may be its own table). */
  recordHref: (index: number, row: number) => string;
  onOpen: (href: string) => void;
  height: number;
};

export function CurveChart({ latest, earlier, latestLabel, earlierLabel, unit, label, recordHref, onOpen, height }: Props) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const end = latest[latest.length - 1];
  const margin = { top: 10, right: Math.max(30, (end?.display.length ?? 4) * 6.4 + 12), bottom: 22, left: 40 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = Math.max(40, height - margin.top - margin.bottom);
  const values = [...latest, ...(earlier ?? [])].map((p) => p.value).filter((v): v is number => v !== null);
  const lo = d3.min(values) ?? 0;
  const hi = d3.max(values) ?? 1;
  const y = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).nice(4).range([ih, 0]);
  const ticks = y.ticks(4);
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const x = d3.scalePoint<number>().domain(latest.map((_, i) => i)).range([0, iw]).padding(0.3);
  const path = (pts: TilePoint[]) =>
    d3
      .line<TilePoint>()
      .defined((p) => p.value !== null)
      .x((_, i) => x(i) ?? 0)
      .y((p) => y(p.value as number))(pts);
  const nearest = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left - margin.left;
    let best = 0;
    for (let i = 1; i < latest.length; i += 1) if (Math.abs((x(i) ?? 0) - mx) < Math.abs((x(best) ?? 0) - mx)) best = i;
    return best;
  };
  const series = [{ key: "latest", label: latestLabel, color: slot(0) }, ...(earlier && earlierLabel ? [{ key: "earlier", label: earlierLabel, color: QUIET }] : [])];
  return (
    <div>
      {earlier && <SeriesLegend items={series} />}
      <div ref={ref} className="relative" style={{ height }}>
        <svg
          width={width}
          height={height}
          className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-label={label}
          tabIndex={0}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            const at = hover ?? latest.length - 1;
            if (e.key === "ArrowLeft") (e.preventDefault(), setHover(Math.max(0, at - 1)));
            else if (e.key === "ArrowRight") (e.preventDefault(), setHover(Math.min(latest.length - 1, at + 1)));
            else if (e.key === "Enter") (e.preventDefault(), onOpen(recordHref(at, latest[at].row)));
          }}
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
            {latest.map((p, i) => (
              <text key={`x${p.key}`} x={x(i) ?? 0} y={ih + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                {p.label}
              </text>
            ))}
            {earlier && <path d={path(earlier) ?? undefined} fill="none" stroke={QUIET} strokeWidth={2} strokeLinejoin="round" />}
            {earlier?.map((p, i) => (p.value === null ? null : <circle key={`e${p.key}`} cx={x(i) ?? 0} cy={y(p.value)} r={3} fill={QUIET} stroke="var(--card)" strokeWidth={2} />))}
            <path d={path(latest) ?? undefined} fill="none" stroke={slot(0)} strokeWidth={2} strokeLinejoin="round" />
            {latest.map((p, i) => (p.value === null ? null : <circle key={`l${p.key}`} cx={x(i) ?? 0} cy={y(p.value)} r={hover === i ? 5 : 4} fill={slot(0)} stroke="var(--card)" strokeWidth={2} />))}
            {end && end.value !== null && (
              <text x={(x(latest.length - 1) ?? 0) + 8} y={y(end.value)} dy="0.32em" className="fill-foreground font-mono text-[10px] font-medium">
                {end.display}
              </text>
            )}
            {hover !== null && <line x1={x(hover) ?? 0} x2={x(hover) ?? 0} y1={0} y2={ih} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.5} pointerEvents="none" />}
            <rect
              width={iw}
              height={ih}
              fill="transparent"
              className="cursor-pointer"
              onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                const i = nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect());
                onOpen(recordHref(i, latest[i].row));
              }}
            />
          </g>
        </svg>
        {hover !== null && (
          <SeriesReadout
            x={(x(hover) ?? 0) + margin.left}
            width={width}
            title={`${latest[hover].label}, ${unit}`}
            rows={[
              { key: "latest", color: slot(0), label: latestLabel, value: latest[hover].value === null ? "–" : latest[hover].display },
              ...(earlier && earlierLabel ? [{ key: "earlier", color: QUIET, label: earlierLabel, value: earlier[hover]?.value === null ? "–" : (earlier[hover]?.display ?? "–") }] : []),
            ]}
          />
        )}
      </div>
    </div>
  );
}
