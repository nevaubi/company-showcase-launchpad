import { useState } from "react";
import { cn } from "@/lib/utils";
import { fillLegend, fillPct, type FillCell } from "./fill-model";
import { useRoving } from "./roving";

/**
 * Shade of each band: one hue mixed into the muted surface, more hue for fuller; the empty band is an outline. The
 * four steps pass the dataviz ordinal checks in both themes (monotone lightness, steps at least 0.06 apart, the
 * lightest at 2.17:1 on the light card and 2.15:1 on the dark one).
 */
const BAND_MIX = [100, 80, 58, 38, 0] as const;
export const bandFill = (band: number) => (band >= 4 ? "transparent" : `color-mix(in oklab, var(--chart-1) ${BAND_MIX[band]}%, var(--muted))`);

/**
 * Filled share per field as a compact heat strip: one cell per field in dictionary order, wrapping into rows, its
 * shade the band of its share. Hover or focus names the field and its counts; the legend below gives each band and how
 * many fields fall in it. One tab stop for the strip, arrow keys move between fields.
 */
export function FillStrip({ cells, label }: { cells: FillCell[]; label: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const roving = useRoving(cells.length, (i) => setShown(i));
  const dense = cells.length > 120;
  const legend = fillLegend(cells);
  const current = shown !== null ? cells[shown] : null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <div role="group" aria-label={label} className={cn("flex min-w-0 flex-wrap", dense ? "gap-[2px]" : "gap-[3px]")} onPointerLeave={() => setShown(null)}>
        {cells.map((c, i) => {
          const props = roving.bind(i);
          return (
            <button
              key={c.position}
              type="button"
              {...props}
              aria-label={c.tip}
              title={c.tip}
              onPointerEnter={() => setShown(i)}
              onFocus={() => {
                props.onFocus();
                setShown(i);
              }}
              className={cn(
                "shrink-0 rounded-[2px] transition-[box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                dense ? "h-4 w-2" : "h-6 w-3.5",
                c.band === 4 && "border border-border",
                shown === i && "ring-1 ring-foreground/40",
              )}
              style={{ background: bandFill(c.band) }}
            />
          );
        })}
      </div>
      <p className="min-h-4 truncate text-[11px] leading-4 text-muted-foreground" aria-live="polite">
        {current ? (
          <>
            <span className="text-foreground">{current.title}</span>
            {current.code && <span className="num ml-1">{current.code}</span>}
            <span className="num ml-1.5">
              {fillPct(current.share)}, a value in {current.filled.toLocaleString("en-US")} of {(current.filled + current.blank).toLocaleString("en-US")} records
            </span>
          </>
        ) : (
          "Point at a field to see it."
        )}
      </p>
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4 text-muted-foreground" aria-label="Bands of filled share">
        {legend.map((l) => (
          <li key={l.band} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("inline-block size-2.5 rounded-[2px]", l.band === 4 && "border border-border")} style={{ background: bandFill(l.band) }} />
            <span>{l.label}</span>
            <span className="num text-foreground">{l.fields.toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
