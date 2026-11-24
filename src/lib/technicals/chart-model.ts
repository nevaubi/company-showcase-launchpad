// Geometry and labelling for the price chart, kept apart from drawing so it can be tested: which bars share
// a candle when there are more bars than pixels, where the axis ticks go and what they say, how price tags
// are kept from overlapping. Bars are [date, open, high, low, close, adjusted close, volume].
import type { Bar } from "@/lib/financials/types";

export type Grain = "bar" | "week" | "month" | "quarter";
export const GRAIN_LABEL: Record<Grain, string> = {
  bar: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
};

export interface Bucket {
  /** First and last source bar (indices into the full series) */
  i0: number;
  i1: number;
  /** Date of the first and last source bar */
  t0: string;
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const isIntraday = (t: string) => t.length > 10;
const utc = (t: string) => Date.parse(isIntraday(t) ? t : `${t}T00:00:00Z`);

/** Monday of the bar's week, as an ISO date. */
export function weekKey(t: string): string {
  const ms = utc(t);
  const dow = new Date(ms).getUTCDay();
  return new Date(ms - ((dow + 6) % 7) * 864e5).toISOString().slice(0, 10);
}
const quarterKey = (t: string) => `${t.slice(0, 4)}Q${Math.floor((+t.slice(5, 7) - 1) / 3) + 1}`;
const keyOf = (t: string, g: Grain) => (g === "week" ? weekKey(t) : g === "month" ? t.slice(0, 7) : quarterKey(t));

/**
 * The finest candle grain that leaves each candle at least `minSlot` pixels: daily bars first, then weeks,
 * months and quarters (5, 21 and 63 sessions a candle on average). Intraday bars are never merged.
 */
export function grainFor(count: number, plotWidth: number, minSlot = 3, intraday = false): Grain {
  if (intraday || count * minSlot <= plotWidth) return "bar";
  if ((count / 5) * minSlot <= plotWidth) return "week";
  if ((count / 21) * minSlot <= plotWidth) return "month";
  return "quarter";
}

/** Merge bars from..to (inclusive) into candles of the given grain: first open, highest high, lowest low, last close, summed volume. */
export function bucketize(rows: Bar[], from: number, to: number, grain: Grain): Bucket[] {
  const out: Bucket[] = [];
  let key = "";
  for (let i = Math.max(0, from); i <= Math.min(rows.length - 1, to); i++) {
    const b = rows[i];
    const k = grain === "bar" ? String(i) : keyOf(b[0], grain);
    const cur = out[out.length - 1];
    if (cur && k === key) {
      cur.i1 = i;
      cur.t = b[0];
      if (b[2] > cur.h) cur.h = b[2];
      if (b[3] < cur.l) cur.l = b[3];
      cur.c = b[4];
      cur.v += b[6] || 0;
    } else {
      key = k;
      out.push({ i0: i, i1: i, t0: b[0], t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[6] || 0 });
    }
  }
  return out;
}

/** Round tick values inside [lo, hi] with steps of 1, 2, 2.5 or 5 times a power of ten. */
export function linearTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return Number.isFinite(lo) ? [lo] : [];
  const raw = (hi - lo) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Ticks for a log scale: 1, 2, 5 times powers of ten, thinned to about `count`; falls back to linear ticks on a narrow range. */
export function logTicks(lo: number, hi: number, count: number): number[] {
  if (!(lo > 0) || !(hi > lo)) return [];
  if (hi / lo < 2.5) return linearTicks(lo, hi, count);
  const all: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 1.5, 2, 3, 5, 7]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) all.push(Number(v.toPrecision(12)));
    }
  if (all.length <= count + 1) return all;
  // keep the rounder multipliers first
  for (const keep of [[1, 2, 5], [1, 3], [1]]) {
    const t = all.filter((v) => keep.includes(Number((v / 10 ** Math.floor(Math.log10(v) + 1e-9)).toPrecision(3))));
    if (t.length <= count + 1 && t.length >= 2) return t;
  }
  return all.filter((_, i) => i % Math.ceil(all.length / count) === 0);
}

/** Decimals an axis needs so neighbouring ticks read differently. */
export function tickDecimals(ticks: number[]): number {
  if (ticks.length < 2) return Math.abs(ticks[0] ?? 0) >= 100 ? 0 : 2;
  let step = Infinity;
  for (let i = 1; i < ticks.length; i++) step = Math.min(step, Math.abs(ticks[i] - ticks[i - 1]));
  return step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
}
export const fmtPriceTick = (v: number, d: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** A price with the precision a quote needs: two decimals from $1, four below. */
export const fmtQuote = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: v >= 1 ? 2 : 4, maximumFractionDigits: v >= 1 ? 2 : 4 });
export function fmtVolume(v: number): string {
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 20, 2026", or "Nov 20, 14:35" for an intraday bar (UTC as stored, shown as New York time by the caller's data). */
export function fmtBarDate(t: string): string {
  if (!isIntraday(t)) return `${MONTH[+t.slice(5, 7) - 1]} ${+t.slice(8, 10)}, ${t.slice(0, 4)}`;
  const d = new Date(t);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })}`;
}
/** Label of a merged candle: one date for a bar, "Nov 16 to 20, 2026" style ranges for longer ones. */
export function fmtBucket(b: Pick<Bucket, "t0" | "t">, grain: Grain): string {
  if (grain === "bar" || b.t0 === b.t) return fmtBarDate(b.t);
  if (grain === "month") return `${MONTH[+b.t.slice(5, 7) - 1]} ${b.t.slice(0, 4)}`;
  if (grain === "quarter") return `Q${Math.floor((+b.t.slice(5, 7) - 1) / 3) + 1} ${b.t.slice(0, 4)}`;
  const sameMonth = b.t0.slice(0, 7) === b.t.slice(0, 7);
  return `${MONTH[+b.t0.slice(5, 7) - 1]} ${+b.t0.slice(8, 10)} to ${sameMonth ? "" : `${MONTH[+b.t.slice(5, 7) - 1]} `}${+b.t.slice(8, 10)}, ${b.t.slice(0, 4)}`;
}

export interface TimeTick {
  /** Index of the candle the tick sits on */
  k: number;
  label: string;
  /** Year boundaries (and day boundaries intraday) are drawn stronger */
  major: boolean;
}

/**
 * Time-axis ticks at calendar boundaries, as fine as fits: days, weeks, months, quarters, years, then every
 * second or fifth year. `minGap` is the least distance in pixels between two labels.
 */
export function timeTicks(buckets: Pick<Bucket, "t0">[], plotWidth: number, minGap = 64): TimeTick[] {
  const n = buckets.length;
  if (!n) return [];
  const slot = plotWidth / n;
  const intraday = isIntraday(buckets[0].t0);
  const ny = (t: string, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", ...o });
  type Level = { key: (t: string) => string; label: (t: string) => string; major: (t: string) => boolean };
  const levels: Level[] = intraday
    ? [
        { key: (t) => ny(t, { month: "numeric", day: "numeric", hour: "2-digit", hour12: false }), label: (t) => ny(t, { hour: "2-digit", minute: "2-digit", hour12: false }), major: () => false },
        { key: (t) => ny(t, { month: "numeric", day: "numeric" }), label: (t) => ny(t, { month: "short", day: "numeric" }), major: () => true },
      ]
    : [
        { key: (t) => t, label: (t) => `${MONTH[+t.slice(5, 7) - 1]} ${+t.slice(8, 10)}`, major: () => false },
        { key: (t) => weekKey(t), label: (t) => `${MONTH[+t.slice(5, 7) - 1]} ${+t.slice(8, 10)}`, major: () => false },
        { key: (t) => t.slice(0, 7), label: (t) => (t.slice(5, 7) === "01" ? t.slice(0, 4) : MONTH[+t.slice(5, 7) - 1]), major: (t) => t.slice(5, 7) === "01" },
        { key: (t) => quarterKey(t), label: (t) => (t.slice(5, 7) <= "03" ? t.slice(0, 4) : MONTH[+t.slice(5, 7) - 1]), major: (t) => t.slice(5, 7) <= "03" },
        { key: (t) => t.slice(0, 4), label: (t) => t.slice(0, 4), major: () => true },
        { key: (t) => String(Math.floor(+t.slice(0, 4) / 2)), label: (t) => t.slice(0, 4), major: () => true },
        { key: (t) => String(Math.floor(+t.slice(0, 4) / 5)), label: (t) => t.slice(0, 4), major: () => true },
      ];
  let best: TimeTick[] = [];
  for (const L of levels) {
    const ticks: TimeTick[] = [];
    let prev = L.key(buckets[0].t0);
    for (let k = 1; k < n; k++) {
      const key = L.key(buckets[k].t0);
      if (key !== prev) {
        ticks.push({ k, label: L.label(buckets[k].t0), major: L.major(buckets[k].t0) });
        prev = key;
      }
    }
    best = ticks;
    let ok = true;
    for (let j = 1; j < ticks.length; j++)
      if ((ticks[j].k - ticks[j - 1].k) * slot < minGap) {
        ok = false;
        break;
      }
    if (ok) break;
  }
  // Never closer than minGap even at the coarsest level, and keep clear of the left edge.
  const out: TimeTick[] = [];
  for (const t of best) {
    const x = (t.k + 0.5) * slot;
    const last = out[out.length - 1];
    if (x < 18 || (last && x - (last.k + 0.5) * slot < minGap)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Move label positions apart so neighbours are at least `gap` pixels from each other, inside [lo, hi], while
 * staying as close as possible to where they belong. Returns positions in the input order.
 */
export function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const pos = order.map((i) => Math.min(hi, Math.max(lo, ys[i])));
  for (let k = 1; k < pos.length; k++) if (pos[k] - pos[k - 1] < gap) pos[k] = pos[k - 1] + gap;
  // if the stack ran past the bottom, push it back up
  const over = pos.length ? pos[pos.length - 1] - hi : 0;
  if (over > 0) {
    pos[pos.length - 1] = hi;
    for (let k = pos.length - 2; k >= 0; k--) if (pos[k + 1] - pos[k] < gap) pos[k] = pos[k + 1] - gap;
  }
  const out = new Array<number>(ys.length);
  order.forEach((i, k) => (out[i] = pos[k]));
  return out;
}

/** Decline from the running high of a series, as a fraction (0 at a new high). */
export function drawdownSeries(x: ArrayLike<number>): number[] {
  const out: number[] = [];
  let peak = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (x[i] > peak) peak = x[i];
    out.push(peak > 0 ? x[i] / peak - 1 : 0);
  }
  return out;
}

/** Index of the first bar on or after a date (bars ascending); bars.length when none. */
export function indexOnOrAfter(rows: Bar[], date: string): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0].slice(0, date.length) < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many trailing daily bars a range label covers, counted on the bars' own dates. */
export function barsInRange(rows: Bar[], range: "1mo" | "3mo" | "6mo" | "ytd" | "1y" | "2y" | "5y" | "10y" | "max"): number {
  const n = rows.length;
  if (!n || range === "max") return n;
  const last = rows[n - 1][0].slice(0, 10);
  let from: string;
  if (range === "ytd") from = `${last.slice(0, 4)}-01-01`;
  else {
    const months = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "2y": 24, "5y": 60, "10y": 120 }[range];
    const d = new Date(`${last}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    from = d.toISOString().slice(0, 10);
  }
  return Math.max(2, n - indexOnOrAfter(rows, from));
}
