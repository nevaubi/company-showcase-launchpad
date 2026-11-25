import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { recordHref } from "@/lib/sources/links";
import { dayLabel, niceDomain, quarterLabel, showCell, tickText, unitLabel, type SeriesPoint } from "@/lib/sources/company/present";
import { cn } from "@/lib/utils";

const HEIGHT = 208;
const M = { top: 12, right: 64, bottom: 22, left: 52 };
const time = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * One measure of one bank by quarter: a single line (dataviz: 2 px, end dot with a surface ring, the latest value at
 * the end, hairline grid, one axis), a crosshair that snaps to the nearest quarter, a readout that leads with the
 * value and its unit, and every point one click (or Enter) from its stored record. Gaps are drawn as gaps.
 */
export function BankHistoryChart({ points, unit, label, sourceName }: { points: SeriesPoint[]; unit: string; label: string; sourceName: (p: SeriesPoint) => string }) {
  const router = useRouter();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const live = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!box) return;
    if (box.clientWidth) setWidth(Math.max(280, box.clientWidth));
    const ro = new ResizeObserver(e => setWidth(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const drawn = useMemo(() => points.map((p, i) => ({ ...p, i })).filter(p => p.value != null), [points]);
  const geo = useMemo(() => {
    const iw = Math.max(80, width - M.left - M.right), ih = HEIGHT - M.top - M.bottom;
    const t0 = time(points[0]?.period ?? "2000-03-31"), t1 = time(points[points.length - 1]?.period ?? "2026-09-30");
    const x = (iso: string) => M.left + ((time(iso) - t0) / Math.max(1, t1 - t0)) * iw;
    const d = niceDomain(drawn.map(p => p.value!), unit.startsWith("USD"));
    const y = (v: number) => M.top + ih - ((v - d.min) / (d.max - d.min || 1)) * ih;
    // the line breaks at every gap: a stored cell that is not a drawable number
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
    const years: number[] = [];
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    const every = iw < 360 ? 10 : 5;
    for (let yr = Math.ceil(y0 / every) * every; yr <= y1; yr += every) years.push(yr);
    return { iw, ih, x, y, d, path, years };
  }, [points, drawn, width, unit]);

  const at = active != null ? points[active] : null;
  const last = drawn[drawn.length - 1];
  const open = (p: SeriesPoint | null) => p && router.history.push(recordHref(p.ref.dataset, p.ref.snapshot, p.ref.row));
  const say = (p: SeriesPoint) => `${quarterLabel(p.period)}: ${p.value == null ? "not drawn" : `${showCell(p.cell, unit).text} ${unitLabel(unit)}`}`;

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
  const onMove = (e: PointerEvent<HTMLDivElement>) => setActive(nearest(e.clientX));
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

  const tipLeft = at ? Math.min(Math.max(geo.x(at.period) + 10, 4), width - 196) : 0;
  return (
    <div className="relative">
      <div
        ref={setBox}
        tabIndex={0}
        role="group"
        aria-label={`${label} by quarter, ${unitLabel(unit)}. Arrow keys read each quarter; Enter opens its stored record.`}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onClick={() => open(at)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className={cn("relative cursor-crosshair rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        style={{ height: HEIGHT }}
      >
        <svg width={width} height={HEIGHT} className="block" aria-hidden>
          {geo.d.ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={M.left + geo.iw} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--border)" strokeWidth={t === 0 && geo.d.min < 0 ? 1.25 : 1} />
              <text x={M.left - 6} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{tickText(t, unit)}</text>
            </g>
          ))}
          {geo.years.map(yr => (
            <text key={yr} x={geo.x(`${yr}-01-01`)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{yr}</text>
          ))}
          <path d={geo.path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last && (
            <>
              <circle cx={geo.x(last.period)} cy={geo.y(last.value!)} r={4} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />
              <text x={geo.x(last.period) + 8} y={geo.y(last.value!)} dy="0.32em" className="fill-foreground font-mono text-[10px]">{tickText(last.value!, unit)}</text>
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
          <div className="pointer-events-none absolute top-2 z-10 w-[188px] rounded-[4px] border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left: tipLeft }}>
            <div className="num text-[13px] font-semibold text-foreground">
              {showCell(at.cell, unit).text || "empty"} <span className="text-[11px] font-normal text-muted-foreground">{unitLabel(unit)}</span>
            </div>
            <div className="text-muted-foreground">{quarterLabel(at.period)} · {dayLabel(at.period)}</div>
            <div className="truncate text-muted-foreground">{sourceName(at)}, row {at.ref.row.toLocaleString("en-US")}</div>
            <div className="text-muted-foreground">Click or press Enter to open the record</div>
          </div>
        )}
      </div>
      <p ref={live} aria-live="polite" className="sr-only" />
    </div>
  );
}
