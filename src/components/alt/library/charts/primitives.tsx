import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

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
 * spec, never by its rank. `--chart-5` is the low-chroma de-emphasis grey and is not a slot.
 */
export const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)"] as const;
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
