/**
 * Field counts stored with a snapshot (migration 0070: `source_field_counts`, written once per published snapshot by
 * the worker from the snapshot's own file, over every record). Pure: the rows as the read gets them, checked, and turned
 * into the counts the category charts take (`FieldCounts`), exactly as `countFields` gives them for the same records.
 *
 * A snapshot's stored counts are used only when they are complete and add up: a row for every field asked for and for
 * the snapshot's last field (the worker writes that one last), and in every row the filled, empty and null records add
 * up to the snapshot's records, and the list and its remainder to the filled records and the distinct values. Anything
 * else is no stored counts, never a part shown as the whole.
 */
import { TOP_VALUES, type FieldCounts } from "./category-model";

/** The columns the read selects, in one select. */
export const FIELD_COUNTS_SELECT = "position,filled,blank,missing,numeric_rows,value_cap,distinct_values,capped,top,other_rows,other_values,computed_at";

/** A field the worker did not count value by value: more distinct values than its cap, or dropped to bound memory. */
export type CappedField = { position: number; filled: number; blank: number; missing: number; cap: number; reason: "values" | "memory" };

/** Where a read's counts come from: stored with the version, or counted from its records on request. */
export type CountBasis = { from: "stored"; records: number; computedAt: string | null } | { from: "records"; records: number };

export type StoredCounts = { fields: FieldCounts[]; capped: CappedField[]; computedAt: string | null };

const whole = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

type Read = { position: number; exact: FieldCounts } | { position: number; capped: CappedField };

/** One stored row, checked against the snapshot's record count; null when it does not add up. */
export function readStoredRow(raw: unknown, records: number): Read | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const position = whole(r.position);
  const filled = whole(r.filled);
  const blank = whole(r.blank);
  const missing = whole(r.missing);
  const numericRows = whole(r.numeric_rows);
  const cap = whole(r.value_cap);
  const otherRows = whole(r.other_rows);
  if (position === null || filled === null || blank === null || missing === null || numericRows === null || cap === null || otherRows === null) return null;
  if (filled + blank + missing !== records || numericRows > filled || cap < 1 || !Array.isArray(r.top)) return null;
  if (r.capped === "values" || r.capped === "memory") {
    if (r.distinct_values !== null || r.other_values !== null || r.top.length || otherRows !== filled) return null;
    return { position, capped: { position, filled, blank, missing, cap, reason: r.capped } };
  }
  if (r.capped !== null) return null;
  const distinct = whole(r.distinct_values);
  const otherValues = whole(r.other_values);
  if (distinct === null || otherValues === null || distinct > cap) return null;
  const top: { value: string; rows: number; row: number }[] = [];
  let listed = 0;
  for (const entry of r.top) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    const [value, rows, row] = entry as unknown[];
    const n = whole(rows);
    const first = whole(row);
    if (typeof value !== "string" || value === "" || n === null || n < 1 || first === null || first < 1 || first > records) return null;
    if (top.length && n > top[top.length - 1].rows) return null;
    top.push({ value, rows: n, row: first });
    listed += n;
  }
  if (listed + otherRows !== filled || top.length + otherValues !== distinct) return null;
  // the charts name ten values; the rest of the stored list joins the remainder, as countFields gives it
  const head = top.slice(0, TOP_VALUES);
  const tail = top.slice(TOP_VALUES);
  return {
    position,
    exact: {
      position,
      filled,
      blank,
      missing,
      distinct,
      top: head,
      otherRows: otherRows + tail.reduce((s, v) => s + v.rows, 0),
      otherValues: otherValues + tail.length,
      numeric: filled > 0 && numericRows >= filled * 0.9,
    },
  };
}

/**
 * The stored counts of `positions`, in that order, or null when they are not complete for the snapshot (`width`
 * fields, `records` records). `rows` is what one select of the positions and the last field returned.
 */
export function storedCounts(rows: readonly unknown[], positions: readonly number[], width: number, records: number): StoredCounts | null {
  const byPosition = new Map<number, Read>();
  let computedAt: string | null = null;
  for (const raw of rows) {
    const read = readStoredRow(raw, records);
    if (!read || read.position >= width || byPosition.has(read.position)) return null;
    byPosition.set(read.position, read);
    const at = (raw as Record<string, unknown>).computed_at;
    if (typeof at === "string" && (computedAt === null || at > computedAt)) computedAt = at;
  }
  if (!byPosition.has(width - 1)) return null;
  const fields: FieldCounts[] = [];
  const capped: CappedField[] = [];
  for (const p of positions) {
    const read = byPosition.get(p);
    if (!read) return null;
    if ("exact" in read) fields.push(read.exact);
    else capped.push(read.capped);
  }
  return { fields, capped, computedAt };
}

/** The positions one select asks for: the fields wanted and the snapshot's last field, which marks the counts complete. */
export function storedPositions(positions: readonly number[], width: number): number[] {
  return [...new Set([...positions, width - 1])].sort((a, b) => a - b);
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * One line about the fields asked for that the worker did not count value by value (`asked` fields in all): "3 of the
 * 12 fields counted hold more than 1,000 values, so they are not drawn by category." Null when there are none.
 */
export function cappedLine(capped: readonly CappedField[], asked: number): string | null {
  const many = capped.filter((c) => c.reason === "values");
  const long = capped.filter((c) => c.reason === "memory");
  const parts: string[] = [];
  if (many.length)
    parts.push(
      `${many.length === 1 ? "One" : n(many.length)} of the ${n(asked)} fields counted ${many.length === 1 ? "holds" : "hold"} more than ${n(Math.max(...many.map((c) => c.cap)))} values, so ${many.length === 1 ? "it is" : "they are"} not drawn by category.`,
    );
  if (long.length)
    parts.push(`${long.length === 1 ? "One field was" : `${n(long.length)} fields were`} not counted value by value: ${long.length === 1 ? "its values were" : "their values were"} too many or too long to hold.`);
  return parts.length ? parts.join(" ") : null;
}

/** The line a category chart carries about where its counts come from. */
export function basisLine(basis: CountBasis): string {
  return basis.from === "stored"
    ? `Counted over all ${n(basis.records)} records of this version as published.`
    : `Counted over all ${n(basis.records)} records of this version.`;
}
