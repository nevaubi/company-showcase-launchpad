import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import * as d3 from "d3";

/**
 * Shared pieces of the round 6 charts: a width observer that measures before paint, the reduced-motion preference,
 * the categorical slots in their fixed order and the tooltip box. Marks follow the dataviz specs: 2px lines, an end
 * dot with a 2px surface ring, bars at most 24px thick with a 4px rounded data end, hairline solid gridlines.
 */

/** Measures before paint in the browser, so a chart never shows one frame at a guessed width. */
export const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The element's content width (at least `min`), kept current by a ResizeObserver. */
export function useWidth(min: number, initial = 360): [(el: HTMLDivElement | null) => void, number, HTMLDivElement | null] {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useBrowserLayoutEffect(() => {
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(min, el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(min, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [ref, width, el];
}

/** True when the reader asked for less motion: transitions are then left out. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * The categorical slots in their fixed order (the app's chart tokens). A series keeps its slot by its place in the
 * spec, never by its rank. `--chart-5` is the low-chroma de-emphasis grey and is not a slot. The order was chosen with
 * the dataviz validator over every order that keeps `--chart-1` first: blue, red-orange, teal, amber, green has the
 * best worst adjacent pair under colour-vision deficiency (Delta E 14.6 light, 9.7 dark) and under normal vision
 * (25.5, 18.9). The tokens' own lightness and chroma, and amber's contrast on the light card (2.15:1), are relieved by
 * the direct labels, legends and table views every multi-series chart carries.
 */
export const SLOTS = ["var(--chart-1)", "var(--chart-4)", "var(--chart-6)", "var(--chart-2)", "var(--chart-3)"] as const;
/** The quiet line of a comparison (a year earlier) and other context marks. */
export const QUIET = "var(--chart-5)";

export const slot = (i: number) => SLOTS[i % SLOTS.length];

/** The true minus sign. */
export const MINUS = "−";

/** One tooltip: the value leads in strong type, the lines after it are quieter. Positioned within the chart's box. */
export function ChartTooltip({
  x,
  y = 0,
  width,
  value,
  lines,
  keyColor,
  boxWidth = 168,
}: {
  /** Horizontal position of the mark within the chart box, px. */
  x: number;
  y?: number;
  /** Width of the chart box, px: the tooltip stays inside it. */
  width: number;
  value: ReactNode;
  lines: ReactNode[];
  /** A short line key in the series colour beside the value, for a multi-series readout. */
  keyColor?: string;
  boxWidth?: number;
}) {
  const left = Math.min(Math.max(x - boxWidth / 2, 0), Math.max(0, width - boxWidth));
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift"
      style={{ left, top: y, width: boxWidth }}
      role="status"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        {keyColor && <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: keyColor }} />}
        <span className="num">{value}</span>
      </p>
      {lines.map((line, i) => (
        <p key={i} className="text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

/** A multi-series readout: one row per series, a line key in its colour, the value leading. */
export function SeriesReadout({
  x,
  width,
  title,
  rows,
  boxWidth = 200,
}: {
  x: number;
  width: number;
  title: string;
  rows: { key: string; color: string; label: string; value: string }[];
  boxWidth?: number;
}) {
  const left = Math.min(Math.max(x - boxWidth / 2, 0), Math.max(0, width - boxWidth));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift"
      style={{ left, width: boxWidth }}
      role="status"
    >
      <p className="mb-0.5 text-muted-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.key} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="num font-semibold text-foreground">{r.value}</span>
          <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

/** Time-axis ticks: one per year (every two or five on long spans) from two years on, months below. */
export function timeTicks(x: d3.ScaleTime<number, number>, width: number): { ticks: Date[]; format: (d: Date) => string } {
  const [a, b] = x.domain();
  const span = (b.getTime() - a.getTime()) / 86_400_000;
  if (span > 700) {
    const every = span > 3700 ? 5 : span > 1900 ? 2 : 1;
    return { ticks: x.ticks(d3.utcYear.every(every) as d3.TimeInterval), format: d3.utcFormat("%Y") };
  }
  return { ticks: x.ticks(width < 360 ? 3 : 4), format: d3.utcFormat(span > 120 ? "%b %Y" : "%b %d") };
}

/** A UTC date of an ISO day. */
export const day = (iso: string | undefined) => new Date(`${iso ?? "1970-01-01"}T00:00:00Z`);

/** The legend of a multi-series chart: a short line key (or a swatch for fills) beside each name, in spec order. */
export function SeriesLegend({ items, fill = false }: { items: { key: string; label: string; color: string }[]; fill?: boolean }) {
  return (
    <ul className="mb-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground" aria-label="Legend">
      {items.map((i) => (
        <li key={i.key} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={fill ? "inline-block size-2 shrink-0 rounded-[2px]" : "inline-block h-0.5 w-3 shrink-0 rounded-full"} style={{ background: i.color }} />
          <span className="truncate">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}
