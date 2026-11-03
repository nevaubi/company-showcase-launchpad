import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

export interface BarDatum {
  key: string;
  label: string;
  /** stacked values; a single-entry array for simple bars */
  parts: { id: string; value: number; color: string }[];
  highlight?: boolean;
}

/** Column chart with optional stacking and click-through per bar segment. */
export function BarChart({
  data,
  height = 220,
  yFormat = (v) => d3.format("~s")(v),
  onSelect,
  className,
  showValues = false,
}: {
  data: BarDatum[];
  height?: number;
  yFormat?: (v: number) => string;
  onSelect?: (d: BarDatum, partId: string) => void;
  className?: string;
  showValues?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(200, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(200, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const margin = { top: showValues ? 18 : 8, right: 8, bottom: 26, left: 44 };
  const iw = width - margin.left - margin.right;
  const ih = height - margin.top - margin.bottom;
  const totals = data.map((d) => d.parts.reduce((s, p) => s + Math.max(0, p.value), 0));
  const mins = data.map((d) => d.parts.reduce((s, p) => s + Math.min(0, p.value), 0));
  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.key))
    .range([0, iw])
    .padding(0.28);
  const y = d3
    .scaleLinear()
    .domain([Math.min(0, d3.min(mins) ?? 0), d3.max(totals) ?? 1])
    .nice()
    .range([ih, 0]);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)}>
      <svg width={width} height={height} className="block">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {y.ticks(4).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "2 3"} />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            let pos = 0;
            let neg = 0;
            return (
              <g key={d.key} transform={`translate(${x(d.key)},0)`} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
                {d.parts.map((p) => {
                  const v0 = p.value >= 0 ? pos : neg;
                  const v1 = v0 + p.value;
                  if (p.value >= 0) pos = v1;
                  else neg = v1;
                  const yTop = y(Math.max(v0, v1));
                  const h = Math.max(1, Math.abs(y(v0) - y(v1)));
                  return (
                    <rect
                      key={p.id}
                      x={0}
                      width={x.bandwidth()}
                      y={yTop}
                      height={h}
                      fill={p.color}
                      opacity={hover && hover !== d.key ? 0.45 : 1}
                      rx={1}
                      className={cn(onSelect && "cursor-pointer")}
                      onClick={() => onSelect?.(d, p.id)}
                    />
                  );
                })}
                {d.highlight && <rect x={-2} width={x.bandwidth() + 4} y={y(totals[i])} height={ih - y(totals[i])} fill="none" stroke="var(--foreground)" strokeWidth={1} />}
                {showValues && (
                  <text x={x.bandwidth() / 2} y={y(totals[i]) - 4} textAnchor="middle" className="fill-foreground font-mono text-[9px]">
                    {yFormat(totals[i] + mins[i])}
                  </text>
                )}
                {i % every === 0 && (
                  <text x={x.bandwidth() / 2} y={ih + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hover && (
        <Tooltip d={data.find((d) => d.key === hover)!} yFormat={yFormat} left={Math.min(width - 180, (x(hover) ?? 0) + margin.left + x.bandwidth() + 6)} />
      )}
    </div>
  );
}

function Tooltip({ d, yFormat, left }: { d: BarDatum; yFormat: (v: number) => string; left: number }) {
  return (
    <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left }}>
      <p className="num font-medium">{d.label}</p>
      {d.parts.map((p) => (
        <p key={p.id} className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.id}</span>
          <span className="num ml-auto pl-3">{yFormat(p.value)}</span>
        </p>
      ))}
      <p className="mt-0.5 text-[10px] text-muted-foreground">Click to open source</p>
    </div>
  );
}
