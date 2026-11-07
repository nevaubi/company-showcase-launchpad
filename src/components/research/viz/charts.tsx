// Recharts-based canvas charts in the house style: horizontal gridlines only, no axis lines, tabular
// figures, palette from the app's chart tokens, direct annotations.
import { useMemo } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ReferenceArea, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { LeafSpec } from "@/lib/research/view-spec";
import { AXIS, PALETTE, TOOLTIP_STYLE, axisFmt, fmtValue, histogramBins, pctIsFraction, regression, toShares, waterfallBars, type Unit } from "./format";
import { Legend } from "./figure";

type Spec<T extends LeafSpec["type"]> = Extract<LeafSpec, { type: T }>;
type Ann = Spec<"chart">["annotations"];

const GRID = <CartesianGrid strokeDasharray="0" stroke="var(--border)" strokeOpacity={0.7} vertical={false} />;
const tick = { ...AXIS };

function annotate(a: Ann, yAxisId?: string) {
  if (!a) return null;
  const id = yAxisId ? { yAxisId } : {};
  return (
    <>
      {(a.ranges ?? []).map((r, i) =>
        r.axis === "y" ? (
          <ReferenceArea key={`r${i}`} {...id} y1={Number(r.from)} y2={Number(r.to)} fill="var(--chart-1)" fillOpacity={0.07} stroke="none" label={r.label ? { value: r.label, position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" } : undefined} />
        ) : (
          <ReferenceArea key={`r${i}`} {...id} x1={r.from as never} x2={r.to as never} fill="var(--muted-foreground)" fillOpacity={0.08} stroke="none" label={r.label ? { value: r.label, position: "insideTop", fontSize: 10, fill: "var(--muted-foreground)" } : undefined} />
        ),
      )}
      {(a.lines ?? []).map((l, i) =>
        l.axis === "x" ? (
          <ReferenceLine key={`l${i}`} {...id} x={l.value as never} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={l.label ? { value: l.label, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" } : undefined} />
        ) : (
          <ReferenceLine key={`l${i}`} {...id} y={Number(l.value)} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={l.label ? { value: l.label, position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" } : undefined} />
        ),
      )}
      {(a.points ?? []).map((p, i) => (
        <ReferenceDot key={`p${i}`} {...id} x={p.x as never} y={p.y} r={3.5} fill="var(--foreground)" stroke="var(--background)" strokeWidth={1.5} label={{ value: p.label, position: "top", fontSize: 10.5, fill: "var(--foreground)" }} />
      ))}
    </>
  );
}

export function CartesianView({ spec, height = 240 }: { spec: Spec<"chart">; height?: number }) {
  const lineSet = new Set(spec.chart === "combo" ? (spec.lineSeries ?? []) : []);
  const left = spec.series.filter((k) => !lineSet.has(k));
  const right = spec.series.filter((k) => lineSet.has(k));
  const pct100 = spec.chart === "stacked100";
  const data = useMemo(() => (pct100 ? toShares(spec.data, spec.series) : spec.data), [spec.data, spec.series, pct100]);
  const leftUnit: Unit = pct100 ? "%" : spec.unit;
  const leftFrac = pct100 || pctIsFraction(left.flatMap((k) => data.map((d) => d[k])));
  const rightFrac = pctIsFraction(right.flatMap((k) => data.map((d) => d[k])));
  const color = (k: string) => PALETTE[spec.series.indexOf(k) % PALETTE.length];
  const tooltip = (
    <Tooltip
      contentStyle={TOOLTIP_STYLE}
      cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
      formatter={(v, name) => (lineSet.has(String(name)) ? fmtValue(v, spec.rightUnit, { fraction: rightFrac }) : fmtValue(v, leftUnit, { fraction: leftFrac }))}
    />
  );
  const xAxis = <XAxis dataKey={spec.x} tick={tick} tickLine={false} axisLine={false} minTickGap={18} />;
  const yLeft = <YAxis yAxisId="l" tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={axisFmt(leftUnit, leftFrac)} domain={pct100 ? [0, 1] : ["auto", "auto"]} />;
  const legend = <Legend items={spec.series.map((k) => ({ label: k, color: color(k), dashed: lineSet.has(k) && false }))} />;
  const stacked = spec.chart === "stacked" || pct100;
  let chart;
  if (spec.chart === "line") {
    chart = (
      <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        {GRID}
        {xAxis}
        {yLeft}
        {tooltip}
        {annotate(spec.annotations, "l")}
        {spec.series.map((k) => <Line key={k} yAxisId="l" dataKey={k} stroke={color(k)} strokeWidth={2} dot={data.length <= 12} connectNulls isAnimationActive={false} />)}
      </LineChart>
    );
  } else if (spec.chart === "area") {
    chart = (
      <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        {GRID}
        {xAxis}
        {yLeft}
        {tooltip}
        {annotate(spec.annotations, "l")}
        {spec.series.map((k) => <Area key={k} yAxisId="l" dataKey={k} stroke={color(k)} fill={color(k)} fillOpacity={0.12} strokeWidth={2} connectNulls isAnimationActive={false} />)}
      </AreaChart>
    );
  } else {
    chart = (
      <ComposedChart data={data} margin={{ top: 10, right: right.length ? 4 : 12, left: 0, bottom: 0 }} barCategoryGap="22%">
        {GRID}
        {xAxis}
        {yLeft}
        {right.length > 0 && <YAxis yAxisId="r" orientation="right" tick={tick} tickLine={false} axisLine={false} width={46} tickFormatter={axisFmt(spec.rightUnit, rightFrac)} />}
        {tooltip}
        {annotate(spec.annotations, "l")}
        {left.map((k, i) => (
          <Bar key={k} yAxisId="l" dataKey={k} fill={color(k)} stackId={stacked ? "s" : undefined} radius={stacked ? (i === left.length - 1 ? [2, 2, 0, 0] : 0) : [2, 2, 0, 0]} maxBarSize={44} isAnimationActive={false} />
        ))}
        {right.map((k) => <Line key={k} yAxisId="r" dataKey={k} stroke={color(k)} strokeWidth={2.25} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />)}
      </ComposedChart>
    );
  }
  return (
    <div className="min-w-0">
      {legend}
      <div className="w-full min-w-0" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </div>
  );
}

/** Ranked horizontal bars, labels left, values at the bar end. */
export function HBarView({ spec }: { spec: Spec<"hbar"> }) {
  const items = useMemo(() => {
    const xs = [...spec.items];
    if (spec.sort !== "none") xs.sort((a, b) => (spec.sort === "asc" ? a.value - b.value : b.value - a.value));
    return xs;
  }, [spec.items, spec.sort]);
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-12);
  const neg = items.some((i) => i.value < 0);
  const frac = pctIsFraction(items.map((i) => i.value));
  const hl = new Set(spec.highlight ?? []);
  return (
    <ul className="grid gap-1" role="list">
      {items.map((it) => {
        const w = (Math.abs(it.value) / max) * (neg ? 50 : 100);
        return (
          <li key={it.label} className="grid grid-cols-[minmax(0,34%)_minmax(0,1fr)] items-center gap-2 text-[11.5px]">
            <span className={cn2("truncate text-right", hl.has(it.label) ? "font-semibold text-foreground" : "text-muted-foreground")} title={it.label}>{it.label}</span>
            <span className="relative flex h-[18px] items-center">
              {neg && <span className="absolute left-1/2 top-0 h-full w-px bg-border" />}
              <span
                className="absolute h-[14px] rounded-[2px]"
                style={{
                  width: `${w}%`,
                  left: neg ? (it.value < 0 ? `${50 - w}%` : "50%") : 0,
                  background: it.value < 0 ? "var(--negative)" : hl.size && !hl.has(it.label) ? "color-mix(in oklch, var(--chart-1) 45%, var(--muted))" : "var(--chart-1)",
                }}
              />
              <span className="num relative tabular-nums text-foreground" style={{ marginLeft: neg ? (it.value < 0 ? `calc(${50 - w}% - 4px)` : `calc(${50 + w}% + 4px)`) : `calc(${w}% + 4px)`, transform: neg && it.value < 0 ? "translateX(-100%)" : undefined }}>
                {fmtValue(it.value, spec.unit, { fraction: frac })}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const cn2 = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");

export function ScatterView({ spec, height = 260 }: { spec: Spec<"scatter">; height?: number }) {
  const groups = useMemo(() => {
    const m = new Map<string, typeof spec.points>();
    for (const p of spec.points) {
      const g = p.group ?? "";
      m.set(g, [...(m.get(g) ?? []), p]);
    }
    return [...m.entries()];
  }, [spec.points]);
  const fit = spec.regression ? regression(spec.points) : null;
  const xs = spec.points.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const xFrac = pctIsFraction(xs), yFrac = pctIsFraction(spec.points.map((p) => p.y));
  const sized = spec.points.some((p) => p.size != null);
  const labelled = spec.points.length <= 40;
  return (
    <div className="min-w-0">
      <Legend items={groups.filter(([g]) => g).map(([g], i) => ({ label: g, color: PALETTE[i % PALETTE.length] }))} />
      <div className="w-full min-w-0" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 14 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} />
            <XAxis type="number" dataKey="x" name={spec.xLabel} tick={tick} tickLine={false} axisLine={false} tickFormatter={axisFmt(spec.xUnit, xFrac)} domain={["auto", "auto"]}
              label={{ value: spec.xLabel, position: "insideBottom", offset: -10, fontSize: 10.5, fill: "var(--muted-foreground)" }} />
            <YAxis type="number" dataKey="y" name={spec.yLabel} tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={axisFmt(spec.yUnit, yFrac)} domain={["auto", "auto"]}
              label={{ value: spec.yLabel, angle: -90, position: "insideLeft", fontSize: 10.5, fill: "var(--muted-foreground)" }} />
            {sized && <ZAxis type="number" dataKey="size" range={[30, 420]} />}
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ strokeDasharray: "3 3" }}
              formatter={(v, n) => (n === spec.xLabel ? fmtValue(v, spec.xUnit, { fraction: xFrac }) : n === spec.yLabel ? fmtValue(v, spec.yUnit, { fraction: yFrac }) : fmtValue(v, ""))}
              labelFormatter={() => ""} />
            {annotate(spec.annotations)}
            {fit && (
              <ReferenceLine segment={[{ x: x0, y: fit.intercept + fit.slope * x0 }, { x: x1, y: fit.intercept + fit.slope * x1 }]} stroke="var(--foreground)" strokeOpacity={0.55} strokeDasharray="4 3"
                label={{ value: `R² ${fit.r2.toFixed(2)}`, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
            )}
            {groups.map(([g, pts], i) => (
              <Scatter key={g || "all"} name={g || "points"} data={pts} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.78} isAnimationActive={false}
                label={labelled ? { dataKey: "label", position: "top", fontSize: 10, fill: "var(--muted-foreground)" } : undefined} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function HistogramView({ spec, height = 220 }: { spec: Spec<"histogram">; height?: number }) {
  const bins = useMemo(() => histogramBins(spec.values, spec.bins), [spec.values, spec.bins]);
  const frac = pctIsFraction(spec.values);
  const data = bins.map((b) => ({ mid: (b.x0 + b.x1) / 2, n: b.n, range: `${fmtValue(b.x0, spec.unit, { fraction: frac })} to ${fmtValue(b.x1, spec.unit, { fraction: frac })}` }));
  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
          {GRID}
          <XAxis dataKey="mid" type="number" domain={["dataMin", "dataMax"]} tick={tick} tickLine={false} axisLine={false} tickFormatter={axisFmt(spec.unit, frac)} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}`, "count"]} labelFormatter={(_, p) => (p?.[0]?.payload as { range?: string } | undefined)?.range ?? ""} />
          {annotate(spec.annotations)}
          <Bar dataKey="n" fill="var(--chart-1)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WaterfallView({ spec, height = 240 }: { spec: Spec<"waterfall">; height?: number }) {
  const bars = useMemo(() => waterfallBars(spec.steps), [spec.steps]);
  const frac = pctIsFraction(spec.steps.map((s) => s.value));
  const fill = (k: string) => (k === "total" ? "var(--foreground)" : k === "up" ? "var(--positive)" : "var(--negative)");
  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 16, right: 12, left: 0, bottom: 0 }} barCategoryGap="18%">
          {GRID}
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={0} minTickGap={0} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={axisFmt(spec.unit, frac)} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(_, __, p) => fmtValue((p.payload as { value: number }).value, spec.unit, { fraction: frac, sign: (p.payload as { kind: string }).kind !== "total" })} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="size" stackId="w" isAnimationActive={false} radius={[2, 2, 2, 2]}
            label={{ position: "top", fontSize: 10, fill: "var(--muted-foreground)", formatter: (v: unknown) => fmtValue(v, spec.unit, { fraction: frac }) }}>
            {bars.map((b, i) => <Cell key={i} fill={fill(b.kind)} fillOpacity={b.kind === "total" ? 0.85 : 0.9} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutView({ spec }: { spec: Spec<"donut"> }) {
  const total = spec.parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="grid grid-cols-1 items-center gap-3 @md:grid-cols-[180px_minmax(0,1fr)]">
      <div className="mx-auto size-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={spec.parts} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={1} stroke="var(--background)" strokeWidth={2} isAnimationActive={false}>
              {spec.parts.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `${fmtValue(v, spec.unit)} (${total ? ((Number(v) / total) * 100).toFixed(1) : 0}%)`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid gap-1 text-[12px]">
        {spec.parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            <span className="num tabular-nums text-muted-foreground">{total ? ((p.value / total) * 100).toFixed(1) : "0"}%</span>
            <span className="num w-16 text-right tabular-nums">{fmtValue(p.value, spec.unit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MultiplesView({ spec }: { spec: Spec<"multiples"> }) {
  const all = spec.items.flatMap((it) => it.data.map((d) => d.y));
  const frac = pctIsFraction(all);
  const finite = all.filter((v): v is number => typeof v === "number");
  const domain: [number | string, number | string] = spec.sharedY && finite.length ? [Math.min(0, ...finite), Math.max(...finite)] : ["auto", "auto"];
  return (
    <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-4">
      {spec.items.map((it) => {
        const last = [...it.data].reverse().find((d) => d.y != null)?.y ?? null;
        return (
          <div key={it.title} className="min-w-0">
            <p className="flex items-baseline gap-1.5 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate font-medium">{it.title}</span>
              <span className="num tabular-nums text-muted-foreground">{fmtValue(last, spec.unit, { fraction: frac })}</span>
            </p>
            <div className="h-20 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                {spec.chart === "bar" ? (
                  <BarChart data={it.data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <YAxis hide domain={domain} />
                    <XAxis dataKey="x" hide />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtValue(v, spec.unit, { fraction: frac })} />
                    <Bar dataKey="y" fill="var(--chart-1)" isAnimationActive={false} />
                  </BarChart>
                ) : (
                  <AreaChart data={it.data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <YAxis hide domain={domain} />
                    <XAxis dataKey="x" hide />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtValue(v, spec.unit, { fraction: frac })} />
                    <Area dataKey="y" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={spec.chart === "area" ? 0.14 : 0} strokeWidth={1.75} connectNulls isAnimationActive={false} />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Candles with volume, moving-average overlays, shaded price bands and event markers (SVG). */
export function CandlesView({ spec, height = 300 }: { spec: Spec<"candles">; height?: number }) {
  const W = 720;
  const H = height;
  const volH = spec.bars.some((b) => b.v != null) ? 52 : 0;
  const top = 10, left = 6, right = 52, bottom = 20;
  const plotH = H - top - bottom - volH - (volH ? 6 : 0);
  const n = spec.bars.length;
  const lows = spec.bars.map((b) => b.l), highs = spec.bars.map((b) => b.h);
  const ov = (spec.overlays ?? []).flatMap((o) => o.values.filter((v): v is number => v != null));
  const bands = spec.bands ?? [];
  let lo = Math.min(...lows, ...ov), hi = Math.max(...highs, ...ov);
  for (const b of bands) if (b.from <= hi * 1.15 && b.to >= lo * 0.85) {
    lo = Math.min(lo, b.from);
    hi = Math.max(hi, b.to);
  }
  const pad = (hi - lo) * 0.04 || 1;
  lo -= pad;
  hi += pad;
  const step = (W - left - right) / n;
  const bw = Math.max(1, Math.min(10, step * 0.65));
  const X = (i: number) => left + step * (i + 0.5);
  const Y = (v: number) => top + ((hi - v) / (hi - lo)) * plotH;
  const vmax = Math.max(...spec.bars.map((b) => b.v ?? 0), 1);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const dateIdx = new Map(spec.bars.map((b, i) => [b.t.slice(0, 10), i]));
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  return (
    <div className="min-w-0">
      <Legend items={(spec.overlays ?? []).map((o, i) => ({ label: o.name, color: PALETTE[(i + 1) % PALETTE.length] }))} />
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={spec.title ?? "Price chart"}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={left} x2={W - right} y1={Y(t)} y2={Y(t)} stroke="var(--border)" strokeOpacity={0.7} />
            <text x={W - right + 6} y={Y(t) + 3.5} fontSize={10.5} fill="var(--muted-foreground)" className="tabular-nums">{fmtValue(t, spec.unit ?? "$", { digits: 2 })}</text>
          </g>
        ))}
        {bands.map((b, i) => (
          <g key={`b${i}`}>
            <rect x={left} width={W - left - right} y={Y(Math.max(b.from, b.to))} height={Math.max(1, Math.abs(Y(b.from) - Y(b.to)))} fill="var(--chart-1)" fillOpacity={0.08} />
            {b.label && <text x={left + 4} y={Y(Math.max(b.from, b.to)) + 11} fontSize={10} fill="var(--muted-foreground)">{b.label}</text>}
          </g>
        ))}
        {spec.bars.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? "var(--positive)" : "var(--negative)";
          return (
            <g key={i}>
              <line x1={X(i)} x2={X(i)} y1={Y(b.h)} y2={Y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={X(i) - bw / 2} width={bw} y={Y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(Y(b.o) - Y(b.c)))} fill={up ? "var(--background)" : col} stroke={col} strokeWidth={1} />
              {volH > 0 && b.v != null && <rect x={X(i) - bw / 2} width={bw} y={H - bottom - (b.v / vmax) * volH} height={(b.v / vmax) * volH} fill="var(--muted-foreground)" fillOpacity={0.28} />}
              {i % labelEvery === 0 && <text x={X(i)} y={H - 5} fontSize={10} textAnchor="middle" fill="var(--muted-foreground)">{b.t.slice(2, 10)}</text>}
            </g>
          );
        })}
        {(spec.overlays ?? []).map((o, k) => {
          const d = o.values.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`));
          const segs: string[] = [];
          let cur: string[] = [];
          for (const p of d) {
            if (p) cur.push(p);
            else if (cur.length) {
              segs.push(cur.join(" "));
              cur = [];
            }
          }
          if (cur.length) segs.push(cur.join(" "));
          return segs.map((s, j) => <polyline key={`${k}-${j}`} points={s} fill="none" stroke={PALETTE[(k + 1) % PALETTE.length]} strokeWidth={1.5} />);
        })}
        {(spec.events ?? []).map((e, i) => {
          const idx = dateIdx.get(e.t.slice(0, 10));
          if (idx == null) return null;
          return (
            <g key={`e${i}`}>
              <line x1={X(idx)} x2={X(idx)} y1={top} y2={top + plotH} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
              <text x={X(idx) + 3} y={top + 9} fontSize={10} fill="var(--muted-foreground)">{e.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
