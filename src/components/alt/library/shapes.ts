/**
 * The thin segmented bar of a collection's tables by shape: one whole split into parts, widths proportional to
 * the counts, a part at zero draws nothing. Pure.
 *
 * Hues (fixed order, never cycled; validated with the dataviz skill's validate_palette.js against the light and
 * the dark card surface, 25 Nov 2026): series --chart-1, panels --chart-3, by place --chart-2, reference
 * --chart-5. Adjacent pairs pass colour-vision separation (worst light 14.6, dark 9.7) and the normal-vision
 * floor (worst light 24.1, dark 18.1). Reference is the app's neutral chart hue on purpose: those tables have no
 * dimension that varies. The app tokens sit outside the validator's lightness band (chart-1 light L 0.42, the
 * dark set L 0.72 to 0.80); they are the app's and are used as they are.
 */
import { SHAPE_LABEL, type SourceShape } from "@/lib/sources/shape";
import type { ShapeCounts } from "./overview";

export const SHAPE_ORDER: readonly SourceShape[] = ["series", "panel", "places", "table"];

export const SHAPE_COLOR: Record<SourceShape, string> = {
  series: "var(--chart-1)",
  panel: "var(--chart-3)",
  places: "var(--chart-2)",
  table: "var(--chart-5)",
};

/** What one part is, for the legend and the accessible name. */
export const SHAPE_NOTE: Record<SourceShape, string> = {
  series: "one series over time",
  panel: "many entities, usually over time",
  places: "rows by place",
  table: "nothing indexed varies: lists and reference tables",
};

export type ShapeSegment = { shape: SourceShape; label: string; count: number; share: number };

/** The parts in fixed order, zero counts left out; shares add up to 1. */
export function shapeSegments(counts: ShapeCounts): ShapeSegment[] {
  const total = SHAPE_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
  if (!total) return [];
  return SHAPE_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => ({
    shape: k,
    label: SHAPE_LABEL[k],
    count: counts[k],
    share: counts[k] / total,
  }));
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** "Tables by shape: 12 series (29%), 30 panels (71%)", the bar's accessible name and its text equivalent. */
export function shapeSummary(counts: ShapeCounts): string {
  const parts = shapeSegments(counts);
  if (!parts.length) return "No tables";
  return `Tables by shape: ${parts
    .map((p) => `${p.count.toLocaleString("en-US")} ${p.label.toLowerCase()} (${pct(p.share)})`)
    .join(", ")}`;
}

export { pct as sharePct };
