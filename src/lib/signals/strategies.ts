// Published short-term price strategies with fixed rules (no fitting). `fire` returns +1 long,
// -1 short or 0, using only data up to and including bar i; trades enter at the next open.
import type { Features } from "./features";

export type StrategyId = "reversal" | "residual" | "rsi2" | "gap" | "volShock" | "volPremium" | "high52" | "squeeze" | "tsmom" | "pairs";

export interface StrategyDef {
  id: StrategyId;
  label: string;
  family: "reversal" | "momentum" | "pairs";
  rule: string;
  source: string;
  horizons: number[];
  sides: (1 | -1)[];
  fire?: (f: Features, i: number) => -1 | 0 | 1;
  /** Strength in standard deviations (or similar), shown on the card. */
  strength?: (f: Features, i: number) => number;
  detail?: (f: Features, i: number) => string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ret = (f: Features, i: number, k: number) => f.a.c[i] / f.a.c[i - k] - 1;
const ok = (...x: number[]) => x.every((v) => Number.isFinite(v));

const z5 = (f: Features, i: number) => ret(f, i, 5) / (f.vol60[i] * Math.sqrt(5));
const zRes = (f: Features, i: number) => {
  let s = 0;
  for (let k = 0; k < 5; k++) s += f.resid[i - k];
  return s / (f.residSd60[i] * Math.sqrt(5));
};

export const STRATEGIES: StrategyDef[] = [
  {
    id: "reversal",
    label: "Weekly overreaction",
    family: "reversal",
    rule: "5-day move beyond 2.5 standard deviations of its own volatility; bet on a snap back",
    source: "Lehmann (1990); Jegadeesh (1990)",
    horizons: [5],
    sides: [1, -1],
    fire: (f, i) => {
      const z = z5(f, i);
      return !ok(z) ? 0 : z <= -2.5 ? 1 : z >= 2.5 ? -1 : 0;
    },
    strength: (f, i) => Math.abs(z5(f, i)),
    detail: (f, i) => `${pct(ret(f, i, 5))} in 5 days, ${z5(f, i).toFixed(1)} standard deviations`,
  },
  {
    id: "residual",
    label: "Sector-adjusted overreaction",
    family: "reversal",
    rule: "5-day return net of its sector ETF (60-day beta) beyond 2 standard deviations; bet on a snap back",
    source: "Avellaneda & Lee (2010); Blitz et al. (2013)",
    horizons: [5, 10],
    sides: [1, -1],
    fire: (f, i) => {
      const z = zRes(f, i);
      return !ok(z) ? 0 : z <= -2 ? 1 : z >= 2 ? -1 : 0;
    },
    strength: (f, i) => Math.abs(zRes(f, i)),
    detail: (f, i) => `${zRes(f, i).toFixed(1)} standard deviations vs its sector over 5 days`,
  },
  {
    id: "rsi2",
    label: "Oversold in an uptrend (RSI 2)",
    family: "reversal",
    rule: "2-day RSI below 5 while above the 200-day average (long), or above 95 while below it (short)",
    source: "Connors & Alvarez (2008)",
    horizons: [3, 5],
    sides: [1, -1],
    fire: (f, i) => {
      const r = f.rsi2[i], m = f.sma200[i], c = f.a.c[i];
      if (!ok(r, m)) return 0;
      return r < 5 && c > m ? 1 : r > 95 && c < m ? -1 : 0;
    },
    strength: (f, i) => Math.abs(50 - f.rsi2[i]) / 10,
    detail: (f, i) => `RSI(2) ${f.rsi2[i].toFixed(1)}, price ${pct(f.a.c[i] / f.sma200[i] - 1)} vs 200-day average`,
  },
  {
    id: "gap",
    label: "Opening gap fade",
    family: "reversal",
    rule: "Opening gap larger than 3x the 20-day daily volatility; bet against the gap from the next open",
    source: "Grant, Wolf & Yu (2005); Plastun et al. (2019)",
    horizons: [1, 5],
    sides: [1, -1],
    fire: (f, i) => {
      const g = f.a.o[i] / f.a.c[i - 1] - 1, v = f.vol20[i - 1];
      return !ok(g, v) || v <= 0 ? 0 : g <= -3 * v ? 1 : g >= 3 * v ? -1 : 0;
    },
    strength: (f, i) => Math.abs(f.a.o[i] / f.a.c[i - 1] - 1) / f.vol20[i - 1],
    detail: (f, i) => `Opened ${pct(f.a.o[i] / f.a.c[i - 1] - 1)} from the prior close`,
  },
  {
    id: "volShock",
    label: "Volume-shock reversal",
    family: "reversal",
    rule: "Daily move beyond 3x its volatility on 3x normal volume; bet on a reversal",
    source: "Chan (2003); Cooper (1999)",
    horizons: [5, 20],
    sides: [1, -1],
    fire: (f, i) => {
      const r = f.r1[i], v = f.vol20[i - 1], av = f.avgV50[i];
      if (!ok(r, v, av) || av <= 0 || f.a.v[i] < 3 * av) return 0;
      return r <= -3 * v ? 1 : r >= 3 * v ? -1 : 0;
    },
    strength: (f, i) => f.a.v[i] / f.avgV50[i],
    detail: (f, i) => `${pct(f.r1[i])} on ${(f.a.v[i] / f.avgV50[i]).toFixed(1)}x normal volume`,
  },
  {
    id: "volPremium",
    label: "High-volume attention",
    family: "momentum",
    rule: "Volume over 3x normal without a large price move (under 1 standard deviation); bet on a rise",
    source: "Gervais, Kaniel & Mingelgrin (2001)",
    horizons: [20],
    sides: [1],
    fire: (f, i) => {
      const r = f.r1[i], v = f.vol20[i - 1], av = f.avgV50[i];
      if (!ok(r, v, av) || av <= 0) return 0;
      return f.a.v[i] >= 3 * av && Math.abs(r) < v ? 1 : 0;
    },
    strength: (f, i) => f.a.v[i] / f.avgV50[i],
    detail: (f, i) => `${(f.a.v[i] / f.avgV50[i]).toFixed(1)}x normal volume, price ${pct(f.r1[i])}`,
  },
  {
    id: "high52",
    label: "Near 52-week high",
    family: "momentum",
    rule: "First close within 2% of the 52-week high in 20 days; bet on continuation",
    source: "George & Hwang (2004)",
    horizons: [10, 20],
    sides: [1],
    fire: (f, i) => {
      const m = f.max252[i];
      if (!ok(m) || f.a.c[i] < 0.98 * m) return 0;
      for (let k = 1; k <= 20; k++) if (f.a.c[i - k] >= 0.98 * f.max252[i - k]) return 0;
      return 1;
    },
    strength: (f, i) => 1 + f.a.c[i] / f.max252[i] - 0.98,
    detail: (f, i) => `${pct(f.a.c[i] / f.max252[i] - 1)} from its 52-week high`,
  },
  {
    id: "squeeze",
    label: "Volatility squeeze breakout",
    family: "momentum",
    rule: "Bollinger band width at a 6-month low the day before, then a close outside the band",
    source: "Bollinger (2001)",
    horizons: [10, 20],
    sides: [1, -1],
    fire: (f, i) => {
      const w = f.bbw[i - 1], mn = f.bbwMin125[i - 1], m = f.sma20[i], sd = f.sd20[i], c = f.a.c[i];
      if (!ok(w, mn, m, sd) || w > mn * 1.05) return 0;
      return c > m + 2 * sd ? 1 : c < m - 2 * sd ? -1 : 0;
    },
    strength: (f, i) => Math.abs(f.a.c[i] - f.sma20[i]) / f.sd20[i],
    detail: (f, i) => `Broke ${f.a.c[i] > f.sma20[i] ? "above" : "below"} the band after its narrowest width in 6 months`,
  },
  {
    id: "tsmom",
    label: "Trend (12-1 momentum)",
    family: "momentum",
    rule: "Monthly: 12-month return excluding the last month, scaled by volatility, beyond 1 standard deviation",
    source: "Moskowitz, Ooi & Pedersen (2012); Jegadeesh & Titman (1993)",
    horizons: [21],
    sides: [1, -1],
    fire: (f, i) => {
      if (i % 21 !== 0 || i < 252) return 0;
      const m = f.a.c[i - 21] / f.a.c[i - 252] - 1, v = f.vol60[i];
      if (!ok(m, v) || v <= 0) return 0;
      const z = m / (v * Math.sqrt(231));
      return z >= 1 ? 1 : z <= -1 ? -1 : 0;
    },
    strength: (f, i) => Math.abs(f.a.c[i - 21] / f.a.c[i - 252] - 1) / (f.vol60[i] * Math.sqrt(231)),
    detail: (f, i) => `${pct(f.a.c[i - 21] / f.a.c[i - 252] - 1)} over 12 months excluding the last one`,
  },
  {
    id: "pairs",
    label: "Pairs: spread snap back",
    family: "pairs",
    rule: "Same-sector pair that is cointegrated over the past year (Engle-Granger, half-life 5-30 days); spread beyond 2 standard deviations; long the cheap leg, short the rich one until the spread closes or 20 days",
    source: "Gatev, Goetzmann & Rouwenhorst (2006); Vidyamurthy (2004)",
    horizons: [20],
    sides: [1],
  },
];

export const STRATEGY = Object.fromEntries(STRATEGIES.map((s) => [s.id, s])) as Record<StrategyId, StrategyDef>;
