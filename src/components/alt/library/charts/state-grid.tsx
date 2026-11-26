import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GRID_COLUMNS, GRID_PLACES, GRID_ROWS } from "@/lib/sources/geo/us-states";
import type { MapPlace } from "@/lib/sources/boards/types";
import { cn } from "@/lib/utils";
import { ChartTooltip, useWidth } from "./primitives";
import { HATCH, fillCss, gridFill, gridNeighbor, gridWidthFor, rampCss, type Direction, type GridScale } from "./state-grid-model";

/**
 * The US state tile grid: each state and DC one square near its usual place, eleven columns by eight rows, the
 * territories listed beneath it. Squares are filled by one figure per state (sequential for levels and counts,
 * diverging around zero for changes); a state without a figure is hatched, and the caption the caller writes names it.
 * Hover or keyboard focus shows the figure, its unit and period; Enter or a click opens the record (or the records)
 * behind it. The arrow keys move between squares (one tab stop for the whole grid). Used by map tiles, the table
 * pages' place view, record counts by state and the company pages.
 */
export function StateGrid({
  places,
  territories = [],
  scale,
  domain,
  rangeLabels,
  unit,
  period,
  label,
  height,
  onOpen,
  selected,
  legend = true,
  className,
}: {
  /** Figures by state; a state of the grid not listed, or listed with a null value, is drawn without a figure. */
  places: readonly MapPlace[];
  territories?: readonly MapPlace[];
  scale: GridScale;
  /** Least and greatest figure drawn. */
  domain: [number, number];
  /** The legend's end labels as printed ("1.2", "14.8" or "−3.1", "+3.1"). */
  rangeLabels: [string, string];
  /** The unit of the figures, for the tooltip and the legend ("records", "%", the stored unit). */
  unit: string;
  /** The period of the figures, for the tooltip. */
  period?: string;
  /** Accessible name of the grid. */
  label: string;
  /** Fit the grid into this height (a board tile); otherwise it fills the width up to 560 px. */
  height?: number;
  onOpen?: (place: MapPlace) => void;
  selected?: string | null;
  legend?: boolean;
  className?: string;
}) {
  const gap = 2;
  const byCode = useMemo(() => new Map(places.map((p) => [p.code, p] as const)), [places]);
  const [hover, setHover] = useState<string | null>(null);
  const [focusCode, setFocusCode] = useState<string>(() => selected ?? GRID_PLACES[0].code);
  const buttons = useRef(new Map<string, HTMLElement>());
  const maxWidth = height ? gridWidthFor(height - (legend ? 24 : 0), gap) : 560;
  const [boxRef, boxWidth] = useWidth(120, maxWidth);
  const width = Math.min(boxWidth, maxWidth);
  const cell = (width - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const shown = hover ? byCode.get(hover) ?? null : null;
  const shownPlace = hover ? GRID_PLACES.find((p) => p.code === hover) ?? null : null;

  const move = (e: KeyboardEvent, code: string) => {
    const keys: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "first", End: "last" };
    const dir = keys[e.key];
    if (dir) {
      const next = gridNeighbor(code, dir);
      e.preventDefault();
      if (next) {
        setFocusCode(next.code);
        buttons.current.get(next.code)?.focus({ preventScroll: true });
      }
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && onOpen) {
      const place = byCode.get(code);
      if (place && (place.row !== null || place.filter)) {
        e.preventDefault();
        onOpen(place);
      }
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      {legend && <GridLegend scale={scale} rangeLabels={rangeLabels} unit={unit} hatched={GRID_PLACES.some((p) => (byCode.get(p.code)?.value ?? null) === null)} />}
      <div ref={boxRef} className="relative mx-auto w-full" style={{ maxWidth }}>
        <div
          role="group"
          aria-label={label}
          className="grid w-full"
          style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${GRID_ROWS}, auto)`, gap }}
        >
          {GRID_PLACES.map((p) => {
            const datum = byCode.get(p.code);
            const value = datum?.value ?? null;
            const fill = gridFill(value, scale, domain);
            const opens = !!onOpen && !!datum && (datum.row !== null || !!datum.filter);
            const name = `${p.name}: ${value === null ? "no figure" : `${datum!.display} ${unit}`}${period ? `, ${period}` : ""}`;
            return (
              <button
                key={p.code}
                type="button"
                ref={(el) => {
                  if (el) buttons.current.set(p.code, el);
                  else buttons.current.delete(p.code);
                }}
                tabIndex={focusCode === p.code ? 0 : -1}
                aria-label={name}
                aria-disabled={!opens || undefined}
                onClick={() => (opens ? onOpen!(datum!) : undefined)}
                onKeyDown={(e) => move(e, p.code)}
                onFocus={() => {
                  setFocusCode(p.code);
                  setHover(p.code);
                }}
                onBlur={() => setHover(null)}
                onPointerEnter={() => setHover(p.code)}
                onPointerLeave={() => setHover(null)}
                style={{
                  gridRow: p.grid!.row + 1,
                  gridColumn: p.grid!.col + 1,
                  background: fill.hue ? fillCss(fill) : HATCH,
                }}
                className={cn(
                  "flex aspect-square min-w-0 items-center justify-center rounded-[3px] font-mono text-[9px] font-semibold leading-none outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card motion-reduce:transition-none @md:text-[10px]",
                  fill.hue ? (fill.lightInkLight ? "text-card" : "text-foreground") : "text-muted-foreground",
                  fill.hue ? (fill.lightInkDark ? "dark:text-card" : "dark:text-foreground") : "",
                  opens ? "cursor-pointer" : "cursor-default",
                  hover && hover !== p.code ? "opacity-80" : "",
                  selected === p.code && "ring-2 ring-ring ring-offset-1 ring-offset-card",
                )}
              >
                {p.code}
              </button>
            );
          })}
        </div>
        {shownPlace && (
          <ChartTooltip
            x={(shownPlace.grid!.col + 0.5) * (cell + gap)}
            // below the square in the upper rows, above it in the lower ones
            y={shownPlace.grid!.row < 4 ? (shownPlace.grid!.row + 1) * (cell + gap) + 2 : shownPlace.grid!.row * (cell + gap) - 64}
            width={width}
            value={shown && shown.value !== null ? shown.display : "–"}
            lines={[shown && shown.value !== null ? unit : "No figure in the source", shownPlace.name, ...(period ? [period] : [])]}
          />
        )}
      </div>
      {territories.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground" aria-label="Territories">
          {territories.map((t) => {
            const opens = !!onOpen && (t.row !== null || !!t.filter);
            return (
              <li key={t.code}>
                {opens ? (
                  <button type="button" onClick={() => onOpen!(t)} className="underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t.name} <span className="num text-foreground">{t.value === null ? "–" : t.display}</span>
                  </button>
                ) : (
                  <span>
                    {t.name} <span className="num text-foreground">{t.value === null ? "–" : t.display}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The value range: a ramp between the two ends as printed, the unit, and the hatch of a square without a figure. */
export function GridLegend({ scale, rangeLabels, unit, hatched }: { scale: GridScale; rangeLabels: [string, string]; unit: string; hatched: boolean }) {
  return (
    <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="num text-foreground">{rangeLabels[0]}</span>
        <span className="inline-block h-2 w-20 rounded-[2px]" style={{ background: rampCss(scale) }} />
        <span className="num text-foreground">{rangeLabels[1]}</span>
        <span>{unit}</span>
      </span>
      {scale === "diverging" && <span>Centred on zero</span>}
      {hatched && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px]" style={{ background: HATCH }} />
          No figure
        </span>
      )}
    </div>
  );
}
