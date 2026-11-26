import { useState } from "react";
import { ChartTooltip, QUIET, slot, useWidth } from "@/components/alt/library/charts/primitives";
import { datasetHref } from "@/lib/sources/links";
import { cn } from "@/lib/utils";
import { HrefLink } from "../ui/primitives";
import { TIMELINE_ROWS, yearTicks, type Timeline } from "./timeline-model";

const DAY = 86_400_000;
const days = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
export const slotColor = (s: number | null) => (s === null ? QUIET : slot(s));

/**
 * One bar per table from its first period to its last on a shared year axis, coloured by publisher (fixed slots,
 * the rest in the quiet grey), newest last period first. Each row is a link to the table and names its publisher, so
 * colour is never the only channel; hover or focus gives the range, the periods and the records.
 */
export function TableTimeline({ timeline, showAll, onShowAll }: { timeline: Timeline; showAll: boolean; onShowAll: () => void }) {
  const [boxRef, width] = useWidth(280, 900);
  const [hover, setHover] = useState<{ i: number; top: number; height: number } | null>(null);
  const narrow = width < 560;
  const gap = 12;
  const labelW = narrow ? width : Math.min(280, Math.round(width * 0.34));
  const trackW = Math.max(80, narrow ? width : width - labelW - gap);
  const trackLeft = narrow ? 0 : labelW + gap;
  const from = days(`${timeline.fromYear}-01-01`);
  const to = days(`${timeline.toYear}-12-31`) + 1;
  const x = (iso: string, end = false) => ((days(iso) + (end ? 1 : 0) - from) / (to - from)) * trackW;
  const rows = showAll ? timeline.rows : timeline.rows.slice(0, TIMELINE_ROWS);
  const ticks = yearTicks(timeline.fromYear, timeline.toYear, Math.max(2, Math.floor(trackW / 52)));
  const shown = hover ? rows[hover.i] : null;
  const mark = (el: HTMLElement, i: number) => setHover({ i, top: el.offsetTop, height: el.offsetHeight });

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4 text-muted-foreground" aria-label="Publishers">
        {timeline.publishers.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-3 rounded-full" style={{ background: slotColor(p.slot) }} />
            <span className="text-foreground">{p.short}</span>
            <span className="num">{p.tables.toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
      <div ref={boxRef} className="relative min-w-0" onPointerLeave={() => setHover(null)}>
        <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: trackLeft, width: trackW }}>
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: x(`${t}-01-01`) }} />
          ))}
        </div>
        <ol className="relative grid grid-cols-1" aria-label="Tables by period, newest last period first">
          {rows.map((r, i) => {
            const left = x(r.start);
            const w = Math.max(4, x(r.end, true) - left);
            return (
              <li key={r.id} onPointerEnter={(e) => mark(e.currentTarget, i)} onFocus={(e) => mark(e.currentTarget, i)} onBlur={() => setHover(null)}>
                <HrefLink
                  href={datasetHref(r.id)}
                  title={r.tip}
                  className="block rounded-sm transition-colors duration-150 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <span
                    className={cn("grid min-w-0 items-center", narrow ? "grid-cols-1 gap-0.5 py-1" : "h-7")}
                    style={narrow ? undefined : { gridTemplateColumns: `${labelW}px ${trackW}px`, columnGap: gap }}
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="min-w-0 truncate text-[13px] leading-5">{r.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{r.publisher}</span>
                    </span>
                    <span aria-hidden className={cn("relative block", narrow ? "h-3" : "h-7")} style={{ width: trackW }}>
                      <span
                        className={cn(
                          "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full transition-opacity duration-150 motion-reduce:transition-none",
                          hover !== null && hover.i !== i && "opacity-60",
                        )}
                        style={{ left, width: w, background: slotColor(r.slot) }}
                      />
                    </span>
                  </span>
                  <span className="sr-only">{r.tip}</span>
                </HrefLink>
              </li>
            );
          })}
        </ol>
        <div aria-hidden className="relative h-5" style={{ marginLeft: trackLeft, width: trackW }}>
          {ticks.map((t, i) => {
            const at = x(`${t}-01-01`);
            const shift = i === ticks.length - 1 && at > trackW - 28 ? "-100%" : at < 14 ? "0" : "-50%";
            return (
              <span key={t} className="num absolute top-1 text-[11px] text-muted-foreground" style={{ left: at, transform: `translateX(${shift})` }}>
                {t}
              </span>
            );
          })}
        </div>
        {shown && hover && (
          <ChartTooltip
            x={trackLeft + Math.min(trackW, x(shown.end, true))}
            y={hover.top + hover.height + 2}
            width={width}
            boxWidth={224}
            value={shown.firstLabel === shown.lastLabel ? shown.firstLabel : `${shown.firstLabel} to ${shown.lastLabel}`}
            lines={[shown.title, `${shown.publisher}${shown.periods ? `, ${shown.periods.toLocaleString("en-US")} periods` : ""}, ${shown.records.toLocaleString("en-US")} records`]}
          />
        )}
      </div>
      {timeline.rows.length > TIMELINE_ROWS && (
        <button
          type="button"
          onClick={onShowAll}
          className="min-h-7 justify-self-start rounded-sm text-[13px] font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll ? `Show the first ${TIMELINE_ROWS}` : `Show all ${timeline.rows.length.toLocaleString("en-US")} tables`}
        </button>
      )}
    </div>
  );
}
