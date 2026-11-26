/**
 * Records by category, pure. A field inside `values` is counted only on a snapshot small enough to read whole in one
 * bounded read (five selects of 1,000 rows); the counts are exact, and a field is drawn only when they show a
 * category (the rule in `isCategorical`). Stored strings are the values: nothing is trimmed, folded or parsed, and an
 * empty cell is counted apart, never as a value. The indexed dimensions (entity, place, period) are counted by facets
 * elsewhere and never here.
 */
import { fieldCode, fieldTitle, type FieldRole } from "@/lib/sources/fields";
import type { SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn, SourceIngest } from "@/lib/sources/schema";

/** Snapshots of at most this many rows are counted: five selects of 1,000 rows read every record. */
export const CATEGORY_READ_ROWS = 5000;
/** Fields one read takes (the series read of several fields reads at most eight). */
export const CATEGORY_FIELDS_MAX = 8;
/** Charts drawn at most. */
export const CATEGORY_CHARTS_MAX = 6;
/** Values named in a chart; the rest are one bar. */
export const TOP_VALUES = 10;

/** The rule's thresholds, named so the tests and the report say the same thing. */
export const CATEGORY_RULE = {
  /** Records with a value, at least. */
  minFilled: 10,
  /** Distinct values, at least. */
  minValues: 2,
  /** At most one distinct value per this many filled records. */
  recordsPerValue: 10,
  /** The ten most common values hold at least this share of the filled records. */
  topShare: 0.5,
} as const;

/**
 * The fields worth one read, from the dictionary alone: not a declared dimension or a part of a composed period,
 * not a quantity, identifier or date, filled in at least `minFilled` records when the snapshot stores blank counts.
 * Fields filled in at least half the records come first, each group in dictionary order; at most eight.
 */
export function categoryCandidates(
  columns: readonly SourceColumn[],
  ingest: Pick<SourceIngest, "dimensions" | "composites"> | null | undefined,
  roles: readonly FieldRole[],
  fills: readonly SourceFieldFill[] | null,
  max = CATEGORY_FIELDS_MAX,
): number[] {
  const taken = new Set<number>();
  for (const p of Object.values(ingest?.dimensions ?? {})) if (typeof p === "number") taken.add(p);
  for (const p of ingest?.composites?.period?.indices ?? []) taken.add(p);
  const eligible = columns
    .map((_, position) => position)
    .filter((p) => !taken.has(p))
    .filter((p) => roles[p] !== "quantity" && roles[p] !== "identifier" && roles[p] !== "date")
    .filter((p) => !fills || (fills[p] !== undefined && fills[p].filled >= CATEGORY_RULE.minFilled));
  const full = eligible.filter((p) => !fills || fills[p].share >= 0.5);
  const rest = eligible.filter((p) => fills && fills[p].share < 0.5);
  return [...full, ...rest].slice(0, max);
}

/** Counts of one field over every record read. */
export type FieldCounts = {
  position: number;
  /** Records with a non-empty string. */
  filled: number;
  /** Records with an empty string. */
  blank: number;
  /** Records with a null (a declared null marker). */
  missing: number;
  /** Distinct non-empty strings. */
  distinct: number;
  /** The most common values, most first (ties in code-point order), with the first record that holds each. */
  top: { value: string; rows: number; row: number }[];
  /** Records and values beyond `top`. */
  otherRows: number;
  otherValues: number;
};

const byCount = (a: { value: string; rows: number }, b: { value: string; rows: number }) =>
  b.rows - a.rows || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/**
 * Counts each field's values over rows read in file order. `cells[i]` is the cell of `positions[i]`. The first
 * record of a value is the lowest row number that holds it.
 */
export function countFields(positions: readonly number[], rows: readonly { row: number; cells: readonly (string | null)[] }[], top = TOP_VALUES): FieldCounts[] {
  return positions.map((position, i) => {
    const seen = new Map<string, { rows: number; row: number }>();
    let blank = 0;
    let missing = 0;
    for (const r of rows) {
      const cell = r.cells[i];
      if (cell === null || cell === undefined) missing += 1;
      else if (cell === "") blank += 1;
      else {
        const hit = seen.get(cell);
        if (hit) {
          hit.rows += 1;
          if (r.row < hit.row) hit.row = r.row;
        } else seen.set(cell, { rows: 1, row: r.row });
      }
    }
    const all = [...seen.entries()].map(([value, c]) => ({ value, rows: c.rows, row: c.row })).sort(byCount);
    const head = all.slice(0, top);
    const tail = all.slice(top);
    return {
      position,
      filled: all.reduce((s, v) => s + v.rows, 0),
      blank,
      missing,
      distinct: all.length,
      top: head,
      otherRows: tail.reduce((s, v) => s + v.rows, 0),
      otherValues: tail.length,
    };
  });
}

/**
 * A field is a category when, over every record: at least 10 hold a value, at least 2 distinct values occur, there is
 * at most one distinct value per 10 filled records, and the 10 most common values hold at least half of the filled
 * records. Identifiers, names and amounts fail the third test; a long tail fails the fourth.
 */
export function isCategorical(c: FieldCounts): boolean {
  if (c.filled < CATEGORY_RULE.minFilled || c.distinct < CATEGORY_RULE.minValues) return false;
  if (c.distinct * CATEGORY_RULE.recordsPerValue > c.filled) return false;
  const top = c.top.slice(0, TOP_VALUES).reduce((s, v) => s + v.rows, 0);
  return top >= c.filled * CATEGORY_RULE.topShare;
}

export type CategoryBar = {
  key: string;
  label: string;
  sub?: string;
  value: number;
  text: string;
  title: string;
  /** The first record holding the value; null for "All other values". */
  row: number | null;
};

export type CategoryChart = {
  position: number;
  title: string;
  /** The stored header when it differs from the title. */
  code: string | null;
  caption: string;
  bars: CategoryBar[];
};

const n = (v: number) => v.toLocaleString("en-US");
const pct = (share: number) => (share >= 0.9995 ? "all" : share > 0 && share < 0.005 ? "under 1%" : `${Math.round(share * 100)}%`);

/** One line from the counts: "3 values in 2,462 records; empty in 12" or "48 values in 900 records; the 10 most common hold 81%". */
export function categoryCaption(c: FieldCounts): string {
  const parts = [`${n(c.distinct)} values in ${n(c.filled)} records`];
  if (c.distinct > TOP_VALUES) {
    const top = c.top.reduce((s, v) => s + v.rows, 0);
    parts.push(`the ${TOP_VALUES} most common hold ${pct(top / c.filled)}`);
  }
  const empty = c.blank + c.missing;
  if (empty) parts.push(`empty in ${n(empty)}`);
  return `${parts.join("; ")}.`;
}

/** The charts of the fields the rule calls categories, in dictionary order, at most six. */
export function categoryCharts(counts: readonly FieldCounts[], columns: readonly SourceColumn[], max = CATEGORY_CHARTS_MAX): CategoryChart[] {
  return counts
    .filter((c) => columns[c.position] && isCategorical(c))
    .sort((a, b) => a.position - b.position)
    .slice(0, max)
    .map((c) => {
      const column = columns[c.position];
      const title = fieldTitle(column);
      const code = fieldCode(column);
      const bars: CategoryBar[] = c.top.map((v) => ({
        key: `v:${v.value}`,
        label: v.value,
        value: v.rows,
        text: n(v.rows),
        title: `${title} ${v.value}: ${n(v.rows)} ${v.rows === 1 ? "record" : "records"}. Opens the first, record ${n(v.row)}.`,
        row: v.row,
      }));
      if (c.otherValues > 0)
        bars.push({
          key: "other",
          label: "All other values",
          sub: `${n(c.otherValues)} ${c.otherValues === 1 ? "value" : "values"}`,
          value: c.otherRows,
          text: n(c.otherRows),
          title: `${title}, the other ${n(c.otherValues)} values: ${n(c.otherRows)} records.`,
          row: null,
        });
      return { position: c.position, title, code: code !== title ? code : null, caption: categoryCaption(c), bars };
    });
}
