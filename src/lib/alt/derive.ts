// Derived alt-data measures: trends by period, size against the company's own scale, recency, and
// the two unusual-change rules. Pure; every figure keeps the rows (and so the source URLs) it was
// computed from. What a stored history can support is decided in `history.ts`, not here.
import { addDays, daysBetween, inProgress } from "@/lib/alt/history";
import type { PeriodMeta } from "@/lib/alt/periods";

export { addDays, daysBetween };

export interface DerivedRow {
  uid?: string;
  dataset?: string;
  date: string | null;
  value: number | null;
  title?: string;
  unit?: string | null;
  // stored meta differs per dataset (same shape as AltRow.meta in query.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: PeriodMeta | Record<string, any> | null;
  source_url?: string | null;
}

/* ---------------- statistics ---------------- */

/** P(X ≥ k) for X ~ Binomial(n, p), summed in log space so large n does not underflow. */
export function binomialUpper(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const lp = Math.log(p);
  const lq = Math.log(1 - p);
  let logC = 0; // ln C(n, i)
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    if (i >= k) tail += Math.exp(logC + i * lp + (n - i) * lq);
  }
  return Math.min(1, tail);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/* ---------------- unusual-change rules ---------------- */

/**
 * The rule for counts of filings and records, per company and dataset, over 90-day windows that the
 * stored history holds whole (`wholeWindows` in history.ts; oldest first, the last is the latest).
 *
 * The company's own rate is not known, only estimated from a handful of windows, so the latest
 * window is tested exactly against them: if every window had the same rate, then given the total T
 * over all k + 1 windows the latest count is Binomial(T, 1/(k + 1)). A rise is flagged when
 *   - at least RISE_MIN_PRIOR earlier windows are whole (a year),
 *   - the latest window holds at least RISE_MIN_RECENT units,
 *   - it is above every earlier window (so one old burst is not beaten by an ordinary quarter) and
 *     at least twice their mean, and
 *   - P(X ≥ latest | T) < RISE_ALPHA.
 * Falls are never flagged: no row records when its company was last collected, so a fall cannot be
 * told from a pause in collection or a publication delay.
 */
export const RISE_ALPHA = 0.001;
export const RISE_MIN_PRIOR = 4;
export const RISE_MIN_RECENT = 3;

export interface RiseVerdict {
  status: "rise" | "normal" | "short";
  recent: number;
  /** mean units per window before the latest */
  mean: number;
  /** the busiest earlier window */
  max: number;
  /** earlier windows used */
  prior: number;
  /** P(X ≥ recent) given the total over all windows, under one common rate */
  p: number;
}

export function riseVerdict(counts: number[]): RiseVerdict {
  const recent = counts[counts.length - 1] ?? 0;
  const prior = counts.slice(0, -1);
  if (prior.length < RISE_MIN_PRIOR) return { status: "short", recent, mean: 0, max: 0, prior: prior.length, p: 1 };
  const sum = prior.reduce((a, b) => a + b, 0);
  const mean = sum / prior.length;
  const max = Math.max(...prior);
  const p = binomialUpper(recent, sum + recent, 1 / (prior.length + 1));
  const rise = recent >= RISE_MIN_RECENT && recent > max && recent >= 2 * mean && p < RISE_ALPHA;
  return { status: rise ? "rise" : "normal", recent, mean, max, prior: prior.length, p };
}

/** "p < 0.0001" or "p = 0.0004": never more precision than the test has. */
export function pLabel(p: number): string {
  return p < 0.0001 ? "p < 0.0001" : `p = ${p.toFixed(4)}`;
}

export interface Reading {
  date: string;
  value: number;
}

export interface RangeVerdict<R extends Reading> {
  status: "above" | "below" | "normal" | "short";
  latest: R | null;
  /** the earlier readings compared against */
  prior: R[];
  /** the highest and lowest of them */
  hi: R | null;
  lo: R | null;
  /** latest ÷ highest (above) or lowest ÷ latest (below); Infinity when the divisor is not positive */
  ratio: number;
}

/**
 * The rule for series (`RangeRule` in history.ts): the latest reading against the range of the
 * earlier readings dated within `days` before it. Above: at least `factor` times the highest of
 * them, at least `minBeyond` beyond it and at least `minLatest`. Below (two-sided rules): no more
 * than the lowest divided by `factor`. It runs only with `minPrior` earlier readings, and only when
 * their median is at least `minLevel`. Readings must be finished periods, oldest first.
 */
export function rangeVerdict<R extends Reading>(readings: R[], rule: { days: number; minPrior: number; factor: number; minBeyond?: number; minLatest?: number; minLevel?: number; sides: "up" | "both" }): RangeVerdict<R> {
  const latest = readings[readings.length - 1] ?? null;
  const none = { latest, prior: [] as R[], hi: null, lo: null, ratio: 1 };
  if (!latest) return { ...none, status: "short" };
  const from = addDays(latest.date, -rule.days);
  const prior = readings.filter((r) => r.date >= from && r.date < latest.date);
  if (prior.length < rule.minPrior) return { ...none, prior, status: "short" };
  const hi = prior.reduce((a, r) => (r.value > a.value ? r : a));
  const lo = prior.reduce((a, r) => (r.value < a.value ? r : a));
  const out = { latest, prior, hi, lo };
  if (rule.minLevel != null && median(prior.map((r) => r.value)) < rule.minLevel) return { ...out, ratio: 1, status: "normal" };
  const beyond = rule.minBeyond ?? 0;
  const v = latest.value;
  if (v > hi.value && v >= rule.factor * hi.value && v - hi.value >= beyond && v >= (rule.minLatest ?? -Infinity)) return { ...out, ratio: hi.value > 0 ? v / hi.value : Infinity, status: "above" };
  if (rule.sides === "both" && lo.value > 0 && v < lo.value && v <= lo.value / rule.factor && lo.value - v >= beyond) return { ...out, ratio: v > 0 ? lo.value / v : Infinity, status: "below" };
  return { ...out, ratio: 1, status: "normal" };
}

/**
 * Single quarters from a year-to-date annualised rate (FDIC's net charge-off rate): the first
 * quarter is its own reading, and quarter k is about k·Yk − (k − 1)·Yk−1, which needs the previous
 * quarter of the same year on file. An estimate (average loans move a little within a year), used
 * so that one large charge-off is seen in its own quarter instead of in every later reading of the
 * year. Each value keeps the readings it was derived from.
 */
export function quarterOnly<R extends { date: string | null; value: number | null }>(rows: R[]): { date: string; value: number; from: R[] }[] {
  const dated = rows.filter((r) => r.date && r.value != null).sort((a, b) => a.date!.localeCompare(b.date!));
  const by = new Map(dated.map((r) => [r.date!.slice(0, 7), r]));
  const out: { date: string; value: number; from: R[] }[] = [];
  for (const r of dated) {
    const month = Number(r.date!.slice(5, 7));
    if (month % 3 !== 0) continue;
    const k = month / 3;
    if (k === 1) {
      out.push({ date: r.date!, value: r.value!, from: [r] });
      continue;
    }
    const prev = by.get(`${r.date!.slice(0, 4)}-${String(month - 3).padStart(2, "0")}`);
    if (prev) out.push({ date: r.date!, value: k * r.value! - (k - 1) * prev.value!, from: [r, prev] });
  }
  return out;
}

/* ---------------- trends, recency ---------------- */

export interface PeriodChange<T> {
  latest: T;
  /** the reading about a year earlier (same quarter, month or fiscal year) */
  prior: T | null;
  change: number | null;
  /** readings whose period is still running or not settled, oldest first (shown apart, never compared) */
  partials: T[];
}

/** Latest finished reading against the one a year earlier; readings in progress are kept apart. */
export function yearOnYear<T extends DerivedRow>(rows: T[], today: string): PeriodChange<T> | null {
  const dated = rows.filter((r) => r.date && r.value != null).sort((a, b) => a.date!.localeCompare(b.date!));
  const full = dated.filter((r) => !inProgress(r as never, today));
  const latest = full[full.length - 1];
  if (!latest) return null;
  const target = addDays(latest.date!, -365);
  const prior = full.filter((r) => Math.abs(daysBetween(r.date!, target)) <= 20).pop() ?? null;
  // partial readings that belong after the latest finished one (a later period, or a year to date)
  const partials = dated.filter((r) => inProgress(r as never, today) && (r.date! > latest.date! || !!(r.meta as PeriodMeta | null)?.ytd || !!(r.meta as PeriodMeta | null)?.fiscal_year));
  const change = prior?.value ? (latest.value! - prior.value) / Math.abs(prior.value) : null;
  return { latest, prior, change, partials };
}

/** Sum of the latest 12 finished monthly readings against the 12 before (needs at least 11 of each). */
export function trailingTwelveMonths<T extends DerivedRow>(rows: T[], today: string) {
  const full = rows.filter((r) => r.date && r.value != null && r.date <= today && !inProgress(r as never, today)).sort((a, b) => a.date!.localeCompare(b.date!));
  const now = full.slice(-12);
  const before = full.slice(-24, -12);
  if (now.length < 11) return null;
  const sum = (xs: T[]) => xs.reduce((a, r) => a + r.value!, 0);
  const s = sum(now);
  const p = before.length >= 11 ? sum(before) : null;
  return { sum: s, prior: p, change: p ? s / p - 1 : null, from: now[0].date!, to: now[now.length - 1].date!, rows: now };
}

/** Days since the newest record dated on or before today. */
export function recency(rows: DerivedRow[], today: string): { latest: string | null; days: number | null } {
  let latest: string | null = null;
  for (const r of rows) if (r.date && r.date <= today && (!latest || r.date > latest)) latest = r.date;
  return { latest, days: latest ? daysBetween(latest, today) : null };
}

/* ---------------- the company's own scale ---------------- */

export interface RevenuePoint {
  value: number;
  end: string;
  accn?: string;
  concept?: string;
}

/** The company's annual revenue for the fiscal year ending nearest `periodEnd` (within 200 days). */
export function revenueNear(points: RevenuePoint[], periodEnd: string): RevenuePoint | null {
  let best: RevenuePoint | null = null;
  for (const p of points) {
    if (!(p.value > 0)) continue;
    const d = Math.abs(daysBetween(p.end, periodEnd));
    if (d <= 200 && (!best || d < Math.abs(daysBetween(best.end, periodEnd)))) best = p;
  }
  return best;
}

/** Revenue points from a company dataset's annual income statement (each keeps its filing). */
export function revenuePoints(income: { periods: { end: string }[]; rows: { key: string; cells: ({ v: number | null; src?: { accn?: string; concept?: string; end?: string } } | null)[] }[] } | null | undefined): RevenuePoint[] {
  const row = income?.rows.find((r) => r.key === "revenue");
  if (!income || !row) return [];
  return row.cells.flatMap((c, i) => (c && c.v != null && income.periods[i] ? [{ value: c.v, end: c.src?.end ?? income.periods[i].end, accn: c.src?.accn, concept: c.src?.concept }] : []));
}
