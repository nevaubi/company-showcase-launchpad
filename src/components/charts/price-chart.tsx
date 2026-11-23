import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { scaleLinear, scaleLog } from "d3";
import type { Bar } from "@/lib/financials/types";
import { bollinger, ema, rsi, sma } from "@/lib/indicators";
import {
  bucketize,
  drawdownSeries,
  fmtBucket,
  fmtPriceTick,
  fmtQuote,
  fmtVolume,
  grainFor,
  GRAIN_LABEL,
  indexOnOrAfter,
  linearTicks,
  logTicks,
  spreadLabels,
  tickDecimals,
  timeTicks,
  type Bucket,
} from "@/lib/technicals/chart-model";
import { useResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type Overlay = "sma20" | "sma50" | "sma200" | "ema21" | "bb";
export type ChartPane = "rsi" | "drawdown";
export interface ChartMarker {
  time: string;
  label: string;
  color?: string;
  position?: "aboveBar" | "belowBar";
  /** What the marker stands for, shown in the readout and read to screen readers ("Earnings release") */
  title?: string;
  /** Free value handed back to onMarker (a filing accession, for example) */
  id?: string;
}
export interface PriceChartProps {
  bars: Bar[];
  mode?: "candles" | "area" | "line";
  overlays?: Overlay[];
  markers?: ChartMarker[];
  /** Total height in pixels, panes and time axis included */
  height?: number;
  showVolume?: boolean;
  compare?: { label: string; bars: Bar[] } | null;
  /** Horizontal reference lines (entry, target, support…) with a tag on the price axis */
  levels?: { price: number; label: string; color?: string }[];
  /** Shaded price zones from a start date to the last bar (open gaps, ranges) */
  bands?: { from: string; top: number; bottom: number; tone?: "positive" | "negative" | "muted" }[];
  className?: string;
  /** Bars before `bars[0]`, used only to warm up averages and bands so they are complete from the first bar shown */
  warmup?: Bar[];
  /** How many trailing bars to show; the rest can be reached by dragging. Default: all of `bars`. */
  visible?: number;
  scale?: "linear" | "log";
  /** Extra panes under the price, sharing the crosshair */
  panes?: ChartPane[];
  /** Stretch the price scale to include every level (default). Off: levels outside the visible range are left out. */
  fitLevels?: boolean;
  /** Called when a marker is clicked or activated from the keyboard */
  onMarker?: (m: ChartMarker) => void;
  /** Accessible name, for example "AAPL price" */
  label?: string;
}

const OVERLAY_META: Record<Exclude<Overlay, "bb">, { label: string; token: string; dash?: number[] }> = {
  sma20: { label: "SMA 20", token: "--chart-2" },
  sma50: { label: "SMA 50", token: "--chart-1" },
  sma200: { label: "SMA 200", token: "--chart-4" },
  ema21: { label: "EMA 21", token: "--chart-3", dash: [4, 3] },
};
const TOKENS = ["--foreground", "--muted-foreground", "--border", "--rule", "--positive", "--negative", "--card", "--background", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"] as const;
type Palette = Record<(typeof TOKENS)[number], string> & { resolve: (css: string | undefined, fallback: string) => string; mono: string; sans: string };

/** Canvas needs concrete colours: resolve CSS variables (oklch tokens included) to rgba through a 1 px canvas. */
function readPalette(): Palette {
  const root = getComputedStyle(document.documentElement);
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, string>();
  const toRgba = (raw: string, fallback: string) => {
    if (!probe || !raw) return fallback;
    const hit = cache.get(raw);
    if (hit) return hit;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = raw;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const out = `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
    cache.set(raw, out);
    return out;
  };
  const token = (name: string, fallback: string) => toRgba(root.getPropertyValue(name).trim(), fallback);
  const P = { mono: root.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace", sans: root.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif" } as Palette;
  for (const t of TOKENS) P[t] = token(t, "#888");
  P.resolve = (css, fallback) => {
    if (!css) return fallback;
    const v = /^var\((--[\w-]+)\)$/.exec(css.trim());
    return v ? token(v[1], fallback) : toRgba(css, fallback);
  };
  return P;
}
const alpha = (rgba: string, a: number) => rgba.replace(/[\d.]+\)$/, `${a})`);

const AXIS_FONT = 10;
const X_AXIS = 20;
const GAP = 8;
const PANE_H = { volume: 52, rsi: 60, drawdown: 60 } as const;

interface Rect {
  top: number;
  bottom: number;
}

/**
 * Price chart on canvas: candles, line or area; linear or log scale; volume, RSI and drawdown panes; moving
 * averages and bands; labelled levels with tags on the price axis; event markers; a crosshair shared by every
 * pane with the readout fixed at the top left. More bars than pixels are merged into weekly, monthly or
 * quarterly candles. The wheel always scrolls the page; drag sideways to move through history, double-click
 * to return to the latest bars, arrow keys move the crosshair.
 */
export function PriceChart({
  bars,
  mode = "candles",
  overlays = [],
  markers = [],
  height = 380,
  showVolume = true,
  compare,
  levels = [],
  bands = [],
  className,
  warmup,
  visible,
  scale = "linear",
  panes = [],
  fitLevels = true,
  onMarker,
  label,
}: PriceChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const theme = useResolvedTheme();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ k: number; y: number | null } | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const palette = useMemo(() => (typeof document === "undefined" ? null : readPalette()), [theme]);

  /* ---------- data ---------- */
  const full = useMemo(() => (warmup?.length ? [...warmup, ...bars] : bars).filter((b) => b[4] > 0), [warmup, bars]);
  const first = useMemo(() => (warmup?.length ? Math.min(full.length - 1, indexOnOrAfter(full, bars[0]?.[0] ?? "")) : 0), [warmup, full, bars]);
  const n = full.length;
  const intraday = (full[0]?.[0].length ?? 0) > 10;
  const count = Math.max(1, Math.min(n - first, visible ?? n - first));
  const [end, setEnd] = useState(n - 1);
  useEffect(() => setEnd(n - 1), [n, count, full]);
  const winEnd = Math.min(n - 1, Math.max(first + count - 1, end));
  const winStart = winEnd - count + 1;
  const canPan = n - first > count;

  const series = useMemo(() => {
    const c = full.map((b) => b[4]);
    const bb = overlays.includes("bb") ? bollinger(c, 20, 2) : null;
    return {
      sma20: overlays.includes("sma20") ? sma(c, 20) : null,
      sma50: overlays.includes("sma50") ? sma(c, 50) : null,
      sma200: overlays.includes("sma200") ? sma(c, 200) : null,
      ema21: overlays.includes("ema21") ? ema(c, 21) : null,
      bbUpper: bb?.upper ?? null,
      bbLower: bb?.lower ?? null,
      rsi: panes.includes("rsi") ? rsi(c, 14) : null,
      // Decline from the running high of the adjusted close (dividends reinvested), over the bars supplied.
      drawdown: panes.includes("drawdown") ? drawdownSeries(full.map((b) => b[5] || b[4])) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, overlays.join(","), panes.join(",")]);

  const hasVolume = useMemo(() => showVolume && full.slice(winStart, winEnd + 1).some((b) => b[6] > 0), [showVolume, full, winStart, winEnd]);
  const narrow = width > 0 && width < 520;
  const topPad = narrow ? 36 : 20;

  /* ---------- geometry ---------- */
  const geo = useMemo(() => {
    if (!width || !n) return null;
    // right axis: wide enough for the largest price label
    const hiRaw = Math.max(...full.slice(winStart, winEnd + 1).map((b) => b[2]));
    const axisW = Math.max(46, Math.ceil(fmtQuote(hiRaw).length * 6.1) + 14);
    const plotW = Math.max(40, width - axisW);
    const grain = mode === "candles" ? grainFor(count, plotW, 3, intraday) : "bar";
    const buckets = bucketize(full, winStart, winEnd, grain);
    const slot = plotW / buckets.length;

    const rects: Partial<Record<"price" | "volume" | ChartPane, Rect>> = {};
    let bottom = height - X_AXIS;
    for (const p of [...panes].reverse()) {
      rects[p] = { top: bottom - PANE_H[p], bottom };
      bottom -= PANE_H[p] + GAP;
    }
    if (hasVolume) {
      rects.volume = { top: bottom - PANE_H.volume, bottom };
      bottom -= PANE_H.volume + GAP;
    }
    rects.price = { top: topPad, bottom: Math.max(topPad + 40, bottom) };

    // price domain: what is drawn in the main series, the comparison line and, when asked, the levels
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of buckets) {
      const l = mode === "candles" ? b.l : b.c;
      const h = mode === "candles" ? b.h : b.c;
      if (l < lo) lo = l;
      if (h > hi) hi = h;
    }
    let cmp: (number | null)[] | null = null;
    if (compare?.bars.length && buckets.length) {
      // Rebase the comparison to the first candle's close so both lines start together.
      const byDate = new Map(compare.bars.map((b) => [b[0], b[4]]));
      const baseAt = byDate.get(buckets[0].t) ?? compare.bars.find((b) => b[0] >= buckets[0].t)?.[4];
      if (baseAt) {
        const k = buckets[0].c / baseAt;
        cmp = buckets.map((b) => {
          const v = byDate.get(b.t);
          return v == null ? null : v * k;
        });
        for (const v of cmp)
          if (v != null) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
      }
    }
    // Averages and bands widen the range so a line that is switched on is seen whole, but by no more than
    // 40% of the candles' own range on either side: a far-away 200-day average must not flatten the price.
    if (hi > lo) {
      const useLog = scale === "log" && lo > 0;
      const span = useLog ? Math.log(hi / lo) : hi - lo;
      const floor = useLog ? lo / Math.exp(0.4 * span) : lo - 0.4 * span;
      const ceil = useLog ? hi * Math.exp(0.4 * span) : hi + 0.4 * span;
      let olo = lo;
      let ohi = hi;
      for (const line of [series.sma20, series.sma50, series.sma200, series.ema21, series.bbUpper, series.bbLower]) {
        if (!line) continue;
        for (const b of buckets) {
          const v = line[b.i1];
          if (v == null || !Number.isFinite(v) || v <= 0) continue;
          if (v < olo) olo = v;
          if (v > ohi) ohi = v;
        }
      }
      lo = Math.max(olo, floor);
      hi = Math.min(ohi, ceil);
    }
    if (fitLevels)
      for (const l of levels)
        if (Number.isFinite(l.price) && l.price > 0) {
          lo = Math.min(lo, l.price);
          hi = Math.max(hi, l.price);
        }
    if (!(hi > lo)) {
      hi = lo * 1.01 || 1;
      lo = lo * 0.99 || 0;
    }
    const log = scale === "log" && lo > 0;
    const padded: [number, number] = log
      ? [lo / (hi / lo) ** 0.05, hi * (hi / lo) ** 0.05]
      : [lo - (hi - lo) * 0.05, hi + (hi - lo) * 0.05];
    const y = (log ? scaleLog() : scaleLinear()).domain(padded).range([rects.price.bottom, rects.price.top]);
    const ticks = (log ? logTicks : linearTicks)(padded[0], padded[1], Math.max(2, Math.floor((rects.price.bottom - rects.price.top) / 44)));
    const vMax = Math.max(1, ...buckets.map((b) => b.v));
    return { axisW, plotW, grain, buckets, slot, rects: rects as Record<"price", Rect> & Partial<Record<"volume" | ChartPane, Rect>>, y, ticks, dec: tickDecimals(ticks), cmp, vMax, domain: padded };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, n, full, winStart, winEnd, count, mode, intraday, height, hasVolume, panes.join(","), topPad, scale, fitLevels, compare?.label, compare?.bars, JSON.stringify(levels), series]);

  const xOf = useCallback((k: number) => (geo ? (k + 0.5) * geo.slot : 0), [geo]);
  /** Candle index for a date: the candle that contains it, or the first one after it. */
  const bucketOf = useCallback(
    (date: string) => {
      if (!geo) return -1;
      const B = geo.buckets;
      const d = date.slice(0, 10);
      if (!B.length || d > B[B.length - 1].t.slice(0, 10) || d < B[0].t0.slice(0, 10)) return -1;
      let lo = 0;
      let hi = B.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (B[mid].t.slice(0, 10) < d) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [geo],
  );

  /* ---------- markers placed on candles ---------- */
  const placed = useMemo(() => {
    if (!geo || !markers.length) return [];
    const stack = new Map<string, number>();
    const out: { m: ChartMarker; k: number; x: number; y: number }[] = [];
    for (const m of [...markers].sort((a, b) => (a.time < b.time ? -1 : 1))) {
      const k = bucketOf(m.time);
      if (k < 0) continue;
      const below = m.position === "belowBar";
      const key = `${k}|${below}`;
      const level = stack.get(key) ?? 0;
      if (level >= 3) continue;
      stack.set(key, level + 1);
      const b = geo.buckets[k];
      const anchor = geo.y(below ? (mode === "candles" ? b.l : b.c) : mode === "candles" ? b.h : b.c);
      const y = Math.min(geo.rects.price.bottom - 8, Math.max(geo.rects.price.top + 8, anchor + (below ? 1 : -1) * (13 + level * 15)));
      out.push({ m, k, x: xOf(k), y });
    }
    return out;
  }, [geo, markers, bucketOf, mode, xOf]);

  /* ---------- base layer ---------- */
  useEffect(() => {
    const cv = base.current;
    if (!cv || !geo || !palette) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const P = palette;
    const { buckets, slot, plotW, rects, y, ticks, dec } = geo;
    const px = (v: number) => Math.round(v) + 0.5; // centre of a device-independent pixel: crisp 1 px lines
    const hline = (yy: number, x0: number, x1: number, color: string, dash?: number[]) => {
      g.beginPath();
      g.setLineDash(dash ?? []);
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.moveTo(x0, px(yy));
      g.lineTo(x1, px(yy));
      g.stroke();
      g.setLineDash([]);
    };
    const text = (s: string, x: number, yy: number, color: string, align: CanvasTextAlign = "left", weight = 400, mono = true, size = AXIS_FONT) => {
      g.font = `${weight} ${size}px ${mono ? P.mono : P.sans}`;
      g.fillStyle = color;
      g.textAlign = align;
      g.textBaseline = "middle";
      g.fillText(s, x, yy);
    };
    const pathOf = (vals: (number | null | undefined)[], yy: (v: number) => number) => {
      g.beginPath();
      let pen = false;
      for (let k = 0; k < vals.length; k++) {
        const v = vals[k];
        if (v == null || !Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const X = xOf(k);
        const Y = yy(v);
        if (pen) g.lineTo(X, Y);
        else g.moveTo(X, Y);
        pen = true;
      }
    };
    /** A series sampled at each candle's last source bar. */
    const at = (s: (number | null)[] | null) => (s ? buckets.map((b) => s[b.i1]) : null);
    const clip = (r: Rect, draw: () => void) => {
      g.save();
      g.beginPath();
      g.rect(0, r.top, plotW, r.bottom - r.top);
      g.clip();
      draw();
      g.restore();
    };

    /* time axis: faint verticals at year (or day) boundaries, labels underneath */
    const tt = timeTicks(buckets, plotW, narrow ? 52 : 64);
    const lowest = Math.max(...Object.values(rects).map((r) => r!.bottom));
    for (const t of tt) {
      const X = px(xOf(t.k) - slot / 2);
      if (t.major) {
        g.beginPath();
        g.strokeStyle = alpha(P["--border"], 0.9);
        g.lineWidth = 1;
        g.moveTo(X, rects.price.top);
        g.lineTo(X, lowest);
        g.stroke();
      }
      text(t.label, Math.min(plotW - 2, Math.max(2, X + 3)), height - X_AXIS / 2 + 1, t.major ? P["--foreground"] : P["--muted-foreground"], "left", t.major ? 600 : 400);
    }
    hline(lowest, 0, width, P["--border"]);

    /* price grid and axis */
    for (const t of ticks) {
      const Y = y(t);
      if (Y < rects.price.top - 1 || Y > rects.price.bottom + 1) continue;
      hline(Y, 0, plotW, P["--border"]);
      text(fmtPriceTick(t, dec), plotW + 8, Y, P["--muted-foreground"]);
    }

    /* shaded zones */
    clip(rects.price, () => {
      for (const band of bands) {
        if (!(band.top > band.bottom)) continue;
        const k = Math.max(0, bucketOf(band.from) < 0 ? (band.from < (buckets[0]?.t0 ?? "") ? 0 : buckets.length) : bucketOf(band.from));
        if (k >= buckets.length) continue;
        const tone = band.tone === "positive" ? P["--positive"] : band.tone === "negative" ? P["--negative"] : P["--chart-5"];
        const x0 = xOf(k) - slot / 2;
        g.fillStyle = alpha(tone, 0.12);
        g.fillRect(x0, y(band.top), plotW - x0, y(band.bottom) - y(band.top));
        hline(y(band.top), x0, plotW, alpha(tone, 0.45));
        hline(y(band.bottom), x0, plotW, alpha(tone, 0.45));
      }
    });

    /* volume */
    if (rects.volume) {
      const r = rects.volume;
      const w = Math.max(1, Math.floor(slot * 0.7));
      for (let k = 0; k < buckets.length; k++) {
        const b = buckets[k];
        const hgt = Math.max(b.v > 0 ? 1 : 0, ((r.bottom - r.top) * b.v) / geo.vMax);
        g.fillStyle = alpha(b.c >= b.o ? P["--positive"] : P["--negative"], 0.4);
        g.fillRect(Math.round(xOf(k) - w / 2), r.bottom - hgt, w, hgt);
      }
      text("Volume", 2, r.top + 5, P["--muted-foreground"], "left", 400, false);
      text(fmtVolume(geo.vMax), plotW + 8, r.top + 5, P["--muted-foreground"]);
      hline(r.bottom, 0, plotW, P["--border"]);
    }

    /* main series and overlays */
    clip(rects.price, () => {
      if (series.bbUpper && series.bbLower) {
        const up = at(series.bbUpper)!;
        const dn = at(series.bbLower)!;
        g.beginPath();
        let started = false;
        for (let k = 0; k < up.length; k++) {
          if (up[k] == null) continue;
          if (started) g.lineTo(xOf(k), y(up[k]!));
          else g.moveTo(xOf(k), y(up[k]!));
          started = true;
        }
        for (let k = dn.length - 1; k >= 0; k--) if (dn[k] != null) g.lineTo(xOf(k), y(dn[k]!));
        g.closePath();
        g.fillStyle = alpha(P["--chart-5"], 0.08);
        g.fill();
        for (const s of [up, dn]) {
          pathOf(s, y);
          g.strokeStyle = alpha(P["--chart-5"], 0.8);
          g.lineWidth = 1;
          g.stroke();
        }
      }
      if (mode === "candles") {
        const w = Math.max(1, Math.floor(slot * 0.68) | 1);
        for (let k = 0; k < buckets.length; k++) {
          const b = buckets[k];
          const color = b.c >= b.o ? P["--positive"] : P["--negative"];
          const X = Math.round(xOf(k));
          g.fillStyle = color;
          const yh = Math.round(y(b.h));
          const yl = Math.round(y(b.l));
          g.fillRect(X, yh, 1, Math.max(1, yl - yh));
          if (w > 1) {
            const yo = Math.round(y(b.o));
            const yc = Math.round(y(b.c));
            g.fillRect(X - (w >> 1), Math.min(yo, yc), w, Math.max(1, Math.abs(yc - yo)));
          }
        }
      } else {
        const closes = buckets.map((b) => b.c);
        if (mode === "area") {
          pathOf(closes, y);
          g.lineTo(xOf(buckets.length - 1), rects.price.bottom);
          g.lineTo(xOf(0), rects.price.bottom);
          g.closePath();
          g.fillStyle = alpha(P["--chart-1"], 0.1);
          g.fill();
        }
        pathOf(closes, y);
        g.strokeStyle = P["--foreground"];
        g.lineWidth = 1.5;
        g.lineJoin = "round";
        g.stroke();
      }
      for (const id of ["sma200", "sma50", "sma20", "ema21"] as const) {
        const s = at(series[id]);
        if (!s) continue;
        pathOf(s, y);
        g.strokeStyle = P[OVERLAY_META[id].token as keyof Palette] as string;
        g.lineWidth = 1.25;
        g.lineJoin = "round";
        g.setLineDash(OVERLAY_META[id].dash ?? []);
        g.stroke();
        g.setLineDash([]);
      }
      if (geo.cmp) {
        pathOf(geo.cmp, y);
        g.strokeStyle = P["--chart-6"];
        g.lineWidth = 1.25;
        g.setLineDash([5, 3]);
        g.stroke();
        g.setLineDash([]);
      }
    });
    if (geo.cmp && compare) {
      let k = geo.cmp.length - 1;
      while (k >= 0 && geo.cmp[k] == null) k--;
      if (k >= 0) text(compare.label, Math.min(plotW - 4, xOf(k)) - 4, Math.max(rects.price.top + 6, y(geo.cmp[k]!) - 8), P["--muted-foreground"], "right", 500, false);
    }

    /* levels: line across the plot, name at the left, price tag on the axis */
    const tags: { y: number; text: string; color: string; fill?: string }[] = [];
    const inPane = (yy: number) => yy >= rects.price.top && yy <= rects.price.bottom;
    const shown = levels.filter((l) => Number.isFinite(l.price) && l.price > 0 && inPane(y(l.price)));
    const labelY = spreadLabels(shown.map((l) => y(l.price) - 6), 11, rects.price.top + 6, rects.price.bottom - 4);
    shown.forEach((l, i) => {
      const color = P.resolve(l.color, P["--muted-foreground"]);
      hline(y(l.price), 0, plotW, alpha(color, 0.75), [4, 3]);
      const wText = l.label.length * 5.4 + 8;
      g.fillStyle = alpha(P["--card"], 0.85);
      g.fillRect(2, labelY[i] - 6, wText, 12);
      text(l.label, 5, labelY[i], color, "left", 500, false);
      tags.push({ y: y(l.price), text: fmtQuote(l.price), color });
    });

    /* last price: line and filled tag */
    const lastB = buckets[buckets.length - 1];
    const lastUp = lastB.c >= (buckets[buckets.length - 2]?.c ?? lastB.o);
    const lastColor = mode === "candles" ? (lastUp ? P["--positive"] : P["--negative"]) : P["--foreground"];
    hline(y(lastB.c), 0, plotW, alpha(lastColor, 0.55), [2, 2]);
    tags.push({ y: y(lastB.c), text: fmtQuote(lastB.c), color: P["--background"], fill: lastColor });
    const tagY = spreadLabels(tags.map((t) => t.y), 15, rects.price.top + 7, rects.price.bottom - 7);
    tags.forEach((t, i) => {
      g.font = `500 ${AXIS_FONT}px ${P.mono}`;
      const w = geo.axisW - 3;
      if (t.fill) {
        g.fillStyle = t.fill;
        g.fillRect(plotW + 2, tagY[i] - 7, w, 14);
      } else {
        g.fillStyle = P["--card"];
        g.fillRect(plotW + 2, tagY[i] - 7, w, 14);
        g.strokeStyle = alpha(t.color, 0.7);
        g.lineWidth = 1;
        g.strokeRect(plotW + 2.5, tagY[i] - 6.5, w - 1, 13);
      }
      text(t.text, plotW + 7, tagY[i] + 0.5, t.fill ? t.color : t.color, "left", 500);
    });

    /* markers */
    for (const { m, x, y: Y } of placed) {
      const color = P.resolve(m.color, P["--foreground"]);
      g.beginPath();
      g.arc(x, Y, 7, 0, Math.PI * 2);
      g.fillStyle = P["--card"];
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.stroke();
      text(m.label.slice(0, 1), x, Y + 0.5, P["--foreground"], "center", 600, false, 9);
    }

    /* RSI pane */
    if (rects.rsi && series.rsi) {
      const r = rects.rsi;
      const yy = scaleLinear().domain([0, 100]).range([r.bottom - 2, r.top + 2]);
      for (const v of [30, 70]) {
        hline(yy(v), 0, plotW, P["--border"]);
        text(String(v), plotW + 8, yy(v), P["--muted-foreground"]);
      }
      clip(r, () => {
        pathOf(at(series.rsi)!, yy);
        g.strokeStyle = P["--chart-1"];
        g.lineWidth = 1.25;
        g.stroke();
      });
      text("RSI 14", 2, r.top + 5, P["--muted-foreground"], "left", 400, false);
      hline(r.bottom, 0, plotW, P["--border"]);
    }

    /* drawdown pane */
    if (rects.drawdown && series.drawdown) {
      const r = rects.drawdown;
      const vals = at(series.drawdown)!;
      const min = Math.min(-0.01, ...vals.map((v) => v ?? 0));
      const yy = scaleLinear().domain([min, 0]).range([r.bottom - 2, r.top + 12]);
      clip(r, () => {
        pathOf(vals, yy);
        g.lineTo(xOf(vals.length - 1), yy(0));
        g.lineTo(xOf(0), yy(0));
        g.closePath();
        g.fillStyle = alpha(P["--negative"], 0.12);
        g.fill();
        pathOf(vals, yy);
        g.strokeStyle = P["--negative"];
        g.lineWidth = 1.25;
        g.stroke();
      });
      hline(yy(0), 0, plotW, P["--border"]);
      text("0%", plotW + 8, yy(0), P["--muted-foreground"]);
      text(`${(min * 100).toFixed(0)}%`, plotW + 8, r.bottom - 6, P["--muted-foreground"]);
      text("Drawdown from high", 2, r.top + 5, P["--muted-foreground"], "left", 400, false);
      hline(r.bottom, 0, plotW, P["--border"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, palette, width, height, mode, series, placed, narrow, JSON.stringify(levels), JSON.stringify(bands), compare?.label]);

  /* ---------- crosshair layer ---------- */
  useEffect(() => {
    const cv = top.current;
    if (!cv || !geo || !palette) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) {
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    if (!hover || hover.k < 0 || hover.k >= geo.buckets.length) return;
    const P = palette;
    const { rects, plotW } = geo;
    const X = Math.round(xOf(hover.k)) + 0.5;
    const lowest = Math.max(...Object.values(rects).map((r) => r!.bottom));
    g.strokeStyle = alpha(P["--foreground"], 0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X, rects.price.top);
    g.lineTo(X, lowest);
    g.stroke();
    // date tag under the line
    const b = geo.buckets[hover.k];
    const dateText = fmtBucket(b, geo.grain);
    g.font = `500 ${AXIS_FONT}px ${P.mono}`;
    const tw = g.measureText(dateText).width + 10;
    const tx = Math.min(plotW - tw, Math.max(0, X - tw / 2));
    g.fillStyle = P["--foreground"];
    g.fillRect(tx, height - X_AXIS + 2, tw, X_AXIS - 4);
    g.fillStyle = P["--background"];
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(dateText, tx + 5, height - X_AXIS / 2 + 0.5);
    // price line and tag
    if (hover.y != null && hover.y >= rects.price.top && hover.y <= rects.price.bottom) {
      const Y = Math.round(hover.y) + 0.5;
      g.beginPath();
      g.moveTo(0, Y);
      g.lineTo(plotW, Y);
      g.stroke();
      g.fillStyle = P["--foreground"];
      g.fillRect(plotW + 2, Y - 7.5, geo.axisW - 3, 15);
      g.fillStyle = P["--background"];
      g.fillText(fmtQuote(geo.y.invert(hover.y)), plotW + 7, Y + 0.5);
    }
  }, [hover, geo, palette, width, height, xOf]);

  /* ---------- interaction ---------- */
  const kAt = (clientX: number) => {
    const r = top.current?.getBoundingClientRect();
    if (!r || !geo) return -1;
    return Math.max(0, Math.min(geo.buckets.length - 1, Math.floor((clientX - r.left) / geo.slot)));
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const d = drag.current;
    if (d && canPan) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 3) d.moved = true;
      if (d.moved) {
        const perPx = count / geo.plotW;
        setEnd(Math.min(n - 1, Math.max(first + count - 1, Math.round(d.start - dx * perPx))));
        return;
      }
    }
    const x = e.clientX - r.left;
    setHover(x > geo.plotW + 1 ? null : { k: kAt(e.clientX), y: e.clientY - r.top });
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, start: winEnd, moved: false };
    if (canPan) e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType !== "mouse") onMove(e);
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved || !onMarker) return;
    // a click on (or near) a marker opens it
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const yy = e.clientY - r.top;
    let best: (typeof placed)[number] | null = null;
    let bestD = 14;
    for (const p of placed) {
      const dist = Math.hypot(p.x - x, p.y - yy);
      if (dist < bestD) {
        best = p;
        bestD = dist;
      }
    }
    if (best) onMarker(best.m);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!geo) return;
    const last = geo.buckets.length - 1;
    const cur = hover?.k ?? last;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey && canPan) setEnd(Math.min(n - 1, Math.max(first + count - 1, winEnd + step * Math.max(1, Math.round(count / 10)))));
      else setHover({ k: Math.max(0, Math.min(last, cur + step)), y: null });
    } else if (e.key === "Home") {
      e.preventDefault();
      setHover({ k: 0, y: null });
    } else if (e.key === "End") {
      e.preventDefault();
      setHover({ k: last, y: null });
    } else if (e.key === "Escape") setHover(null);
  };

  /* ---------- readout ---------- */
  const k = geo ? Math.min(geo.buckets.length - 1, hover?.k ?? geo.buckets.length - 1) : -1;
  const cur: Bucket | null = geo && k >= 0 ? geo.buckets[k] : null;
  const prevClose = geo && k > 0 ? geo.buckets[k - 1].c : cur && cur.i0 > 0 ? full[cur.i0 - 1][4] : null;
  const chg = cur && prevClose ? cur.c / prevClose - 1 : null;
  const here = cur ? placed.filter((p) => p.k === k && (p.m.title || p.m.label)) : [];
  const keyed = (token: string, dash?: boolean) => (
    <span aria-hidden className="inline-block h-0 w-3 align-middle" style={{ borderTop: `2px ${dash ? "dashed" : "solid"} var(${token})` }} />
  );
  const val = (s: (number | null)[] | null) => (cur && s && s[cur.i1] != null ? fmtQuote(s[cur.i1]!) : null);

  return (
    <div
      ref={wrap}
      role="group"
      tabIndex={0}
      aria-label={`${label ?? "Price"} chart${geo ? `, ${GRAIN_LABEL[geo.grain]} ${mode === "candles" ? "candles" : "closes"}, ${fmtBucket(geo.buckets[0], geo.grain)} to ${fmtBucket(geo.buckets[geo.buckets.length - 1], geo.grain)}, last ${fmtQuote(geo.buckets[geo.buckets.length - 1].c)}` : ""}. Arrow keys move the crosshair.`}
      onKeyDown={onKey}
      data-chart="price"
      className={cn("relative w-full min-w-0 select-none overflow-hidden rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      style={{ height }}
    >
      <canvas ref={base} aria-hidden className="absolute inset-0 block h-full w-full" />
      <canvas
        ref={top}
        aria-hidden
        className={cn("absolute inset-0 block h-full w-full", canPan ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair")}
        style={{ touchAction: "pan-y" }}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => !drag.current && setHover(null)}
        onDoubleClick={() => setEnd(n - 1)}
      />
      {cur && geo && (
        <div
          data-chart-readout
          className="pointer-events-none absolute left-0 top-0 flex max-h-9 flex-wrap items-center gap-x-2.5 gap-y-0 overflow-hidden bg-card/80 pr-2 text-[11px] leading-[18px] text-muted-foreground"
          style={{ maxWidth: geo.plotW }}
        >
          <span className="num font-medium text-foreground">{fmtBucket(cur, geo.grain)}</span>
          {geo.grain !== "bar" && <span>{GRAIN_LABEL[geo.grain]}</span>}
          {(["O", "H", "L", "C"] as const).map((key, i) => (
            <span key={key} className="num whitespace-nowrap">
              {key} <span className="text-foreground">{fmtQuote([cur.o, cur.h, cur.l, cur.c][i])}</span>
            </span>
          ))}
          {chg != null && (
            <span className={cn("num whitespace-nowrap", chg > 0 ? "text-positive" : chg < 0 ? "text-negative" : "")}>
              {chg > 0 ? "+" : chg < 0 ? "−" : ""}
              {Math.abs(chg * 100).toFixed(2)}%
            </span>
          )}
          {hasVolume && (
            <span className="num whitespace-nowrap">
              Vol <span className="text-foreground">{fmtVolume(cur.v)}</span>
            </span>
          )}
          {(Object.keys(OVERLAY_META) as (keyof typeof OVERLAY_META)[]).map((id) => {
            const v = val(series[id]);
            return v ? (
              <span key={id} className="num whitespace-nowrap">
                {keyed(OVERLAY_META[id].token, !!OVERLAY_META[id].dash)} {OVERLAY_META[id].label} <span className="text-foreground">{v}</span>
              </span>
            ) : null;
          })}
          {val(series.bbUpper) && (
            <span className="num whitespace-nowrap">
              {keyed("--chart-5")} Bands <span className="text-foreground">{val(series.bbLower)} to {val(series.bbUpper)}</span>
            </span>
          )}
          {geo.cmp && geo.cmp[k] != null && geo.cmp[0] != null && compare && (
            <span className="num whitespace-nowrap">
              {keyed("--chart-6", true)} {compare.label} <span className="text-foreground">{((geo.cmp[k]! / geo.cmp[0]! - 1) * 100).toFixed(1)}%</span>
            </span>
          )}
          {series.rsi && series.rsi[cur.i1] != null && (
            <span className="num whitespace-nowrap">
              RSI <span className="text-foreground">{series.rsi[cur.i1]!.toFixed(1)}</span>
            </span>
          )}
          {series.drawdown && (
            <span className="num whitespace-nowrap">
              DD <span className="text-foreground">{(series.drawdown[cur.i1] * 100).toFixed(1)}%</span>
            </span>
          )}
          {here.map((p, i) => (
            <span key={i} className="whitespace-nowrap text-foreground">
              {p.m.title ?? p.m.label}
            </span>
          ))}
        </div>
      )}
      {onMarker && placed.length > 0 && (
        <ul className="sr-only">
          {placed.map((p, i) => (
            <li key={i}>
              <button type="button" data-agent-click onClick={() => onMarker(p.m)}>
                {p.m.title ?? p.m.label}, {p.m.time}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
