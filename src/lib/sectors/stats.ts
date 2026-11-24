// Small, pure statistics for the sector pages: medians and quartiles that skip missing values, breadth
// shares that say how many members they rest on, competition ranks with ties, and a group's distribution
// on one metric. No browser or Node APIs, so the pages, the tests and a script can share them.

export type Num = number | null | undefined;

const finite = (v: Num): v is number => typeof v === "number" && Number.isFinite(v);

/** The finite values, sorted ascending. */
export function sortedValues(xs: readonly Num[]): number[] {
  return xs.filter(finite).sort((a, b) => a - b);
}

/** Quantile of an ascending array by linear interpolation between closest ranks (Excel PERCENTILE.INC, R type 7). */
export function quantileSorted(s: readonly number[], p: number): number | null {
  if (!s.length) return null;
  const h = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

/** Median of the finite values; null when there are none. */
export function median(xs: readonly Num[]): number | null {
  return quantileSorted(sortedValues(xs), 0.5);
}

/** Median over values above zero only (multiples such as P/E mean nothing on a loss). */
export function positiveMedian(xs: readonly Num[]): number | null {
  return median(xs.filter((v) => finite(v) && v > 0));
}

export interface Share {
  /** Share of known members for which the flag holds, 0 to 1; null when no member is known. */
  share: number | null;
  /** Members for which the flag holds. */
  hits: number;
  /** Members with a known flag. */
  known: number;
  /** All members asked about. */
  total: number;
  /** Fewer than `minKnown` known members: show the count, not a percentage that looks precise. */
  thin: boolean;
}

/** Breadth: the share of members for which a flag holds, over the members whose flag is known. */
export function shareOf(flags: readonly (boolean | null | undefined)[], minKnown = 5): Share {
  let hits = 0;
  let known = 0;
  for (const f of flags) {
    if (f == null) continue;
    known++;
    if (f) hits++;
  }
  return { share: known ? hits / known : null, hits, known, total: flags.length, thin: known < minKnown };
}

/** Competition ranks ("1224"), highest value first unless `ascending`; missing values get no rank. */
export function ranks(xs: readonly Num[], ascending = false): (number | null)[] {
  const order = xs
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => finite(x.v))
    .sort((a, b) => (ascending ? a.v - b.v : b.v - a.v));
  const out: (number | null)[] = xs.map(() => null);
  order.forEach((x, k) => {
    out[x.i] = k > 0 && order[k - 1].v === x.v ? out[order[k - 1].i] : k + 1;
  });
  return out;
}

/** Percentile rank in 0..1 (share of the other values below, ties counted half); null for a missing value or a group of one. */
export function percentileRanks(xs: readonly Num[]): (number | null)[] {
  const s = sortedValues(xs);
  if (s.length < 2) return xs.map(() => null);
  return xs.map((v) => {
    if (!finite(v)) return null;
    let below = 0;
    let equal = 0;
    for (const x of s) {
      if (x < v) below++;
      else if (x === v) equal++;
    }
    return (below + (equal - 1) / 2) / (s.length - 1);
  });
}

export interface DistPoint<T> {
  item: T;
  v: number;
  /** Percentile rank within the group, 0 lowest to 1 highest. */
  pct: number;
  /** Outside the plotted domain (the 2nd to 98th percentile, widened to the quartiles): drawn at the edge. */
  clipped: boolean;
}
export interface Distribution<T> {
  n: number;
  missing: number;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  /** Plotted range; extreme outliers are pinned to its edges so one value cannot squash the rest. */
  lo: number;
  hi: number;
  points: DistPoint<T>[];
}

/** A group's distribution on one metric, for a strip plot and the highest and lowest lists. */
export function distribution<T>(items: readonly T[], value: (t: T) => Num): Distribution<T> {
  const vals = items.map(value);
  const s = sortedValues(vals);
  const pr = percentileRanks(vals);
  const q = (p: number) => quantileSorted(s, p);
  const q1 = q(0.25);
  const q3 = q(0.75);
  let lo = s.length > 20 ? (q(0.02) ?? 0) : (s[0] ?? 0);
  let hi = s.length > 20 ? (q(0.98) ?? 0) : (s[s.length - 1] ?? 0);
  if (q1 != null && q1 < lo) lo = q1;
  if (q3 != null && q3 > hi) hi = q3;
  if (hi === lo) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const points: DistPoint<T>[] = [];
  items.forEach((item, i) => {
    const v = vals[i];
    if (!finite(v)) return;
    points.push({ item, v, pct: pr[i] ?? 0.5, clipped: v < lo || v > hi });
  });
  points.sort((a, b) => a.v - b.v);
  return {
    n: s.length,
    missing: items.length - s.length,
    min: s[0] ?? null,
    q1,
    median: q(0.5),
    q3,
    max: s[s.length - 1] ?? null,
    lo,
    hi,
    points,
  };
}

export type SortDir = "asc" | "desc";

/** Comparator that keeps missing values last in either direction. */
export function compareNullable(a: Num | string, b: Num | string, dir: SortDir): number {
  const am = a == null || (typeof a === "number" && !Number.isFinite(a));
  const bm = b == null || (typeof b === "number" && !Number.isFinite(b));
  if (am && bm) return 0;
  if (am) return 1;
  if (bm) return -1;
  const c = typeof a === "string" || typeof b === "string" ? String(a).localeCompare(String(b)) : (a as number) - (b as number);
  return dir === "asc" ? c : -c;
}

/** Sort a copy by a key, missing values last, ties broken by a stable secondary key. */
export function sortBy<T>(rows: readonly T[], key: (r: T) => Num | string, dir: SortDir, tie: (r: T) => string): T[] {
  return [...rows].sort((a, b) => compareNullable(key(a), key(b), dir) || tie(a).localeCompare(tie(b)));
}
