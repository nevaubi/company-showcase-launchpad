"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { InsightDriver, InsightMetric } from "./ai-insight-card-data";
import styles from "./ai-insight-card.module.css";

const HEIGHT = 112;
const PAD_TOP = 30;
const PAD_BOTTOM = 6;
const PAD_X = 6;
const BADGE_Y = 10;
/** Half the tooltip's width, so it stays inside the card at either end. */
const TIP_HALF = 104;

type Point = { x: number; y: number };

/** Monotone cubic interpolation (Fritsch and Carlson): smooth, never overshoots a data point, so dips read honestly. */
function monotonePath(points: Point[]) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0].x},${points[0].y}`;
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push((points[i + 1].y - points[i].y) / dx[i]);
  }
  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i], b = tangent[i + 1] / slope[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); tangent[i] = t * a * slope[i]; tangent[i + 1] = t * b * slope[i]; }
  }
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = points[i], q = points[i + 1], h = dx[i] / 3;
    d += `C${(p.x + h).toFixed(2)},${(p.y + tangent[i] * h).toFixed(2)} ${(q.x - h).toFixed(2)},${(q.y - tangent[i + 1] * h).toFixed(2)} ${q.x.toFixed(2)},${q.y.toFixed(2)}`;
  }
  return d;
}

export interface InsightChartProps {
  metric: InsightMetric;
  format: (value: number) => string;
  drivers: InsightDriver[];
  /** Driver ids already mentioned by the explanation. Their annotations show. */
  mentioned: ReadonlySet<string>;
  /** The driver being read or hovered right now. */
  activeId?: string;
  onHoverDriver?: (id: string | undefined) => void;
}

/** A clean two line sparkline: the current period solid, the comparison dashed, numbered annotations for each driver. */
export function InsightChart({ metric, format, drivers, mentioned, activeId, onHoverDriver }: InsightChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const { series, previousSeries = [], points: labels } = metric;

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const all = [...series, ...previousSeries];
    if (!width || series.length < 2 || all.length === 0) return null;
    const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
    const lo = min - range * .12, hi = max + range * .08;
    const step = (width - PAD_X * 2) / (series.length - 1);
    const toPoint = (value: number, i: number): Point => ({ x: PAD_X + i * step, y: PAD_TOP + (1 - (value - lo) / (hi - lo)) * (HEIGHT - PAD_TOP - PAD_BOTTOM) });
    return { step, current: series.map(toPoint), previous: previousSeries.slice(0, series.length).map(toPoint) };
  }, [width, series, previousSeries]);

  const pick = (clientX: number) => {
    if (!geometry || !box.current) return;
    const x = clientX - box.current.getBoundingClientRect().left;
    setScrub(Math.max(0, Math.min(series.length - 1, Math.round((x - PAD_X) / geometry.step))));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "touch" || event.buttons) pick(event.clientX); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = series.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(last, (scrub ?? -1) + 1) : event.key === "ArrowLeft" ? Math.max(0, (scrub ?? last + 1) - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "Escape" ? null : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setScrub(next);
  };

  if (series.length < 2) return <div className={styles.chartEmpty}>No data for this period yet</div>;

  const scrubPoint = scrub !== null && geometry ? geometry.current[scrub] : null;
  const scrubPrevious = scrub !== null && geometry ? geometry.previous[scrub] : null;
  const tipLeft = scrubPoint ? Math.max(TIP_HALF, Math.min(width - TIP_HALF, scrubPoint.x)) : 0;
  const summary = `${metric.label}, ${metric.points[0]} to ${metric.points[metric.points.length - 1]}. Use the arrow keys to read each point.`;
  const readout = scrub !== null ? `${labels[scrub]}: ${format(series[scrub])}${previousSeries[scrub] !== undefined ? `, ${metric.previousSeriesLabel ?? "previous"} ${format(previousSeries[scrub])}` : ""}` : "";

  return <div ref={box} className={styles.chart} tabIndex={0} role="group" aria-label={summary}
    onPointerMove={onPointerMove} onPointerDown={(event) => pick(event.clientX)} onPointerLeave={() => setScrub(null)} onKeyDown={onKeyDown} onBlur={() => setScrub(null)}>
    {geometry ? <svg className={styles.chartSvg} width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
      <line className={styles.baseline} x1={0} x2={width} y1={HEIGHT - .5} y2={HEIGHT - .5} />
      {geometry.previous.length > 1 ? <path className={styles.linePrevious} d={monotonePath(geometry.previous)} /> : null}
      <path className={styles.lineCurrent} d={monotonePath(geometry.current)} />
      {drivers.map((driver) => {
        const point = geometry.current[driver.point];
        if (!point) return null;
        return <line key={driver.id} className={styles.guide} data-state={state(driver.id, mentioned, activeId)}
          x1={point.x} x2={point.x} y1={BADGE_Y + 13} y2={point.y - 6} />;
      })}
      {scrubPoint ? <line className={styles.scrubLine} x1={scrubPoint.x} x2={scrubPoint.x} y1={PAD_TOP - 6} y2={HEIGHT} /> : null}
    </svg> : null}

    {geometry ? drivers.map((driver, rank) => {
      const point = geometry.current[driver.point];
      if (!point) return null;
      const s = state(driver.id, mentioned, activeId);
      return <span key={driver.id} aria-hidden="true">
        <span className={styles.annotationDot} data-state={s} style={{ left: point.x, top: point.y }} />
        <span className={styles.annotationBadge} data-state={s} style={{ left: point.x, top: BADGE_Y }}
          onPointerEnter={() => onHoverDriver?.(driver.id)} onPointerLeave={() => onHoverDriver?.(undefined)}>{rank + 1}</span>
      </span>;
    }) : null}

    {scrubPoint ? <>
      {scrubPrevious ? <span className={styles.scrubDotPrevious} style={{ left: scrubPrevious.x, top: scrubPrevious.y }} aria-hidden="true" /> : null}
      <span className={styles.scrubDot} style={{ left: scrubPoint.x, top: scrubPoint.y }} aria-hidden="true" />
      <span className={styles.tooltip} style={{ left: tipLeft }} aria-hidden="true">
        <span className={styles.tooltipLabel}>{labels[scrub!]}</span>
        <span className={styles.tooltipRow}><i className={styles.swatchCurrent} />{format(series[scrub!])}</span>
        {previousSeries[scrub!] !== undefined ? <span className={styles.tooltipRow}><i className={styles.swatchPrevious} />{format(previousSeries[scrub!])}</span> : null}
      </span>
    </> : null}
    <span className={styles.srOnly} aria-live="polite">{readout}</span>
  </div>;
}

function state(id: string, mentioned: ReadonlySet<string>, activeId?: string) {
  return activeId === id ? "active" : mentioned.has(id) ? "mentioned" : "hidden";
}
