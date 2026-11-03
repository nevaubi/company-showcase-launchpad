import { useEffect, useRef } from "react";
import type { Bar } from "@/lib/financials/types";
import { bollinger, ema, sma } from "@/lib/indicators";
import { cn } from "@/lib/utils";

export type Overlay = "sma20" | "sma50" | "sma200" | "ema21" | "bb";
export interface ChartMarker {
  time: string;
  label: string;
  color?: string;
  position?: "aboveBar" | "belowBar";
}

function cssColor(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  // lightweight-charts needs rgb/hex — resolve any CSS colour via a canvas.
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

const toTime = (d: string) => (d.length > 10 ? (Math.floor(new Date(d).getTime() / 1000) as number) : d);

/** TradingView lightweight-charts wrapper, loaded on the client only. */
export function PriceChart({
  bars,
  mode = "candles",
  overlays = [],
  markers = [],
  height = 380,
  showVolume = true,
  compare,
  levels = [],
  className,
}: {
  bars: Bar[];
  mode?: "candles" | "area" | "line";
  overlays?: Overlay[];
  markers?: ChartMarker[];
  height?: number;
  showVolume?: boolean;
  compare?: { label: string; bars: Bar[] } | null;
  /** Horizontal reference lines (entry, target, support…) */
  levels?: { price: number; label: string; color?: string }[];
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !el.current) return;
      const fg = cssColor("--foreground", "#222");
      const muted = cssColor("--muted-foreground", "#777");
      const border = cssColor("--border", "#ddd");
      const pos = cssColor("--positive", "#2a8");
      const neg = cssColor("--negative", "#c33");
      const c1 = cssColor("--chart-1", "#335");
      const c2 = cssColor("--chart-2", "#ca3");
      const c3 = cssColor("--chart-3", "#3a7");
      const c4 = cssColor("--chart-4", "#c53");
      const c5 = cssColor("--chart-5", "#888");
      const chart = lc.createChart(el.current, {
        height,
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: muted, fontFamily: "JetBrains Mono, monospace", fontSize: 10, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: border, style: lc.LineStyle.Dotted } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: showVolume ? 0.24 : 0.06 } },
        timeScale: { borderVisible: false, timeVisible: bars[0]?.[0].length > 10, secondsVisible: false },
        crosshair: { mode: lc.CrosshairMode.Magnet, vertLine: { color: muted, labelBackgroundColor: fg }, horzLine: { color: muted, labelBackgroundColor: fg } },
        handleScale: { axisPressedMouseMove: true },
      });
      const closes = bars.map((b) => b[4]);
      let main;
      if (mode === "candles") {
        main = chart.addSeries(lc.CandlestickSeries, {
          upColor: pos,
          downColor: neg,
          borderVisible: false,
          wickUpColor: pos,
          wickDownColor: neg,
        });
        main.setData(bars.map((b) => ({ time: toTime(b[0]) as never, open: b[1], high: b[2], low: b[3], close: b[4] })));
      } else if (mode === "area") {
        main = chart.addSeries(lc.AreaSeries, {
          lineColor: fg,
          topColor: cssColor("--chart-1", "#335").replace(/[\d.]+\)$/, "0.16)"),
          bottomColor: "rgba(0,0,0,0)",
          lineWidth: 2,
        });
        main.setData(bars.map((b) => ({ time: toTime(b[0]) as never, value: b[4] })));
      } else {
        main = chart.addSeries(lc.LineSeries, { color: fg, lineWidth: 2 });
        main.setData(bars.map((b) => ({ time: toTime(b[0]) as never, value: b[4] })));
      }
      if (showVolume) {
        const vol = chart.addSeries(lc.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: c5 });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        vol.setData(
          bars.map((b) => ({
            time: toTime(b[0]) as never,
            value: b[6],
            color: (b[4] >= b[1] ? pos : neg).replace(/[\d.]+\)$/, "0.35)"),
          })),
        );
      }
      const addLine = (vals: (number | null)[], color: string, width = 1.5, dashed = false) => {
        const s = chart.addSeries(lc.LineSeries, {
          color,
          lineWidth: width as 1,
          lineStyle: dashed ? lc.LineStyle.Dashed : lc.LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(bars.flatMap((b, i) => (vals[i] == null ? [] : [{ time: toTime(b[0]) as never, value: vals[i]! }])));
      };
      if (overlays.includes("sma20")) addLine(sma(closes, 20), c2);
      if (overlays.includes("sma50")) addLine(sma(closes, 50), c1);
      if (overlays.includes("sma200")) addLine(sma(closes, 200), c4);
      if (overlays.includes("ema21")) addLine(ema(closes, 21), c3, 1.5, true);
      if (overlays.includes("bb")) {
        const bb = bollinger(closes, 20, 2);
        addLine(bb.upper, c5, 1, true);
        addLine(bb.lower, c5, 1, true);
      }
      if (compare && compare.bars.length && bars.length) {
        // Rebase the comparison series to the main series' first close.
        const first = new Map(compare.bars.map((b) => [b[0], b[4]]));
        const startDate = bars[0][0];
        const base = first.get(startDate) ?? compare.bars.find((b) => b[0] >= startDate)?.[4];
        if (base) {
          const s = chart.addSeries(lc.LineSeries, { color: c1, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, priceLineVisible: false, title: compare.label });
          const k = bars[0][4] / base;
          s.setData(compare.bars.filter((b) => b[0] >= startDate).map((b) => ({ time: toTime(b[0]) as never, value: b[4] * k })));
        }
      }
      for (const l of levels) {
        main.createPriceLine({ price: l.price, color: l.color ? cssColor(l.color.replace(/^var\((--[\w-]+)\)$/, "$1"), muted) : muted, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: l.label });
      }
      if (levels.length) {
        // Keep entry/target lines in view even when price hasn't reached them.
        const lvl = levels.map((l) => l.price).filter(Number.isFinite);
        main.applyOptions({
          autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
            const r = orig();
            if (!r) return r;
            return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...lvl), maxValue: Math.max(r.priceRange.maxValue, ...lvl) } };
          },
        } as never);
      }
      if (markers.length) {
        const set = new Set(bars.map((b) => b[0]));
        const firstDay = bars[0][0].slice(0, 10);
        const lastDay = bars[bars.length - 1][0].slice(0, 10);
        const ms = markers
          .filter((m) => m.time >= firstDay && m.time <= lastDay)
          .map((m) => ({ ...m, time: set.has(m.time) ? m.time : bars.find((b) => b[0] >= m.time)?.[0] }))
          .filter((m): m is ChartMarker & { time: string } => !!m.time)
          .sort((a, b) => (a.time < b.time ? -1 : 1))
          .map((m) => ({
            time: toTime(m.time) as never,
            position: m.position ?? ("aboveBar" as const),
            color: m.color ? cssColor(m.color.replace(/^var\((--[\w-]+)\)$/, "$1"), fg) : fg,
            shape: "circle" as const,
            text: m.label,
            size: 0.6,
          }));
        lc.createSeriesMarkers(main, ms);
      }
      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    })();
    return () => {
      disposed = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, mode, overlays.join(","), JSON.stringify(markers), height, showVolume, compare?.label, compare?.bars, JSON.stringify(levels)]);

  return <div ref={el} className={cn("w-full min-w-0 overflow-hidden", className)} style={{ height }} />;
}
