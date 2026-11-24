import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

export interface CurveLine {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: { label: string; years: number; value: number }[];
}

/** Treasury yield curve plotted on a log-maturity axis. */
export function YieldCurveChart({ lines, height = 260, className }: { lines: CurveLine[]; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(260, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(260, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = { t: 14, r: 56, b: 26, l: 40 };
  const tenors = lines[0]?.points ?? [];
  const all = lines.flatMap((l) => l.points.map((p) => p.value));
  const x = d3
    .scaleLog()
    .domain([1 / 12, 30])
    .range([m.l, width - m.r]);
  const y = d3
    .scaleLinear()
    .domain(all.length ? [Math.min(...all) - 0.15, Math.max(...all) + 0.15] : [0, 5])
    .nice()
    .range([height - m.b, m.t]);
  const line = d3
    .line<{ years: number; value: number }>()
    .x((p) => x(p.years))
    .y((p) => y(p.value))
    .curve(d3.curveMonotoneX);

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg width={width} height={height} className="overflow-visible">
        {y.ticks(5).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
              {t.toFixed(1)}%
            </text>
          </g>
        ))}
        {tenors.map((p, i) => (
          <g key={p.label}>
            <text x={x(p.years)} y={height - 8} textAnchor="middle" className={cn("fill-muted-foreground font-mono text-[10px]", hover === i && "fill-foreground")}>
              {p.label}
            </text>
            <rect
              x={x(p.years) - 14}
              y={m.t}
              width={28}
              height={height - m.t - m.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
        {hover != null && tenors[hover] && <line x1={x(tenors[hover].years)} x2={x(tenors[hover].years)} y1={m.t} y2={height - m.b} stroke="var(--muted-foreground)" strokeWidth={0.75} />}
        {lines.map((l) => (
          <g key={l.id}>
            <path d={line(l.points) ?? ""} fill="none" stroke={l.color} strokeWidth={l.dashed ? 1.25 : 2} strokeDasharray={l.dashed ? "4 3" : undefined} />
            {l.points.map((p) => (
              <circle key={p.label} cx={x(p.years)} cy={y(p.value)} r={hover != null && tenors[hover]?.label === p.label ? 3.5 : 2} fill={l.color} />
            ))}
            {l.points.length > 0 && (
              <text x={width - m.r + 6} y={y(l.points.at(-1)!.value)} dy="0.32em" className="font-mono text-[10px]" fill={l.color}>
                {l.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover != null && tenors[hover] && (
        <div className="pointer-events-none absolute left-2 top-0 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift">
          <p className="font-medium">{tenors[hover].label} Treasury</p>
          {lines.map((l) => {
            const p = l.points.find((q) => q.label === tenors[hover].label);
            return (
              <p key={l.id} className="num flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: l.color }} />
                {l.label}: {p ? `${p.value.toFixed(2)}%` : "—"}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
