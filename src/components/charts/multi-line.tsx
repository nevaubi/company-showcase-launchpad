import { useEffect, useMemo, useState } from "react";
import { scaleLinear } from "d3";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** x is a sortable string (ISO date or period key); y may be null for gaps */
  points: { x: string; y: number | null; t?: number }[];
}

/** Widest end label the chart reserves room for, as a share of its width. */
const LABEL_SHARE = 0.34;
/** Average glyph width of the 10.5 px semibold end labels, in px. */
const GLYPH = 6.1;

/**
 * Lightweight multi-series line chart: round axis values, direct end labels, a crosshair readout that
 * follows the pointer (mouse, pen or touch) and the arrow keys.
 */
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
  // A callback ref: the measured element changes when the chart goes from "No data" to drawn.
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const xs = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(), [series]);
  /** value by x for each series, so the readout does not search the points on every move */
  const byX = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))), [series]);
  const vals = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length || !vals.length)
    return (
      <div ref={ref} className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No data
      </div>
    );
  const longest = Math.max(0, ...series.map((s) => s.label.length));
  const m = { t: 10, r: Math.round(Math.min(Math.max(40, longest * GLYPH + 12), Math.max(40, W * LABEL_SHARE))), b: 22, l: 46 };
  const lo0 = Math.min(...vals, baseline ?? Infinity);
  const hi0 = Math.max(...vals, baseline ?? -Infinity);
  // Round axis values: the data's own range is widened to the nearest round numbers and the ticks sit on
  // them, so a share that runs from 0 to 100 keeps a 0 to 100 axis. A flat series gets a little room.
  const flat = hi0 === lo0 ? Math.abs(hi0) * 0.05 || 1 : 0;
  const ys = scaleLinear()
    .domain([lo0 - flat, hi0 + flat])
    .nice(height < 180 ? 3 : 4)
    .range([height - m.b - 1, m.t + 1]);
  const ticks = ys.ticks(height < 180 ? 3 : 4);
  const y = (v: number) => ys(v);
  const plotW = Math.max(1, W - m.l - m.r);
  const x = (i: number) => m.l + (i / Math.max(1, xs.length - 1)) * plotW;
  const xi = new Map(xs.map((k, i) => [k, i]));
  const xt = xs.length > 2 && plotW > 220 ? [0, Math.floor((xs.length - 1) / 2), xs.length - 1] : xs.length > 1 ? [0, xs.length - 1] : [0];
  const at = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const f = (clientX - r.left) / Math.max(1, r.width);
    return Math.max(0, Math.min(xs.length - 1, Math.round(f * (xs.length - 1))));
  };
  // End labels, nudged apart vertically and kept inside the plot.
  const ends = series
    .map((s) => {
      const last = [...s.points].reverse().find((p) => p.y != null && Number.isFinite(p.y));
      return last ? { s, yy: y(last.y!) } : null;
    })
    .filter((e): e is { s: LineSeries; yy: number } => !!e)
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 12) ends[i].yy = ends[i - 1].yy + 12;
  const over = ends.length ? ends[ends.length - 1].yy - (height - m.b) : 0;
  if (over > 0) for (const e of ends) e.yy -= over;
  const maxChars = Math.max(4, Math.floor((m.r - 8) / GLYPH));
  const hx = hover != null ? xs[hover] : null;
  return (
    <div
      ref={ref}
      className="relative rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Arrow keys read the values.`}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        setHover((h) => Math.max(0, Math.min(xs.length - 1, (h ?? xs.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
      }}
      onBlur={() => setHover(null)}
    >
      {W > 0 && (
        <svg width={W} height={height} role="img" aria-label={label} className="block">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} stroke="var(--border)" shapeRendering="crispEdges" />
              <text x={m.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(v)}
              </text>
            </g>
          ))}
          {baseline != null && (
            <line x1={m.l} x2={W - m.r} y1={Math.round(y(baseline)) + 0.5} y2={Math.round(y(baseline)) + 0.5} stroke="var(--muted-foreground)" strokeOpacity={0.6} shapeRendering="crispEdges" />
          )}
          {xt.map((i, k) => (
            <text key={`${xs[i]}-${k}`} x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle"} fontSize={10} fill="var(--muted-foreground)">
              {xFormat(xs[i])}
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
              d += `${pen ? "L" : "M"}${x(xi.get(p.x) ?? 0).toFixed(1)},${y(p.y).toFixed(1)}`;
              pen = true;
            }
            return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />;
          })}
          {ends.map((e) => (
            <text key={e.s.key} x={W - m.r + 6} y={e.yy + 3.5} fontSize={10.5} fontWeight={600} fill={e.s.color}>
              <title>{e.s.label}</title>
              {e.s.label.length > maxChars ? `${e.s.label.slice(0, maxChars - 1)}…` : e.s.label}
            </text>
          ))}
          {hover != null && (
            <g pointerEvents="none">
              <line x1={Math.round(x(hover)) + 0.5} x2={Math.round(x(hover)) + 0.5} y1={m.t} y2={height - m.b} stroke="var(--foreground)" strokeOpacity={0.3} shapeRendering="crispEdges" />
              {series.map((s, k) => {
                const v = byX[k].get(hx!);
                return v != null && Number.isFinite(v) ? <circle key={s.key} cx={x(hover)} cy={y(v)} r={3} fill={s.color} stroke="var(--card)" strokeWidth={1} /> : null;
              })}
            </g>
          )}
          <rect
            x={m.l}
            y={m.t}
            width={plotW}
            height={Math.max(0, height - m.t - m.b)}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerMove={(e) => setHover(at(e.clientX, e.currentTarget))}
            onPointerDown={(e) => setHover(at(e.clientX, e.currentTarget))}
            // a finger lifting is not "leaving": the value read by touch stays until focus moves on
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          />
        </svg>
      )}
      {hover != null && (
        <div
          className="pointer-events-none absolute top-1 rounded border bg-popover px-2 py-1 text-[11px] leading-4 shadow-sm"
          style={x(hover) > m.l + plotW / 2 ? { left: m.l + 4 } : { right: m.r + 4 }}
        >
          <p className="font-medium">{xFormat(hx!)}</p>
          {series.map((s, k) => {
            const v = byX[k].get(hx!);
            return (
              <p key={s.key} className="num flex items-center gap-1.5 tabular-nums">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label} {v != null && Number.isFinite(v) ? format(v) : "–"}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
