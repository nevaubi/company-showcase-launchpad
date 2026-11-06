// Report charts: plain SVG (so print and the Word export reproduce them exactly), themed through CSS
// variables, every bar/point clickable to its source. Composite values (peer medians, fits) show
// their member facts in a strip under the chart instead of a single document.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, X } from "lucide-react";
import { scaleBand, scaleLinear } from "d3";
import { useSource } from "@/components/source/source-context";
import { refCaption, refTarget, readableDates } from "@/lib/reports/present";
import type { ChartPoint, ChartSeries, ChartUnit, Fact, ReportChart } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

const C = {
  brand: "var(--brand, var(--color-foreground))",
  ink: "var(--color-foreground)",
  muted: "var(--color-muted-foreground)",
  grid: "var(--color-border)",
  pos: "var(--color-positive)",
  neg: "var(--color-negative)",
  peer: "var(--color-chart-5)",
  card: "var(--color-card)",
};
const PALETTE = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-6)", "var(--color-chart-5)"];
const FONT = 10.5;

// ---------- formatting ----------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtChart(v: number | null | undefined, unit: ChartUnit, opts: { compact?: boolean; signed?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : opts.signed && v > 0 ? "+" : "";
  const a = Math.abs(v);
  switch (unit) {
    case "usd": {
      if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(a >= 1e13 ? 0 : 1)}T`;
      if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e11 || opts.compact ? 0 : 1)}B`;
      if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 || opts.compact ? 0 : 1)}M`;
      if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
      return `${sign}$${a.toFixed(0)}`;
    }
    case "pct": return `${sign}${(a * 100).toFixed(opts.compact && a >= 0.1 ? 0 : 1)}%`;
    case "pp": return `${v < 0 ? "−" : "+"}${(a * 100).toFixed(1)} pp`;
    case "mult": return `${sign}${a.toFixed(a >= 100 ? 0 : 1)}x`;
    case "usdPerShare": return `${sign}$${a.toFixed(2)}`;
    case "index": return a.toFixed(0);
    case "count": return `${sign}${a.toLocaleString("en-US", { maximumFractionDigits: a < 10 ? 1 : 0 })}`;
  }
}
const dateTick = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${MON[Number(d.slice(5, 7)) - 1]} ’${d.slice(2, 4)}` : /^\d{4}-\d{2}$/.test(d) ? `${MON[Number(d.slice(5, 7)) - 1]} ’${d.slice(2, 4)}` : d);

function niceDomain(vals: number[], includeZero = true): [number, number] {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  if (includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  return scaleLinear().domain([lo, hi]).nice(4).domain() as [number, number];
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ---------- source interaction ----------
interface Ctx { facts: Map<string, Fact>; ticker: string; onPick: (f?: string, label?: string) => void }

function useChartSource(facts: Map<string, Fact>, ticker: string) {
  const { open } = useSource();
  const [picked, setPicked] = useState<{ id: string; label?: string } | null>(null);
  const onPick = (id?: string, label?: string) => {
    if (!id) return;
    const f = facts.get(id);
    if (!f) return;
    if (f.ref.kind === "composite") return setPicked({ id, label });
    const t = refTarget(f.ref, ticker, f.text);
    if (t) open(label && !t.doc && !t.external ? { ...t, label } : t);
    else setPicked({ id, label });
  };
  return { picked, setPicked, onPick };
}

function PickedStrip({ id, facts, ticker, onClose }: { id: string; facts: Map<string, Fact>; ticker: string; onClose: () => void }) {
  const { open } = useSource();
  const f = facts.get(id);
  if (!f) return null;
  const members = f.ref.kind === "composite" ? f.ref.members.map((m) => facts.get(m)).filter((x): x is Fact => !!x) : [];
  return (
    <div className="mt-2 rounded-md border bg-secondary/40 px-3 py-2 text-[11px]" data-print-hide>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1"><span className="text-foreground">{readableDates(f.text)}</span> <span className="text-muted-foreground">— {refCaption(f.ref)}</span></p>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      {members.length > 0 && (
        <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {members.map((m) => {
            const t = refTarget(m.ref, ticker, m.text);
            return (
              <li key={m.id} className="min-w-0">
                {t ? (
                  <button type="button" onClick={() => open(t)} className="group inline-flex max-w-full items-start gap-1 text-left text-muted-foreground hover:text-foreground">
                    <span className="truncate">{readableDates(m.text)}</span><ExternalLink className="mt-0.5 size-3 shrink-0 text-[color:var(--color-primary)]" />
                  </button>
                ) : <span className="text-muted-foreground">{readableDates(m.text)} <span className="text-[10px]">({refCaption(m.ref)})</span></span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- shared frame ----------
function Frame({ chart, legend, children, picked, facts, ticker, onClose }: {
  chart: ReportChart; legend?: { name: string; color: string; opacity?: number; dash?: boolean; line?: boolean }[]; children: ReactNode;
  picked: { id: string } | null; facts: Map<string, Fact>; ticker: string; onClose: () => void;
}) {
  return (
    <figure className={cn("report-chart min-w-0 break-inside-avoid", chart.size === "full" && "sm:col-span-2")} data-chart-id={chart.id}>
      <figcaption className="mb-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--brand-accent-ink,var(--color-muted-foreground))]">{chart.title}</span>
        {chart.subtitle && <span className="block text-[10.5px] text-muted-foreground">{readableDates(chart.subtitle)}</span>}
      </figcaption>
      {legend && (legend.length > 1 || legend[0]?.line) && (
        <ul className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
          {legend.map((l) => (
            <li key={l.name} className="inline-flex items-center gap-1">
              <svg width="14" height="8" aria-hidden>{l.line || l.dash ? <line x1="0" x2="14" y1="4" y2="4" style={{ stroke: l.color, strokeWidth: 2, strokeDasharray: l.dash ? "3 2" : undefined }} /> : <rect width="10" height="8" x="2" rx="1" style={{ fill: l.color, opacity: l.opacity }} />}</svg>
              {l.name}
            </li>
          ))}
        </ul>
      )}
      {children}
      {chart.note && <p className="mt-1 text-[10.5px] text-muted-foreground">{chart.note}</p>}
      {picked && <PickedStrip id={picked.id} facts={facts} ticker={ticker} onClose={onClose} />}
    </figure>
  );
}

function Tip({ tip, w }: { tip: { x: number; y: number; lines: string[] } | null; w: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 10, 0), Math.max(0, w - 180));
  return (
    <div className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-md border bg-popover px-2 py-1 text-[10.5px] leading-snug text-popover-foreground shadow-sm" style={{ left, top: Math.max(0, tip.y - 8) }} data-print-hide>
      {tip.lines.map((l, i) => <div key={i} className={cn(i === 0 && "font-medium")}>{l}</div>)}
    </div>
  );
}

const Axis = ({ y, x0, x1, ticks, unit, side }: { y: (v: number) => number; x0: number; x1: number; ticks: number[]; unit: ChartUnit; side: "left" | "right" }) => (
  <g>
    {ticks.map((t) => (
      <g key={t}>
        {side === "left" && <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} style={{ stroke: C.grid, strokeWidth: t === 0 ? 1 : 0.6, strokeDasharray: t === 0 ? undefined : "2 3" }} />}
        <text x={side === "left" ? x0 - 5 : x1 + 5} y={y(t)} dy="0.32em" textAnchor={side === "left" ? "end" : "start"} style={{ fill: C.muted, fontSize: FONT - 1 }}>{fmtChart(t, unit, { compact: true })}</text>
      </g>
    ))}
  </g>
);

function seriesColor(s: ChartSeries, i: number, hasSelf: boolean) {
  if (s.tone === "self") return C.brand;
  if (s.tone === "bench") return C.muted;
  if (s.tone === "peer" || s.tone === "neutral") return C.peer;
  if (s.tone === "pos") return C.pos;
  if (s.tone === "neg") return C.neg;
  return PALETTE[(hasSelf ? i + 1 : i) % PALETTE.length];
}

// ---------- combo (bars + lines, optional right axis) ----------
function Combo({ chart, ctx, w }: { chart: Extract<ReportChart, { type: "combo" | "stacked" }>; ctx: Ctx; w: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const stacked = chart.type === "stacked";
  const percent = chart.type === "stacked" && chart.percent;
  const H = 190, m = { t: 10, r: 10, b: 22, l: 46 };
  const left = chart.series.filter((s) => s.axis !== "right"), right = chart.series.filter((s) => s.axis === "right");
  if (right.length) m.r = 42;
  const bars = left.filter((s) => s.kind === "bar"), lines = chart.series.filter((s) => s.kind !== "bar");
  const n = chart.x.length;
  const hasSelf = chart.series.some((s) => s.tone === "self");
  const colors = new Map(chart.series.map((s, i) => [s, seriesColor(s, i, hasSelf)]));
  const totals = chart.x.map((_, i) => bars.reduce((a, s) => a + Math.max(0, s.points[i]?.v ?? 0), 0));
  const val = (s: ChartSeries, i: number) => { const v = s.points[i]?.v ?? null; return v == null ? null : percent ? (totals[i] ? v / totals[i] : null) : v; };
  const leftVals: number[] = [];
  if (stacked) chart.x.forEach((_, i) => { let pos = 0; for (const s of bars) pos += Math.max(0, val(s, i) ?? 0); leftVals.push(pos); });
  for (const s of stacked ? lines.filter((x) => x.axis !== "right") : left) for (let i = 0; i < n; i++) { const v = val(s, i); if (v != null) leftVals.push(v); }
  const lineOnly = !bars.length;
  const yL = scaleLinear().domain(percent ? [0, 1] : niceDomain(leftVals, !lineOnly || chart.series.every((s) => s.unit !== "index"))).range([H - m.b, m.t]);
  const rightVals = right.flatMap((s) => s.points.map((p) => p.v).filter((v): v is number => v != null));
  const yR = scaleLinear().domain(niceDomain(rightVals)).range([H - m.b, m.t]);
  const x = scaleBand<number>().domain(chart.x.map((_, i) => i)).range([m.l, Math.max(m.l + 10, w - m.r)]).paddingInner(lineOnly ? 0 : 0.28).paddingOuter(lineOnly ? 0 : 0.12);
  const cx = (i: number) => (x(i) ?? 0) + x.bandwidth() / 2;
  const unitL = percent ? "pct" : (left[0]?.unit ?? "usd");
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - m.l - m.r) / 58))));
  const groupW = x.bandwidth() / (stacked ? 1 : Math.max(1, bars.length));
  const labelBars = bars.length === 1 && !stacked && n <= 10 && w > 300;
  const hover = (i: number, ev: React.MouseEvent) => {
    const r = (ev.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const scale = w / r.width;
    setTip({ x: (ev.clientX - r.left) * scale, y: (ev.clientY - r.top) * scale, lines: [dateTick(chart.x[i]), ...chart.series.map((s) => `${s.name}: ${fmtChart(s.points[i]?.v, s.unit, { signed: s.unit === "pct" && s.axis === "right" })}${percent && s.points[i]?.v != null && totals[i] ? ` (${fmtChart((s.points[i]!.v as number) / totals[i], "pct")})` : ""}`)] });
  };
  const pick = (i: number) => { const s = [...bars, ...lines].find((q) => q.points[i]?.f); ctx.onPick(s?.points[i]?.f, `${s?.name} · ${chart.x[i]}`); };
  if (w < 40) return null;
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg data-report-chart={chart.id} viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={chart.title} style={{ fontFamily: "inherit", display: "block" }}>
        <Axis y={yL} x0={m.l} x1={w - m.r} ticks={yL.ticks(4)} unit={unitL} side="left" />
        {right.length > 0 && <Axis y={yR} x0={m.l} x1={w - m.r} ticks={yR.ticks(4)} unit={right[0].unit} side="right" />}
        {chart.x.map((lab, i) => (i % step === 0 || i === n - 1) && (n - 1 - i >= step * (lineOnly ? 0.8 : 0.5) || i === n - 1) ? (
          <text key={i} x={cx(i)} y={H - 6} textAnchor={lineOnly && n > 8 && i === n - 1 ? "end" : lineOnly && n > 8 && i === 0 ? "start" : "middle"} style={{ fill: C.muted, fontSize: FONT - 1 }}>{dateTick(lab)}</text>
        ) : null)}
        {/* bars */}
        {chart.x.map((_, i) => {
          let pos = 0;
          return bars.map((s, k) => {
            const v = val(s, i);
            if (v == null) return null;
            const color = s.tone === "signed" ? (v >= 0 ? C.pos : C.neg) : colors.get(s)!;
            let y0: number, y1: number;
            if (stacked) { y0 = yL(pos); pos += Math.max(0, v); y1 = yL(pos); } else { y0 = yL(0); y1 = yL(v); }
            const bx = stacked ? (x(i) ?? 0) : (x(i) ?? 0) + k * groupW;
            const bw = Math.max(1, (stacked ? x.bandwidth() : groupW) - (stacked || bars.length === 1 ? 0 : 1.5));
            return (
              <g key={`${s.name}-${i}`}>
                <rect x={bx} width={bw} y={Math.min(y0, y1)} height={Math.max(0.5, Math.abs(y1 - y0))} rx={1} style={{ fill: color, opacity: s.opacity, cursor: s.points[i]?.f ? "pointer" : undefined }}
                  onMouseMove={(e) => hover(i, e)} onClick={() => ctx.onPick(s.points[i]?.f, `${s.name} · ${chart.x[i]}`)} />
                {labelBars && <text x={bx + bw / 2} y={v >= 0 ? y1 - 3 : y1 + FONT} textAnchor="middle" style={{ fill: C.ink, fontSize: FONT - 1.5 }}>{fmtChart(v, s.unit, { compact: true })}</text>}
              </g>
            );
          });
        })}
        {/* lines */}
        {lines.map((s) => {
          const ys = s.axis === "right" ? yR : yL;
          const pts = chart.x.map((_, i) => { const v = s.axis === "right" ? (s.points[i]?.v ?? null) : val(s, i); return v == null ? null : [cx(i), ys(v)] as const; });
          const segs: string[] = [];
          let cur = "";
          pts.forEach((q) => { if (q) cur += `${cur ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`; else if (cur) { segs.push(cur); cur = ""; } });
          if (cur) segs.push(cur);
          const color = colors.get(s)!;
          const dots = n <= 12;
          const endLabel = !dots && (s.tone === "self" || lines.length === 1);
          return (
            <g key={s.name}>
              {segs.map((d, k) => <path key={k} d={d} style={{ fill: "none", stroke: color, strokeWidth: s.tone === "self" ? 2.2 : 1.6, strokeDasharray: s.kind === "dash" ? "4 3" : undefined }} />)}
              {pts.map((q, i) => q && (dots || i === n - 1) ? <circle key={i} cx={q[0]} cy={q[1]} r={dots ? 2.6 : 3} style={{ fill: C.card, stroke: color, strokeWidth: 1.6, cursor: s.points[i]?.f ? "pointer" : undefined }} onMouseMove={(e) => hover(i, e)} onClick={() => ctx.onPick(s.points[i]?.f, `${s.name} · ${chart.x[i]}`)} /> : null)}
              {endLabel && pts[n - 1] && <text x={pts[n - 1]![0] - 4} y={pts[n - 1]![1] - 6} textAnchor="end" style={{ fill: color, fontSize: FONT - 1, fontWeight: 600 }}>{fmtChart(s.points[n - 1]?.v, s.unit)}</text>}
            </g>
          );
        })}
        {/* hover columns */}
        {lineOnly && chart.x.map((_, i) => <rect key={i} x={cx(i) - (x.step() / 2)} width={x.step()} y={m.t} height={H - m.t - m.b} style={{ fill: "transparent" }} onMouseMove={(e) => hover(i, e)} onClick={() => pick(i)} />)}
      </svg>
      <Tip tip={tip} w={w} />
    </div>
  );
}

// ---------- horizontal bars (bridges, contributions) ----------
function HBar({ chart, ctx, w }: { chart: Extract<ReportChart, { type: "hbar" }>; ctx: Ctx; w: number }) {
  // Label column sized to the longest label (≈6px per character), truncated only when it can't fit.
  const longest = Math.max(...chart.rows.map((r) => r.label.length), 4);
  const labelW = Math.min(Math.max(70, longest * 6 + 6), w * 0.46), maxChars = Math.floor((labelW - 4) / 6);
  const rowH = 22, valW = 64;
  const H = chart.rows.length * rowH + 8;
  const x = scaleLinear().domain(niceDomain(chart.rows.map((r) => r.v))).range([labelW + 6, w - valW]);
  if (w < 40) return null;
  return (
    <svg data-report-chart={chart.id} viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={chart.title} style={{ fontFamily: "inherit", display: "block" }}>
      <line x1={x(0)} x2={x(0)} y1={2} y2={H - 4} style={{ stroke: C.grid }} />
      {chart.rows.map((r, i) => {
        const y = 4 + i * rowH;
        const color = r.self ? C.brand : chart.signed ? (r.v >= 0 ? C.pos : C.neg) : PALETTE[0];
        return (
          <g key={r.label} style={{ cursor: r.f ? "pointer" : undefined }} onClick={() => ctx.onPick(r.f, r.label)}>
            <title>{`${r.label}: ${fmtChart(r.v, chart.unit, { signed: true })}`}</title>
            {r.self && <line x1={0} x2={w} y1={y - 2} y2={y - 2} style={{ stroke: C.grid }} />}
            <text x={labelW} y={y + rowH / 2 - 2} dy="0.32em" textAnchor="end" style={{ fill: C.ink, fontSize: FONT, fontWeight: r.self ? 600 : 400 }}>{r.label.length > maxChars ? `${r.label.slice(0, maxChars - 1)}…` : r.label}<title>{r.label}</title></text>
            <rect x={Math.min(x(0), x(r.v))} width={Math.max(1, Math.abs(x(r.v) - x(0)))} y={y + 3} height={rowH - 10} rx={1.5} style={{ fill: color, opacity: r.self ? 1 : 0.85 }} />
            <text x={w - valW + 6} y={y + rowH / 2 - 2} dy="0.32em" style={{ fill: r.self ? C.ink : C.muted, fontSize: FONT, fontWeight: r.self ? 600 : 400 }} className="num">{fmtChart(r.v, chart.unit, { signed: true })}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- peer small multiples ----------
function Peers({ chart, ctx, w }: { chart: Extract<ReportChart, { type: "peers" }>; ctx: Ctx; w: number }) {
  const narrow = w < 560;
  const metrics = narrow ? chart.metrics.slice(0, 4) : chart.metrics;
  const labelW = narrow ? 70 : 150, rowH = 21, headH = 30;
  const colW = (w - labelW) / Math.max(1, metrics.length);
  const H = headH + chart.rows.length * rowH + 4;
  if (w < 40) return null;
  return (
    <svg data-report-chart={chart.id} viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={chart.title} style={{ fontFamily: "inherit", display: "block" }}>
      {metrics.map((mt, j) => {
        const ci = chart.metrics.indexOf(mt);
        const vals = chart.rows.map((r) => r.cells[ci]?.v).filter((v): v is number => v != null);
        const x0 = labelW + j * colW + 6, x1 = labelW + (j + 1) * colW - 40;
        const xs = scaleLinear().domain(niceDomain(vals)).range([x0, Math.max(x0 + 10, x1)]);
        return (
          <g key={mt.key}>
            <text x={x0} y={12} style={{ fill: C.ink, fontSize: FONT, fontWeight: 600 }}>{mt.label}</text>
            <text x={x0} y={24} onClick={() => ctx.onPick(mt.medianF, `${mt.label} · peer median`)} style={{ fill: C.muted, fontSize: FONT - 1.5, cursor: mt.medianF ? "pointer" : undefined, textDecoration: mt.medianF ? "underline dotted" : undefined }}>{mt.median != null ? `median ${fmtChart(mt.median, mt.unit, { compact: true })}` : ""}<title>{`${mt.better === "high" ? "Higher is better" : "Lower is cheaper"} · click for the peer values behind the median`}</title></text>
            <line x1={xs(0)} x2={xs(0)} y1={headH} y2={H - 2} style={{ stroke: C.grid }} />
            {chart.rows.map((r, i) => {
              const c: ChartPoint | undefined = r.cells[ci];
              const y = headH + i * rowH;
              if (c?.v == null) return <text key={r.ticker} x={x0} y={y + rowH / 2} dy="0.32em" style={{ fill: C.muted, fontSize: FONT - 1 }}>—</text>;
              const color = r.self ? C.brand : C.peer;
              return (
                <g key={r.ticker} style={{ cursor: c.f ? "pointer" : undefined }} onClick={() => ctx.onPick(c.f, `${r.ticker} · ${mt.label}`)}>
                  <title>{`${r.ticker} ${mt.label}: ${fmtChart(c.v, mt.unit)}`}</title>
                  <rect x={Math.min(xs(0), xs(c.v))} width={Math.max(1, Math.abs(xs(c.v) - xs(0)))} y={y + 5} height={rowH - 10} rx={1.5} style={{ fill: color, opacity: r.self ? 1 : 0.55 }} />
                  <text x={Math.max(xs(0), xs(c.v)) + 3} y={y + rowH / 2} dy="0.32em" style={{ fill: r.self ? C.ink : C.muted, fontSize: FONT - 1, fontWeight: r.self ? 600 : 400 }}>{fmtChart(c.v, mt.unit, { compact: true })}</text>
                </g>
              );
            })}
            {mt.median != null && (
              <g style={{ cursor: mt.medianF ? "pointer" : undefined }} onClick={() => ctx.onPick(mt.medianF, `${mt.label} · peer median`)}>
                <title>{`Peer median ${fmtChart(mt.median, mt.unit)} · click for the peer values`}</title>
                <line x1={xs(mt.median)} x2={xs(mt.median)} y1={headH - 2} y2={H - 2} style={{ stroke: C.muted, strokeDasharray: "3 2", pointerEvents: "none" }} />
                <line data-median x1={xs(mt.median)} x2={xs(mt.median)} y1={headH - 2} y2={H - 2} style={{ stroke: "transparent", strokeWidth: 7 }} />
              </g>
            )}
          </g>
        );
      })}
      {chart.rows.map((r, i) => (
        <g key={r.ticker}>
          {r.self && <rect x={0} y={headH + i * rowH + 1} width={w} height={rowH - 2} rx={2} style={{ fill: C.brand, opacity: 0.06, pointerEvents: "none" }} />}
          <text x={4} y={headH + i * rowH + rowH / 2} dy="0.32em" style={{ fill: C.ink, fontSize: FONT, fontWeight: r.self ? 700 : 500 }}>{r.ticker}</text>
          {!narrow && <text x={46} y={headH + i * rowH + rowH / 2} dy="0.32em" style={{ fill: C.muted, fontSize: FONT - 1 }}>{r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}</text>}
        </g>
      ))}
    </svg>
  );
}

// ---------- scatter with fit ----------
function Scatter({ chart, ctx, w }: { chart: Extract<ReportChart, { type: "scatter" }>; ctx: Ctx; w: number }) {
  const H = 210, m = { t: 12, r: 14, b: 30, l: 46 };
  const x = scaleLinear().domain(niceDomain(chart.points.map((p) => p.x), false)).range([m.l, w - m.r]);
  const y = scaleLinear().domain(niceDomain(chart.points.map((p) => p.y))).range([H - m.b, m.t]);
  const [x0, x1] = x.domain();
  if (w < 40) return null;
  return (
    <svg data-report-chart={chart.id} viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={chart.title} style={{ fontFamily: "inherit", display: "block" }}>
      <Axis y={y} x0={m.l} x1={w - m.r} ticks={y.ticks(4)} unit={chart.yUnit} side="left" />
      {x.ticks(5).map((t) => <text key={t} x={x(t)} y={H - m.b + 13} textAnchor="middle" style={{ fill: C.muted, fontSize: FONT - 1 }}>{fmtChart(t, chart.xUnit, { compact: true })}</text>)}
      <text x={(m.l + w - m.r) / 2} y={H - 3} textAnchor="middle" style={{ fill: C.muted, fontSize: FONT - 1 }}>{chart.xLabel}</text>
      {chart.fit && (
        <line x1={x(x0)} x2={x(x1)} y1={y(chart.fit.a + chart.fit.b * x0)} y2={y(chart.fit.a + chart.fit.b * x1)} style={{ stroke: C.muted, strokeDasharray: "4 3", cursor: chart.fit.f ? "pointer" : undefined }} onClick={() => ctx.onPick(chart.fit?.f, "Peer fit")}>
          <title>{`Fit: R² ${chart.fit.r2.toFixed(2)}`}</title>
        </line>
      )}
      {placeLabels(chart.points.map((p) => ({ ...p, px: x(p.x), py: y(p.y) })), w).sort((a, b) => Number(a.self) - Number(b.self)).map((p) => (
        <g key={p.ticker} style={{ cursor: "pointer" }} onClick={() => ctx.onPick(p.fy ?? p.fx, `${p.ticker} · ${chart.yLabel}`)}>
          <title>{`${p.ticker}: ${chart.xLabel} ${fmtChart(p.x, chart.xUnit)}, ${chart.yLabel} ${fmtChart(p.y, chart.yUnit)}`}</title>
          <circle cx={p.px} cy={p.py} r={p.self ? 5.5 : 4} style={{ fill: p.self ? C.brand : C.peer, opacity: p.self ? 1 : 0.75, stroke: C.card, strokeWidth: 1 }} />
          <text x={p.lx} y={p.ly} dy="0.32em" textAnchor={p.anchor} style={{ fill: p.self ? C.ink : C.muted, fontSize: FONT - (p.self ? 0 : 1), fontWeight: p.self ? 700 : 400 }}>{p.ticker}</text>
        </g>
      ))}
    </svg>
  );
}

/** Greedy label placement: right, left, above, below — the first spot that doesn't hit a placed label. */
function placeLabels<T extends { ticker: string; self: boolean; px: number; py: number }>(pts: T[], w: number) {
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = pts.map((p) => ({ x0: p.px - 5, x1: p.px + 5, y0: p.py - 5, y1: p.py + 5 }));
  const order = [...pts].sort((a, b) => Number(b.self) - Number(a.self));
  const out = new Map<string, { lx: number; ly: number; anchor: "start" | "end" | "middle" }>();
  for (const p of order) {
    const tw = p.ticker.length * (p.self ? 7 : 6), r = p.self ? 8 : 6;
    const cands = [
      { lx: p.px + r, ly: p.py, anchor: "start" as const, x0: p.px + r, x1: p.px + r + tw, y0: p.py - 6, y1: p.py + 6 },
      { lx: p.px - r, ly: p.py, anchor: "end" as const, x0: p.px - r - tw, x1: p.px - r, y0: p.py - 6, y1: p.py + 6 },
      { lx: p.px, ly: p.py - 11, anchor: "middle" as const, x0: p.px - tw / 2, x1: p.px + tw / 2, y0: p.py - 17, y1: p.py - 5 },
      { lx: p.px, ly: p.py + 12, anchor: "middle" as const, x0: p.px - tw / 2, x1: p.px + tw / 2, y0: p.py + 6, y1: p.py + 18 },
    ].filter((c) => c.x0 >= 0 && c.x1 <= w);
    const hit = (c: { x0: number; x1: number; y0: number; y1: number }) => boxes.some((b) => c.x0 < b.x1 && c.x1 > b.x0 && c.y0 < b.y1 && c.y1 > b.y0);
    const pick = cands.find((c) => !hit(c)) ?? cands[0] ?? { lx: p.px + r, ly: p.py, anchor: "start" as const, x0: 0, x1: 0, y0: 0, y1: 0 };
    boxes.push(pick);
    out.set(p.ticker, { lx: pick.lx, ly: pick.ly, anchor: pick.anchor });
  }
  return pts.map((p) => ({ ...p, ...out.get(p.ticker)! }));
}

// ---------- history band ----------
function Band({ chart, ctx, w }: { chart: Extract<ReportChart, { type: "band" }>; ctx: Ctx; w: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const H = 190, m = { t: 10, r: 58, b: 22, l: 40 };
  const vals = chart.values.filter((v): v is number => v != null);
  const y = scaleLinear().domain(niceDomain([Math.min(...vals, chart.lo), Math.max(...vals, chart.hi)], false)).range([H - m.b, m.t]).clamp(true);
  const x = scaleLinear().domain([0, chart.dates.length - 1]).range([m.l, w - m.r]);
  let d = "";
  chart.values.forEach((v, i) => { if (v != null) d += `${d && chart.values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
  const lastI = chart.values.length - 1 - [...chart.values].reverse().findIndex((v) => v != null);
  const last = chart.values[lastI];
  const years = chart.dates.map((dt, i) => ({ dt, i })).filter((q, k, a) => k > 0 && q.dt.slice(0, 4) !== a[k - 1].dt.slice(0, 4));
  if (w < 40) return null;
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg data-report-chart={chart.id} viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={chart.title} style={{ fontFamily: "inherit", display: "block", cursor: chart.f ? "pointer" : undefined }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const sx = (e.clientX - r.left) * (w / r.width);
          const i = Math.max(0, Math.min(chart.dates.length - 1, Math.round(x.invert(sx))));
          setTip({ x: sx, y: (e.clientY - r.top) * (w / r.width), lines: [chart.dates[i], fmtChart(chart.values[i], chart.unit)] });
        }}
        onClick={() => ctx.onPick(chart.f, chart.title)}>
        <rect x={m.l} width={w - m.l - m.r} y={y(chart.hi)} height={Math.max(1, y(chart.lo) - y(chart.hi))} style={{ fill: C.brand, opacity: 0.07 }} />
        <Axis y={y} x0={m.l} x1={w - m.r} ticks={y.ticks(4)} unit={chart.unit} side="left" />
        <line x1={m.l} x2={w - m.r} y1={y(chart.median)} y2={y(chart.median)} style={{ stroke: C.muted, strokeDasharray: "4 3" }} />
        {(last == null || Math.abs(y(last) - y(chart.median)) > 11) && <text x={w - m.r + 4} y={y(chart.median)} dy="0.32em" style={{ fill: C.muted, fontSize: FONT - 1 }}>med {fmtChart(chart.median, chart.unit)}</text>}
        {years.map((q) => <text key={q.dt} x={x(q.i)} y={H - 6} textAnchor="middle" style={{ fill: C.muted, fontSize: FONT - 1 }}>{q.dt.slice(0, 4)}</text>)}
        <path d={d} style={{ fill: "none", stroke: C.brand, strokeWidth: 1.6 }} />
        {last != null && <>
          <circle cx={x(lastI)} cy={y(last)} r={3.2} style={{ fill: C.brand }} />
          <text x={w - m.r + 4} y={y(last)} dy="0.32em" style={{ fill: C.ink, fontSize: FONT, fontWeight: 600 }}>{fmtChart(last, chart.unit)}</text>
        </>}
      </svg>
      <Tip tip={tip} w={w} />
    </div>
  );
}

// ---------- ranges (targets vs trading range) ----------
function Range({ chart, ctx, w }: { chart: Extract<ReportChart, { type: "range" }>; ctx: Ctx; w: number }) {
  const rowH = 56, labelW = Math.min(150, w * 0.32), m = { t: 22, r: 26 };
  const H = m.t + chart.rows.length * rowH;
  const all = chart.rows.flatMap((r) => [r.low, r.high, ...r.marks.map((k) => k.v)]).concat(chart.current ? [chart.current.v] : []);
  const pad = (Math.max(...all) - Math.min(...all)) * 0.08;
  const x = scaleLinear().domain([Math.min(...all) - pad, Math.max(...all) + pad]).range([labelW + 8, w - m.r]);
  if (w < 40) return null;
  return (
    <svg data-report-chart={chart.id} viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label={chart.title} style={{ fontFamily: "inherit", display: "block" }}>
      {chart.rows.map((r, i) => {
        const y = m.t + i * rowH;
        return (
          <g key={r.label} style={{ cursor: r.f ? "pointer" : undefined }} onClick={() => ctx.onPick(r.f, r.label)}>
            <text x={labelW} y={y + 22} dy="0.32em" textAnchor="end" style={{ fill: C.ink, fontSize: FONT, fontWeight: 500 }}>{r.label}</text>
            <rect x={x(r.low)} width={Math.max(2, x(r.high) - x(r.low))} y={y + 16} height={12} rx={2} style={{ fill: PALETTE[i % PALETTE.length], opacity: 0.35 }} />
            <text x={x(r.low)} y={y + 40} textAnchor="middle" style={{ fill: C.muted, fontSize: FONT - 1 }}>{fmtChart(r.low, chart.unit)}</text>
            <text x={x(r.high)} y={y + 40} textAnchor="middle" style={{ fill: C.muted, fontSize: FONT - 1 }}>{fmtChart(r.high, chart.unit)}</text>
            {r.marks.map((k, j) => {
              // Marks close together stack their labels instead of overlapping.
              const lift = r.marks.slice(0, j).filter((q) => Math.abs(x(q.v) - x(k.v)) < 70).length;
              return (
                <g key={k.label}><title>{`${k.label} ${fmtChart(k.v, chart.unit)}`}</title>
                  <line x1={x(k.v)} x2={x(k.v)} y1={y + 12 - lift * 10} y2={y + 31} style={{ stroke: C.ink, strokeWidth: 1.4 }} />
                  <text x={x(k.v)} y={y + 9 - lift * 10} textAnchor={x(k.v) > w - 60 ? "end" : "middle"} style={{ fill: C.ink, fontSize: FONT - 1.5 }}>{k.label} {fmtChart(k.v, chart.unit)}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      {chart.current && (
        <g style={{ cursor: chart.current.f ? "pointer" : undefined }} onClick={() => ctx.onPick(chart.current?.f, chart.current?.label)}>
          <line x1={x(chart.current.v)} x2={x(chart.current.v)} y1={m.t - 6} y2={H - 4} style={{ stroke: C.brand, strokeWidth: 2 }} />
          <text x={x(chart.current.v)} y={m.t - 9} textAnchor={x(chart.current.v) < labelW + 60 ? "start" : "middle"} style={{ fill: C.brand, fontSize: FONT, fontWeight: 700 }}>{chart.current.label} {fmtChart(chart.current.v, chart.unit)}</text>
        </g>
      )}
    </svg>
  );
}

export function ReportChartView({ chart, facts, ticker }: { chart: ReportChart; facts: Map<string, Fact>; ticker: string }) {
  const [ref, w] = useWidth();
  const { picked, setPicked, onPick } = useChartSource(facts, ticker);
  const ctx: Ctx = { facts, ticker, onPick };
  const legend = useMemo(() => {
    if (chart.type !== "combo" && chart.type !== "stacked") return undefined;
    const hasSelf = chart.series.some((s) => s.tone === "self");
    return chart.series.map((s, i) => ({ name: s.name, color: s.tone === "signed" ? C.pos : seriesColor(s, i, hasSelf), opacity: s.opacity, dash: s.kind === "dash", line: s.kind !== "bar" }));
  }, [chart]);
  return (
    <Frame chart={chart} legend={legend} picked={picked} facts={facts} ticker={ticker} onClose={() => setPicked(null)}>
      <div ref={ref} className="min-w-0">
        {chart.type === "combo" || chart.type === "stacked" ? <Combo chart={chart} ctx={ctx} w={w} />
          : chart.type === "hbar" ? <HBar chart={chart} ctx={ctx} w={w} />
          : chart.type === "peers" ? <Peers chart={chart} ctx={ctx} w={w} />
          : chart.type === "scatter" ? <Scatter chart={chart} ctx={ctx} w={w} />
          : chart.type === "band" ? <Band chart={chart} ctx={ctx} w={w} />
          : <Range chart={chart} ctx={ctx} w={w} />}
      </div>
    </Frame>
  );
}
