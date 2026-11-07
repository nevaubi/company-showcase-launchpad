"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { motion } from "motion/react";
import type { AskYourDataChart, AskYourDataResult } from "./ask-your-data-types";
import styles from "./ask-your-data.module.css";

export const defaultFormat = (value: number) => value.toLocaleString("en-US");
export const seriesColor = (result: AskYourDataResult, index: number) => result.series[index]?.color ?? `var(--series-${(index % 4) + 1})`;
export const isStacked = (result: AskYourDataResult) => result.stacked !== false;
const totalAt = (result: AskYourDataResult, index: number) => result.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0);

/** Round axis steps (1, 2, 2.5, 5 x 10^n) so gridlines land on numbers people would pick. */
function niceScale(max: number, target = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= raw) ?? 10 * magnitude;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { top, ticks };
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setSize(previous => previous.width === node.clientWidth && previous.height === node.clientHeight ? previous : { width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/** A rectangle with only its top corners rounded, so stacked and grouped bars sit flat on the baseline. */
function topRounded(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

const AXIS = 20; // x label row
const GUTTER = 44; // y label column
const TOP = 8;
const TOOLTIP = 188;

interface PlotProps {
  result: AskYourDataResult;
  kind: Exclude<AskYourDataChart, "table">;
  reduced: boolean;
}

/** Bars or lines in measured pixels, so text and hairlines stay crisp at any width. Hover or arrow keys read one category. */
export function Plot({ result, kind, reduced }: PlotProps) {
  const { ref, width, height } = useSize();
  const [active, setActive] = useState<number | null>(null);
  const format = result.formatValue ?? defaultFormat;
  const stacked = isStacked(result);
  const n = result.categories.length;

  const plotW = Math.max(0, width - GUTTER);
  const plotH = Math.max(0, height - AXIS - TOP);
  const band = n ? plotW / n : 0;
  const max = kind === "bar" && stacked
    ? Math.max(0, ...result.categories.map((_, index) => totalAt(result, index)))
    : Math.max(0, ...result.series.flatMap(series => series.values));
  const { top, ticks } = niceScale(max);
  const y = (value: number) => TOP + plotH - (value / top) * plotH;
  const cx = (index: number) => GUTTER + band * index + band / 2;
  const every = Math.max(1, Math.ceil(46 / Math.max(band, 1)));
  const barW = kind === "bar" ? Math.min(28, band * (stacked ? .58 : .76)) : 0;

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive(current => current === null ? (step > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, current + step)));
    } else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(n - 1); }
    else if (event.key === "Escape") setActive(null);
  };

  const pointerAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !band) return;
    const index = Math.floor((clientX - box.left - GUTTER) / band);
    setActive(index >= 0 && index < n ? index : null);
  };

  const readout = active === null ? "" : `${result.categories[active]}: ${result.series.map(series => `${series.label} ${format(series.values[active] ?? 0)}`).join(", ")}${stacked ? `, total ${format(totalAt(result, active))}` : ""}`;
  const tipLeft = active === null ? 0 : cx(active) + (cx(active) > width / 2 ? -band / 2 - 8 - TOOLTIP : band / 2 + 8);

  return <div ref={ref} className={styles.plot} tabIndex={0} role="group"
    aria-label={`${result.title}, ${kind === "bar" ? "bar" : "line"} chart. Use the left and right arrow keys to read each ${(result.categoryLabel ?? "category").toLowerCase()}.`}
    onKeyDown={move} onBlur={() => setActive(null)}
    onPointerMove={event => { if (event.pointerType !== "touch" || event.buttons) pointerAt(event.clientX); }}
    onPointerDown={event => pointerAt(event.clientX)}
    onPointerLeave={event => { if (event.pointerType !== "touch") setActive(null); }}>
    {width > 0 && height > 0 ? <svg width={width} height={height} className={styles.svg} aria-hidden="true">
      {ticks.map(tick => <g key={tick}>
        <line x1={GUTTER} x2={width} y1={Math.round(y(tick)) + .5} y2={Math.round(y(tick)) + .5} className={tick === 0 ? styles.baseline : styles.grid} />
        <text x={GUTTER - 10} y={y(tick)} dy="0.32em" textAnchor="end" className={styles.axisText}>{format(tick)}</text>
      </g>)}
      {result.categories.map((label, index) => index % every === 0
        ? <text key={label + index} x={cx(index)} y={height - 4} textAnchor="middle" className={styles.axisLabel}>{label}</text> : null)}
      {active !== null ? <rect x={GUTTER + band * active + 1} y={TOP} width={Math.max(0, band - 2)} height={plotH} rx={6} className={styles.hoverBand} /> : null}

      {kind === "bar" ? result.categories.map((_, index) => {
        let base = 0;
        const x = cx(index) - barW / 2;
        const subW = stacked ? barW : (barW - (result.series.length - 1) * 2) / result.series.length;
        return <motion.g key={index} className={styles.column} data-dim={active !== null && active !== index || undefined}
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
          initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
          transition={{ duration: .32, ease: [0.22, 1, 0.36, 1], delay: index * Math.min(.016, .18 / Math.max(n, 1)) }}>
          {result.series.map((series, s) => {
            const value = series.values[index] ?? 0;
            if (stacked) {
              const lastVisible = result.series.slice(s + 1).every(next => !(next.values[index] > 0));
              const y0 = y(base), y1 = y(base + value);
              base += value;
              const h = Math.max(0, y0 - y1 - (lastVisible ? 0 : 1.5));
              if (h <= 0) return null;
              return lastVisible
                ? <path key={series.id} d={topRounded(x, y1, barW, h, 4)} fill={seriesColor(result, s)} />
                : <rect key={series.id} x={x} y={y1 + 1.5} width={barW} height={h} fill={seriesColor(result, s)} />;
            }
            const h = Math.max(0, y(0) - y(value));
            return <path key={series.id} d={topRounded(x + s * (subW + 2), y(value), subW, h, 3)} fill={seriesColor(result, s)} />;
          })}
        </motion.g>;
      }) : <>
        {result.series.map((series, s) => {
          const d = series.values.map((value, index) => `${index ? "L" : "M"}${cx(index).toFixed(2)},${y(value).toFixed(2)}`).join("");
          return <motion.path key={series.id} d={d} fill="none" stroke={seriesColor(result, s)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: .46, ease: [0.22, 1, 0.36, 1], delay: s * .04 }} />;
        })}
        {active !== null ? result.series.map((series, s) => <circle key={series.id} cx={cx(active)} cy={y(series.values[active] ?? 0)} r={3.5}
          fill="var(--surface)" stroke={seriesColor(result, s)} strokeWidth={2} />) : null}
      </>}
    </svg> : null}

    {active !== null && width > 0 ? <div className={styles.tooltip} style={{ transform: `translate3d(${Math.max(0, Math.min(width - TOOLTIP, tipLeft))}px, ${TOP}px, 0)`, width: TOOLTIP }} aria-hidden="true">
      <span className={styles.tipHead}>{result.categories[active]}</span>
      {result.series.map((series, s) => <span key={series.id} className={styles.tipRow}>
        <span className={styles.dot} style={{ background: seriesColor(result, s) }} />
        <span className={styles.tipLabel}>{series.label}</span>
        <span className={styles.tipValue}>{format(series.values[active] ?? 0)}</span>
      </span>)}
      {stacked ? <span className={`${styles.tipRow} ${styles.tipTotal}`}>
        <span className={styles.tipLabel}>Total</span>
        <span className={styles.tipValue}>{format(totalAt(result, active))}</span>
      </span> : null}
    </div> : null}
    <span className={styles.srOnly} aria-live="polite">{readout}</span>
  </div>;
}

/** The same rows as a table, with a total column when the series add up. Scrolls inside its own area. */
export function DataTable({ result }: { result: AskYourDataResult }) {
  const format = result.formatValue ?? defaultFormat;
  const stacked = isStacked(result);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () => setScrolled(node.scrollTop > 0);
    node.addEventListener("scroll", update, { passive: true });
    return () => node.removeEventListener("scroll", update);
  }, []);
  return <div ref={scroller} className={styles.tableWrap} tabIndex={0} role="region" aria-label={`${result.title}, table`} data-scrolled={scrolled || undefined}>
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{result.categoryLabel ?? "Category"}</th>
          {result.series.map((series, s) => <th key={series.id} scope="col" className={styles.num}>
            <span className={styles.thInner}><span className={styles.dot} style={{ background: seriesColor(result, s) }} aria-hidden="true" />{series.label}</span>
          </th>)}
          {stacked ? <th scope="col" className={styles.num}>Total</th> : null}
        </tr>
      </thead>
      <tbody>
        {result.categories.map((category, index) => <tr key={category + index}>
          <th scope="row">{category}</th>
          {result.series.map(series => <td key={series.id} className={styles.num}>{format(series.values[index] ?? 0)}</td>)}
          {stacked ? <td className={`${styles.num} ${styles.total}`}>{format(totalAt(result, index))}</td> : null}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

export function seriesTotal(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}
