/**
 * Financial statement table typesetting: pure rules (this file) and the look (`table.css`, classes `irt-*`).
 * Free of IR imports so any statement table (the IR tab, the company Financials tab) can use it.
 *
 * Row kinds, from the section's data, never from label text:
 *   head   a printed row heading (no figures)            → tr.irt-group
 *   gap    a printed spacer                              → tr.irt-gap
 *   line   a figure line                                 → tr.irt-line + tr.irt-l0..irt-l3 by indent level
 *   sub    a subtotal: a total that does not close the table at the top level, or a printed bold line
 *                                                        → + tr.irt-sub
 *   grand  a grand total: the top-level total that closes the table, or a printed double rule
 *                                                        → + tr.irt-grand
 *   ratio  a ratio, percentage, basis-point or per-share line (by unit) → + tr.irt-ratio
 *
 * Classes (put `irt-root` on the element that holds the table; it defines the colours):
 *   irt-root          colour variables (light and dark), the soft edge of the first column when the root
 *                     carries `data-scrolled`
 *   irt-sec-head      section head strip: quiet band under a firm rule
 *   irt-colhead       column head strip (wrapper of the head table); th.irt-latest marks the newest period,
 *                     .irt-period over .irt-date inside each head cell
 *   irt-body          on tbody: opaque cells, stripes (tr.irt-stripe), hover, td.irt-latest tint, totals
 *   irt-fc            the sticky first column cells
 *   irt-mark          a unit mark after a figure (%, ×, bps), muted
 *   irt-missing       a cell with no figure (blank: an em space; missing: an en dash)
 *   irt-tag           a small label after a line's name (restated, older basis)
 *   irt-scope         on a wrapper of a table this system does not render: head band, stripes, hover;
 *                     add table.irt-blocks when each item is its own tbody
 *   irt-list          on a ul: a faint band on every other item, hover
 *
 * Rules adopted (round 8, irstyle):
 * - Section head strip: a quiet band (4 to 7% ink over the card) under a firm top rule, title, then one
 *   caption line (source, unit and scale, period range, documents) and the controls on the right.
 * - Column head strip: fiscal period over calendar date, right-aligned over the figures, a ruled bottom edge,
 *   sticky under the app header; the newest period's head is set bold and its column carries a faint tint.
 * - Group headings (printed row headings): semibold, 12 px, on a faint band.
 * - Indents: 16 px per printed level from a 16 px gutter; from the second level down, hairline guides at
 *   each ancestor's indent so deep parts stay attached to their parent; levels 2 and deeper a shade quieter.
 * - Totals: a subtotal is semibold with a hairline rule over its figures; a grand total is bold with a firmer
 *   rule over its figures and a double rule under them, as statements print it. The rules run over the
 *   figure columns only, never under the label, as in print.
 * - Shading: every other line within a block (a block restarts at each heading or spacer) carries a faint
 *   band; hover and keyboard focus are drawn over it and always win.
 * - Ratios, per-share and basis-point lines: their unit mark is set muted after the figure.
 * - Figures: tabular, right-aligned, negatives in parentheses, a fixed gutter for the tie mark; a period the
 *   table itself prints with nothing in the cell shows an em space, a period no stored document prints a
 *   quiet en dash.
 * - A restated or older-basis line carries a small label after its name.
 * - The first column is sticky; once the table is scrolled sideways it casts a soft edge shadow.
 */

export type TotalKind = "none" | "sub" | "grand";

/** A blank cell: the table prints the period but nothing in this row. */
export const BLANK = "\u2003";

export interface RowLike {
  kind: "line" | "head" | "gap";
  depth?: number;
  /** the build's total flag */
  total?: boolean;
  /** printed marks of the row, when the section data carries them: bold, a rule above, a double rule */
  bold?: boolean;
  rule?: "single" | "double";
}

/**
 * Subtotal or grand total for each row, from the row data. With printed marks: a double rule is a grand
 * total, a rule above or bold type a subtotal, unless it is the top-level line that closes the table (grand).
 * Without them: a total is grand when it is the top-level line that closes the table, else a subtotal.
 * A section of one line has nothing to total.
 */
export function totalKinds(rows: RowLike[]): TotalKind[] {
  const lines = rows.filter((r) => r.kind === "line");
  if (lines.length < 2) return rows.map(() => "none");
  const top = Math.min(...lines.map((r) => r.depth ?? 0));
  let last = -1;
  rows.forEach((r, i) => {
    if (r.kind === "line") last = i;
  });
  return rows.map((r, i) => {
    if (r.kind !== "line") return "none";
    if (r.rule === "double") return "grand";
    const marked = r.total || r.bold || r.rule === "single";
    if (!marked) return "none";
    return (r.depth ?? 0) === top && i === last && r.total !== false ? "grand" : "sub";
  });
}

/** A ratio, percentage, basis-point or per-share line, by its unit and printed scale. */
export function isRatioLine(unit: string, perShare: boolean): boolean {
  return unit === "pct" || unit === "ratio" || unit === "bps" || perShare;
}

/** Faint band on every other line within a block; headings and spacers start a new block. */
export function stripes(rows: RowLike[]): boolean[] {
  let n = 0;
  return rows.map((r) => {
    if (r.kind !== "line") {
      n = 0;
      return false;
    }
    return n++ % 2 === 1;
  });
}

/** Indent step per printed level and the first column's left gutter, px. */
export const INDENT = 16;
export const GUTTER = 16;
/** Levels drawn distinctly; deeper rows keep indenting but share the last level's class. */
export const LEVELS = 4;

export const levelClass = (depth: number) => `irt-l${Math.min(Math.max(0, Math.round(depth)), LEVELS - 1)}`;

/**
 * Padding and hairline guides for a label at `depth`: one 1 px guide at each ancestor level from the
 * first nested level down (x = gutter + level × indent + 4), drawn as background so it costs no element.
 */
export function labelStyle(depth: number): { paddingLeft: number; backgroundImage?: string; backgroundSize?: string; backgroundRepeat?: string } {
  const d = Math.max(0, Math.round(depth));
  const style: ReturnType<typeof labelStyle> = { paddingLeft: GUTTER + d * INDENT };
  if (d < 2) return style;
  const xs: number[] = [];
  for (let k = 1; k < d; k++) xs.push(GUTTER + k * INDENT - INDENT / 2);
  style.backgroundImage = xs.map(() => "linear-gradient(var(--irt-guide), var(--irt-guide))").join(", ");
  style.backgroundSize = xs.map(() => "1px 100%").join(", ");
  style.backgroundRepeat = "no-repeat";
  (style as Record<string, unknown>).backgroundPosition = xs.map((x) => `${x}px 0`).join(", ");
  return style;
}

/** The figure and its unit mark apart, so the mark can be set muted ("12.5%" → ["12.5", "%"]). */
export function splitMark(text: string, mark: string): [string, string] {
  if (mark && text.endsWith(mark) && text.length > mark.length) return [text.slice(0, -mark.length), mark];
  return [text, ""];
}

/** A small label for a line printed on another basis ("Restated", "Older basis"), from its printed name. */
export function basisTag(label: string): string | null {
  const x = label.toLowerCase();
  if (/\b(as )?previously reported\b/.test(x)) return "As previously reported";
  if (/\b(restated|recast)\b/.test(x)) return "Restated";
  if (/\b(old(er)?|prior|former|legacy) basis\b/.test(x)) return "Older basis";
  return null;
}

/**
 * Cells a section's own printed table leaves empty. `tables` maps "doc:table" to the period ends that table
 * prints any figure for; a row printed in that table (`at` = [doc, table]) with no figure in such a period
 * is blank (the table prints nothing there), not missing (no document prints the period).
 */
export function isBlank(at: readonly number[] | undefined, end: string, tables: Map<string, Set<string>>): boolean {
  if (!at || at.length < 2) return false;
  return tables.get(`${at[0]}:${at[1]}`)?.has(end) ?? false;
}

/** Adds one printed figure to the per-table period index `isBlank` reads. */
export function notePrinted(tables: Map<string, Set<string>>, d: number | undefined, l: unknown, end: string) {
  if (d == null || !Array.isArray(l)) return;
  const key = `${d}:${l[0]}`;
  let set = tables.get(key);
  if (!set) tables.set(key, (set = new Set()));
  set.add(end);
}
