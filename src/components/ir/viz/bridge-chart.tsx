// 3. The bridge from one period's total to another's across the section's parts, drawn as horizontal rows so long
// line names stay readable at phone width. Drawn only when the parts add up to the printed total in both periods
// (bridgeOf); otherwise the reason is a one-line note. The sign of every change is written, not only coloured.
import { useState, type KeyboardEvent } from "react";
import * as d3 from "d3";
import { QUIET, useWidth } from "@/components/alt/library/charts/primitives";
import { cn } from "@/lib/utils";
import { axisCaption, fmtValue } from "./format";
import { bridgeCloses, waterfallBars, type WaterfallBar } from "./model";
import { VizNote, useOpener } from "./parts";
import type { BridgeChartProps } from "./types";

const UP = "var(--chart-1)";
const DOWN = "var(--chart-4)";
const ROW = 26;

export function BridgeChart({ bridge, reason, scale, onOpen, className }: BridgeChartProps) {
  const [ref, width] = useWidth(260, 640);
  const [active, setActive] = useState<number | null>(null);
  const open = useOpener(onOpen);
  if (!bridge) return <VizNote className={className}>{reason || "No bridge: the parts do not add up to the printed total in both periods."}</VizNote>;

  const bars = waterfallBars(bridge);
  const closes = bridgeCloses(bridge);
  const labelW = Math.min(240, Math.max(104, Math.round(width * 0.3)));
  const valueW = 76;
  const w = Math.max(60, width - labelW - valueW - 8);
  // The axis spans the running totals, not zero: steps are small beside the totals, so the totals are marked by a
  // tick at their value instead of a bar from zero (a bar on a cut axis would misstate its length).
  const run = bars.flatMap((b) => (b.kind === "total" ? [b.end] : [b.start, b.end]));
  const rlo = Math.min(...run);
  const rhi = Math.max(...run);
  const pad = (rhi - rlo || Math.abs(rhi) || 1) * 0.08;
  const cut = rlo - pad > 0 || rhi + pad < 0;
  const lo = cut ? rlo - pad : Math.min(0, rlo);
  const hi = cut ? rhi + pad : Math.max(0, rhi);
  const x = d3.scaleLinear().domain([lo, hi]).range([0, w]);
  const h = bars.length * ROW;
  const sign = (b: WaterfallBar) => (b.kind === "total" ? "" : b.delta > 0 ? "+" : b.delta < 0 ? "" : "±");
  const text = (b: WaterfallBar) => `${sign(b)}${fmtValue(b.kind === "total" ? b.end : b.delta, bridge.unit, scale)}`;
  const span = bridge.span === "yoy" ? "Year over year" : bridge.span === "qoq" ? "Quarter over quarter" : "Between the two periods";
  const describe = (b: WaterfallBar) =>
    b.kind === "total"
      ? `${bridge.label}, ${b.point!.periodLabel}: ${fmtValue(b.end, bridge.unit, scale)}, as filed ${b.point!.printed ?? "not printed as a cell"}`
      : `${b.label}: ${text(b)}, from ${fmtValue(b.from!.value, bridge.unit, scale)} (${b.from!.short}) to ${fmtValue(b.point!.value, bridge.unit, scale)} (${b.point!.short}), as filed ${b.from!.printed ?? "–"} and ${b.point!.printed ?? "–"}`;
  const onKey = (ev: KeyboardEvent<HTMLUListElement>) => {
    const i = Number((ev.target as HTMLElement).dataset.i ?? -1);
    if (i < 0) return;
    const to = ev.key === "ArrowDown" ? i + 1 : ev.key === "ArrowUp" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? bars.length - 1 : null;
    if (to == null) return;
    ev.preventDefault();
    const next = Math.max(0, Math.min(bars.length - 1, to));
    (ev.currentTarget.querySelectorAll("button")[next] as HTMLButtonElement | undefined)?.focus();
  };

  return (
    <figure className={cn("min-w-0", className)}>
      <div ref={ref} className="relative min-w-0">
        <ul className="relative m-0 list-none p-0" onKeyDown={onKey} aria-label={`${span}: ${bridge.label}, ${bridge.from.short} to ${bridge.to.short}`} style={{ height: h }}>
          {bars.map((b, i) => {
            const x0 = x(Math.min(b.start, b.end));
            const bw = Math.max(1.5, Math.abs(x(b.end) - x(b.start)));
            const fill = b.kind === "total" ? QUIET : b.delta >= 0 ? UP : DOWN;
            return (
              <li key={b.key} className="absolute inset-x-0" style={{ top: i * ROW, height: ROW }}>
                <button
                  type="button"
                  className={cn("flex h-full w-full items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm", active === i && "bg-muted/50")}
                  aria-label={describe(b)}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  data-i={i}
                  onClick={() => open(b.point)}
                >
                  <span className={cn("shrink-0 truncate pr-2 text-[12px] leading-4", b.kind === "total" ? "font-medium text-foreground" : "text-muted-foreground")} style={{ width: labelW }}>
                    {b.kind === "total" ? `${bridge.label.length > 24 ? "Total" : bridge.label}, ${b.label}` : b.label}
                  </span>
                  <svg width={w} height={ROW} className="shrink-0 overflow-visible" aria-hidden>
                    {i === 0 && !cut && <line x1={x(0)} x2={x(0)} y1={0} y2={h} stroke="var(--border)" />}
                    {i > 0 && <line x1={x(bars[i - 1].end)} x2={x(bars[i - 1].end)} y1={-ROW / 2 + 7} y2={7} stroke="var(--muted-foreground)" strokeDasharray="2 2" opacity={0.5} />}
                    {b.kind === "total" && cut ? (
                      <rect x={x(b.end) - 1.5} y={5} width={3} height={ROW - 10} rx={1.5} fill={fill} />
                    ) : (
                      <rect x={x0} y={7} width={bw} height={ROW - 14} rx={2} fill={fill} />
                    )}
                  </svg>
                  <span className={cn("num shrink-0 pl-2 text-right text-[12px] leading-4", b.kind === "total" ? "font-medium text-foreground" : "text-foreground")} style={{ width: valueW }}>
                    {text(b)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {active != null && (
          <div className="pointer-events-none absolute right-0 z-10 max-w-[260px] rounded-md border bg-popover px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-lift" style={{ top: Math.min(h - 8, (active + 1) * ROW + 2) }} role="status">
            {describe(bars[active])}
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {span}, {bridge.from.short} to {bridge.to.short} · {axisCaption({ unit: bridge.unit }, scale)} · each step is a line&apos;s printed change; the lines add up to the printed total in both periods
        {cut ? ` · the axis runs from ${fmtValue(lo, bridge.unit, scale)}, not zero, so totals are marked, not drawn as bars` : ""}
        {closes ? "" : " · the steps differ from the change of the total by more than rounding"}
      </figcaption>
    </figure>
  );
}
