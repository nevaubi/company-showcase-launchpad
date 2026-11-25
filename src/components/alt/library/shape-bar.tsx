import { cn } from "@/lib/utils";
import type { ShapeCounts } from "./overview";
import { SHAPE_COLOR, SHAPE_NOTE, SHAPE_ORDER, shapeSegments, shapeSummary, sharePct } from "./shapes";
import { SHAPE_LABEL } from "@/lib/sources/shape";

/**
 * A collection's tables by shape: a thin bar, one whole split into parts in fixed order, a 2 px surface gap
 * between parts, no text on the bar. Every part names itself on hover; the bar's accessible name gives all of them.
 */
export function ShapeBar({ counts, className }: { counts: ShapeCounts; className?: string }) {
  const parts = shapeSegments(counts);
  const label = shapeSummary(counts);
  return (
    <div role="img" aria-label={label} className={cn("flex h-2 w-full min-w-0 gap-[2px] overflow-hidden rounded-full", className)}>
      {parts.map((p) => (
        <span
          key={p.shape}
          title={`${p.label}: ${p.count.toLocaleString("en-US")} ${p.count === 1 ? "table" : "tables"} (${sharePct(p.share)})`}
          className="h-full"
          style={{ flexGrow: p.count, flexBasis: 0, minWidth: 2, background: SHAPE_COLOR[p.shape] }}
        />
      ))}
    </div>
  );
}

/** The one legend for every shape bar on the page, in the bars' order. */
export function ShapeLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Shapes of tables" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {SHAPE_ORDER.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5" title={SHAPE_NOTE[s]}>
          <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: SHAPE_COLOR[s] }} />
          {SHAPE_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}
