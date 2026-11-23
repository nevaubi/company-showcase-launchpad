// Derived alt-data measures: trends by period, size against the company's own scale, recency, and
// unusual-change detection against the company's own history. Pure; every figure keeps the rows
// (and so the source URLs) it was computed from.
import { isPartial, type PeriodMeta } from "@/lib/alt/periods";

export interface DerivedRow {
  uid?: string;
  date: string | null;
  value: number | null;
  title?: string;
  unit?: string | null;
  meta?: PeriodMeta | Record<string, any> | null;
  source_url?: string | null;
}

const DAY = 864e5;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY);

/* ---------------- statistics ---------------- */

/** P(X ≥ k) for X ~ Poisson(λ). */
export function poissonUpper(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

/** P(X ≤ k) for X ~ Poisson(λ). */
export function poissonLower(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.min(1, cdf);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/* ---------------- unusual-change rules ---------------- */

/**
 * The rule for event counts (8-K items, 13D/G filings, recalls, Federal Register notices...), per
 * company and dataset, in 90-day windows (oldest first, the last one is the latest 90 days).
 *
 * History starts at the company's first window with any record, so a source that only began
 * covering a company recently (nothing on file before) is "new", never "unusual". At least
 * EVENT_MIN_PRIOR earlier windows are required. A rise is flagged when the latest window has at
 * least 3 records, at least twice the prior mean λ, a Poisson tail P(X ≥ n | λ) below EVENT_P and
 * a z-score of at least 3 against the prior spread (floored at √λ and 1, so a lumpy history is not
 * mistaken for a quiet one). A fall is flagged when λ ≥ 4 and P(X ≤ n | λ) < EVENT_P.
 */
export const EVENT_P = 0.005;
export const EVENT_MIN_PRIOR = 4;

export type UnusualStatus = "spike" | "drop" | "normal" | "short" | "new";

export interface CountVerdict {
  status: UnusualStatus;
  recent: number;
  /** mean records per window before the latest */
  baseline: number;
  /** windows of history used */
  prior: number;
  /** tail probability of a count this extreme under the company's own rate */
  p: number;
  z: number;
}

export function countVerdict(history: number[], opts: { maxPrior?: number; minPrior?: number } = {}): CountVerdict {
  const recent = history[history.length - 1] ?? 0;
  const first = history.findIndex((n) => n > 0);
  let prior = first < 0 || first === history.length - 1 ? [] : history.slice(first, -1);
  if (opts.maxPrior) prior = prior.slice(-opts.maxPrior);
  const base = { recent, baseline: 0, prior: prior.length, p: 1, z: 0 };
  if (first === history.length - 1 && recent > 0) return { ...base, status: "new" };
  if (prior.length < (opts.minPrior ?? EVENT_MIN_PRIOR)) return { ...base, status: "short" };
  const lambda = prior.reduce((a, b) => a + b, 0) / prior.length;
  const sd = Math.sqrt(prior.reduce((a, b) => a + (b - lambda) ** 2, 0) / prior.length);
  const z = (recent - lambda) / Math.max(sd, Math.sqrt(lambda), 1);
  const up = poissonUpper(recent, lambda);
  const down = poissonLower(recent, lambda);
  const out = { ...base, baseline: lambda };
  if (recent >= 3 && recent >= 2 * lambda && up < EVENT_P && z >= 3) return { ...out, status: "spike", p: up, z };
  if (lambda >= 4 && down < EVENT_P) return { ...out, status: "drop", p: down, z };
  return { ...out, status: "normal", p: Math.min(up, down), z };
}

/**
 * The rule for series (monthly pageviews, half-monthly fails to deliver, quarterly bank ratios):
 * Iglewicz–Hoaglin modified z-score of the latest reading against the previous `window` readings,
 * M = 0.6745·(x − median)/MAD, flagged when |M| ≥ SERIES_Z. Skewed money and count series are
 * compared on a log scale (log1p), rates on their own scale. The MAD is floored (`floor`) so a
 * perfectly flat history does not turn a rounding change into a flag. At least SERIES_MIN_PRIOR
 * earlier readings are required.
 */
export const SERIES_Z = 3.5;
export const SERIES_MIN_PRIOR = 8;

export interface SeriesVerdict {
  status: "spike" | "drop" | "normal" | "short";
  latest: number;
  median: number;
  z: number;
  prior: number;
}

export function seriesVerdict(values: number[], opts: { log?: boolean; window?: number; floor?: number; minPrior?: number } = {}): SeriesVerdict {
  const latest = values[values.length - 1];
  const prior = values.slice(0, -1).slice(-(opts.window ?? 12));
  const med = prior.length ? median(prior) : NaN;
  if (latest == null || prior.length < (opts.minPrior ?? SERIES_MIN_PRIOR)) return { status: "short", latest, median: med, z: 0, prior: prior.length };
  const f = (x: number) => (opts.log ? Math.log1p(Math.max(0, x)) : x);
  const xs = prior.map(f);
  const m = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - m)));
  const z = (0.6745 * (f(latest) - m)) / Math.max(mad, opts.floor ?? (opts.log ? 0.05 : 1e-9));
  return { status: z >= SERIES_Z ? "spike" : z <= -SERIES_Z ? "drop" : "normal", latest, median: med, z, prior: prior.length };
}

/* ---------------- windows, trends, recency ---------------- */

/** Records per 90-day window back from `today` (oldest first; the last is the latest 90 days). */
export function eventWindows(dates: (string | null)[], today: string, windows = 9, days = 90): number[] {
  const h = Array(windows).fill(0) as number[];
  for (const d of dates) {
    if (!d) continue;
    const age = daysBetween(d, today);
    if (age < 0) continue;
    const b = Math.floor(age / days);
    if (b < windows) h[windows - 1 - b]++;
  }
  return h;
}

export interface Trailing<T> {
  /** last 365 days */
  now: T[];
  /** the 365 days before */
  before: T[];
  count: number;
  prevCount: number;
  sum: number;
  prevSum: number;
  /** count change vs the year before; null without anything a year before */
  change: number | null;
}

/** Records and their values in the trailing twelve months and the twelve before. */
export function trailingYear<T extends DerivedRow>(rows: T[], today: string): Trailing<T> {
  const y1 = addDays(today, -365);
  const y2 = addDays(today, -730);
  const now = rows.filter((r) => r.date && r.date > y1 && r.date <= today);
  const before = rows.filter((r) => r.date && r.date > y2 && r.date <= y1);
  const s = (xs: T[]) => xs.reduce((a, r) => a + (r.value ?? 0), 0);
  return { now, before, count: now.length, prevCount: before.length, sum: s(now), prevSum: s(before), change: before.length ? now.length / before.length - 1 : null };
}

export interface PeriodChange<T> {
  latest: T;
  /** the reading about a year earlier (same quarter, month or fiscal year) */
  prior: T | null;
  change: number | null;
  /** the newest reading when it covers only part of its period (shown apart, never compared) */
  partial: T | null;
}

/** Latest full-period reading against the one a year earlier; partial periods are kept apart. */
export function yearOnYear<T extends DerivedRow>(rows: T[], today: string): PeriodChange<T> | null {
  const dated = rows.filter((r) => r.date && r.value != null).sort((a, b) => a.date!.localeCompare(b.date!));
  const full = dated.filter((r) => !isPartial(r as never, today));
  const partials = dated.filter((r) => isPartial(r as never, today));
  const latest = full[full.length - 1];
  if (!latest) return null;
  const target = addDays(latest.date!, -365);
  const prior = full.filter((r) => Math.abs(daysBetween(r.date!, target)) <= 20).pop() ?? null;
  const partial = partials.filter((r) => r.date! > latest.date! || (r.meta as PeriodMeta | null)?.ytd).pop() ?? null;
  const change = prior?.value ? (latest.value! - prior.value) / Math.abs(prior.value) : null;
  return { latest, prior, change, partial };
}

/** Sum of the latest 12 monthly readings against the 12 before (needs at least 11 of each). */
export function trailingTwelveMonths<T extends DerivedRow>(rows: T[], today: string) {
  const full = rows.filter((r) => r.date && r.value != null && r.date <= today).sort((a, b) => a.date!.localeCompare(b.date!));
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
