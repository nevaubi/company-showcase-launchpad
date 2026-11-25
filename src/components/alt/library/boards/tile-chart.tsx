import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import type { ScaleAxis } from "@/lib/sources/boards/scale";
import type { TilePoint } from "@/lib/sources/boards/types";
import { estimateTextWidth, rankLayout } from "./ranked-layout";

/**
 * The chart of one tile: one series, so no legend (the tile's title names it). A line breaks at a gap
 * (a period without a figure is never drawn as zero or bridged), bars grow from a zero baseline, ranked bars
 * carry their value at the tip, or on the name's line where the names sit above the bars (`ranked-layout.ts`).
 * With a reader-scale axis (`scale.ts`) the marks are placed and labelled in the axis unit ("USD trillions"),
 * while the tooltip keeps the stored figure and unit. Hover or focus shows the value, its period and the unit;
 * a click opens the record behind the mark. Marks
 * follow the dataviz specs: 2px lines, an end dot with a surface ring, bars at most 24px thick with a 4px
 * rounded data end, hairline solid gridlines.
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
  /** Height of the plot (TILE_CHART_HEIGHT when not given). A stacked ranking grows past it only when its rows need more. */
  height?: number;
  /** A reader-scale value axis: values are plotted divided by its divisor and labelled with each point's `axisDisplay`. */
  axis?: ScaleAxis;
};

type ChartProps = Omit<Props, "form" | "axis"> & {
  /** The text of a direct label on the chart: the point in the axis unit, else as printed. */
  labelOf: (p: TilePoint) => string;
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

/** Measures before paint in the browser, so a chart never shows one frame at a guessed width. */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useWidth(min: number): [(el: HTMLDivElement | null) => void, number, HTMLDivElement | null] {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(360);
  useBrowserLayoutEffect(() => {
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(min, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(min, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [ref, width, el];
}

let measureCanvas: HTMLCanvasElement | null = null;

/** The rendered width of the widest text in a font, or null where nothing can measure it (no canvas, as in tests). */
function measureWidest(texts: readonly string[], font: string): number | null {
  if (typeof document === "undefined" || /jsdom/i.test(navigator.userAgent)) return null;
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  return texts.reduce((widest, text) => Math.max(widest, ctx.measureText(text).width), 0);
}

/** The chart's two faces: names in the sans, figures (`.num`) in the mono. */
type Fonts = { sans: string; mono: string; loaded: boolean };

/** The font families the chart's text is set in; a new value once the page's fonts have loaded, to measure again. */
function useFonts(el: HTMLElement | null): Fonts | null {
  const [fonts, setFonts] = useState<Fonts | null>(null);
  useBrowserLayoutEffect(() => {
    if (!el) return;
    const style = getComputedStyle(el);
    const sans = style.fontFamily;
    const mono = style.getPropertyValue("--font-mono").trim() || "monospace";
    if (!sans) return;
    let live = true;
    setFonts({ sans, mono, loaded: false });
    // A fallback font measures other widths than the web font it stands in for.
    document.fonts?.ready.then(() => {
      if (live) setFonts({ sans, mono, loaded: true });
    });
    return () => {
      live = false;
    };
  }, [el]);
  return fonts;
}

/** Width of the widest of these texts at this size in this family (estimated when nothing can measure). */
function widestText(texts: readonly string[], size: number, family: string | null): number {
  const measured = family ? measureWidest(texts, `${size}px ${family}`) : null;
  return measured ?? texts.reduce((widest, text) => Math.max(widest, estimateTextWidth(text, size)), 0);
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

function LineChart({ points, unit, label, recordHref, onOpen, height = TILE_CHART_HEIGHT, labelOf }: ChartProps) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const last = [...points].reverse().find((p) => p.value !== null) ?? null;
  const endText = last ? labelOf(last) : "";
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
  const span = (x.domain()[1].getTime() - x.domain()[0].getTime()) / 86_400_000;
  // Years on an axis of two years or more (one tick each, never a year twice), months on a shorter one.
  const years = span > 700 ? x.ticks(d3.utcYear.every(span > 3700 ? 5 : span > 1900 ? 2 : 1) as d3.TimeInterval) : x.ticks(width < 360 ? 3 : 4);
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

function ColumnChart({ points, unit, label, recordHref, onOpen, height = TILE_CHART_HEIGHT, labelOf }: ChartProps) {
  const [ref, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
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
              {labelOf(points[lastIndex])}
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

function RankedBars({ points, unit, label, recordHref, onOpen, height = TILE_CHART_HEIGHT, labelOf }: ChartProps) {
  const [ref, width, el] = useWidth(220);
  const fonts = useFonts(el);
  const values = useMemo(() => points.map(labelOf), [points, labelOf]);
  const labelWidth = useMemo(() => widestText(points.map((p) => p.label), 11, fonts?.sans ?? null), [points, fonts]);
  const valueWidth = useMemo(() => widestText(values, 10, fonts?.mono ?? null), [values, fonts]);
  const layout = rankLayout({ width, labelWidth, valueWidth, count: points.length, height });
  const max = d3.max(points, (p) => p.value ?? 0) ?? 1;
  // Bars from a shared zero; a figure that is not above zero draws no bar.
  const barWidth = (p: TilePoint) => (p.value === null || p.value <= 0 || max <= 0 ? 0 : Math.max(2, (p.value / max) * layout.track));
  return (
    <div ref={ref} style={{ height: layout.height }} data-layout={layout.kind}>
      <ul className="flex flex-col" aria-label={label}>
        {points.map((p, i) => (
          <li key={p.key} style={{ height: layout.rowHeight }}>
            <a
              href={recordHref(p.row)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onOpen(recordHref(p.row));
              }}
              title={`${p.label}: ${p.display} ${unit}`}
              className={`group h-full min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${layout.kind === "column" ? "flex items-center gap-2" : "block"}`}
            >
              {layout.kind === "column" ? (
                <>
                  <span className="shrink-0 truncate text-[11px] text-muted-foreground group-hover:text-foreground" style={{ width: layout.labelWidth }}>
                    {p.label}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center">
                    <span
                      className="block shrink-0 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                      style={{ width: barWidth(p), height: Math.min(10, layout.rowHeight - 6), background: COLOR }}
                    />
                    <span className="num ml-1.5 shrink-0 text-[10px] text-foreground">{values[i]}</span>
                  </span>
                </>
              ) : (
                <>
                  {/* The name on its own line, its value at the line's end; the bar under both spans the whole width. */}
                  <span className="flex h-3 min-w-0 items-baseline gap-2 text-[11px] leading-3">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground">{p.label}</span>
                    <span className="num shrink-0 text-[10px] text-foreground">{values[i]}</span>
                  </span>
                  <span
                    className="mt-px block h-1 rounded-r-[2px] transition-opacity group-hover:opacity-80"
                    style={{ width: barWidth(p), background: COLOR }}
                  />
                </>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const asPrinted = (p: TilePoint) => p.display;
const inAxisUnit = (p: TilePoint) => p.axisDisplay ?? p.display;

export function TileChart({ form, axis, points, ...rest }: Props) {
  // Marks are placed in the axis unit; `display` and the unit stay as stored for the tooltip.
  const plotted = useMemo(
    () => (axis ? points.map((p) => (p.value === null ? p : { ...p, value: p.value / axis.divisor })) : points),
    [points, axis],
  );
  const props: ChartProps = { ...rest, points: plotted, labelOf: axis ? inAxisUnit : asPrinted };
  if (form === "ranked-bars") return <RankedBars {...props} />;
  if (form === "bars") return <ColumnChart {...props} />;
  return <LineChart {...props} />;
}
