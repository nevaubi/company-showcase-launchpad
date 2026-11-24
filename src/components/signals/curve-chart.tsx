// A rule's record over time: the running sum of its monthly average net return per trade. The years
// before the test window are drawn quieter, the tested years in the chart colour, with a marker where
// the test starts. One series, so the line is labelled at its end and there is no legend.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { monthLabel, niceTicks, pct } from "@/lib/signals/format";

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export function CurveChart({ curve, from, height = 176, label }: { curve: readonly (readonly [string, number])[]; from: string; height?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => {
    let prev = 0;
    return curve
      .filter(([, v]) => Number.isFinite(v))
      .map(([m, cum]) => {
        const p = { m, i: monthIndex(m), cum, month: cum - prev };
        prev = cum;
        return p;
      });
  }, [curve]);

  if (pts.length < 2) return <p className="py-6 text-[11px] text-muted-foreground">Not enough months with trades to draw a record yet.</p>;

  const M = { t: 18, r: 58, b: 20, l: 46 };
  const i0 = pts[0].i, i1 = pts[pts.length - 1].i;
  const vals = pts.map((p) => p.cum);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = Math.min(ticks[0], Math.min(0, ...vals)), hi = Math.max(ticks[ticks.length - 1], Math.max(0, ...vals));
  const iw = Math.max(1, W - M.l - M.r), ih = height - M.t - M.b;
  const x = (i: number) => M.l + ((i - i0) / Math.max(1, i1 - i0)) * iw;
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo || 1)) * ih;
  const path = (list: typeof pts) => list.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.cum).toFixed(1)}`).join("");
  const split = pts.findIndex((p) => p.m >= from);
  const before = split < 0 ? pts : pts.slice(0, split + 1);
  const tested = split < 0 ? [] : pts.slice(split);
  const fromIndex = monthIndex(from);
  const showSplit = split > 0 && fromIndex > i0 && fromIndex <= i1;
  const years: number[] = [];
  for (let yr = Math.ceil(i0 / 12); yr * 12 <= i1; yr++) years.push(yr);
  const every = Math.max(1, Math.ceil((years.length * 40) / iw));
  const last = pts[pts.length - 1];
  const h = hover == null ? null : pts[hover];

  const nearest = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    const at = i0 + ((clientX - box.left - M.l) / iw) * (i1 - i0);
    let best = 0;
    for (let k = 1; k < pts.length; k++) if (Math.abs(pts[k].i - at) < Math.abs(pts[best].i - at)) best = k;
    return best;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((cur) => Math.min(pts.length - 1, Math.max(0, (cur ?? pts.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  return (
    <div
      ref={ref}
      role="img"
      tabIndex={0}
      aria-label={`${label}. ${monthLabel(pts[0].m)} to ${monthLabel(last.m)}, ending at ${pct(last.cum, 1)}.`}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
      className="relative rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height }}
    >
      {W > 0 && (
        <svg width={W} height={height} className="block overflow-visible" onMouseMove={(e) => setHover(nearest(e.clientX))} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-foreground/35" : "stroke-border"} strokeWidth={1} />
              <text x={M.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted-foreground text-[11px]">
                {pct(t, 0, false)}
              </text>
            </g>
          ))}
          {years.filter((_, k) => k % every === 0).map((yr) => (
            <text key={yr} x={x(yr * 12)} y={height - 5} textAnchor="middle" className="num fill-muted-foreground text-[11px]">
              {yr}
            </text>
          ))}
          {showSplit && (
            <g>
              <line x1={x(fromIndex)} x2={x(fromIndex)} y1={M.t - 4} y2={height - M.b} className="stroke-foreground/35" strokeWidth={1} />
              <text x={x(fromIndex) + 5} y={M.t - 7} className="fill-muted-foreground text-[11px]">
                Tested from {monthLabel(from)}
              </text>
            </g>
          )}
          <path d={path(before)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {tested.length > 1 && <path d={path(tested)} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          <text x={x(last.i) + 6} y={y(last.cum)} dy="0.32em" className="num fill-foreground text-[11px] font-medium">
            {pct(last.cum, 1)}
          </text>
          {h && (
            <g pointerEvents="none">
              <line x1={x(h.i)} x2={x(h.i)} y1={M.t} y2={height - M.b} className="stroke-foreground/40" strokeWidth={1} />
              <circle cx={x(h.i)} cy={y(h.cum)} r={3.5} fill="var(--chart-1)" className="stroke-background" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      )}
      {h && W > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-md border bg-popover px-2 py-1.5 text-[11px] leading-4 text-popover-foreground shadow-lift"
          style={x(h.i) > W / 2 ? { right: W - x(h.i) + 10 } : { left: x(h.i) + 10 }}
        >
          <div className="font-medium">{monthLabel(h.m)}</div>
          <div className="num">Running sum {pct(h.cum, 2)}</div>
          <div className="num text-muted-foreground">This month {pct(h.month, 2)} a trade</div>
        </div>
      )}
    </div>
  );
}
