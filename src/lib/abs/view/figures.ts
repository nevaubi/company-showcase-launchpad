// Reading stored figures and deriving the few the page computes. A derived share always carries its
// numerator, its denominator and the filing both come from; nothing here adds across filings or deals.
import { DUE_UNSTATED } from "./codes";
import type { FigureRow, Share, Stored } from "./types";

/** The number a stored value spells, or null when the file states none. */
export function num(text: string | number | null | undefined): number | null {
  if (text == null || text === "") return null;
  const v = typeof text === "number" ? text : Number(text);
  return Number.isFinite(v) ? v : null;
}

/** One stored figure with what it rests on. */
export type Figure = {
  /** the value as stored (text of the numeric column) */
  text: string | null;
  value: number | null;
  /** records that contributed */
  n: number;
  /** records left out because the field is blank or unreadable */
  missing: number;
};

export const figure = (s: Stored | undefined | null): Figure | null =>
  s ? { text: s[0], value: num(s[0]), n: s[1], missing: s[2] } : null;

/** Figures of one filing keyed by metric, from rows of one dim. */
export function byMetric(rows: readonly FigureRow[], dim = "", bucket = ""): Record<string, Figure> {
  const out: Record<string, Figure> = {};
  for (const r of rows)
    if (r[1] === dim && r[2] === bucket)
      out[r[0]] = { text: r[3], value: num(r[3]), n: r[4], missing: r[5] };
  return out;
}

/** The split of one metric by one dim: bucket to figure. */
export function splitOf(
  rows: readonly FigureRow[],
  metric: string,
  dim: string,
): Record<string, Figure> {
  const out: Record<string, Figure> = {};
  for (const r of rows)
    if (r[0] === metric && r[1] === dim)
      out[r[2]] = { text: r[3], value: num(r[3]), n: r[4], missing: r[5] };
  return out;
}

type SplitValues = Record<string, string | number | null | Stored | Figure>;

const valueOf = (x: SplitValues[string]): number | null =>
  x == null
    ? null
    : Array.isArray(x)
      ? num(x[0])
      : typeof x === "object"
        ? x.value
        : num(x);

/**
 * The share of the end amount that sits in `buckets`: the sum of those buckets over the end amount of
 * the whole file. A bucket the split does not hold adds nothing (no record fell in it). The share is
 * null, not zero, when the file gives no denominator above zero, when it stores no split at all, or
 * when no record of it states a status (every bucket is one of `unstated`).
 */
export function shareOf(
  split: SplitValues,
  denominator: string | number | null | undefined,
  buckets: readonly string[],
  accession: string,
  unstated: readonly string[] = DUE_UNSTATED,
): Share {
  const keys = Object.keys(split);
  const den = num(denominator);
  const stated = keys.some((k) => !unstated.includes(k));
  let numerator: number | null = null;
  if (stated) {
    numerator = 0;
    for (const b of buckets) numerator += valueOf(split[b]) ?? 0;
  }
  const value = numerator != null && den != null && den > 0 ? numerator / den : null;
  return { value, numerator, denominator: den, buckets: buckets.filter((b) => b in split), accession };
}

/** Amount of the end amount whose records state no status, and its share of the end amount. */
export function unstatedOf(
  split: SplitValues,
  denominator: string | number | null | undefined,
  unstated: readonly string[] = DUE_UNSTATED,
): { amount: number; share: number | null } {
  let amount = 0;
  for (const b of unstated) amount += valueOf(split[b]) ?? 0;
  const den = num(denominator);
  return { amount, share: den != null && den > 0 ? amount / den : null };
}

/** Days from one calendar date to another (b minus a); null when either is not a date. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86_400_000) : null;
}
