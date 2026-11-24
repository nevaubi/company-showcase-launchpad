// Three small multiples over the quarterly history: revenue (columns from zero), the profit margin
// (line) and the stock's two-day reaction to each release (columns either side of zero). One series
// each, so no legends; the latest point is labelled directly and every mark has a tooltip with its
// value, unit and period.
import type { ProfitLine, QuarterRecord } from "@/lib/earnings/quarters";
import { fmtCompactUsd, fmtDate } from "@/lib/format";
import { signedPct } from "./figures";

const W = 320;
const H = 112;
const PAD = { l: 34, r: 40, t: 14, b: 18 };
const iw = W - PAD.l - PAD.r;
const ih = H - PAD.t - PAD.b;

function Frame({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure className="min-w-0 px-4 py-3">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="truncate text-[11px] text-muted-foreground">{caption}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`${title}, ${caption}`}>
        {children}
      </svg>
    </figure>
  );
}

const axisText = "fill-muted-foreground text-[10px]";

function XLabels({ quarters, x }: { quarters: QuarterRecord[]; x: (i: number) => number }) {
  const n = quarters.length;
  return (
    <>
      <text x={x(0)} y={H - 4} textAnchor="start" className={axisText}>
        {quarters[0].period.label}
      </text>
      <text x={x(n - 1)} y={H - 4} textAnchor="end" className={axisText}>
        {quarters[n - 1].period.label}
      </text>
    </>
  );
}

function RevenueColumns({ quarters }: { quarters: QuarterRecord[] }) {
  const vals = quarters.map((q) => q.revenue?.v ?? null);
  const max = Math.max(...vals.map((v) => v ?? 0));
  if (!(max > 0)) return null;
  const n = quarters.length;
  const band = iw / n;
  const bw = Math.min(24, band - 2);
  const x = (i: number) => PAD.l + band * i + band / 2;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const last = vals[n - 1];
  return (
    <Frame title="Revenue" caption="per quarter, USD">
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="stroke-border" strokeWidth={1} />
      <text x={PAD.l - 4} y={PAD.t + 3} textAnchor="end" className={axisText}>
        {fmtCompactUsd(max, 0)}
      </text>
      <text x={PAD.l - 4} y={PAD.t + ih + 3} textAnchor="end" className={axisText}>
        0
      </text>
      {vals.map((v, i) =>
        v == null || v <= 0 ? null : (
          <path
            key={i}
            d={`M${x(i) - bw / 2},${PAD.t + ih} V${y(v) + 3} q0,-3 3,-3 h${bw - 6} q3,0 3,3 V${PAD.t + ih} Z`}
            className={i === n - 1 ? "fill-chart-1" : "fill-chart-5/45 transition-opacity duration-150 hover:fill-chart-5/80"}
          >
            <title>{`${quarters[i].period.label} (to ${fmtDate(quarters[i].period.end)}): revenue ${fmtCompactUsd(v)}`}</title>
          </path>
        ),
      )}
      {last != null && (
        <text x={x(n - 1) + bw / 2 + 4} y={y(last) + 4} className="fill-foreground text-[10px] font-medium">
          {fmtCompactUsd(last)}
        </text>
      )}
      <XLabels quarters={quarters} x={x} />
    </Frame>
  );
}

function MarginLine({ quarters, label }: { quarters: QuarterRecord[]; label: string }) {
  const pts = quarters.map((q, i) => ({ i, v: q.profitMargin?.v ?? null })).filter((p): p is { i: number; v: number } => p.v != null);
  if (pts.length < 2) return null;
  const n = quarters.length;
  const band = iw / n;
  const x = (i: number) => PAD.l + band * i + band / 2;
  let lo = Math.min(...pts.map((p) => p.v));
  let hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.15, 0.01);
  lo -= pad;
  hi += pad;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
  const end = pts[pts.length - 1];
  const fmt = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <Frame title={label} caption="per quarter">
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="stroke-border" strokeWidth={1} />
      <text x={PAD.l - 4} y={PAD.t + 3} textAnchor="end" className={axisText}>
        {fmt(hi)}
      </text>
      <text x={PAD.l - 4} y={PAD.t + ih + 3} textAnchor="end" className={axisText}>
        {fmt(lo)}
      </text>
      <path d={d} fill="none" className="stroke-chart-1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={p.i === end.i ? 4 : 6} className={p.i === end.i ? "fill-chart-1 stroke-card" : "fill-transparent"} strokeWidth={2}>
          <title>{`${quarters[p.i].period.label}: ${label.toLowerCase()} ${fmt(p.v)}`}</title>
        </circle>
      ))}
      <text x={x(end.i) + 7} y={y(end.v) + 4} className="fill-foreground text-[10px] font-medium">
        {fmt(end.v)}
      </text>
      <XLabels quarters={quarters} x={x} />
    </Frame>
  );
}

function ReactionColumns({ quarters }: { quarters: QuarterRecord[] }) {
  const vals = quarters.map((q) => q.reaction?.move ?? null);
  const present = vals.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const m = Math.max(0.02, ...present.map(Math.abs));
  const n = quarters.length;
  const band = iw / n;
  const bw = Math.min(24, band - 2);
  const x = (i: number) => PAD.l + band * i + band / 2;
  const zero = PAD.t + ih / 2;
  const y = (v: number) => zero - (v / m) * (ih / 2);
  const lastI = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop()!;
  const lastV = vals[lastI]!;
  return (
    <Frame title="Reaction to each release" caption="2-day move">
      <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} className="stroke-border" strokeWidth={1} />
      <text x={PAD.l - 4} y={PAD.t + 3} textAnchor="end" className={axisText}>
        +{(m * 100).toFixed(0)}%
      </text>
      <text x={PAD.l - 4} y={zero + 3} textAnchor="end" className={axisText}>
        0
      </text>
      <text x={PAD.l - 4} y={PAD.t + ih + 3} textAnchor="end" className={axisText}>
        −{(m * 100).toFixed(0)}%
      </text>
      {vals.map((v, i) => {
        if (v == null || v === 0) return null;
        const top = Math.min(y(v), zero);
        const h = Math.max(1, Math.abs(y(v) - zero));
        const r = Math.min(3, h);
        const path =
          v > 0
            ? `M${x(i) - bw / 2},${zero} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${zero} Z`
            : `M${x(i) - bw / 2},${zero} V${zero + h - r} q0,${r} ${r},${r} h${bw - 2 * r} q${r},0 ${r},-${r} V${zero} Z`;
        return (
          <path key={i} d={path} className={v > 0 ? "fill-positive/80 transition-opacity duration-150 hover:fill-positive" : "fill-negative/80 transition-opacity duration-150 hover:fill-negative"}>
            <title>{`${quarters[i].period.label}, release ${fmtDate(quarters[i].reaction!.date)}: ${signedPct(v)} over two days${quarters[i].reaction!.excess != null ? `, ${signedPct(quarters[i].reaction!.excess)} vs S&P 500` : ""}`}</title>
          </path>
        );
      })}
      <text x={x(lastI) + bw / 2 + 4} y={y(lastV) + (lastV > 0 ? 4 : 0)} className="fill-foreground text-[10px] font-medium">
        {signedPct(lastV)}
      </text>
      <XLabels quarters={quarters} x={x} />
    </Frame>
  );
}

/** Oldest-first quarters in; renders up to three charts side by side (one column on phones). */
export function HistoryCharts({ quarters, profit }: { quarters: QuarterRecord[]; profit: ProfitLine }) {
  return (
    <div data-section="History charts" className="grid grid-cols-1 divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
      <RevenueColumns quarters={quarters} />
      <MarginLine quarters={quarters} label={profit.marginLabel} />
      <ReactionColumns quarters={quarters} />
    </div>
  );
}
