// Simulated price histories in which nothing is predictable, for testing the evidence layer: any "signal"
// found in them is a false positive by construction. Used by the unit tests and the verification script;
// the page never shows simulated data.
import type { Bars } from "./conditions";
import { rng } from "./stat";

export interface SimOptions {
  /** Trading days (default 2,520 = ten years) */
  n?: number;
  /** Mean daily log return */
  drift?: number;
  /** Unconditional daily volatility of log returns */
  vol?: number;
  /** GARCH(1,1) volatility clustering with Student-t(5) shocks; false gives independent normal returns */
  garch?: boolean;
  /**
   * A planted, genuinely predictable pattern for positive controls: the mean daily return switches between
   * +trend and −trend in long runs (expected length `run` days), so trend-following conditions do carry
   * information about what follows. Leave unset for a pure random walk.
   */
  trend?: number;
  run?: number;
}

/**
 * A random walk with drift in log price. With `garch`, volatility clusters (σ²_t = ω + 0.08 ε²_{t−1} + 0.90 σ²_{t−1})
 * and shocks have fat tails, as real daily returns do, but the mean return never depends on the past.
 * Open, high and low are built around the close from further independent shocks; volume rises with the size
 * of the day's move. Dividends are zero, so the total-return index equals the close rebased to 1.
 */
export function simulateBars(seed: number, opt: SimOptions = {}): Bars {
  const n = opt.n ?? 2520;
  const mu = opt.drift ?? 0.0004;
  const vol = opt.vol ?? 0.016;
  const garch = opt.garch ?? true;
  const u = rng(seed);
  const normal = () => {
    let a = u();
    if (a < 1e-12) a = 1e-12;
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
  };
  // Student-t with 5 degrees of freedom, scaled to unit variance
  const shock = () => {
    if (!garch) return normal();
    let chi = 0;
    for (let k = 0; k < 5; k++) chi += normal() ** 2;
    return (normal() / Math.sqrt(chi / 5)) / Math.sqrt(5 / 3);
  };
  const alpha = 0.08;
  const beta = 0.9;
  const omega = (1 - alpha - beta) * vol * vol;
  let s2 = vol * vol;
  let prevEps = 0;
  const d: string[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  const v: number[] = [];
  let close = 100;
  const trend = opt.trend ?? 0;
  const stay = 1 - 1 / (opt.run ?? 250);
  let regime = 1;
  const day0 = Date.UTC(2010, 0, 4);
  let cal = 0;
  for (let i = 0; i < n; i++) {
    if (garch) s2 = omega + alpha * prevEps * prevEps + beta * s2;
    const sig = Math.sqrt(s2);
    // overnight part (a quarter of the variance) and intraday part
    const gap = 0.5 * sig * shock();
    const intra = Math.sqrt(0.75) * sig * shock();
    const eps = gap + intra;
    prevEps = eps;
    if (trend && u() > stay) regime = -regime;
    const m = mu + regime * trend;
    const open = close * Math.exp(i ? gap + m / 2 : 0);
    const next = i ? open * Math.exp(intra + m / 2) : close;
    const hi = Math.max(open, next) * Math.exp(Math.abs(0.35 * sig * normal()));
    const lo = Math.min(open, next) * Math.exp(-Math.abs(0.35 * sig * normal()));
    const volume = Math.round(1e6 * Math.exp(0.4 * normal() + 25 * Math.abs(eps)));
    // weekdays only
    while (new Date(day0 + cal * 864e5).getUTCDay() % 6 === 0) cal++;
    d.push(new Date(day0 + cal * 864e5).toISOString().slice(0, 10));
    cal++;
    o.push(open);
    h.push(hi);
    l.push(lo);
    c.push(next);
    v.push(volume);
    close = next;
  }
  const tr = c.map((x) => x / c[0]);
  return { d, o, h, l, c, v, tr };
}
