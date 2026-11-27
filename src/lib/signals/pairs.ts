// Distance + cointegration pairs (Gatev et al. 2006 selection, Engle-Granger test), formed on a
// trailing year and traded in the following quarter, so every trade uses only past data.
import { Samples } from "./backtest";
import { adfT, corr, EG_CRIT_5, halfLife, ols } from "./stats";
import { tradeCost, roundTripCost } from "./features";

export interface PairLeg {
  ticker: string;
  o: Float64Array;
  c: Float64Array;
  start: number;
  dv20: Float64Array;
}

export interface PairPick {
  a: number;
  b: number;
  alpha: number;
  beta: number;
  sd: number;
  rho: number;
  adf: number;
  hl: number;
}

export const PAIRS = { window: 252, step: 63, maxNames: 120, minCorr: 0.8, maxPerSector: 40, entryZ: 2, maxHold: 20, minHl: 5, maxHl: 30, minDv: 2e7 };

/** Choose cointegrated pairs among one sector's legs, using bars F-window+1..F only. */
export function formPairs(legs: PairLeg[], F: number): PairPick[] {
  const W = PAIRS.window;
  const from = F - W + 1;
  if (from < 1) return [];
  const names = legs
    .map((l, k) => ({ k, dv: l.dv20[F] }))
    .filter(({ k, dv }) => legs[k].start <= from - 1 && dv >= PAIRS.minDv)
    .sort((x, y) => y.dv - x.dv)
    .slice(0, PAIRS.maxNames)
    .map((x) => x.k);
  const lp = new Map<number, Float64Array>();
  const lr = new Map<number, Float64Array>();
  for (const k of names) {
    const p = new Float64Array(W), r = new Float64Array(W - 1);
    for (let t = 0; t < W; t++) p[t] = Math.log(legs[k].c[from + t]);
    for (let t = 1; t < W; t++) r[t - 1] = p[t] - p[t - 1];
    lp.set(k, p);
    lr.set(k, r);
  }
  const cands: { a: number; b: number; rho: number }[] = [];
  for (let x = 0; x < names.length; x++)
    for (let y = x + 1; y < names.length; y++) {
      const rho = corr(lr.get(names[x])!, lr.get(names[y])!);
      if (rho >= PAIRS.minCorr) cands.push({ a: names[x], b: names[y], rho });
    }
  cands.sort((p, q) => q.rho - p.rho);
  const out: PairPick[] = [];
  const used = new Map<number, number>();
  for (const c of cands) {
    if (out.length >= PAIRS.maxPerSector) break;
    if ((used.get(c.a) ?? 0) >= 3 || (used.get(c.b) ?? 0) >= 3) continue;
    const fit = ols(lp.get(c.b)!, lp.get(c.a)!);
    if (!(fit.b > 0)) continue;
    const adf = adfT(fit.resid);
    if (!(adf < EG_CRIT_5)) continue;
    const hl = halfLife(fit.resid);
    if (hl < PAIRS.minHl || hl > PAIRS.maxHl) continue;
    let s2 = 0;
    for (const e of fit.resid) s2 += e * e;
    const sd = Math.sqrt(s2 / (fit.resid.length - 2));
    out.push({ a: c.a, b: c.b, alpha: fit.a, beta: fit.b, sd, rho: c.rho, adf, hl });
    used.set(c.a, (used.get(c.a) ?? 0) + 1);
    used.set(c.b, (used.get(c.b) ?? 0) + 1);
  }
  return out;
}

export const spreadZ = (legs: PairLeg[], p: PairPick, t: number) => (Math.log(legs[p.a].c[t]) - p.alpha - p.beta * Math.log(legs[p.b].c[t])) / p.sd;

/** Trade each formed pair over the next quarter. Entry next open after the spread first crosses ±2. */
export function tradePairs(legs: (PairLeg & { volume: Float64Array })[], picks: PairPick[], F: number, end: number, out: Samples) {
  for (const p of picks) {
    let t = F + 1;
    const stop = Math.min(F + PAIRS.step, end - 2);
    let prev = spreadZ(legs, p, F);
    while (t <= stop) {
      const z = spreadZ(legs, p, t);
      if (Math.abs(z) >= PAIRS.entryZ && Math.abs(prev) < PAIRS.entryZ) {
        const dir = z < 0 ? 1 : -1; // +1 = long A / short B
        const A = legs[p.a], B = legs[p.b];
        const ca = roundTripCost(A.dv20[t]), cb = roundTripCost(B.dv20[t]);
        let x = t + 1;
        const timeout = t + PAIRS.maxHold;
        const limit = Math.min(timeout, end);
        // A close observes convergence. An early exit can execute only at the following open.
        while (x < limit && (!(A.volume[x] > 0 && B.volume[x] > 0) || Math.sign(spreadZ(legs, p, x)) === Math.sign(z))) x++;
        const early = x < limit;
        const exit = early ? x + 1 : timeout;
        const enter = t + 1;
        if (exit < end && ca != null && cb != null &&
            [t, enter, exit].every((j) => A.volume[j] > 0 && B.volume[j] > 0)) {
          const ra = (early ? A.o[exit] : A.c[exit]) / A.o[enter] - 1;
          const rb = (early ? B.o[exit] : B.c[exit]) / B.o[enter] - 1;
          const gross = (dir * (ra - rb)) / 2; // half the capital in each leg
          if (Number.isFinite(gross)) {
            const held = Math.max(1, exit - enter + (early ? 0 : 1));
            const cost = (tradeCost(ca, dir, held) + tradeCost(cb, dir === 1 ? -1 : 1, held)) / 2;
            out.push(t, gross - cost, gross - cost, gross);
          }
        }
        t = x + 1;
        prev = spreadZ(legs, p, Math.min(x, end - 1));
        continue;
      }
      prev = z;
      t++;
    }
  }
}
