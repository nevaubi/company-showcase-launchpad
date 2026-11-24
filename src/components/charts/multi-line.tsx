import { useEffect, useMemo, useRef, useState } from "react";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** x is a sortable string (ISO date or period key); y may be null for gaps */
  points: { x: string; y: number | null; t?: number }[];
}

/** Lightweight multi-series line chart: direct end labels, crosshair readout, no chart junk. */
export function MultiLine({
  series,
  height = 240,
  format,
  xFormat = (x) => x,
  baseline,
  label,
}: {
  series: LineSeries[];
  height?: number;
  format: (v: number) => string;
  xFormat?: (x: string) => string;
  baseline?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const xs = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(),
    [series],
  );
  const vals = series
    .flatMap((s) => s.points.map((p) => p.y))
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length || !vals.length)
    return (
      <div
        ref={ref}
        className="flex h-40 items-center justify-center text-sm text-muted-foreground"
      >
        No data
      </div>
    );
  const m = { t: 10, r: 64, b: 22, l: 52 };
  let lo = Math.min(...vals, baseline ?? Infinity),
    hi = Math.max(...vals, baseline ?? -Infinity);
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
  lo -= pad;
  hi += pad;
  const xi = new Map(xs.map((x, i) => [x, i]));
  const x = (k: string) => m.l + ((xi.get(k) ?? 0) / Math.max(1, xs.length - 1)) * (W - m.l - m.r);
  const y = (v: number) => m.t + ((hi - v) / (hi - lo)) * (height - m.t - m.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const xt = [0, Math.floor((xs.length - 1) / 2), xs.length - 1].map((i) => xs[i]);
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setHover(xs[Math.max(0, Math.min(xs.length - 1, Math.round(f * (xs.length - 1))))]);
  };
  // End labels, nudged apart vertically.
  const ends = series
    .map((s) => {
      const last = [...s.points].reverse().find((p) => p.y != null);
      return last ? { s, v: last.y!, yy: y(last.y!) } : null;
    })
    .filter((e): e is { s: LineSeries; v: number; yy: number } => !!e)
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++)
    if (ends[i].yy - ends[i - 1].yy < 12) ends[i].yy = ends[i - 1].yy + 12;
  return (
    <div ref={ref} className="relative">
      {W > 0 && (
        <svg width={W} height={height} role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text
                x={m.l - 6}
                y={y(v) + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {format(v)}
              </text>
            </g>
          ))}
          {baseline != null && (
            <line
              x1={m.l}
              x2={W - m.r}
              y1={y(baseline)}
              y2={y(baseline)}
              stroke="var(--rule)"
              strokeDasharray="3 3"
            />
          )}
          {xt.map((k, i) => (
            <text
              key={`${k}-${i}`}
              x={x(k)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {xFormat(k)}
            </text>
          ))}
          {series.map((s) => {
            let d = "";
            let pen = false;
            for (const p of s.points) {
              if (p.y == null || !Number.isFinite(p.y)) {
                pen = false;
                continue;
              }
              d += `${pen ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`;
              pen = true;
            }
            return (
              <path
                key={s.key}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
            );
          })}
          {ends.map((e) => (
            <text
              key={e.s.key}
              x={W - m.r + 6}
              y={e.yy + 3}
              fontSize={10.5}
              fontWeight={600}
              fill={e.s.color}
            >
              {e.s.label}
            </text>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={m.t}
                y2={height - m.b}
                stroke="var(--foreground)"
                strokeOpacity={0.25}
              />
              {series.map((s) => {
                const p = s.points.find((q) => q.x === hover);
                return p?.y != null ? (
                  <circle key={s.key} cx={x(hover)} cy={y(p.y)} r={3} fill={s.color} />
                ) : null;
              })}
            </g>
          )}
          <rect
            x={m.l}
            y={m.t}
            width={Math.max(0, W - m.l - m.r)}
            height={height - m.t - m.b}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover && (
        <div className="pointer-events-none absolute left-14 top-1 rounded border bg-popover px-2 py-1 text-[11px] shadow-sm">
          <p className="font-medium">{xFormat(hover)}</p>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hover);
            return (
              <p key={s.key} className="num flex items-center gap-1.5 tabular-nums">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label} {p?.y != null ? format(p.y) : "–"}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
