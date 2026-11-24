import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

export interface ComboSeries {
  id: string;
  label: string;
  color: string;
  type: "bar" | "line";
  /** Lines can use a right-hand axis (e.g. margins next to dollar bars) */
  axis?: "left" | "right";
  values: (number | null)[];
  format: (v: number) => string;
  /** Click a bar or point (e.g. open its SEC source) */
  onSelect?: (index: number) => void;
  dashed?: boolean;
}

/** Bars (grouped or stacked) and lines over shared categories, with an optional right axis. */
export function ComboChart({
  categories,
  series,
  height = 240,
  stacked = false,
  className,
  leftFormat,
  rightFormat,
  zeroLine = true,
}: {
  categories: string[];
  series: ComboSeries[];
  height?: number;
  stacked?: boolean;
  className?: string;
  leftFormat?: (v: number) => string;
  rightFormat?: (v: number) => string;
  zeroLine?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setWidth(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver((e) => setWidth(Math.max(240, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const left = series.filter((s) => (s.axis ?? "left") === "left");
  const right = series.filter((s) => s.axis === "right");
  const bars = series.filter((s) => s.type === "bar");
  const hasRight = right.length > 0;
  const margin = { top: 10, right: hasRight ? 48 : 10, bottom: 26, left: 52 };
  const iw = Math.max(10, width - margin.left - margin.right);
  const ih = height - margin.top - margin.bottom;

  const x = d3.scaleBand().domain(categories.map(String)).range([0, iw]).padding(0.22);
  const extent = (ss: ComboSeries[], stack: boolean): [number, number] => {
    let lo = 0;
    let hi = 0;
    categories.forEach((_, i) => {
      if (stack) {
        let pos = 0;
        let neg = 0;
        for (const s of ss.filter((s) => s.type === "bar")) {
          const v = s.values[i] ?? 0;
          if (v >= 0) pos += v;
          else neg += v;
        }
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
        for (const s of ss.filter((s) => s.type === "line")) {
          const v = s.values[i];
          if (v != null) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
        }
      } else
        for (const s of ss) {
          const v = s.values[i];
          if (v != null && Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
        }
    });
    if (lo === hi) hi = lo + 1;
    return [lo, hi];
  };
  const yL = d3.scaleLinear().domain(extent(left, stacked)).nice().range([ih, 0]);
  const yR = d3.scaleLinear().domain(hasRight ? extent(right, false) : [0, 1]).nice().range([ih, 0]);
  const fmtL = leftFormat ?? left[0]?.format ?? ((v: number) => d3.format("~s")(v));
  const fmtR = rightFormat ?? right[0]?.format ?? ((v: number) => String(v));
  const leftBars = bars.filter((s) => (s.axis ?? "left") === "left");
  const inner = d3
    .scaleBand()
    .domain(leftBars.map((s) => s.id))
    .range([0, x.bandwidth()])
    .padding(0.08);
  const every = Math.ceil(categories.length / Math.max(1, Math.floor(iw / 52)));

  const stackedPos = useMemo(() => {
    // [seriesIndex][category] → [y0, y1]
    return leftBars.map((s, si) =>
      categories.map((_, i) => {
        let pos = 0;
        let neg = 0;
        for (let k = 0; k < si; k++) {
          const v = leftBars[k].values[i] ?? 0;
          if (v >= 0) pos += v;
          else neg += v;
        }
        const v = s.values[i] ?? 0;
        return v >= 0 ? [pos, pos + v] : [neg, neg + v];
      }),
    );
  }, [leftBars, categories]);

  const yOf = (s: ComboSeries) => (s.axis === "right" ? yR : yL);

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} className="block" role="img" aria-label={series.map((s) => s.label).join(", ")}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yL.ticks(4).map((t) => (
            <g key={t} transform={`translate(0,${yL(t)})`}>
              <line x1={0} x2={iw} stroke="var(--border)" strokeDasharray={t === 0 && zeroLine ? undefined : "2 3"} />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {fmtL(t)}
              </text>
            </g>
          ))}
          {hasRight &&
            yR.ticks(4).map((t) => (
              <text key={t} x={iw + 8} y={yR(t)} dy="0.32em" className="fill-muted-foreground font-mono text-[10px]">
                {fmtR(t)}
              </text>
            ))}
          {categories.map((c, i) => (
            <g key={c} transform={`translate(${x(String(c))},0)`}>
              <rect
                x={-x.step() * x.paddingInner() * 0.5}
                width={x.step()}
                height={ih}
                fill={hover === i ? "var(--secondary)" : "transparent"}
                onMouseEnter={() => setHover(i)}
              />
              {leftBars.map((s, si) => {
                const v = s.values[i];
                if (v == null) return null;
                const [a, b] = stacked ? stackedPos[si][i] : [0, v];
                const y0 = yL(Math.max(a, b));
                const h = Math.max(1, Math.abs(yL(a) - yL(b)));
                return (
                  <rect
                    key={s.id}
                    x={stacked ? 0 : (inner(s.id) ?? 0)}
                    width={stacked ? x.bandwidth() : inner.bandwidth()}
                    y={y0}
                    height={h}
                    rx={1}
                    fill={s.color}
                    opacity={hover != null && hover !== i ? 0.55 : 1}
                    className={cn(s.onSelect && "cursor-pointer")}
                    onMouseEnter={() => setHover(i)}
                    onClick={() => s.onSelect?.(i)}
                  />
                );
              })}
              {i % every === 0 && (
                <text x={x.bandwidth() / 2} y={ih + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                  {c}
                </text>
              )}
            </g>
          ))}
          {series
            .filter((s) => s.type === "line")
            .map((s) => {
              const y = yOf(s);
              const pts = s.values.map((v, i) => (v == null || !Number.isFinite(v) ? null : ([(x(String(categories[i])) ?? 0) + x.bandwidth() / 2, y(v)] as [number, number])));
              const line = d3
                .line<[number, number] | null>()
                .defined((d) => d != null)
                .x((d) => d![0])
                .y((d) => d![1])
                .curve(d3.curveMonotoneX);
              return (
                <g key={s.id}>
                  <path d={line(pts) ?? ""} fill="none" stroke={s.color} strokeWidth={1.75} strokeDasharray={s.dashed ? "4 3" : undefined} />
                  {pts.map((p, i) =>
                    p ? (
                      <circle
                        key={i}
                        cx={p[0]}
                        cy={p[1]}
                        r={hover === i ? 4 : 2.5}
                        fill="var(--card)"
                        stroke={s.color}
                        strokeWidth={1.5}
                        className={cn(s.onSelect && "cursor-pointer")}
                        onMouseEnter={() => setHover(i)}
                        onClick={() => s.onSelect?.(i)}
                      />
                    ) : null,
                  )}
                </g>
              );
            })}
        </g>
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-44 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift"
          style={{ left: Math.min(width - 196, Math.max(0, (x(String(categories[hover])) ?? 0) + margin.left + x.bandwidth() + 8)) }}
        >
          <p className="num font-medium">{categories[hover]}</p>
          {series.map((s) => (
            <p key={s.id} className="flex items-center gap-1.5">
              <span className={cn("size-2 shrink-0", s.type === "bar" ? "rounded-sm" : "rounded-full")} style={{ background: s.color }} />
              <span className="truncate text-muted-foreground">{s.label}</span>
              <span className="num ml-auto pl-3">{s.values[hover] == null ? "—" : s.format(s.values[hover]!)}</span>
            </p>
          ))}
          {series.some((s) => s.onSelect) && <p className="mt-0.5 text-[10px] text-muted-foreground">Click a bar or point for its source</p>}
        </div>
      )}
    </div>
  );
}

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
