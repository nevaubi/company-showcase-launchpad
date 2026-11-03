import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

export interface WaterfallStep {
  id: string;
  label: string;
  value: number;
  /** Totals start from zero (first and last bars); others float */
  total?: boolean;
  onSelect?: () => void;
}

/** Bridge chart: start total, signed contributions, end total. */
export function Waterfall({ steps, height = 240, format, className }: { steps: WaterfallStep[]; height?: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(240, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let run = 0;
  const bars = steps.map((s) => {
    if (s.total) {
      run = s.value;
      return { ...s, y0: 0, y1: s.value };
    }
    const y0 = run;
    run += s.value;
    return { ...s, y0, y1: run };
  });
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.y0, b.y1)));
  const hi = Math.max(...bars.map((b) => Math.max(b.y0, b.y1)));
  // Zoom into the moving part so small contributions stay visible.
  const floor = lo >= 0 ? Math.max(0, Math.min(...bars.filter((b) => !b.total).map((b) => Math.min(b.y0, b.y1)), hi) * 0.85) : lo;
  const margin = { top: 16, right: 8, bottom: 44, left: 52 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;
  const x = d3.scaleBand().domain(bars.map((b) => b.id)).range([0, iw]).padding(0.25);
  const y = d3.scaleLinear().domain([floor, hi]).nice().range([ih, 0]);

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)}>
      <svg width={width} height={height} className="block">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {y.ticks(4).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeDasharray="2 3" />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {format(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const top = y(Math.max(b.y0, b.y1));
            const h = Math.max(1, Math.abs(y(Math.max(floor, b.y0)) - y(Math.max(floor, b.y1))));
            const color = b.total ? "var(--foreground)" : b.value >= 0 ? "var(--positive)" : "var(--negative)";
            const next = bars[i + 1];
            return (
              <g key={b.id} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}>
                <rect
                  x={x(b.id)}
                  y={b.total ? y(b.y1) : top}
                  width={x.bandwidth()}
                  height={b.total ? ih - y(b.y1) : h}
                  fill={color}
                  opacity={hover && hover !== b.id ? 0.5 : b.total ? 0.85 : 0.9}
                  rx={1}
                  className={cn(b.onSelect && "cursor-pointer")}
                  onClick={b.onSelect}
                />
                {next && (
                  <line
                    x1={(x(b.id) ?? 0) + x.bandwidth()}
                    x2={x(next.id)}
                    y1={y(b.y1)}
                    y2={y(b.y1)}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="2 2"
                  />
                )}
                <text x={(x(b.id) ?? 0) + x.bandwidth() / 2} y={(b.total ? y(b.y1) : top) - 4} textAnchor="middle" className="fill-foreground font-mono text-[9px]">
                  {b.total ? format(b.value) : `${b.value >= 0 ? "+" : "−"}${format(Math.abs(b.value))}`}
                </text>
                <foreignObject x={(x(b.id) ?? 0) - 6} y={ih + 4} width={x.bandwidth() + 12} height={38}>
                  <p className="line-clamp-2 text-center text-[10px] leading-tight text-muted-foreground">{b.label}</p>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
