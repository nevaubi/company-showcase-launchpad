// Technical indicators and return statistics. Pure functions over number arrays;
// outputs are aligned to the input (leading values are null until defined).

export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

/** Wilder's RSI */
export function rsi(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const firstIdx = line.findIndex((x) => x != null);
  const sig: (number | null)[] = values.map(() => null);
  if (firstIdx >= 0) {
    const compact = line.slice(firstIdx) as number[];
    const e = ema(compact, signal);
    e.forEach((v, i) => (sig[firstIdx + i] = v));
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i]! : null));
  return { line, signal: sig, hist };
}

export function bollinger(values: number[], n = 20, k = 2) {
  const mid = sma(values, n);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const w = values.slice(i - n + 1, i + 1);
    const m = mid[i]!;
    const sd = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / n);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  }
  return { mid, upper, lower };
}

export function returns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(values[i] / values[i - 1] - 1);
  return out;
}

export function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function stdev(xs: number[]) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function correlation(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export function beta(asset: number[], bench: number[]) {
  const n = Math.min(asset.length, bench.length);
  const x = bench.slice(-n);
  const y = asset.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    varx += (x[i] - mx) ** 2;
  }
  return cov / varx;
}

/** Annualized volatility of daily returns */
export function annualizedVol(dailyReturns: number[]) {
  return stdev(dailyReturns) * Math.sqrt(252);
}

export function maxDrawdown(values: number[]) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd;
}

/** Align two date-keyed close series on common dates. */
export function alignByDate(a: [string, number][], b: [string, number][]) {
  const mb = new Map(b);
  const dates: string[] = [];
  const xa: number[] = [];
  const xb: number[] = [];
  for (const [d, v] of a) {
    const w = mb.get(d);
    if (w != null) {
      dates.push(d);
      xa.push(v);
      xb.push(w);
    }
  }
  return { dates, a: xa, b: xb };
}

export function pctChangeOver(values: number[], lookback: number) {
  if (values.length <= lookback) return null;
  return values[values.length - 1] / values[values.length - 1 - lookback] - 1;
}
