import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { TickerMark } from "@/components/app/ticker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/lib/format";
import { crossQuery, METRICS, niceTicks, ols, quantileSorted, rowsOf, SCATTER_KEYS, type CrossRow } from "@/lib/technicals/cross";
import { methodsQuery } from "@/lib/technicals/data";
import { cn } from "@/lib/utils";
import { Note, T as S, TechPanel } from "./ui";

/** Axis values are round numbers: "+30.0%" reads as "+30%". */
const axis = (s: string) => s.replace(/\.0+(?=%|$)/, "");
function val(r: CrossRow | undefined, k: string): number | null {
  const v = r?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Width of an element that may mount later than the component (it appears once the data has loaded). */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

/**
 * Any two measures against each other for every covered company on one as-of date, with the open symbol
 * and its sector picked out. A point opens that company.
 */
export function CrossScatter({ symbol, onPick }: { symbol: string | null; onPick: (s: string) => void }) {
  const X = useQuery(crossQuery);
  const methods = useQuery(methodsQuery);
  const [xk, setXk] = useState("vol60");
  const [yk, setYk] = useState("mom12_1");
  const [only, setOnly] = useState<"all" | "sector">("all");
  const [hover, setHover] = useState<CrossRow | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>();
  const rows = useMemo(() => (X.data ? rowsOf(X.data) : []), [X.data]);
  const me = rows.find((r) => r.sym === symbol);
  const sector = me?.sector ?? null;
  const pts = rows.filter((r) => r.kind === "stock" && val(r, xk) != null && val(r, yk) != null && (only === "all" || !sector || r.sector === sector));

  const H = Math.round(Math.min(420, Math.max(260, W * 0.5)));
  const m = { t: 22, r: 16, b: 40, l: 52 };
  const xv = pts.map((p) => val(p, xk)!);
  const yv = pts.map((p) => val(p, yk)!);
  const xs = [...xv].sort((a, b) => a - b);
  const ys = [...yv].sort((a, b) => a - b);
  let xd: [number, number] = [quantileSorted(xs, 0.005), quantileSorted(xs, 0.995)];
  let yd: [number, number] = [quantileSorted(ys, 0.005), quantileSorted(ys, 0.995)];
  const mx = val(me, xk);
  const my = val(me, yk);
  if (mx != null) xd = [Math.min(xd[0], mx), Math.max(xd[1], mx)];
  if (my != null) yd = [Math.min(yd[0], my), Math.max(yd[1], my)];
  const padx = (xd[1] - xd[0]) * 0.05 || 1;
  const pady = (yd[1] - yd[0]) * 0.07 || 1;
  xd = [xd[0] - padx, xd[1] + padx];
  yd = [yd[0] - pady, yd[1] + pady];
  const clip = (v: number, d: [number, number]) => Math.max(d[0], Math.min(d[1], v));
  const px = (v: number) => m.l + ((clip(v, xd) - xd[0]) / (xd[1] - xd[0])) * (W - m.l - m.r);
  const py = (v: number) => H - m.b - ((clip(v, yd) - yd[0]) / (yd[1] - yd[0])) * (H - m.t - m.b);
  const fit = ols(xv, yv);
  // Direct labels where there is room: each point's ticker to its right (left near the edge), skipped when it
  // would overlap a label already placed, the selected symbol's own label first. Only up to 40 points.
  const labels: { sym: string; x: number; y: number; end: boolean }[] = [];
  if (W > 0 && pts.length <= 40) {
    const boxes: [number, number, number, number][] = [];
    const box = (x: number, y: number, w: number, end: boolean): [number, number, number, number] => [end ? x - w : x, y - 9, end ? x : x + w, y + 3];
    const hit = (b: [number, number, number, number]) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    if (mx != null && my != null) {
      const end = px(mx) > W - 80;
      boxes.push(box(px(mx) + (end ? -9 : 9), py(my) + 4, (symbol ?? "").length * 7 + 2, end));
    }
    // the dots are obstacles too, so a label never covers another company's point
    for (const p of pts) {
      const x = px(val(p, xk)!);
      const y = py(val(p, yk)!);
      boxes.push([x - 3, y - 3, x + 3, y + 3]);
    }
    for (const p of pts) {
      if (p.sym === symbol) continue;
      const x0 = px(val(p, xk)!);
      const y0 = py(val(p, yk)!);
      const w = p.sym.length * 6 + 2;
      const end = x0 + 6 + w > W - m.r;
      const x = x0 + (end ? -6 : 6);
      const y = y0 + 3.5;
      const b = box(x, y, w, end);
      if (hit(b)) continue;
      boxes.push(b);
      labels.push({ sym: p.sym, x, y, end });
    }
  }
  const ordered = [...pts].sort((a, b) => Number(a.sym === symbol) - Number(b.sym === symbol) || Number(a.sector === sector) - Number(b.sector === sector));
  const pick = (v: string, set: (k: string) => void, label: string) => (
    <Select value={v} onValueChange={set}>
      <SelectTrigger aria-label={label} className="h-7 w-40 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SCATTER_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {METRICS[k].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <TechPanel
      section="Cross-section"
      id="cross"
      tour="tech-cross"
      title="Cross-section"
      subtitle={
        X.data
          ? `${pts.length.toLocaleString("en-US")} covered companies as of ${fmtDate(X.data.as_of)}, correlation ${Number.isFinite(fit.r) ? fit.r.toFixed(2).replace("-", "−") : "–"}`
          : "Covered companies on one date"
      }
      actions={
        <>
          {pick(yk, setYk, "Vertical axis")}
          <span className="text-xs text-muted-foreground">against</span>
          {pick(xk, setXk, "Horizontal axis")}
          {sector && (
            <Segmented
              size="xs"
              label="Companies shown"
              value={only}
              onChange={setOnly}
              options={[
                { v: "all", l: "All" },
                { v: "sector", l: "Sector" },
              ]}
            />
          )}
        </>
      }
    >
      {X.isPending ? (
        <Skeleton className="m-3 h-64" />
      ) : !X.data ? (
        <p className={cn("px-3 py-4", S.caption)}>The cross-section of covered companies is not available right now. It is rebuilt every weekday evening.</p>
      ) : (
        <>
          <div ref={ref} className="relative px-2 pt-1">
            {W > 0 && pts.length > 1 && (
              <svg width={W} height={H} role="img" aria-label={`${METRICS[yk].label} against ${METRICS[xk].label} for ${pts.length} covered companies`} className="block">
                {niceTicks(yd[0], yd[1], 5).map((t) => (
                  <g key={`y${t}`}>
                    <line x1={m.l} x2={W - m.r} y1={Math.round(py(t)) + 0.5} y2={Math.round(py(t)) + 0.5} stroke="var(--border)" shapeRendering="crispEdges" />
                    <text x={m.l - 6} y={py(t) + 3} textAnchor="end" className="num fill-muted-foreground text-[10px]">
                      {axis(METRICS[yk].fmt(t))}
                    </text>
                  </g>
                ))}
                {niceTicks(xd[0], xd[1], W < 520 ? 4 : 6).map((t) => (
                  <g key={`x${t}`}>
                    <line x1={Math.round(px(t)) + 0.5} x2={Math.round(px(t)) + 0.5} y1={H - m.b} y2={H - m.b + 4} stroke="var(--border)" shapeRendering="crispEdges" />
                    <text x={px(t)} y={H - m.b + 15} textAnchor="middle" className="num fill-muted-foreground text-[10px]">
                      {axis(METRICS[xk].fmt(t))}
                    </text>
                  </g>
                ))}
                <text x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {METRICS[xk].label}
                </text>
                <text x={m.l - 44} y={12} className="fill-muted-foreground text-[11px]">
                  {METRICS[yk].label}
                </text>
                {Number.isFinite(fit.b) && pts.length >= 10 && (
                  <line
                    x1={px(xd[0])}
                    x2={px(xd[1])}
                    y1={py(fit.a + fit.b * xd[0])}
                    y2={py(fit.a + fit.b * xd[1])}
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.7}
                    strokeDasharray="4 3"
                  />
                )}
                {ordered.map((p) => {
                  const mine = p.sym === symbol;
                  const inSec = !!sector && p.sector === sector;
                  return (
                    <circle
                      key={p.sym}
                      cx={px(val(p, xk)!)}
                      cy={py(val(p, yk)!)}
                      r={mine ? 5.5 : hover?.sym === p.sym ? 4.5 : 3}
                      fill={mine ? "var(--foreground)" : inSec ? "var(--chart-1)" : "var(--muted-foreground)"}
                      fillOpacity={mine ? 1 : inSec ? 0.85 : 0.5}
                      stroke={mine ? "var(--card)" : "none"}
                      strokeWidth={mine ? 2 : 0}
                      className="cursor-pointer"
                      onPointerEnter={() => setHover(p)}
                      onPointerLeave={() => setHover(null)}
                      onClick={() => onPick(p.sym)}
                    />
                  );
                })}
                {labels.map((l) => (
                  <text
                    key={l.sym}
                    x={l.x}
                    y={l.y}
                    textAnchor={l.end ? "end" : "start"}
                    className="num pointer-events-none fill-muted-foreground text-[10px]"
                    stroke="var(--card)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {l.sym}
                  </text>
                ))}
                {mx != null && my != null && (
                  <text
                    x={px(mx) + (px(mx) > W - 80 ? -9 : 9)}
                    y={py(my) + 4}
                    textAnchor={px(mx) > W - 80 ? "end" : "start"}
                    className="num fill-foreground text-[11px] font-semibold"
                    stroke="var(--card)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {symbol}
                  </text>
                )}
              </svg>
            )}
            {W > 0 && pts.length <= 1 && <p className={cn("px-1 py-6", S.caption)}>Too few companies have both measures to plot.</p>}
            {hover && (
              <div className="pointer-events-none absolute right-3 top-1 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] leading-4 shadow-sm">
                <TickerMark ticker={hover.sym} name link={false} className="max-w-56" />
                <p className="text-muted-foreground">{hover.sector}</p>
                <p className="num">
                  {METRICS[yk].label} {METRICS[yk].fmt(val(hover, yk))}
                </p>
                <p className="num">
                  {METRICS[xk].label} {METRICS[xk].fmt(val(hover, xk))}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pb-2 text-[11px] leading-4 text-muted-foreground">
            {me && (
              <span className="flex items-center gap-1.5">
                <i className="inline-block size-2 rounded-full bg-foreground" /> {symbol}
              </span>
            )}
            {sector && (
              <span className="flex items-center gap-1.5">
                <i className="inline-block size-2 rounded-full bg-chart-1" /> {sector}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <i className="inline-block size-2 rounded-full bg-muted-foreground/50" /> {sector ? "Other covered companies" : "Covered companies"}
            </span>
            {pts.length >= 10 && <span>Dashed line: least-squares fit</span>}
            <span>A point opens that company</span>
          </div>
          <Note>
            {METRICS[yk].label}: {METRICS[yk].def} {METRICS[xk].label}: {METRICS[xk].def} Axes are clipped at the 0.5th and 99.5th percentiles so a few extreme names do not flatten the rest.{" "}
            {methods.data?.cross ?? ""}
          </Note>
        </>
      )}
    </TechPanel>
  );
}
