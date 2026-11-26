import { useMemo, useState, type KeyboardEvent } from "react";
import * as d3 from "d3";
import type { ScaleAxis } from "@/lib/sources/boards/scale";
import type { TileLine, TilePoint } from "@/lib/sources/boards/types";
import { tickFormat } from "../boards/tile-chart";
import { SeriesLegend, SeriesReadout, day, slot, timeTicks, useWidth } from "./primitives";

/**
 * The parts of a whole over time, stacked from a zero baseline in their fixed order (the first part at the bottom):
 * columns with a 2px surface gap between segments and a 4px rounded top on the stack, or areas washed at a quarter of
 * the hue with a 2px line on each layer's top. Levels in the unit of the whole, or shares adding up to 100. A period
 * without every figure draws nothing. The legend names the parts; hover or the arrow keys show every part of the
 * period with the whole; a click opens the record of the segment (or, on areas, the layer) under the pointer.
 */
type Props = {
  parts: TileLine[];
  whole: TileLine;
  draw: "areas" | "columns";
  share: boolean;
  label: string;
  recordHref: (line: TileLine, row: number) => string;
  onOpen: (href: string) => void;
  height: number;
  axis?: ScaleAxis;
};

type Period = { i: number; t: number; label: string; layers: { part: number; p: TilePoint; y0: number; y1: number }[]; whole: TilePoint | null };

export function StackedChart({ parts, whole, draw, share, label, recordHref, onOpen, height, axis }: Props) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const scaled = (v: number) => (axis && !share ? v / axis.divisor : v);
  const periods: Period[] = useMemo(() => {
    const n = parts[0]?.points.length ?? 0;
    const out: Period[] = [];
    for (let i = 0; i < n; i += 1) {
      const ps = parts.map((l) => l.points[i]);
      const date = ps[0]?.date;
      if (!date) continue;
      let acc = 0;
      const complete = ps.every((p) => p && p.value !== null);
      const layers = complete
        ? ps.map((p, part) => {
            const y0 = acc;
            acc += scaled(p.value as number);
            return { part, p, y0, y1: acc };
          })
        : [];
      out.push({ i, t: day(date).getTime(), label: ps[0].label, layers, whole: whole.points[i] ?? null });
    }
    return out;
    // scaled depends on axis and share only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, whole, axis, share]);
  const margin = { top: 8, right: 10, bottom: 20, left: 40 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = Math.max(40, height - margin.top - margin.bottom);
  const top = d3.max(periods, (p) => p.layers[p.layers.length - 1]?.y1 ?? 0) ?? 1;
  const y = d3.scaleLinear().domain([0, share ? Math.max(100, top) : top || 1]).nice(4).range([ih, 0]);
  const ticks = y.ticks(4);
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const band = d3.scaleBand<number>().domain(periods.map((p) => p.i)).range([0, iw]).paddingInner(0.2);
  const bar = Math.min(24, Math.max(2, band.bandwidth()));
  const x = d3.scaleUtc().domain([new Date(periods[0]?.t ?? 0), new Date(periods[periods.length - 1]?.t ?? 1)]).range([0, iw]);
  const cx = (p: Period) => (draw === "columns" ? (band(p.i) ?? 0) + band.bandwidth() / 2 : x(new Date(p.t)));
  const every = Math.max(1, Math.ceil(periods.length / (width < 360 ? 4 : 6)));
  const { ticks: xt, format } = timeTicks(x, width);
  const hovered = hover === null ? null : periods[hover] ?? null;

  const nearest = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left - margin.left;
    let best = 0;
    for (let i = 1; i < periods.length; i += 1) if (Math.abs(cx(periods[i]) - mx) < Math.abs(cx(periods[best]) - mx)) best = i;
    return best;
  };
  const layerAt = (period: Period, clientY: number, rect: DOMRect) => {
    const v = y.invert(clientY - rect.top - margin.top);
    return period.layers.find((l) => v >= l.y0 && v <= l.y1) ?? period.layers[period.layers.length - 1] ?? null;
  };
  const keys = (e: KeyboardEvent) => {
    const at = hover ?? periods.length - 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover(Math.max(0, at - 1)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setHover(Math.min(periods.length - 1, at + 1)); }
    else if (e.key === "Enter") {
      const p = periods[at]?.layers[0];
      if (p) { e.preventDefault(); onOpen(recordHref(parts[p.part], p.p.row)); }
    }
  };
  const area = (part: number) =>
    d3
      .area<Period>()
      .defined((p) => p.layers.length > 0)
      .x((p) => x(new Date(p.t)))
      .y0((p) => y(p.layers[part].y0))
      .y1((p) => y(p.layers[part].y1))(periods);
  const topLine = (part: number) =>
    d3
      .line<Period>()
      .defined((p) => p.layers.length > 0)
      .x((p) => x(new Date(p.t)))
      .y((p) => y(p.layers[part].y1))(periods);

  return (
    <div>
      <SeriesLegend fill items={parts.map((l, i) => ({ key: l.key, label: l.label, color: slot(i) }))} />
      <div ref={ref} className="relative" style={{ height }}>
        <svg width={width} height={height} className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" role="img" aria-label={label} tabIndex={0} onKeyDown={keys} onBlur={() => setHover(null)}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((v) => (
              <g key={v} transform={`translate(0,${y(v)})`}>
                <line x1={0} x2={iw} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={v === 0 ? 1 : 0.7} />
                <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                  {tickFormat(v, step)}
                </text>
              </g>
            ))}
            {draw === "columns"
              ? periods.map((p) =>
                  p.layers.map((l, k) => {
                    const x0 = cx(p) - bar / 2;
                    // a 2px surface gap below every segment but the first; the top of the stack rounded
                    const yTop = y(l.y1);
                    const h = Math.max(0, y(l.y0) - y(l.y1) - (k > 0 ? 2 : 0));
                    const last = k === p.layers.length - 1;
                    const r = last ? Math.min(4, bar / 2, h) : 0;
                    const d = `M${x0},${yTop + h}V${yTop + r}${r ? `Q${x0},${yTop} ${x0 + r},${yTop}` : ""}H${x0 + bar - r}${r ? `Q${x0 + bar},${yTop} ${x0 + bar},${yTop + r}` : ""}V${yTop + h}Z`;
                    return <path key={`${p.i}-${k}`} d={d} fill={slot(l.part)} opacity={hover === null || hover === p.i ? 1 : 0.6} />;
                  }),
                )
              : parts.map((l, k) => (
                  <g key={l.key}>
                    <path d={area(k) ?? undefined} fill={slot(k)} opacity={0.25} />
                    <path d={topLine(k) ?? undefined} fill="none" stroke={slot(k)} strokeWidth={2} strokeLinejoin="round" />
                  </g>
                ))}
            {draw === "columns"
              ? periods.map((p, i) =>
                  i % every === (periods.length - 1) % every ? (
                    <text key={`x${p.i}`} x={cx(p)} y={ih + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                      {p.label.replace(/^Q(\d) \d{2}(\d{2})$/, "Q$1 $2")}
                    </text>
                  ) : null,
                )
              : xt.map((d) => (
                  <text key={+d} x={x(d)} y={ih + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                    {format(d)}
                  </text>
                ))}
            {hovered && draw === "areas" && <line x1={cx(hovered)} x2={cx(hovered)} y1={0} y2={ih} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} pointerEvents="none" />}
            <rect
              width={iw}
              height={ih}
              fill="transparent"
              className="cursor-pointer"
              onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                const period = periods[nearest(e.clientX, rect)];
                const l = period ? layerAt(period, e.clientY, rect) : null;
                if (l) onOpen(recordHref(parts[l.part], l.p.row));
              }}
            />
          </g>
        </svg>
        {hovered && (
          <SeriesReadout
            x={cx(hovered) + margin.left}
            width={width}
            title={`${hovered.label}, ${share ? "% of the whole" : parts[0].plotUnit}`}
            rows={[
              ...[...parts].map((l, k) => ({ key: l.key, color: slot(k), label: l.label, value: l.points[hovered.i]?.value === null ? "–" : (l.points[hovered.i]?.display ?? "–") })).reverse(),
              { key: "whole", color: "var(--muted-foreground)", label: `${whole.label}, ${whole.unit}`, value: hovered.whole?.value === null || !hovered.whole ? "–" : hovered.whole.display },
            ]}
            boxWidth={230}
          />
        )}
      </div>
    </div>
  );
}
