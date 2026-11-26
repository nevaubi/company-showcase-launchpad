// Small pieces every IR chart shares: the one-line note that stands in for an empty frame, the source opener, the
// tooltip of one figure and the sparkline of a tile.
import { useCallback, type ReactNode } from "react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import type { Scale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { asFiled, changeLine, decimalsOf, fmtValue } from "./format";
import { changeBetween, priorPeriod, yearAgo } from "./model";
import type { VizPoint, VizSeries } from "./types";

/** A quiet one-line note in place of a chart that has nothing to draw. */
export function VizNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("py-2 text-[12px] leading-5 text-muted-foreground", className)}>{children}</p>
  );
}

/** The opener a chart uses: the caller's, else the app's source viewer. */
export function useOpener(onOpen?: (t: SourceTarget) => void) {
  const { open } = useSource();
  return useCallback(
    (p: VizPoint | null | undefined) => {
      if (!p?.source) return false;
      (onOpen ?? open)(p.source);
      return true;
    },
    [onOpen, open],
  );
}

/** The lines of one figure's tooltip after its value: the period, the as-filed cell, YoY and QoQ, a stated caveat. */
export function pointLines(s: VizSeries, p: VizPoint): string[] {
  const out = [p.periodLabel, asFiled(p)];
  const yoy = changeLine("YoY", changeBetween(p, yearAgo(s, p), s.unit));
  const qoq =
    s.cadence === "y"
      ? null
      : changeLine(s.cadence === "m" ? "MoM" : "QoQ", changeBetween(p, priorPeriod(s, p), s.unit));
  if (yoy) out.push(yoy);
  if (qoq) out.push(qoq);
  if (p.note) out.push(p.note);
  if (!p.source) out.push("No source link for this figure");
  return out;
}

export const valueText = (s: VizSeries, p: VizPoint, scale: Scale) =>
  fmtValue(p.value, s.unit, scale, s.printedUnit, decimalsOf(p));

/** Twelve periods as a quiet line with the latest point marked; a gap stays a gap. */
export function Spark({ values, className }: { values: (number | null)[]; className?: string }) {
  const vs = values.filter((v): v is number => v != null);
  if (vs.length < 2) return null;
  const w = 96;
  const h = 28;
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (i: number) => (values.length === 1 ? w / 2 : 3 + (i / (values.length - 1)) * (w - 6));
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (h - 6);
  const runs: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v == null) {
      if (cur) runs.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) runs.push(cur);
  const last = values.length - 1;
  const lv = values[last];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      {runs.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {lv != null && (
        <circle
          cx={x(last)}
          cy={y(lv)}
          r={2.5}
          fill="var(--chart-1)"
          stroke="var(--card)"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}
