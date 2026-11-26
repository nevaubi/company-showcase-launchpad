import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { axisText, type Axis } from "@/lib/sources/company/charts";
import { dayLabel, quarterLabel, showCell, unitLabel } from "@/lib/sources/company/present";
import type { FigureRef, OfficialCell } from "@/lib/sources/company/types";
import { recordHref } from "@/lib/sources/links";
import { cn } from "@/lib/utils";

export interface BarPoint {
  period: string;
  value: number | null;
  cell: OfficialCell;
  ref: FigureRef;
}

function useBoxWidth(min: number): [(el: HTMLDivElement | null) => void, number] {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(240);
  useEffect(() => {
    if (!box) return;
    if (box.clientWidth) setWidth(Math.max(min, box.clientWidth));
    const ro = new ResizeObserver(e => setWidth(Math.max(min, Math.round(e[0].contentRect.width))));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box, min]);
  return [setBox, width];
}

/**
 * A few quarters of one amount as columns from a zero baseline (dataviz: at most 24 px wide, a 4 px rounded data end,
 * the value on the cap where it fits). Each column is its own hit target and tab stop: hover or focus shows the stored
 * figure with its unit, a click or Enter opens the record.
 */
export function QuarterColumns({ points, unit, axis, label, height = 132 }: { points: BarPoint[]; unit: string; axis: Axis; label: string; height?: number }) {
  const router = useRouter();
  const [ref, width] = useBoxWidth(160);
  const [active, setActive] = useState<number | null>(null);
  const M = { top: 16, right: 4, bottom: 18, left: Math.max(26, ...axis.ticks.map(t => t.text.length * 6 + 8)) };
  const iw = width - M.left - M.right, ih = height - M.top - M.bottom;
  const y = (v: number) => M.top + ih - ((v - axis.min) / (axis.max - axis.min || 1)) * ih;
  const band = iw / Math.max(1, points.length);
  const bar = Math.min(24, band * 0.5);
  const open = (p: BarPoint) => router.history.push(recordHref(p.ref.dataset, p.ref.snapshot, p.ref.row));
  const at = active != null ? points[active] : null;
  return (
    <div ref={ref} className="relative" role="group" aria-label={`${label}, ${axis.title}`}>
      <svg width={width} height={height} className="block" aria-hidden>
        {axis.ticks.map(t => (
          <g key={t.value}>
            <line x1={M.left} x2={M.left + iw} y1={y(t.value)} y2={y(t.value)} stroke="var(--border)" />
            <text x={M.left - 6} y={y(t.value)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{t.text}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = M.left + band * i + band / 2;
          const top = p.value == null ? y(0) : y(Math.max(0, p.value));
          const base = p.value == null ? y(0) : y(Math.min(0, p.value));
          const h = Math.max(0, base - top);
          const r = Math.min(4, h, bar / 2);
          const up = (p.value ?? 0) >= 0;
          const d = up
            ? `M${cx - bar / 2},${base}V${top + r}Q${cx - bar / 2},${top} ${cx - bar / 2 + r},${top}H${cx + bar / 2 - r}Q${cx + bar / 2},${top} ${cx + bar / 2},${top + r}V${base}Z`
            : `M${cx - bar / 2},${top}V${base - r}Q${cx - bar / 2},${base} ${cx - bar / 2 + r},${base}H${cx + bar / 2 - r}Q${cx + bar / 2},${base} ${cx + bar / 2},${base - r}V${top}Z`;
          const text = p.value == null ? "" : axisText(p.value, axis);
          return (
            <g key={p.period}>
              {p.value != null && <path d={d} fill="var(--chart-1)" opacity={active == null || active === i ? 1 : 0.55} />}
              {text && text.length * 6 <= band && <text x={cx} y={(up ? top : base) - 4} textAnchor="middle" className="fill-foreground font-mono text-[10px]">{text}</text>}
              <text x={cx} y={height - 4} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{quarterLabel(p.period)}</text>
            </g>
          );
        })}
      </svg>
      {points.map((p, i) => {
        const shown = showCell(p.cell, unit);
        return (
          <button
            key={p.period}
            type="button"
            className="absolute rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ left: M.left + band * i, top: 0, width: band, height: height - M.bottom + 2 }}
            aria-label={`${quarterLabel(p.period)}: ${shown.text || "empty"} ${unitLabel(unit)}. Opens the stored record.`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={() => open(p)}
          />
        );
      })}
      {at && (
        <div className="pointer-events-none absolute z-10 rounded-[4px] border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left: Math.min(Math.max(0, M.left + band * (active ?? 0) + band / 2 - 90), Math.max(0, width - 180)), top: 0, width: 180 }}>
          <div className="num text-[13px] font-semibold text-foreground">
            {showCell(at.cell, unit).text || "empty"} <span className="text-[11px] font-normal text-muted-foreground">{unitLabel(unit)}</span>
          </div>
          <div className="text-muted-foreground">{dayLabel(at.period)}, row {at.ref.row.toLocaleString("en-US")}</div>
          <div className="text-muted-foreground">Click or press Enter to open the record</div>
        </div>
      )}
    </div>
  );
}

export interface RatioLine {
  key: string;
  label: string;
  color: string;
  points: BarPoint[];
}

/**
 * Several ratios of one unit over a few quarters on one axis: 2 px lines, a dot at every quarter (few points), the
 * label and latest value at each line's end where the ends separate, otherwise in the legend only. A crosshair per
 * quarter reads every line at once; a click or Enter opens the first line's record of that quarter, and each value in
 * the readout is a link to its own record.
 */
export function RatioLines({ lines, axis, label, height = 176, unit }: { lines: RatioLine[]; axis: Axis; label: string; height?: number; unit: string }) {
  const router = useRouter();
  const [ref, width] = useBoxWidth(220);
  const [active, setActive] = useState<number | null>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const periods = lines[0]?.points.map(p => p.period) ?? [];
  const labelWidth = Math.min(170, Math.max(...lines.map(l => l.label.length * 6 + 44), 80));
  const roomy = width >= 420;
  const M = { top: 10, right: roomy ? labelWidth : 40, bottom: 18, left: Math.max(24, ...axis.ticks.map(t => t.text.length * 6 + 8)) };
  const iw = Math.max(60, width - M.left - M.right), ih = height - M.top - M.bottom;
  const x = (i: number) => M.left + (periods.length > 1 ? (i / (periods.length - 1)) * iw : iw / 2);
  const y = (v: number) => M.top + ih - ((v - axis.min) / (axis.max - axis.min || 1)) * ih;
  // end labels only where every pair of line ends is at least 12 px apart
  const ends = lines.map(l => {
    const last = [...l.points].reverse().find(p => p.value != null);
    return { key: l.key, y: last ? y(last.value!) : null };
  });
  const separate = ends.every((a, i) => ends.every((b, j) => i === j || a.y == null || b.y == null || Math.abs(a.y - b.y) >= 12));
  const say = (i: number) => `${quarterLabel(periods[i])}: ${lines.map(l => `${l.label} ${showCell(l.points[i]?.cell, unit, { decimals: "stored" }).text}`).join(", ")}`;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!periods.length) return;
    const pos = active ?? periods.length - 1;
    let to = pos;
    if (e.key === "ArrowLeft") to = Math.max(0, pos - 1);
    else if (e.key === "ArrowRight") to = Math.min(periods.length - 1, pos + 1);
    else if (e.key === "Enter" && active != null) {
      const p = lines[0]?.points[active];
      if (p) router.history.push(recordHref(p.ref.dataset, p.ref.snapshot, p.ref.row));
      return;
    } else return;
    e.preventDefault();
    setActive(to);
    if (live.current) live.current.textContent = say(to);
  };
  const nearest = (clientX: number, el: HTMLElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    periods.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    return best;
  };
  return (
    <div ref={ref} className="relative">
      <div
        tabIndex={0}
        role="group"
        aria-label={`${label}, ${axis.title}. Arrow keys read each quarter; Enter opens its stored record.`}
        onPointerMove={e => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onClick={() => {
          const p = active != null ? lines[0]?.points[active] : null;
          if (p) router.history.push(recordHref(p.ref.dataset, p.ref.snapshot, p.ref.row));
        }}
        className="relative cursor-crosshair rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ height }}
      >
        <svg width={width} height={height} className="block" aria-hidden>
          {axis.ticks.map(t => (
            <g key={t.value}>
              <line x1={M.left} x2={M.left + iw} y1={y(t.value)} y2={y(t.value)} stroke="var(--border)" />
              <text x={M.left - 6} y={y(t.value)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{t.text}</text>
            </g>
          ))}
          {periods.map((p, i) => (
            <text key={p} x={x(i)} y={height - 4} textAnchor={periods.length > 1 && i === 0 ? "start" : periods.length > 1 && i === periods.length - 1 ? "end" : "middle"} className="fill-muted-foreground font-mono text-[10px]">{quarterLabel(p)}</text>
          ))}
          {active != null && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + ih} stroke="var(--foreground)" strokeOpacity={0.35} />}
          {lines.map(l => {
            let d = "";
            let pen = false;
            l.points.forEach((p, i) => {
              if (p.value == null) {
                pen = false;
                return;
              }
              d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
              pen = true;
            });
            const lastIndex = l.points.map(p => p.value != null).lastIndexOf(true);
            return (
              <g key={l.key}>
                <path d={d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {l.points.map((p, i) => (p.value == null ? null : <circle key={p.period} cx={x(i)} cy={y(p.value)} r={4} fill={l.color} stroke="var(--card)" strokeWidth={2} />))}
                {roomy && separate && lastIndex >= 0 && (
                  <text x={x(lastIndex) + 8} y={y(l.points[lastIndex].value!)} dy="0.32em" className="fill-foreground text-[11px]">
                    <tspan className="font-mono">{showCell(l.points[lastIndex].cell, unit, { decimals: 2 }).text}</tspan>
                    <tspan className="fill-muted-foreground"> {l.label}</tspan>
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {active != null && (
          <div className="pointer-events-none absolute top-0 z-10 rounded-[4px] border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left: Math.min(Math.max(0, x(active) + 10), Math.max(0, width - 220)), width: 220 }}>
            <p className="mb-0.5 text-muted-foreground">{dayLabel(periods[active])}, as filed</p>
            {lines.map(l => (
              <p key={l.key} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: l.color }} />
                <span className="num font-semibold text-foreground">{showCell(l.points[active]?.cell, unit, { decimals: "stored" }).text}</span>
                <span className="truncate text-muted-foreground">{l.label}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Legend">
        {lines.map(l => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: l.color }} />
            {l.label}
          </li>
        ))}
      </ul>
      <p ref={live} aria-live="polite" className="sr-only" />
    </div>
  );
}

/**
 * A sparkline that keeps time: one slot per quarter, a gap where no figure is stored, the line in the quiet hue and
 * the latest quarter as an accent dot (dataviz stat tile). Decorative: the tile states the figures.
 */
export function GapSparkline({ values, className }: { values: (number | null)[]; className?: string }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const W = 100, H = 28;
  const px = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2);
  const py = (v: number) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${px(i).toFixed(2)},${py(v).toFixed(2)}`;
    pen = true;
  });
  const lastIndex = values.map(v => v != null).lastIndexOf(true);
  // the dot is an element over the stretched drawing, so it stays round at any width
  return (
    <div className={cn("relative h-7 w-full", className)} aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={d} fill="none" stroke="var(--chart-5)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--chart-1)] ring-2 ring-card" style={{ left: `${(px(lastIndex) / W) * 100}%`, top: `${(py(values[lastIndex]!) / H) * 100}%` }} />
    </div>
  );
}
