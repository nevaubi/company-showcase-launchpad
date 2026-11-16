// Pure statistics for the short-term setup engine. No Node or browser APIs.

export const mean = (x: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : NaN;
};

export function std(x: ArrayLike<number>, m = mean(x)) {
  if (x.length < 2) return NaN;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2;
  return Math.sqrt(s / (x.length - 1));
}

export function moments(x: number[]) {
  const m = mean(x);
  const sd = std(x, m);
  let s3 = 0, s4 = 0;
  for (const v of x) {
    const z = (v - m) / sd;
    s3 += z ** 3;
    s4 += z ** 4;
  }
  return { mean: m, sd, skew: s3 / x.length, kurt: s4 / x.length };
}

/** t-statistic of the mean against zero. */
export const tStat = (x: number[]) => (x.length < 3 ? NaN : mean(x) / (std(x) / Math.sqrt(x.length)));

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function normCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Inverse standard normal CDF (Acklam). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** One-sided p-value that the true mean is <= 0, from a t-stat (normal approximation, fine for n >= 30). */
export const pOneSided = (t: number) => (Number.isFinite(t) ? 1 - normCdf(t) : 1);

/** Simple OLS y = a + b x. */
export function ols(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const resid = new Float64Array(n);
  let sse = 0;
  for (let i = 0; i < n; i++) {
    resid[i] = y[i] - a - b * x[i];
    sse += resid[i] ** 2;
  }
  const seB = n > 2 && sxx ? Math.sqrt(sse / (n - 2) / sxx) : NaN;
  return { a, b, resid, seB };
}

export function corr(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Augmented Dickey-Fuller t-stat (constant, one lag): Δe_t = c + γ e_{t-1} + φ Δe_{t-1}. */
export function adfT(e: ArrayLike<number>) {
  const n = e.length;
  if (n < 30) return NaN;
  // Two-regressor OLS solved through normal equations on demeaned data.
  const rows = n - 2;
  const Y = new Float64Array(rows), X1 = new Float64Array(rows), X2 = new Float64Array(rows);
  for (let t = 2; t < n; t++) {
    Y[t - 2] = e[t] - e[t - 1];
    X1[t - 2] = e[t - 1];
    X2[t - 2] = e[t - 1] - e[t - 2];
  }
  const my = mean(Y), m1 = mean(X1), m2 = mean(X2);
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  for (let i = 0; i < rows; i++) {
    const a = X1[i] - m1, b = X2[i] - m2, y = Y[i] - my;
    s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * y; s2y += b * y;
  }
  const det = s11 * s22 - s12 * s12;
  if (!det) return NaN;
  const g = (s22 * s1y - s12 * s2y) / det;
  const p = (s11 * s2y - s12 * s1y) / det;
  let sse = 0;
  for (let i = 0; i < rows; i++) {
    const r = Y[i] - my - g * (X1[i] - m1) - p * (X2[i] - m2);
    sse += r * r;
  }
  const s2 = sse / (rows - 3);
  return g / Math.sqrt((s2 * s22) / det);
}

/** Engle-Granger 5% critical value for two variables (MacKinnon 2010, constant, large n). */
export const EG_CRIT_5 = -3.34;

/** Mean-reversion half-life in bars from an AR(1) fit of the spread. */
export function halfLife(e: ArrayLike<number>) {
  const n = e.length;
  const lag = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let t = 1; t < n; t++) {
    lag[t - 1] = e[t - 1];
    d[t - 1] = e[t] - e[t - 1];
  }
  const { b } = ols(lag, d);
  return b < 0 ? -Math.LN2 / b : Infinity;
}

/**
 * Deflated Sharpe ratio (Bailey & López de Prado 2014): probability the observed per-period Sharpe
 * beats the best Sharpe expected from `trials` unskilled strategies with variance `srVar` across trials.
 */
export function deflatedSharpe(sr: number, n: number, skew: number, kurt: number, trials: number, srVar: number) {
  const g = 0.5772156649;
  const N = Math.max(trials, 2);
  const sr0 = Math.sqrt(Math.max(srVar, 0)) * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E)));
  const den = Math.sqrt(Math.max(1 - skew * sr + ((kurt - 1) / 4) * sr * sr, 1e-9));
  return normCdf(((sr - sr0) * Math.sqrt(n - 1)) / den);
}

/** Benjamini-Hochberg: which p-values are discoveries at false-discovery rate q. */
export function bhFdr(p: number[], q = 0.05): boolean[] {
  const idx = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  let k = -1;
  idx.forEach(([v], r) => {
    if (v <= ((r + 1) / p.length) * q) k = r;
  });
  const out = p.map(() => false);
  for (let r = 0; r <= k; r++) out[idx[r][1]] = true;
  return out;
}
