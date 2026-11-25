import { useEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import type { TilePoint } from "@/lib/sources/boards/types";

/**
 * The chart of one tile: one series, so no legend (the tile's title names it). A line breaks at a gap
 * (a period without a figure is never drawn as zero or bridged), bars grow from a zero baseline, ranked bars
 * carry their value at the tip. Hover or focus shows the value, its period and the unit; a click opens the
 * record behind the mark. Marks follow the dataviz specs: 2px lines, an end dot with a surface ring, bars at
 * most 24px thick with a 4px rounded data end, hairline solid gridlines.
 */
export const TILE_CHART_HEIGHT = 180;

type Props = {
  form: "line" | "bars" | "ranked-bars";
  points: TilePoint[];
  /** The unit of the plotted values, for the tooltip. */
  unit: string;
  /** Accessible name of the chart. */
  label: string;
  /** Address of a record, for a click on a mark. */
  recordHref: (row: number) => string;
  onOpen: (href: string) => void;
};

const COLOR = "var(--chart-1)";

/** "Q3 2026" becomes "Q3 26" under a column; other labels stay as they are. */
const shortLabel = (label: string) => label.replace(/^Q(\d) \d{2}(\d{2})$/, "Q$1 $2");
const MINUS = "−";

/** Axis ticks: in full below 10,000, compact (K, M, B, T) above, with a true minus sign. */
export function tickFormat(v: number, step: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  if (abs >= 10_000) {
    for (const [size, suffix] of units) {
      if (abs >= size) {
        const scaled = abs / size;
        const places = step / size >= 1 ? 0 : step / size >= 0.1 ? 1 : 2;
        return `${sign}${scaled.toFixed(places).replace(/\.0+$/, "")}${suffix}`;
      }
    }
  }
  const places = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;
}

function useWidth(min: number): [(el: HTMLDivElement | null) => void, number] {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(min, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(min, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [ref, width];
}

function Tooltip({ point, unit, x, width }: { point: TilePoint; unit: string; x: number; width: number }) {
  const left = Math.min(Math.max(x - 70, 0), Math.max(0, width - 150));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-[150px] rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift"
      style={{ left }}
      role="status"
    >
      <p className="num text-[13px] font-semibold">{point.value === null ? "–" : point.display}</p>
      <p className="text-muted-foreground">{point.value === null ? "No figure in the source" : unit}</p>
      <p className="text-muted-foreground">{point.label}</p>
    </div>
  );
}

function LineChart({ points, unit, label, recordHref, onOpen }: Omit<Props, "form">) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const height = TILE_CHART_HEIGHT;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const last = [...points].reverse().find((p) => p.value !== null) ?? null;
  const endText = last?.display ?? "";
  const margin = { top: 10, right: Math.max(28, endText.length * 6.4 + 12), bottom: 20, left: 40 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = height - margin.top - margin.bottom;

  const { x, y, ticks, step } = useMemo(() => {
    const dates = points.map((p) => new Date(`${p.date ?? "1970-01-01"}T00:00:00Z`));
    const x = d3.scaleUtc().domain(d3.extent(dates) as [Date, Date]).range([0, iw]);
    const lo = d3.min(values) ?? 0;
    const hi = d3.max(values) ?? 1;
    const y = d3
      .scaleLinear()
      .domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi])
      .nice(4)
      .range([ih, 0]);
    const ticks = y.ticks(4);
    const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
    return { x, y, ticks, step };
  }, [points, values, iw, ih]);

  const xy = points.map((p) => ({ p, px: x(new Date(`${p.date}T00:00:00Z`)), py: p.value === null ? null : y(p.value) }));
  const path = d3
    .line<(typeof xy)[number]>()
    .defined((d) => d.py !== null)
    .x((d) => d.px)
    .y((d) => d.py as number)(xy);
  const years = x.ticks(width < 360 ? 3 : 4);
  const span = (x.domain()[1].getTime() - x.domain()[0].getTime()) / 86_400_000;
  const xFormat = span > 700 ? d3.utcFormat("%Y") : d3.utcFormat("%b %Y");
  const zeroInside = y.domain()[0] < 0 && y.domain()[1] > 0;
  const lastXy = last ? xy.find((d) => d.p === last) : null;
  const hovered = hover === null ? null : xy[hover];

  const nearest = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left - margin.left;
    let best = 0;
    for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i].px - mx) < Math.abs(xy[best].px - mx)) best = i;
    return best;
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} className="block" role="img" aria-label={label}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={t === 0 && zeroInside ? 1 : 0.7} />
              <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {tickFormat(t, step)}
              </text>
            </g>
          ))}
          {zeroInside && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.5} shapeRendering="crispEdges" />}
          {years.map((t) => (
            <text key={+t} x={x(t)} y={ih + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
              {xFormat(t)}
            </text>
          ))}
          {path && <path d={path} fill="none" stroke={COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {lastXy && lastXy.py !== null && (
            <>
              <circle cx={lastXy.px} cy={lastXy.py} r={4} fill={COLOR} stroke="var(--card)" strokeWidth={2} />
              <text x={lastXy.px + 8} y={lastXy.py} dy="0.32em" className="fill-foreground font-mono text-[10px] font-medium">
                {endText}
              </text>
            </>
          )}
          {hovered && (
            <g pointerEvents="none">
              <line x1={hovered.px} x2={hovered.px} y1={0} y2={ih} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} />
              {hovered.py !== null && <circle cx={hovered.px} cy={hovered.py} r={4} fill={COLOR} stroke="var(--card)" strokeWidth={2} />}
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
              const i = nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect());
              onOpen(recordHref(xy[i].p.row));
            }}
          />
        </g>
      </svg>
      {hovered && <Tooltip point={hovered.p} unit={unit} x={hovered.px + margin.left} width={width} />}
    </div>
  );
}

function ColumnChart({ points, unit, label, recordHref, onOpen }: Omit<Props, "form">) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const height = TILE_CHART_HEIGHT;
  const margin = { top: 16, right: 8, bottom: 20, left: 40 };
  const iw = Math.max(40, width - margin.left - margin.right);
  const ih = height - margin.top - margin.bottom;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const lo = Math.min(0, d3.min(values) ?? 0);
  const hi = Math.max(0, d3.max(values) ?? 1);
  const y = d3.scaleLinear().domain(lo === hi ? [0, 1] : [lo, hi]).nice(4).range([ih, 0]);
  const ticks = y.ticks(4);
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const band = d3.scaleBand<number>().domain(points.map((_, i) => i)).range([0, iw]).paddingInner(0.2);
  const bar = Math.min(24, Math.max(2, band.bandwidth()));
  const every = Math.max(1, Math.ceil(points.length / (width < 360 ? 4 : 6)));
  const lastIndex = points.length - 1;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} className="block" role="img" aria-label={label}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" opacity={t === 0 ? 1 : 0.7} />
              <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {tickFormat(t, step)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = (band(i) ?? 0) + band.bandwidth() / 2;
            if (p.value === null) return null;
            const top = y(Math.max(0, p.value));
            const h = Math.max(1, Math.abs(y(p.value) - y(0)));
            const r = Math.min(4, bar / 2, h);
            const up = p.value >= 0;
            const x0 = cx - bar / 2;
            const d = up
              ? `M${x0},${top + h}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bar - r}Q${x0 + bar},${top} ${x0 + bar},${top + r}V${top + h}Z`
              : `M${x0},${top}V${top + h - r}Q${x0},${top + h} ${x0 + r},${top + h}H${x0 + bar - r}Q${x0 + bar},${top + h} ${x0 + bar},${top + h - r}V${top}Z`;
            return <path key={p.key} d={d} fill={COLOR} opacity={hover === null || hover === i ? 1 : 0.55} />;
          })}
          {points.map((p, i) =>
            i % every === (lastIndex % every) ? (
              <text key={`x${p.key}`} x={(band(i) ?? 0) + band.bandwidth() / 2} y={ih + 15} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                {shortLabel(p.label)}
              </text>
            ) : null,
          )}
          {points[lastIndex]?.value !== null && points[lastIndex] && (
            <text
              x={(band(lastIndex) ?? 0) + band.bandwidth() / 2}
              y={(points[lastIndex].value as number) >= 0 ? y(points[lastIndex].value as number) - 4 : y(points[lastIndex].value as number) + 11}
              textAnchor="end"
              className="fill-foreground font-mono text-[10px] font-medium"
            >
              {points[lastIndex].display}
            </text>
          )}
          {points.map((p, i) => (
            <rect
              key={`h${p.key}`}
              x={band(i) ?? 0}
              width={band.step()}
              y={0}
              height={ih}
              fill="transparent"
              className="cursor-pointer"
              onPointerMove={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onOpen(recordHref(p.row))}
            />
          ))}
        </g>
      </svg>
      {hover !== null && points[hover] && (
        <Tooltip point={points[hover]} unit={unit} x={margin.left + (band(hover) ?? 0) + band.bandwidth() / 2} width={width} />
      )}
    </div>
  );
}

function RankedBars({ points, unit, label, recordHref, onOpen }: Omit<Props, "form">) {
  const [ref, width] = useWidth(220);
  const max = d3.max(points, (p) => p.value ?? 0) ?? 1;
  const narrow = width < 420;
  const nameWidth = narrow ? 0 : Math.min(190, Math.round(width * 0.38));
  const valueWidth = 92;
  const track = Math.max(40, width - nameWidth - valueWidth - 8);
  const rowHeight = TILE_CHART_HEIGHT / Math.max(points.length, 1);
  return (
    <div ref={ref} style={{ height: TILE_CHART_HEIGHT }}>
      <ul className="flex flex-col" aria-label={label}>
        {points.map((p) => {
          const w = p.value === null ? 0 : Math.max(2, (p.value / max) * track);
          return (
            <li key={p.key} style={{ height: rowHeight }}>
              <a
                href={recordHref(p.row)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpen(recordHref(p.row));
                }}
                title={`${p.label}: ${p.display} ${unit}`}
                className="group flex h-full min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {!narrow && (
                  <span className="shrink-0 truncate text-[11px] text-muted-foreground group-hover:text-foreground" style={{ width: nameWidth }}>
                    {p.label}
                  </span>
                )}
                <span className="relative flex h-full min-w-0 flex-1 items-center">
                  {narrow && <span className="absolute left-0 top-0 max-w-full truncate text-[10px] leading-none text-muted-foreground">{p.label}</span>}
                  <span
                    className="block shrink-0 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                    style={{ width: w, height: Math.min(10, rowHeight - (narrow ? 9 : 6)), marginTop: narrow ? 8 : 0, background: COLOR }}
                  />
                  <span className="num ml-1.5 shrink-0 text-[10px] text-foreground" style={{ marginTop: narrow ? 8 : 0 }}>
                    {p.display}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TileChart(props: Props) {
  if (props.form === "ranked-bars") return <RankedBars {...props} />;
  if (props.form === "bars") return <ColumnChart {...props} />;
  return <LineChart {...props} />;
}
