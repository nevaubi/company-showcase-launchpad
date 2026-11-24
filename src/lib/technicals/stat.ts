// Statistics behind the Technicals page. Pure functions over plain arrays (no browser or Node APIs), so the
// page, its web worker and the tests run the same code. Every formula is written out where it is used and is
// checked in stat.test.ts against hand-computed or textbook values, and in verify/ against numpy.

export const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/* ---------- descriptive ---------- */
export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : NaN;
}
/** Sample standard deviation (n - 1). */
export function sd(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - m) ** 2;
  return Math.sqrt(s / (n - 1));
}
/** Linear-interpolated quantile of an ascending array (the same rule as ta.js and numpy's default). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function median(x: ArrayLike<number>): number {
  return quantileSorted(Float64Array.from(x as ArrayLike<number>).sort(), 0.5);
}

/* ---------- distributions ---------- */
/** ln Γ(x), Lanczos approximation (g = 7, n = 9); accurate to about 1e-14 for x > 0. */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/** Regularised incomplete beta function I_x(a, b), continued fraction (modified Lentz). */
export function incBeta(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // The fraction converges fast for x < (a + 1) / (a + b + 2); use the symmetry otherwise.
  if (x > (a + 1) / (a + b + 2)) return 1 - incBeta(1 - x, b, a);
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let f = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    f *= d * c;
    num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return (front * f) / a;
}
/** Two-sided p-value of a Student-t statistic with `dof` degrees of freedom: I_{ν/(ν+t²)}(ν/2, 1/2). */
export function tTwoSided(t: number, dof: number): number {
  if (!Number.isFinite(t) || !(dof > 0)) return NaN;
  return incBeta(dof / (dof + t * t), dof / 2, 0.5);
}
/**
 * Exact two-sided binomial p-value: the probability, under Binomial(n, p0), of an outcome no more likely than
 * k (the "minimum likelihood" rule scipy's binomtest uses, with the same small relative tolerance).
 */
export function binomTwoSided(k: number, n: number, p0: number): number {
  if (!(n > 0) || !(p0 > 0 && p0 < 1)) return NaN;
  const lp = (j: number) => logGamma(n + 1) - logGamma(j + 1) - logGamma(n - j + 1) + j * Math.log(p0) + (n - j) * Math.log(1 - p0);
  const at = lp(k);
  let sum = 0;
  for (let j = 0; j <= n; j++) {
    const l = lp(j);
    if (l <= at + 1e-7) sum += Math.exp(l);
  }
  return Math.min(1, sum);
}
/**
 * Critical value of Student-t: the c > 0 with tTwoSided(c, dof) = p (bisection; tTwoSided falls as c grows).
 * tCritical(0.05, ∞-like dof) ≈ 1.96.
 */
export function tCritical(p: number, dof: number): number {
  if (!(p > 0 && p < 1) || !(dof > 0)) return NaN;
  let lo = 0;
  let hi = 1;
  while (tTwoSided(hi, dof) > p && hi < 1e6) hi *= 2;
  for (let k = 0; k < 200 && hi - lo > 1e-10 * hi; k++) {
    const mid = (lo + hi) / 2;
    if (tTwoSided(mid, dof) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/**
 * Upper regularised incomplete gamma function Q(a, x) = Γ(a, x) ÷ Γ(a): the series for P(a, x) below
 * x = a + 1, the continued fraction (modified Lentz) above, so the far tail keeps its relative accuracy.
 */
export function gammaQ(a: number, x: number): number {
  if (!(a > 0) || Number.isNaN(x)) return NaN;
  if (!(x > 0)) return 1;
  const front = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-17) break;
    }
    return Math.max(0, 1 - sum * front);
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return front * h;
}
/**
 * Two-sided p-value of a standard normal statistic: P(χ²₁ > z²) = Q(1/2, z²/2). Exact to about fifteen
 * digits, including far in the tail where a polynomial approximation of the normal distribution loses
 * its relative accuracy.
 */
export const zTwoSided = (z: number) => (Number.isFinite(z) ? gammaQ(0.5, (z * z) / 2) : NaN);

/** Benjamini-Hochberg adjusted p-values (q-values): q_(i) = min over j >= i of p_(j) · m / j. */
export function bhAdjust(p: number[]): number[] {
  const m = p.length;
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const q = new Array<number>(m);
  let run = 1;
  for (let r = m - 1; r >= 0; r--) {
    const i = order[r];
    run = Math.min(run, (p[i] * m) / (r + 1));
    q[i] = run;
  }
  return q;
}

/* ---------- random numbers (seeded, so every figure on the page is reproducible) ---------- */
/** mulberry32: a small, fast generator with a 32-bit state; returns uniform numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** FNV-1a hash of a string, for seeding. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ---------- time-series inference ---------- */
/**
 * Mean of x with a Newey-West standard error: the long-run variance is
 * γ0 + 2 Σ_{k=1..lag} (1 − k/(lag+1)) γk, with γk the lag-k autocovariance (divisor n).
 */
export function neweyWest(x: ArrayLike<number>, lag: number) {
  const n = x.length;
  const m = mean(x);
  let lrv = 0;
  for (let i = 0; i < n; i++) lrv += (x[i] - m) ** 2;
  lrv /= n;
  const L = Math.max(0, Math.min(lag, n - 1));
  for (let k = 1; k <= L; k++) {
    let g = 0;
    for (let i = k; i < n; i++) g += (x[i] - m) * (x[i - k] - m);
    lrv += 2 * (1 - k / (L + 1)) * (g / n);
  }
  return { mean: m, lrv, se: Math.sqrt(Math.max(lrv, 0) / n), n, lag: L };
}
/** The usual automatic lag for Newey-West: floor(4 (n/100)^(2/9)). */
export const nwLag = (n: number) => Math.floor(4 * (n / 100) ** (2 / 9));

/** Ordinary least squares of y on its index 0..n-1: slope per step, intercept, R² and the classical slope SE. */
export function olsTrend(y: ArrayLike<number>) {
  const n = y.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2;
  const my = mean(y);
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  const sxx = (n * (n * n - 1)) / 12;
  const slope = sxy / sxx;
  const sse = Math.max(0, syy - slope * sxy);
  return {
    n,
    slope,
    intercept: my - slope * mx,
    r2: syy > 0 ? 1 - sse / syy : 0,
    seSlope: Math.sqrt(sse / (n - 2) / sxx),
  };
}

/** Market model y = α + β x + ε on paired observations: β with its classical SE, R², correlation and residual SD. */
export function marketModel(y: ArrayLike<number>, x: ArrayLike<number>) {
  const n = Math.min(y.length, x.length);
  if (n < 20) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  const beta = sxy / sxx;
  const sse = Math.max(0, syy - beta * sxy);
  const residSd = Math.sqrt(sse / (n - 2));
  return {
    n,
    beta,
    alpha: my - beta * mx,
    seBeta: residSd / Math.sqrt(sxx),
    r2: 1 - sse / syy,
    corr: sxy / Math.sqrt(sxx * syy),
    residSd,
  };
}

export interface VarianceRatio {
  q: number;
  /** number of one-period returns */
  n: number;
  vr: number;
  /** Lo-MacKinlay statistic that stays valid when volatility changes over time */
  z: number;
  p: number;
  /** statistic under constant volatility, for reference */
  zIid: number;
}
/**
 * Lo and MacKinlay (1988) variance ratio of q-period to one-period log returns, with overlapping q-period
 * returns and their unbiased variance estimators:
 *   μ = (p_T − p_0)/T,  σa² = Σ (p_t − p_{t−1} − μ)² / (T − 1),
 *   σc² = Σ_{t=q..T} (p_t − p_{t−q} − qμ)² / m,  m = q (T − q + 1)(1 − q/T),  VR = σc²/σa².
 * z* = (VR − 1)/√θ with θ = Σ_{j=1..q−1} [2(q − j)/q]² δ_j and
 * δ_j = Σ_{t=j+1..T} x_t² x_{t−j}² / (Σ_t x_t²)², x_t = p_t − p_{t−1} − μ (heteroskedasticity-robust).
 * VR above 1 means moves tend to continue over q periods, below 1 that they tend to reverse.
 */
export function varianceRatio(logPrice: ArrayLike<number>, q: number): VarianceRatio | null {
  const T = logPrice.length - 1;
  if (q < 2 || T < 4 * q) return null;
  const mu = (logPrice[T] - logPrice[0]) / T;
  const x = new Float64Array(T + 1);
  let s2 = 0;
  for (let t = 1; t <= T; t++) {
    x[t] = logPrice[t] - logPrice[t - 1] - mu;
    s2 += x[t] * x[t];
  }
  if (!(s2 > 0)) return null;
  const va = s2 / (T - 1);
  let sc = 0;
  for (let t = q; t <= T; t++) sc += (logPrice[t] - logPrice[t - q] - q * mu) ** 2;
  const m = q * (T - q + 1) * (1 - q / T);
  const vr = sc / m / va;
  let theta = 0;
  for (let j = 1; j < q; j++) {
    let num = 0;
    for (let t = j + 1; t <= T; t++) num += x[t] * x[t] * x[t - j] * x[t - j];
    theta += ((2 * (q - j)) / q) ** 2 * (num / (s2 * s2));
  }
  const z = (vr - 1) / Math.sqrt(theta);
  const zIid = (vr - 1) / Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * T));
  return { q, n: T, vr, z, p: zTwoSided(z), zIid };
}

/** Kaufman efficiency ratio: |net change| ÷ sum of |one-step changes|. 1 = a straight line; a random walk of n steps averages about 1/√n. */
export function efficiencyRatio(x: ArrayLike<number>): number | null {
  const n = x.length;
  if (n < 3) return null;
  let path = 0;
  for (let i = 1; i < n; i++) path += Math.abs(x[i] - x[i - 1]);
  return path > 0 ? Math.abs(x[n - 1] - x[0]) / path : null;
}

/**
 * Point-in-time percentile rank: for each i, the share of the defined values in the trailing window
 * (at most `window` values ending at i, at least `minCount`) that are <= x[i]. Uses nothing after bar i.
 */
export function trailingRank(
  x: ArrayLike<number | null>,
  window: number,
  minCount: number,
): (number | null)[] {
  const n = x.length;
  const out = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (!fin(v)) continue;
    let k = 0;
    let le = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const w = x[j];
      if (!fin(w)) continue;
      k++;
      if (w <= v) le++;
    }
    if (k >= minCount) out[i] = le / k;
  }
  return out;
}

/* ---------- forward returns after a condition ---------- */
export interface ForwardTest {
  h: number;
  /** first and last evaluation bars: every bar from `from` whose h-day forward window is complete */
  from: number;
  last: number;
  nAll: number;
  /** bars on which the condition held */
  n: number;
  /** occurrences at least h bars apart: the count of forward windows that do not overlap */
  nEff: number;
  /**
   * The tested effect: mean h-day log total return after the condition minus the mean over all sample bars,
   * with its Hodrick (1992) standard error, t statistic, degrees of freedom and two-sided p-value.
   */
  excess: number;
  se: number;
  t: number;
  dof: number;
  p: number;
  /** 95% block-bootstrap interval of the excess */
  ci: [number, number] | null;
  /** mean h-day log return on condition bars and on all bars */
  meanLog: number;
  meanAllLog: number;
  /** the same windows as simple returns: mean, median and share above zero, condition bars and all bars */
  mean: number;
  meanAll: number;
  median: number;
  medianAll: number;
  excessMedian: number;
  hit: number;
  hitAll: number;
  /** excess in the first and the second half of the sample (null when a half has under 5 cases) */
  halves: [number | null, number | null];
}

/** Forward h-day log returns of a total-return index, with the all-days baseline cached by start bar. */
export class ForwardReturns {
  /** F[t] = ln(tr[t+h] / tr[t]) for t = 0..last */
  readonly F: Float64Array;
  readonly last: number;
  private base = new Map<number, { meanLog: number; mean: number; median: number; hit: number }>();
  constructor(
    readonly tr: ArrayLike<number>,
    readonly h: number,
  ) {
    const n = tr.length;
    this.last = n - 1 - h;
    this.F = new Float64Array(Math.max(0, this.last + 1));
    for (let t = 0; t <= this.last; t++) this.F[t] = Math.log(tr[t + h] / tr[t]);
  }
  baseline(from: number) {
    let b = this.base.get(from);
    if (!b) {
      const s = this.F.slice(from, this.last + 1);
      let sum = 0;
      let simple = 0;
      let up = 0;
      for (let i = 0; i < s.length; i++) {
        sum += s[i];
        simple += Math.expm1(s[i]);
        if (s[i] > 0) up++;
      }
      const k = s.length;
      b = {
        meanLog: k ? sum / k : NaN,
        mean: k ? simple / k : NaN,
        median: Math.expm1(quantileSorted(s.sort(), 0.5)),
        hit: k ? up / k : NaN,
      };
      this.base.set(from, b);
    }
    return b;
  }
}

/** Number of flagged bars kept when each must be at least h bars after the previous kept one. */
export function countIndependent(flag: ArrayLike<number>, from: number, last: number, h: number): number {
  let n = 0;
  let prev = -Infinity;
  for (let t = from; t <= last; t++)
    if (flag[t] && t - prev >= h) {
      n++;
      prev = t;
    }
  return n;
}

/** Block length (sessions) of the bootstrap over daily contributions. */
export const BOOT_BLOCK = 10;
/** Block length for an h-day test: at least BOOT_BLOCK, and never shorter than the window, whose terms are autocorrelated up to h lags. */
export const bootBlock = (h: number) => Math.max(BOOT_BLOCK, h);

/**
 * Do h-day forward returns after a condition differ from the stock's own all-days average?
 *
 * Sample: bars t = from..last (forward window complete). Effect: mean h-day log total return on condition
 * bars minus the mean over all sample bars.
 *
 * Test (Hodrick 1992, standard errors "1B"): with daily log returns r and c_t = C_t − mean(C),
 *   Σ_t c_t · (r_{t+1} + … + r_{t+h})  =  Σ_s r_s · x_s,   x_s = c_{s−1} + … + c_{s−h},
 * so the sum of overlapping h-day returns against the condition equals a sum of one-day returns against the
 * (centred) number of open windows, and the effect is that sum divided by the number of condition bars.
 * Under the null that the next day's return cannot be predicted from the past, the terms (r_s − r̄) x_s are
 * uncorrelated, so the variance is Σ (r_s − r̄)² x_s² whatever the overlap, the persistence of the condition
 * or the level of volatility. t = effect / SE; the p-value uses Student-t with (independent occurrences − 1)
 * degrees of freedom, which widens it when cases are few.
 *
 * Interval: the same daily terms are resampled in blocks of max(BOOT_BLOCK, h) sessions (circular block bootstrap),
 * so it reflects fat tails and volatility clustering without assuming a normal distribution.
 */
export function forwardTest(
  F: ForwardReturns,
  logRet: ArrayLike<number>,
  flag: ArrayLike<number>,
  from: number,
  opt: { bootstrap?: number; seed?: number } = {},
): ForwardTest | null {
  const { h, last } = F;
  const fwd = F.F;
  const nAll = last - from + 1;
  if (nAll < 4 * h || nAll < 60) return null;
  let n = 0;
  for (let t = from; t <= last; t++) if (flag[t]) n++;
  if (!n || n === nAll) return null;
  const nEff = countIndependent(flag, from, last, h);
  const base = F.baseline(from);

  // condition bars: mean log, mean simple, median and share above zero
  const sub = new Float64Array(n);
  let k = 0;
  let sum = 0;
  let simple = 0;
  let up = 0;
  for (let t = from; t <= last; t++)
    if (flag[t]) {
      sub[k++] = fwd[t];
      sum += fwd[t];
      simple += Math.expm1(fwd[t]);
      if (fwd[t] > 0) up++;
    }
  const med = Math.expm1(quantileSorted(sub.sort(), 0.5));

  const w = dailyTerms(F, logRet, flag, from, n);
  let S = 0;
  let V = 0;
  for (let i = 0; i < w.length; i++) {
    S += w[i];
    V += w[i] * w[i];
  }
  const excess = S / n;
  const se = Math.sqrt(V) / n;
  const t = V > 0 ? S / Math.sqrt(V) : NaN;
  const dof = Math.max(1, nEff - 1);

  const mid = from + Math.floor(nAll / 2);
  const half = (a: number, b: number): number | null => {
    let c = 0;
    let sc = 0;
    let sa = 0;
    for (let i = a; i <= b; i++) {
      sa += fwd[i];
      if (flag[i]) {
        c++;
        sc += fwd[i];
      }
    }
    return c >= 5 ? sc / c - sa / (b - a + 1) : null;
  };

  const B = opt.bootstrap ?? 0;
  return {
    h,
    from,
    last,
    nAll,
    n,
    nEff,
    excess,
    se,
    t,
    dof,
    p: tTwoSided(t, dof),
    ci: B > 0 ? blockBootstrapSum(w, bootBlock(h), B, opt.seed ?? 1, n) : null,
    meanLog: sum / n,
    meanAllLog: base.meanLog,
    mean: simple / n,
    meanAll: base.mean,
    median: med,
    medianAll: base.median,
    excessMedian: med - base.median,
    hit: up / n,
    hitAll: base.hit,
    halves: [half(from, mid - 1), half(mid, last)],
  };
}

/**
 * The daily terms (r_s − r̄) · x_s of the Hodrick sum for s = from+1 .. last+h, where x_s is the centred number
 * of forward windows open on day s. Their sum divided by the number of condition bars is the excess.
 */
export function dailyTerms(
  F: ForwardReturns,
  logRet: ArrayLike<number>,
  flag: ArrayLike<number>,
  from: number,
  n: number,
): Float64Array {
  const { h, last } = F;
  const pbar = n / (last - from + 1);
  const s0 = from + 1;
  const s1 = last + h;
  const days = s1 - s0 + 1;
  let rbar = 0;
  for (let s = s0; s <= s1; s++) rbar += logRet[s];
  rbar /= days;
  const w = new Float64Array(days);
  let x = 0;
  for (let s = s0; s <= s1; s++) {
    const enter = s - 1; // bar whose window starts covering day s
    const leave = s - 1 - h; // bar whose window stopped covering day s
    if (enter <= last) x += (flag[enter] ? 1 : 0) - pbar;
    if (leave >= from) x -= (flag[leave] ? 1 : 0) - pbar;
    w[s - s0] = (logRet[s] - rbar) * x;
  }
  return w;
}

/** The block-bootstrap interval of a forward test, computed on its own (for tests that skipped it). */
export function forwardInterval(
  F: ForwardReturns,
  logRet: ArrayLike<number>,
  flag: ArrayLike<number>,
  test: Pick<ForwardTest, "from" | "n">,
  B: number,
  seed: number,
): [number, number] | null {
  return blockBootstrapSum(dailyTerms(F, logRet, flag, test.from, test.n), bootBlock(F.h), B, seed, test.n);
}

/**
 * 95% percentile interval of (Σ w) / scale from a circular block bootstrap of the terms w: the series is
 * rebuilt from blocks of `blockLen` consecutive terms drawn with replacement (wrapping at the end). Block sums
 * for every start are precomputed, so a resample costs one draw per block.
 */
export function blockBootstrapSum(
  w: ArrayLike<number>,
  blockLen: number,
  B: number,
  seed: number,
  scale = 1,
): [number, number] | null {
  const N = w.length;
  if (N < 4 * blockLen || B < 100) return null;
  const pre = new Float64Array(2 * N + 1);
  for (let i = 0; i < 2 * N; i++) pre[i + 1] = pre[i] + w[i % N];
  const block = new Float64Array(N);
  for (let s = 0; s < N; s++) block[s] = pre[s + blockLen] - pre[s];
  const blocks = Math.round(N / blockLen);
  // resamples hold blocks·blockLen terms; rescale to the original length
  const k = N / (blocks * blockLen) / scale;
  const rand = rng(seed);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let j = 0; j < blocks; j++) sum += block[Math.floor(rand() * N)];
    out[b] = sum * k;
  }
  out.sort();
  return [quantileSorted(out, 0.025), quantileSorted(out, 0.975)];
}
