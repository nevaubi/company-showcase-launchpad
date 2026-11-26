import { useState } from "react";
import { ChartTooltip, useWidth } from "@/components/alt/library/charts/primitives";
import { cn } from "@/lib/utils";
import { axisLabel, countTicks, labelWidth } from "./axis";
import { useRoving } from "./roving";

export type ColumnMark = {
  key: string;
  value: number;
  /** The column's name in the tooltip ("Q2 2026", "2023"). */
  label: string;
  /** The count as the tooltip leads with it ("1,234 records", "at least 250,000 records"). */
  valueText: string;
  /** Lines under the value (what a click does, what the column holds). */
  lines: string[];
  /** Full accessible name of the column. */
  title: string;
  /** False for a column a click cannot open (a year without records). */
  actionable: boolean;
};

/** Plot height of the column charts; the axis band below it is part of the box, so the card never scrolls. */
export const COLUMN_PLOT_HEIGHT = 168;
const AXIS_BAND = 22;
const TOP_ROOM = 16;

/**
 * Columns from a zero baseline in one hue (`--chart-1`), at most 24 px thick with a 4 px rounded data end and a 2 px
 * surface gap between neighbours. Hairline gridlines at clean steps, the count axis at the left, the period axis
 * below; the last column carries its count. Every column is a hit target the full height of the plot, one tab stop
 * for the row (arrow keys move), with the same tooltip on hover and focus.
 */
export function ColumnChart({
  columns,
  ticks,
  label,
  onSelect,
  roomFor,
  className,
}: {
  columns: ColumnMark[];
  /** Axis labels under the columns, by column index. */
  ticks: (room: number) => { index: number; label: string }[];
  /** Accessible name of the chart. */
  label: string;
  onSelect?: (index: number) => void;
  /** Width a tick label needs, px (the chart fits as many as there is room for). */
  roomFor?: number;
  className?: string;
}) {
  const [boxRef, width] = useWidth(240, 640);
  const [hover, setHover] = useState<number | null>(null);
  const roving = useRoving(columns.length, (i) => columns[i]?.actionable && onSelect?.(i));
  const max = Math.max(0, ...columns.map((c) => c.value));
  const yTicks = countTicks(max, 4);
  const top = yTicks[yTicks.length - 1];
  const yLabels = yTicks.map((t) => axisLabel(t, top));
  const gutter = labelWidth(yLabels);
  const plotW = Math.max(40, width - gutter);
  const plotH = COLUMN_PLOT_HEIGHT;
  const slot = columns.length ? plotW / columns.length : plotW;
  const bar = Math.max(1, Math.min(24, slot - 2));
  const y = (v: number) => TOP_ROOM + plotH - (top > 0 ? (v / top) * plotH : 0);
  const xTicks = ticks(Math.max(2, Math.floor(plotW / (roomFor ?? 56))));
  const last = columns.length - 1;
  const shown = hover ?? null;
  const height = TOP_ROOM + plotH + AXIS_BAND;

  return (
    <div ref={boxRef} className={cn("relative min-w-0", className)} role="group" aria-label={label} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} className="block overflow-visible" aria-hidden>
        {yTicks.map((t, i) => (
          <g key={t}>
            <line x1={gutter} x2={width} y1={y(t)} y2={y(t)} className={i === 0 ? "stroke-border" : "stroke-border/60"} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={gutter - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted-foreground text-[11px]">
              {yLabels[i]}
            </text>
          </g>
        ))}
        {columns.map((c, i) => {
          if (c.value <= 0) return null;
          const x = gutter + i * slot + (slot - bar) / 2;
          const h = Math.max(1, y(0) - y(c.value));
          const r = Math.min(4, bar / 2, h);
          const yy = y(0) - h;
          const d = `M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bar - r} Q${x + bar},${yy} ${x + bar},${yy + r} V${y(0)} Z`;
          return <path key={c.key} d={d} className={cn("fill-chart-1 transition-opacity duration-150 motion-reduce:transition-none", shown !== null && shown !== i && "opacity-55")} />;
        })}
        {last >= 0 && columns[last].value > 0 && (
          <text
            x={Math.min(width - 2, gutter + last * slot + slot / 2)}
            y={y(columns[last].value) - 5}
            textAnchor={gutter + last * slot + slot / 2 > width - 24 ? "end" : "middle"}
            className="num fill-foreground text-[11px] font-medium"
          >
            {columns[last].value.toLocaleString("en-US")}
          </text>
        )}
        {xTicks.map((t) => {
          const cx = gutter + t.index * slot + slot / 2;
          const anchor = cx < gutter + 20 ? "start" : cx > width - 20 ? "end" : "middle";
          return (
            <text key={t.index} x={anchor === "start" ? Math.max(gutter, cx - slot / 2) : anchor === "end" ? width : cx} y={TOP_ROOM + plotH + 15} textAnchor={anchor} className="num fill-muted-foreground text-[11px]">
              {t.label}
            </text>
          );
        })}
      </svg>
      <div className="absolute inset-y-0 right-0" style={{ left: gutter, top: TOP_ROOM, height: plotH }}>
        {columns.map((c, i) => {
          const props = roving.bind(i);
          return (
            <button
              key={c.key}
              type="button"
              {...props}
              aria-label={c.title}
              aria-disabled={!c.actionable || !onSelect ? true : undefined}
              onPointerEnter={() => setHover(i)}
              onFocus={() => {
                props.onFocus();
                setHover(i);
              }}
              onBlur={() => setHover(null)}
              onClick={() => c.actionable && onSelect?.(i)}
              className={cn(
                "absolute inset-y-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                c.actionable && onSelect ? "cursor-pointer" : "cursor-default",
              )}
              style={{ left: i * slot, width: Math.max(1, slot) }}
            />
          );
        })}
      </div>
      {shown !== null && columns[shown] && (
        <ChartTooltip
          x={gutter + shown * slot + slot / 2}
          y={Math.max(0, y(columns[shown].value) - 64)}
          width={width}
          boxWidth={200}
          value={columns[shown].valueText}
          lines={[columns[shown].label, ...columns[shown].lines]}
        />
      )}
    </div>
  );
}

/** A box of the chart's own size, for while the counts load. */
export function ColumnChartSkeleton() {
  return (
    <div aria-hidden className="relative" style={{ height: TOP_ROOM + COLUMN_PLOT_HEIGHT + AXIS_BAND }}>
      <div className="absolute inset-x-0 animate-pulse rounded bg-muted/70" style={{ top: TOP_ROOM, height: COLUMN_PLOT_HEIGHT }} />
    </div>
  );
}
