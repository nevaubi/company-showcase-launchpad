// 1. The chart above a statement table: the selected lines over time (a line for quarters and months, columns for
// fiscal years) on one value axis, or the section's parts stacked (absolute or 100 percent) in the periods where they
// add up to the printed total. Hover or arrow keys read a period (value, as filed, YoY and QoQ); a click or Enter
// opens the figure's source document.
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import * as d3 from "d3";
import { Segmented } from "@/components/app/segmented";
import { QUIET, SeriesLegend, dashOf, slot, useReducedMotion, useWidth } from "@/components/alt/library/charts/primitives";
import { cn } from "@/lib/utils";
import { axisCaption, fmtTick, fmtValue } from "./format";
import { foldParts, markOf, oneAxis, periodsOf, pointAt, spreadLabels, stackColumns, stackable, valueDomain } from "./model";
import { VizNote, pointLines, useOpener, valueText } from "./parts";
import type { SectionChartProps, VizPoint, VizSeries } from "./types";

type View = "lines" | "stacked" | "share";
const M = { top: 10, bottom: 22, left: 46 };
const LABEL_W = 108;

/** The readout box: title, then one row per mark, then the as-filed lines of the active mark. */
function Readout({ x, width, title, rows, foot }: { x: number; width: number; title: string; rows: { key: string; color: string; label: string; value: string; active: boolean }[]; foot: string[] }) {
  const w = Math.min(236, width - 8);
  const left = Math.min(Math.max(x - w / 2, 0), Math.max(0, width - w));
  return (
    <div className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-lift" style={{ left, width: w }} role="status" aria-live="polite">
      <p className="mb-0.5 text-muted-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.key} className={cn("flex items-center gap-1.5", r.active ? "text-foreground" : "text-muted-foreground")}>
          <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className={cn("num", r.active ? "font-medium text-foreground" : "")}>{r.value}</span>
          <span className="min-w-0 truncate">{r.label}</span>
        </p>
      ))}
      {foot.map((l, i) => (
        <p key={i} className="mt-0.5 text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

export function SectionChart({ series, parts: given, title, view: initial = "lines", height = 200, scale, onOpen, className }: SectionChartProps) {
  // Stacks keep at most five colours; smaller lines fold into "Other lines" (lines views draw the lines themselves).
  const parts = useMemo(() => (given ? foldParts(given) : null), [given]);
  const canStack = !!parts && stackable(parts);
  const [view, setView] = useState<View>(initial !== "lines" && canStack ? initial : "lines");
  const [active, setActive] = useState<{ i: number; j: number } | null>(null);
  const [ref, width] = useWidth(240, 640);
  const reduced = useReducedMotion();
  const open = useOpener(onOpen);
  const v: View = view !== "lines" && !canStack ? "lines" : view;

  const { shown, leftOut } = useMemo(() => oneAxis(v === "lines" ? series : parts?.parts ?? [], 6), [series, parts, v]);
  const columns = useMemo(() => (parts && v !== "lines" ? stackColumns(parts, v) : []), [parts, v]);
  const cadence = shown[0]?.cadence ?? parts?.cadence ?? "q";
  const periods = useMemo(() => (v === "lines" ? periodsOf(shown) : columns.map((c) => c.period)), [shown, columns, v]);
  const unitSeries: Pick<VizSeries, "unit" | "printedUnit"> = v === "share" ? { unit: "pct" } : (shown[0] ?? { unit: parts?.unit ?? "usd" });

  if (!shown.length || !periods.length) return <VizNote className={className}>No figures to chart for {title}.</VizNote>;

  const keyOf = (s: VizSeries) => s.key;
  // The colour follows the line's place in the section, never its rank.
  const colorOf = (s: VizSeries) => {
    if (s.key === "__other") return QUIET;
    const idx = (v === "lines" ? series : parts!.parts).findIndex((x) => keyOf(x) === keyOf(s));
    return slot(idx);
  };
  const direct = v === "lines" && shown.length >= 2 && shown.length <= 4 && width >= 520;
  const right = direct ? LABEL_W : 12;
  const w = Math.max(40, width - M.left - right);
  const h = height;
  const columnsView = v !== "lines" || markOf(cadence) === "columns";
  const band = d3.scaleBand<string>().domain(periods).range([0, w]).paddingInner(0.28).paddingOuter(0.14);
  const point = d3.scalePoint<string>().domain(periods).range([0, w]).padding(periods.length === 1 ? 0.5 : 0.2);
  const xc = (e: string) => (columnsView ? (band(e) ?? 0) + band.bandwidth() / 2 : (point(e) ?? 0));

  const values = v === "lines" ? shown.flatMap((s) => s.points.map((p) => p.value)) : columns.flatMap((c) => c.segments.map((g) => g.y1));
  const [lo, hi] = valueDomain(values, columnsView);
  const y = d3.scaleLinear().domain(v === "share" ? [0, 100] : [lo, hi]).range([h, 0]);
  if (v !== "share") y.nice(h < 150 ? 3 : 4);
  const ticks = y.ticks(h < 150 ? 3 : 4);
  const tickFmt = (t: number) => (v === "share" ? `${t}` : fmtTick(t, unitSeries.unit, scale));

  // About one period label per 64px: every n-th from the first, the last in place of a neighbour too close to it.
  const every = Math.max(1, Math.ceil(periods.length / Math.max(2, Math.floor(w / 64))));
  const labelled = new Set<number>();
  for (let k = 0; k < periods.length; k += every) labelled.add(k);
  const lastK = periods.length - 1;
  if (!labelled.has(lastK)) {
    const prev = Math.floor(lastK / every) * every;
    if (lastK - prev < every * 0.75 && prev !== 0) labelled.delete(prev);
    labelled.add(lastK);
  }
  const shortOf = (e: string) => {
    for (const s of shown) {
      const p = pointAt(s, e);
      if (p) return p.short;
    }
    return columns.find((c) => c.period === e)?.short ?? e;
  };

  const clampActive = (i: number, j: number) => ({ i: Math.max(0, Math.min(periods.length - 1, i)), j: Math.max(0, Math.min((v === "lines" ? shown.length : parts!.parts.length) - 1, j)) });
  const pointOfActive = (a: { i: number; j: number } | null): VizPoint | null => {
    if (!a) return null;
    const e = periods[a.i];
    if (v === "lines") return pointAt(shown[a.j], e);
    return columns[a.i]?.segments[a.j]?.point ?? null;
  };

  const onMove = (ev: PointerEvent<SVGRectElement>) => {
    const box = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ev.clientX - box.left - M.left;
    const py = ev.clientY - box.top - M.top;
    let i = 0;
    let best = Infinity;
    periods.forEach((e, k) => {
      const d = Math.abs(xc(e) - px);
      if (d < best) (best = d), (i = k);
    });
    let j = 0;
    if (v === "lines") {
      let bd = Infinity;
      shown.forEach((s, k) => {
        const p = pointAt(s, periods[i]);
        if (!p) return;
        const d = Math.abs(y(p.value) - py);
        if (d < bd) (bd = d), (j = k);
      });
    } else {
      const segs = columns[i]?.segments ?? [];
      const val = y.invert(py);
      const k = segs.findIndex((g) => val >= Math.min(g.y0, g.y1) && val <= Math.max(g.y0, g.y1));
      j = k >= 0 ? k : Math.max(0, segs.length - 1);
    }
    setActive({ i, j });
  };
  const onKey = (ev: KeyboardEvent<SVGSVGElement>) => {
    const a = active ?? { i: periods.length - 1, j: 0 };
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, v === "lines" ? -1 : 1], ArrowDown: [0, v === "lines" ? 1 : -1] };
    if (moves[ev.key]) {
      ev.preventDefault();
      setActive(clampActive(a.i + moves[ev.key][0], a.j + moves[ev.key][1]));
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      setActive(clampActive(ev.key === "Home" ? 0 : periods.length - 1, a.j));
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      open(pointOfActive(a));
    } else if (ev.key === "Escape") setActive(null);
  };

  const lineOf = (s: VizSeries) =>
    d3
      .line<string>()
      .defined((e) => !!pointAt(s, e))
      .x((e) => xc(e))
      .y((e) => y(pointAt(s, e)?.value ?? 0))(periods) ?? "";

  const ends =
    direct && v === "lines"
      ? spreadLabels(
          shown.map((s) => ({ key: s.key, y: y(s.points.at(-1)!.value) })),
          13,
          4,
          h - 2,
        )
      : null;

  // The readout of the active period.
  let readout: { x: number; title: string; rows: { key: string; color: string; label: string; value: string; active: boolean }[]; foot: string[] } | null = null;
  if (active) {
    const e = periods[active.i];
    if (v === "lines") {
      const s = shown[active.j];
      const p = pointAt(s, e);
      const rows = shown.flatMap((x, k) => {
        const q = pointAt(x, e);
        return q ? [{ key: x.key, color: colorOf(x), label: x.label, value: valueText(x, q, scale), active: k === active.j }] : [];
      });
      const lead = p ?? shown.map((x) => pointAt(x, e)).find(Boolean)!;
      readout = { x: M.left + xc(e), title: lead.periodLabel, rows, foot: p ? pointLines(s, p).slice(1) : [] };
    } else {
      const c = columns[active.i];
      const g = c.segments[active.j];
      const rows = [...c.segments].reverse().map((x) => ({
        key: x.key,
        color: x.key === "__other" ? QUIET : slot(x.slot),
        label: x.label,
        value: v === "share" ? `${x.value.toFixed(1)}%` : fmtValue(x.value, parts!.unit, scale),
        active: x.key === g.key,
      }));
      const s = parts!.parts[g.slot];
      const foot = [`${parts!.total.label}: ${fmtValue(c.total.value, parts!.unit, scale)}`, ...pointLines(s, g.point).slice(1)];
      if (v === "share") foot.unshift(`${g.label}: ${fmtValue(g.point.value, parts!.unit, scale)}`);
      readout = { x: M.left + xc(e), title: c.periodLabel, rows, foot };
    }
  }

  const activePoint = pointOfActive(active);
  const legendItems = (v === "lines" ? shown : parts!.parts).map((s) => ({ key: s.key, label: s.label, color: colorOf(s), dash: v === "lines" ? dashOf((v === "lines" ? series : parts!.parts).indexOf(s)) : undefined }));
  const first = shortOf(periods[0]);
  const last = shortOf(periods[periods.length - 1]);
  const why = parts && !canStack ? (parts.ties.length ? "Not stacked: a line is negative in a period, so a stack would not read as the total." : "Not stacked: the lines never add up to the printed total.") : "";

  return (
    <figure className={cn("min-w-0", className)}>
      {parts && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented<View>
            label={`${title}: chart view`}
            value={v}
            onChange={(x) => {
              setView(x);
              setActive(null);
            }}
            options={[
              { v: "lines", l: "Lines" },
              { v: "stacked", l: "Stacked", disabled: !canStack, title: canStack ? "Parts stacked to the printed total" : why },
              { v: "share", l: "100%", disabled: !canStack, title: canStack ? "Each part as a share of the printed total" : why },
            ]}
          />
        </div>
      )}
      {legendItems.length > 1 && <SeriesLegend items={legendItems} fill={v !== "lines" || columnsView} />}
      <div ref={ref} className="relative min-w-0">
        <svg
          width={width}
          height={h + M.top + M.bottom}
          className={cn("block max-w-full overflow-visible rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", !reduced && "transition-opacity duration-150")}
          role="group"
          aria-roledescription="chart"
          aria-label={`${title}, ${first} to ${last}, ${axisCaption(unitSeries, scale)}. Arrow keys move between periods and lines, Enter opens the source.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => !active && setActive({ i: periods.length - 1, j: 0 })}
          onBlur={() => setActive(null)}
        >
          <g transform={`translate(${M.left},${M.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x1={0} x2={w} stroke="var(--border)" strokeWidth={t === 0 ? 1 : 0.5} opacity={t === 0 ? 1 : 0.8} />
                <text x={-6} dy="0.32em" textAnchor="end" className="fill-muted-foreground num text-[10px]">
                  {tickFmt(t)}
                </text>
              </g>
            ))}
            {periods.map((e, k) =>
              labelled.has(k) ? (
                <text key={e} x={xc(e)} y={h + 15} textAnchor={k === 0 && !columnsView && xc(e) < 24 ? "start" : k === lastK && !columnsView && w - xc(e) < 24 ? "end" : "middle"} className="fill-muted-foreground num text-[10px]">
                  {shortOf(e)}
                </text>
              ) : null,
            )}
            {active && <line x1={xc(periods[active.i])} x2={xc(periods[active.i])} y1={0} y2={h} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.35} />}

            {v === "lines" && !columnsView &&
              shown.map((s, k) => (
                <g key={s.key}>
                  <path d={lineOf(s)} fill="none" stroke={colorOf(s)} strokeWidth={2} strokeDasharray={dashOf(series.indexOf(s))} strokeLinejoin="round" strokeLinecap="round" />
                  {s.points.length === 1 || !active ? (
                    <circle cx={xc(s.points.at(-1)!.period)} cy={y(s.points.at(-1)!.value)} r={3.5} fill={colorOf(s)} stroke="var(--card)" strokeWidth={2} />
                  ) : null}
                  {active && pointAt(s, periods[active.i]) && (
                    <circle cx={xc(periods[active.i])} cy={y(pointAt(s, periods[active.i])!.value)} r={k === active.j ? 5 : 3.5} fill={colorOf(s)} stroke="var(--card)" strokeWidth={2} />
                  )}
                </g>
              ))}

            {v === "lines" && columnsView &&
              periods.map((e) => {
                const bw = Math.min(24, band.bandwidth() / shown.length - 2);
                const x0 = xc(e) - (shown.length * (bw + 2) - 2) / 2;
                return shown.map((s, k) => {
                  const p = pointAt(s, e);
                  if (!p) return null;
                  const top = Math.min(y(p.value), y(0));
                  const isActive = active && periods[active.i] === e && active.j === k;
                  return <rect key={`${e}-${s.key}`} x={x0 + k * (bw + 2)} y={top} width={bw} height={Math.max(1, Math.abs(y(p.value) - y(0)))} rx={2} fill={colorOf(s)} opacity={active && !isActive ? 0.55 : 1} />;
                });
              })}

            {v !== "lines" &&
              columns.map((c, i) => {
                const bw = Math.min(28, band.bandwidth());
                const x0 = xc(c.period) - bw / 2;
                return c.segments.map((g, k) => {
                  const top = y(Math.max(g.y0, g.y1));
                  const hh = Math.abs(y(g.y0) - y(g.y1));
                  const isActive = active?.i === i && active?.j === k;
                  return (
                    <rect
                      key={`${c.period}-${g.key}`}
                      x={x0}
                      y={top + (k === c.segments.length - 1 ? 0 : 1)}
                      width={bw}
                      height={Math.max(0, hh - (k === c.segments.length - 1 ? 1 : 2))}
                      rx={k === c.segments.length - 1 ? 2 : 0}
                      fill={g.key === "__other" ? QUIET : slot(g.slot)}
                      opacity={active && active.i === i && !isActive ? 0.6 : 1}
                      stroke={isActive ? "var(--foreground)" : "none"}
                      strokeWidth={isActive ? 1.5 : 0}
                    />
                  );
                });
              })}

            {ends &&
              shown.map((s) => (
                <text key={s.key} x={w + 8} y={ends.get(s.key)} dy="0.32em" className="fill-muted-foreground text-[10px]">
                  {s.label.length > 17 ? `${s.label.slice(0, 16)}…` : s.label}
                </text>
              ))}

            <rect
              x={0}
              y={0}
              width={w}
              height={h}
              fill="transparent"
              className={activePoint?.source ? "cursor-pointer" : undefined}
              onPointerMove={onMove}
              onPointerLeave={() => setActive(null)}
              onClick={() => open(activePoint)}
            />
          </g>
        </svg>
        {readout && <Readout width={width} {...readout} />}
      </div>
      <figcaption className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {v === "share" ? `Share of ${parts!.total.label} (each line ÷ the printed total × 100, both ${axisCaption(parts!.total, scale)})` : axisCaption(unitSeries, scale)}
        {` · ${first} to ${last}`}
        {v !== "lines" && parts && parts.ties.length < parts.total.points.length ? ` · ${parts.ties.length} of ${parts.total.points.length} periods add up and are shown` : ""}
        {leftOut > 0 ? ` · ${leftOut} more ${leftOut === 1 ? "line" : "lines"} not drawn (another unit or past six)` : ""}
        {v === "lines" && why ? ` · ${why}` : ""}
      </figcaption>
    </figure>
  );
}

