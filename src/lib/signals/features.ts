// Point-in-time price features on a common trading calendar. Every value at index i uses bars <= i only.
import type { Bar } from "../financials/types";
import type { EventFeatures } from "./events";

/** Daily OHLCV aligned to `dates`, split/dividend adjusted via the adjusted close; internal gaps forward-filled. */
export interface Aligned {
  start: number; // first valid index (-1 when the ticker has no bars in range)
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
}

export function align(dates: string[], bars: Bar[]): Aligned {
  const n = dates.length;
  const o = new Float64Array(n).fill(NaN), h = new Float64Array(n).fill(NaN), l = new Float64Array(n).fill(NaN), c = new Float64Array(n).fill(NaN), v = new Float64Array(n);
  const pos = new Map(dates.map((d, i) => [d, i]));
  for (const b of bars) {
    const i = pos.get(b[0].slice(0, 10));
    if (i == null || !(b[4] > 0) || !(b[5] > 0)) continue;
    const k = b[5] / b[4];
    o[i] = (b[1] > 0 ? b[1] : b[4]) * k;
    h[i] = (b[2] > 0 ? b[2] : b[4]) * k;
    l[i] = (b[3] > 0 ? b[3] : b[4]) * k;
    c[i] = b[5];
    v[i] = b[6] || 0;
  }
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(c[i])) {
      if (start >= 0) {
        // Missing day inside the series: flat bar at the previous close, zero volume.
        o[i] = h[i] = l[i] = c[i] = c[i - 1];
        v[i] = 0;
      }
    } else if (start < 0) start = i;
  }
  return { start, o, h, l, c, v };
}

export function rollMean(x: ArrayLike<number>, n: number, from: number) {
  const out = new Float64Array(x.length).fill(NaN);
  let s = 0;
  for (let i = from; i < x.length; i++) {
    s += x[i];
    if (i - n >= from) s -= x[i - n];
    if (i - from + 1 >= n) out[i] = s / n;
  }
  return out;
}

export function rollStd(x: ArrayLike<number>, n: number, from: number) {
  const out = new Float64Array(x.length).fill(NaN);
  let s = 0, s2 = 0;
  for (let i = from; i < x.length; i++) {
    s += x[i];
    s2 += x[i] * x[i];
    if (i - n >= from) {
      s -= x[i - n];
      s2 -= x[i - n] * x[i - n];
    }
    if (i - from + 1 >= n) out[i] = Math.sqrt(Math.max((s2 - (s * s) / n) / (n - 1), 0));
  }
  return out;
}

/** Rolling extreme over the window ending at i (inclusive) via a monotonic deque. */
export function rollExtreme(x: ArrayLike<number>, n: number, from: number, max: boolean) {
  const out = new Float64Array(x.length).fill(NaN);
  const dq: number[] = [];
  let head = 0;
  for (let i = from; i < x.length; i++) {
    while (dq.length > head && (max ? x[dq[dq.length - 1]] <= x[i] : x[dq[dq.length - 1]] >= x[i])) dq.pop();
    dq.push(i);
    while (dq[head] <= i - n) head++;
    if (i - from + 1 >= n) out[i] = x[dq[head]];
  }
  return out;
}

export interface Features {
  a: Aligned;
  r1: Float64Array;
  vol20: Float64Array;
  vol60: Float64Array;
  sma20: Float64Array;
  sd20: Float64Array;
  sma200: Float64Array;
  rsi2: Float64Array;
  atr14: Float64Array;
  avgV50: Float64Array; // previous 50 days, excluding today
  max252: Float64Array;
  bbw: Float64Array;
  bbwMin125: Float64Array; // previous 125 days, excluding today
  dv20: Float64Array; // average daily dollar volume
  resid: Float64Array; // daily return net of beta x sector ETF return
  residSd60: Float64Array;
  /** Earnings, insider and short-selling features (absent when the scan has no event data). */
  ev?: EventFeatures;
  /** Market context on the same calendar: VIX close and VIX / VIX3M (term structure; above 1 = inverted). */
  mk?: { vix: ArrayLike<number>; vixRatio: ArrayLike<number> };
  /** Supply-chain: customers' 21-day return net of SPY, in standard deviations (NaN when no linked customers). */
  cust?: Float64Array;
}

/** `bench` is the sector ETF (or SPY) adjusted close on the same calendar. */
export function features(a: Aligned, bench: Float64Array): Features {
  const n = a.c.length;
  const s = Math.max(a.start, 0);
  const r1 = new Float64Array(n);
  for (let i = s + 1; i < n; i++) r1[i] = a.c[i] / a.c[i - 1] - 1;
  const from = s + 1;
  const vol20 = rollStd(r1, 20, from);
  const vol60 = rollStd(r1, 60, from);
  const sma20 = rollMean(a.c, 20, s);
  const sd20 = rollStd(a.c, 20, s);
  const sma200 = rollMean(a.c, 200, s);
  // Wilder RSI(2)
  const rsi2 = new Float64Array(n).fill(NaN);
  let ag = 0, al = 0;
  for (let i = from; i < n; i++) {
    const d = a.c[i] - a.c[i - 1];
    const g = Math.max(d, 0), lo = Math.max(-d, 0);
    if (i - from < 2) {
      ag += g / 2;
      al += lo / 2;
    } else {
      ag = (ag * 1 + g) / 2;
      al = (al * 1 + lo) / 2;
    }
    if (i - from >= 1) rsi2[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  const tr = new Float64Array(n);
  for (let i = from; i < n; i++) tr[i] = Math.max(a.h[i] - a.l[i], Math.abs(a.h[i] - a.c[i - 1]), Math.abs(a.l[i] - a.c[i - 1]));
  const atr14 = rollMean(tr, 14, from);
  const avg50 = rollMean(a.v, 50, s);
  const avgV50 = new Float64Array(n).fill(NaN);
  for (let i = s + 1; i < n; i++) avgV50[i] = avg50[i - 1];
  const max252 = rollExtreme(a.c, 252, s, true);
  const bbw = new Float64Array(n).fill(NaN);
  for (let i = s; i < n; i++) bbw[i] = (4 * sd20[i]) / sma20[i];
  const bbStart = s + 19;
  const min125 = rollExtreme(bbw, 125, Math.min(bbStart, n), false);
  const bbwMin125 = new Float64Array(n).fill(NaN);
  for (let i = bbStart + 1; i < n; i++) bbwMin125[i] = min125[i - 1];
  const dv = new Float64Array(n);
  for (let i = s; i < n; i++) dv[i] = a.c[i] * a.v[i];
  const dv20 = rollMean(dv, 20, s);
  // Rolling 60-day beta to the benchmark, applied from the previous day (point-in-time).
  const br = new Float64Array(n);
  for (let i = 1; i < n; i++) br[i] = bench[i] / bench[i - 1] - 1 || 0;
  const resid = new Float64Array(n);
  let sx = 0, sy = 0, sxy = 0, sxx = 0, cnt = 0, beta = 1;
  for (let i = from; i < n; i++) {
    resid[i] = r1[i] - beta * br[i];
    sx += br[i]; sy += r1[i]; sxy += br[i] * r1[i]; sxx += br[i] * br[i]; cnt++;
    if (cnt > 60) {
      const j = i - 60;
      sx -= br[j]; sy -= r1[j]; sxy -= br[j] * r1[j]; sxx -= br[j] * br[j]; cnt--;
    }
    if (cnt === 60) {
      const vx = sxx - (sx * sx) / 60;
      if (vx > 0) beta = (sxy - (sx * sy) / 60) / vx;
    }
  }
  const residSd60 = rollStd(resid, 60, from + 60);
  return { a, r1, vol20, vol60, sma20, sd20, sma200, rsi2, atr14, avgV50, max252, bbw, bbwMin125, dv20, resid, residSd60 };
}

/** Annual stock-borrow fee charged on short trades (general-collateral names). */
export const BORROW_FEE = 0.03;

/** Total cost of a trade: round trip plus borrow for shorts held `h` trading days. */
export const tradeCost = (roundTrip: number, side: 1 | -1, h: number) => roundTrip + (side < 0 ? (BORROW_FEE * h) / 252 : 0);

/** Round-trip trading cost (fraction) from average daily dollar volume; null below the liquidity floor. */
export function roundTripCost(dv20: number): number | null {
  if (!(dv20 >= 5e6)) return null;
  if (dv20 >= 5e8) return 0.0004;
  if (dv20 >= 1e8) return 0.0008;
  if (dv20 >= 2e7) return 0.0016;
  return 0.003;
}
