import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { axisText, type Axis } from "@/lib/sources/company/charts";
import { dayLabel, quarterLabel, showCell, unitLabel } from "@/lib/sources/company/present";
import type { FigureRef, OfficialCell } from "@/lib/sources/company/types";
import { recordHref } from "@/lib/sources/links";
import { cn } from "@/lib/utils";

/** One quarter of a series: the figure drawn (null: a gap), the stored cell and its record. */
export interface QuarterPoint {
  period: string;
  value: number | null;
  cell: OfficialCell;
  ref: FigureRef;
}

const time = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * One series by quarter (dataviz: a 2 px line, an end dot with a surface ring and the latest value beside it, hairline
 * grid, one value axis in the unit `axis` names), a crosshair that snaps to the nearest quarter, a tooltip that leads
 * with the stored figure and its unit, and every quarter one click (or Enter) from its stored record. A stored cell
 * that is not a number breaks the line. `span` shares one time axis across the charts of a small multiple.
 */
export function QuarterChart({
  points,
  unit,
  axis,
  label,
  sourceName,
  height = 168,
  span,
  compact = false,
}: {
  points: QuarterPoint[];
  /** The stored unit, for the tooltip. */
  unit: string;
  axis: Axis;
  label: string;
  sourceName: (p: QuarterPoint) => string;
  height?: number;
  span?: [string, string];
  /** A small multiple: three ticks at most, decade years. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);
  const live = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!box) return;
    if (box.clientWidth) setWidth(Math.max(200, box.clientWidth));
    const ro = new ResizeObserver(e => setWidth(Math.max(200, Math.round(e[0].contentRect.width))));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const drawn = useMemo(() => points.map((p, i) => ({ ...p, i })).filter(p => p.value != null), [points]);
  const ticks = useMemo(() => (compact && axis.ticks.length > 3 ? axis.ticks.filter((_, i, a) => i === 0 || i === a.length - 1 || i === Math.floor((a.length - 1) / 2)) : axis.ticks), [axis.ticks, compact]);
  const left = Math.max(28, ...ticks.map(t => t.text.length * 6 + 8));
  const M = { top: 10, right: compact ? 40 : 52, bottom: 20, left };
  const geo = useMemo(() => {
    const iw = Math.max(60, width - M.left - M.right), ih = height - M.top - M.bottom;
    const t0 = time(span?.[0] ?? points[0]?.period ?? "2000-03-31"), t1 = time(span?.[1] ?? points[points.length - 1]?.period ?? "2026-09-30");
    const x = (iso: string) => M.left + ((time(iso) - t0) / Math.max(1, t1 - t0)) * iw;
    const y = (v: number) => M.top + ih - ((v - axis.min) / (axis.max - axis.min || 1)) * ih;
    let path = "";
    let pen = false;
    for (const p of points) {
      if (p.value == null) {
        pen = false;
        continue;
      }
      path += `${pen ? "L" : "M"}${x(p.period).toFixed(1)},${y(p.value).toFixed(1)}`;
      pen = true;
    }
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    const every = compact || iw < 300 ? 10 : 5;
    const years: number[] = [];
    for (let yr = Math.ceil((y0 + 1) / every) * every; yr <= y1; yr += every) years.push(yr);
    return { iw, ih, x, y, path, years };
  }, [points, width, height, axis, span, compact, M.left, M.right, M.top, M.bottom]);

  const at = active != null ? points[active] : null;
  const last = drawn[drawn.length - 1];
  const open = (p: QuarterPoint | null) => p && router.history.push(recordHref(p.ref.dataset, p.ref.snapshot, p.ref.row));
  const say = (p: QuarterPoint) => `${quarterLabel(p.period)}: ${p.value == null ? "no figure" : `${showCell(p.cell, unit).text} ${unitLabel(unit)}`}`;
  const nearest = (clientX: number) => {
    const rect = box?.getBoundingClientRect();
    if (!rect || !drawn.length) return null;
    const px = clientX - rect.left;
    let best = drawn[0], dist = Infinity;
    for (const p of drawn) {
      const dx = Math.abs(geo.x(p.period) - px);
      if (dx < dist) {
        dist = dx;
        best = p;
      }
    }
    return best.i;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!drawn.length) return;
    const pos = active == null ? drawn.length - 1 : drawn.findIndex(p => p.i === active);
    let to = pos;
    if (e.key === "ArrowLeft") to = Math.max(0, pos - 1);
    else if (e.key === "ArrowRight") to = Math.min(drawn.length - 1, pos + 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = drawn.length - 1;
    else if (e.key === "Enter" && at) {
      e.preventDefault();
      open(at);
      return;
    } else return;
    e.preventDefault();
    setActive(drawn[to].i);
    if (live.current) live.current.textContent = say(points[drawn[to].i]);
  };
  const tipWidth = 180;
  const tipLeft = at ? Math.min(Math.max(geo.x(at.period) + 10, 0), Math.max(0, width - tipWidth)) : 0;
  return (
    <div className="relative">
      <div
        ref={setBox}
        tabIndex={0}
        role="group"
        aria-label={`${label}, ${axis.title}. Arrow keys read each quarter; Enter opens its stored record.`}
        onPointerMove={(e: PointerEvent<HTMLDivElement>) => setActive(nearest(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onClick={() => open(at)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className={cn("relative cursor-crosshair rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        style={{ height }}
      >
        <svg width={width} height={height} className="block" aria-hidden>
          {ticks.map(t => (
            <g key={t.value}>
              <line x1={M.left} x2={M.left + geo.iw} y1={geo.y(t.value)} y2={geo.y(t.value)} stroke="var(--border)" strokeWidth={t.value === 0 && axis.min < 0 ? 1.25 : 1} />
              <text x={M.left - 6} y={geo.y(t.value)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{t.text}</text>
            </g>
          ))}
          {geo.years.map(yr => (
            <text key={yr} x={geo.x(`${yr}-01-01`)} y={height - 5} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{yr}</text>
          ))}
          <path d={geo.path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last && (
            <>
              <circle cx={geo.x(last.period)} cy={geo.y(last.value!)} r={4} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />
              <text x={geo.x(last.period) + 7} y={geo.y(last.value!)} dy="0.32em" className="fill-foreground font-mono text-[10px]">{axisText(last.value!, axis)}</text>
            </>
          )}
          {at && at.value != null && (
            <>
              <line x1={geo.x(at.period)} x2={geo.x(at.period)} y1={M.top} y2={M.top + geo.ih} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
              <circle cx={geo.x(at.period)} cy={geo.y(at.value)} r={4} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
        {at && (
          <div className="pointer-events-none absolute top-1 z-10 rounded-[4px] border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left: tipLeft, width: tipWidth }}>
            <div className="num text-[13px] font-semibold text-foreground">
              {showCell(at.cell, unit).text || "empty"} <span className="text-[11px] font-normal text-muted-foreground">{unitLabel(unit)}</span>
            </div>
            <div className="text-muted-foreground">
              {quarterLabel(at.period)} · {dayLabel(at.period)}
            </div>
            <div className="truncate text-muted-foreground">{sourceName(at)}, row {at.ref.row.toLocaleString("en-US")}</div>
            <div className="text-muted-foreground">Click or press Enter to open the record</div>
          </div>
        )}
      </div>
      <p ref={live} aria-live="polite" className="sr-only" />
    </div>
  );
}
