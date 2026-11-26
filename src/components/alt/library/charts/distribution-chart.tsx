import { useMemo, useState } from "react";
import * as d3 from "d3";
import type { DistributionBin, TilePoint } from "@/lib/sources/boards/types";
import { tickFormat } from "../boards/tile-chart";
import { ChartTooltip, slot, useWidth } from "./primitives";

/**
 * One measure across the entities of one period. A histogram: one column per stated bin, its height the records in it,
 * from a zero baseline, at most 24px thick with a 4px rounded top; the median's bin is marked with a hairline and a
 * label. A strip: one dot per entity along the value axis (8px, a surface ring), spread over a few lanes so dots of
 * close values stay apart, the median a vertical hairline. Hover or focus shows the bin's count and its largest
 * members, or the entity's figure; a click on a dot opens its record, on a bin the records of the period.
 */
type Props = {
  draw: "histogram" | "dots";
  bins: DistributionBin[] | null;
  /** Every entity with a figure, largest first. */
  points: TilePoint[];
  median: { value: number; display: string };
  unit: string;
  label: string;
  recordHref: (row: number) => string;
  /** The records of the period, for a click on a bin. */
  periodHref: string;
  onOpen: (href: string) => void;
  height: number;
};

export function DistributionChart(props: Props) {
  return props.draw === "histogram" && props.bins ? <Histogram {...props} bins={props.bins} /> : <Strip {...props} />;
}

function Histogram({ bins, median, unit, label, periodHref, onOpen, height }: Props & { bins: DistributionBin[] }) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 16, right: 8, bottom: 30, left: 36 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = Math.max(40, height - margin.top - margin.bottom);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.count) || 1]).nice(4).range([ih, 0]);
  const ticks = y.ticks(4).filter((t) => Number.isInteger(t));
  const band = d3.scaleBand<number>().domain(bins.map((_, i) => i)).range([0, iw]).paddingInner(0.2);
  const bar = Math.min(24, Math.max(2, band.bandwidth()));
  const medianBin = bins.findIndex((b) => {
    const lo = b.from === null ? -Infinity : Number(b.from);
    const hi = b.to === null ? Infinity : Number(b.to);
    return median.value >= lo && median.value < hi;
  });
  const every = Math.max(1, Math.ceil(bins.length / (width < 360 ? 4 : 7)));
  const shown = hover === null ? null : bins[hover];
  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} className="block" role="img" aria-label={label}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={t === 0 ? 1 : 0.7} />
              <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {tickFormat(t, 1)}
              </text>
            </g>
          ))}
          {bins.map((b, i) => {
            const x0 = (band(i) ?? 0) + (band.bandwidth() - bar) / 2;
            const top = y(b.count);
            const h = Math.max(b.count ? 1 : 0, ih - top);
            const r = Math.min(4, bar / 2, h);
            const d = `M${x0},${top + h}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bar - r}Q${x0 + bar},${top} ${x0 + bar},${top + r}V${top + h}Z`;
            return b.count ? <path key={b.label} d={d} fill={slot(0)} opacity={hover === null || hover === i ? 1 : 0.6} /> : null;
          })}
          {medianBin >= 0 && (
            <g pointerEvents="none">
              <line
                x1={(band(medianBin) ?? 0) + band.bandwidth() / 2}
                x2={(band(medianBin) ?? 0) + band.bandwidth() / 2}
                y1={-10}
                y2={ih}
                stroke="var(--foreground)"
                strokeWidth={1}
                opacity={0.7}
              />
              <text x={(band(medianBin) ?? 0) + band.bandwidth() / 2 + 4} y={-3} className="fill-foreground font-mono text-[10px]">
                Median {median.display}
              </text>
            </g>
          )}
          {bins.map((b, i) =>
            i % every === 0 || i === bins.length - 1 ? (
              <text key={`x${b.label}`} x={(band(i) ?? 0) + band.bandwidth() / 2} y={ih + 14} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
                {b.from === null ? `< ${b.to}` : b.to === null ? `≥ ${b.from}` : b.from}
              </text>
            ) : null,
          )}
          <text x={iw / 2} y={ih + 26} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {unit}, bins closed on the left
          </text>
          {bins.map((b, i) => (
            <rect
              key={`h${b.label}`}
              x={band(i) ?? 0}
              width={band.step()}
              y={0}
              height={ih}
              fill="transparent"
              className="cursor-pointer outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${b.label} ${unit}: ${b.count} records`}
              onPointerMove={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(periodHref)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(periodHref); }
              }}
            />
          ))}
        </g>
      </svg>
      {shown && hover !== null && (
        <ChartTooltip
          x={margin.left + (band(hover) ?? 0) + band.bandwidth() / 2}
          width={width}
          value={`${shown.count.toLocaleString("en-US")} records`}
          lines={[`${shown.label} ${unit}`, ...(shown.members.length ? [`${shown.members.slice(0, 3).join(", ")}${shown.count > 3 ? ` and ${(shown.count - Math.min(3, shown.members.length)).toLocaleString("en-US")} more` : ""}`] : [])]}
          boxWidth={200}
        />
      )}
    </div>
  );
}

const LANES = 7;

function Strip({ points, median, unit, label, recordHref, onOpen, height }: Props) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 18, right: 12, bottom: 22, left: 12 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = Math.max(40, height - margin.top - margin.bottom);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const x = d3.scaleLinear().domain([d3.min(values) ?? 0, d3.max(values) ?? 1]).nice(5).range([0, iw]);
  const ticks = x.ticks(width < 360 ? 3 : 5);
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  // lanes by order of value, so neighbours in value sit on different lanes
  const placed = useMemo(() => {
    const sorted = points.map((p, i) => ({ p, i })).filter((d) => d.p.value !== null).sort((a, b) => (a.p.value as number) - (b.p.value as number));
    return sorted.map((d, k) => ({ ...d, lane: k % LANES }));
  }, [points]);
  const laneY = (lane: number) => ih / 2 + (lane - (LANES - 1) / 2) * Math.min(10, ih / (LANES + 1));
  const nearest = (clientX: number, clientY: number, rect: DOMRect) => {
    const mx = clientX - rect.left - margin.left;
    const my = clientY - rect.top - margin.top;
    let best = placed[0];
    let dist = Infinity;
    for (const d of placed) {
      const dd = Math.hypot(x(d.p.value as number) - mx, laneY(d.lane) - my);
      if (dd < dist) {
        dist = dd;
        best = d;
      }
    }
    return dist < 24 ? best : null;
  };
  const shown = hover === null ? null : placed.find((d) => d.i === hover) ?? null;
  return (
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
          // the arrow keys walk the dots in order of value; Enter opens the record
          const at = placed.findIndex((d) => d.i === hover);
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const next = at === -1 ? (e.key === "ArrowRight" ? 0 : placed.length - 1) : Math.min(placed.length - 1, Math.max(0, at + (e.key === "ArrowRight" ? 1 : -1)));
            setHover(placed[next]?.i ?? null);
          } else if (e.key === "Enter" && at !== -1) {
            e.preventDefault();
            onOpen(recordHref(placed[at].p.row));
          }
        }}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(${x(t)},0)`}>
              <line y1={0} y2={ih} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={0.7} />
              <text y={ih + 14} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                {tickFormat(t, step)}
              </text>
            </g>
          ))}
          {placed.map((d) => (
            <circle key={d.i} cx={x(d.p.value as number)} cy={laneY(d.lane)} r={hover === d.i ? 5 : 3.5} fill={slot(0)} stroke="var(--card)" strokeWidth={1.5} opacity={hover === null || hover === d.i ? 0.85 : 0.45} />
          ))}
          <line x1={x(median.value)} x2={x(median.value)} y1={-8} y2={ih} stroke="var(--foreground)" strokeWidth={1} opacity={0.7} pointerEvents="none" />
          <text x={x(median.value) + 4} y={-2} className="fill-foreground font-mono text-[10px]">
            Median {median.display}
          </text>
          <rect
            width={iw}
            height={ih}
            fill="transparent"
            className="cursor-pointer"
            onPointerMove={(e) => setHover(nearest(e.clientX, e.clientY, e.currentTarget.ownerSVGElement!.getBoundingClientRect())?.i ?? null)}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const d = nearest(e.clientX, e.clientY, e.currentTarget.ownerSVGElement!.getBoundingClientRect());
              if (d) onOpen(recordHref(d.p.row));
            }}
          />
        </g>
      </svg>
      {shown && (
        <ChartTooltip x={margin.left + x(shown.p.value as number)} width={width} value={shown.p.display} lines={[unit, shown.p.label]} boxWidth={200} />
      )}
    </div>
  );
}
