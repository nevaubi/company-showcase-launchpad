import * as d3 from "d3";
import type { TilePoint } from "@/lib/sources/boards/types";
import { QUIET, slot, useWidth } from "./primitives";

/**
 * The trend of a stat tile: the latest periods as a 2px line in the quiet hue, the latest period a dot in the accent.
 * No axis: the figure beside it carries the value, the table view of its board and the record carry the rest. A gap
 * breaks the line.
 */
export function Sparkline({ points, label, height = 32 }: { points: TilePoint[]; label: string; height?: number }) {
  const [ref, width] = useWidth(60, 140);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const lo = d3.min(values) ?? 0;
  const hi = d3.max(values) ?? 1;
  const x = d3.scaleLinear().domain([0, Math.max(1, points.length - 1)]).range([2, width - 6]);
  const y = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).range([height - 4, 4]);
  const d = d3
    .line<TilePoint>()
    .defined((p) => p.value !== null)
    .x((_, i) => x(i))
    .y((p) => y(p.value as number))(points);
  const lastIndex = points.map((p) => p.value !== null).lastIndexOf(true);
  const last = lastIndex >= 0 ? points[lastIndex] : null;
  return (
    <div ref={ref} style={{ height }} className="min-w-0">
      <svg width={width} height={height} className="block" role="img" aria-label={label}>
        {d && <path d={d} fill="none" stroke={QUIET} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {last && <circle cx={x(lastIndex)} cy={y(last.value as number)} r={3.5} fill={slot(0)} stroke="var(--card)" strokeWidth={1.5} />}
      </svg>
    </div>
  );
}
