/**
 * One presentation system for investor-relations data (company IR page and the KPI matrix).
 *
 * Type: five sizes, three weights, each tied to a role.
 *   18 px / 600  stat value (summary tiles)                     → IR.stat
 *   14 px / 600  section title (panel headers)                  → IR.section
 *   13 px / 600  table title, totals and subtotals              → IR.group, IR.total
 *   13 px / 400  row labels and numeric cells                   → IR.row, IR.num
 *   13 px / 500  emphasised value (key metrics, latest column)  → IR.strong
 *   11 px / 400  captions, units, periods, sources              → IR.caption
 *   10 px mono   quiet group headers and column kickers         → IR.eyebrow (the global .eyebrow)
 * Totals and subtotals carry weight and a hairline rule, never colour.
 *
 * Hierarchy: rows indent INDENT px per level from a fixed gutter, with padding (not leading spaces),
 * so a wrapped label stays aligned. "Of which" lines under a subtotal get a hairline guide at their
 * parent's indent.
 *
 * Numbers: `.num` tabular figures, right-aligned, one decimal convention per row, a true minus sign,
 * the unit stated once per table or row (never per cell), a quiet dash (–) for a period no document
 * prints. Derived values carry a dotted underline and show their formula on hover.
 *
 * Periods: oldest to newest, left to right. Column heads read "Q3 FY25" with the calendar month
 * under it; the exact period end is in the title. Quarterly and annual never share a run of columns.
 *
 * Rhythm: 4 px grid. Rows 28 px (py-1 + 20 px line), panel gutter 16 px (px-4), 12 px between a
 * table's title and its head, 24 px between tables. Tables keep their head and first column in view
 * with sticky positioning against the page; no inner vertical scrolling. Horizontal overflow at
 * phone width stays in the table's own wrapper.
 *
 * Colour and finish: colour only where it encodes data (sign of a change, a failed check, a flag).
 * Hairline borders, `shadow-paper` on panels, radius 6 px at most, row hover tint, visible focus
 * ring, transitions of 150 ms or less, reduced motion respected.
 */
export const IR = {
  stat: "num text-lg font-semibold leading-6",
  section: "text-sm font-semibold tracking-tight",
  group: "text-[13px] font-semibold leading-5",
  total: "font-semibold",
  row: "text-[13px] leading-5",
  strong: "font-medium",
  num: "num text-right tabular-nums whitespace-nowrap",
  caption: "text-[11px] leading-4 text-muted-foreground",
  eyebrow: "eyebrow",
  /** a period no stored document prints */
  missing: "text-muted-foreground",
  /** derived (calculated) value: dotted underline, formula on hover */
  derived: "underline decoration-dotted decoration-muted-foreground underline-offset-[3px]",
  /** row hover tint and keyboard focus for clickable cells */
  cellButton:
    "relative block w-full px-3 py-1 text-right transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none",
  /** panel finish */
  panel: "shadow-paper",
} as const;

/** Indent step per hierarchy level, px. */
export const INDENT = 16;
/** Left gutter of the first column, px (matches px-4). */
export const GUTTER = 16;

/** Inline style for a row label at `depth` (0 = the table's total). */
export const indentStyle = (depth: number) => ({ paddingLeft: GUTTER + Math.max(0, depth) * INDENT });

/** Quiet dash for a period with no printed value. */
export const DASH = "–";
