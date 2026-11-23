import { useEffect, useRef, useState } from "react";
import { fmtAlt } from "@/lib/alt/catalog";
import type { ChartPoint } from "@/lib/alt/company";
import { cn } from "@/lib/utils";

/**
 * A small, quiet chart for one alt series: bars from a zero baseline for yearly totals, a line for
 * monthly or half-monthly readings. Partial periods are lighter and labelled. Hover or focus shows
 * the period, value and unit; nothing animates.
 */
export function AltChart({ points, kind, unit, height = 112, label }: { points: ChartPoint[]; kind: "bar" | "line"; unit: string | null; height?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  if (!points.length) return null;
  const left = 44, right = 6, top = 6, bottom = 18;
  const iw = Math.max(0, w - left - right), ih = height - top - bottom;
  const vals = points.map((p) => p.value);
  const lo = kind === "bar" ? Math.min(0, ...vals) : Math.min(...vals);
  const hi0 = Math.max(...vals, kind === "bar" ? 0 : -Infinity);
  const hi = hi0 === lo ? lo + 1 : hi0;
  const y = (v: number) => top + ih - ((v - lo) / (hi - lo)) * ih;
  const step = iw / points.length;
  const x = (i: number) => left + step * i + step / 2;
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(iw / 56))));
  const h = hover != null ? points[hover] : null;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} role="img" aria-label={`${label}: ${points.map((p) => `${p.label} ${fmtAlt(p.value, unit)}`).slice(-6).join(", ")}`}>
      {w > 0 && (
        <svg width={w} height={height} className="block overflow-visible" onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 3"} />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted-foreground text-[10px]">{fmtAlt(t, unit)}</text>
            </g>
          ))}
          {kind === "bar"
            ? points.map((p, i) => {
                const y0 = y(Math.max(0, lo)), y1 = y(p.value);
                return <rect key={i} x={x(i) - Math.min(18, step * 0.32)} width={Math.min(36, step * 0.64)} y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y0 - y1))} rx={1.5} fill="var(--chart-1)" fillOpacity={p.partial ? 0.35 : hover === i ? 1 : 0.85} />;
              })
            : (
              <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("")} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinejoin="round" />
            )}
          {h && kind === "line" && <circle cx={x(hover!)} cy={y(h.value)} r={3} fill="var(--chart-1)" />}
          {points.map((p, i) => (i % labelEvery === (points.length - 1) % labelEvery ? (
            <text key={i} x={x(i)} y={height - 4} textAnchor="middle" className={cn("num text-[10px]", p.partial ? "fill-muted-foreground/70" : "fill-muted-foreground")}>{p.label}</text>
          ) : null))}
          {points.map((_, i) => (
            <rect key={i} x={left + step * i} y={top} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
      )}
      {h && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-[4px] border bg-popover px-2 py-1 text-[11px] shadow-lift" style={{ left: Math.min(Math.max(0, x(hover!) - 60), Math.max(0, w - 130)) }}>
          <span className="text-muted-foreground">{h.label}{h.partial ? " (partial)" : ""}</span> <span className="num font-medium">{fmtAlt(h.value, unit)}</span>
        </div>
      )}
    </div>
  );
}
