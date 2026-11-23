// Professional measures for one symbol, computed from its daily history at read time. Each is a plain
// description of the data with its inputs; none is a forecast. Definitions are in the doc comments and are
// checked against numpy in verify/ (three stocks) and against textbook values in measures.test.ts.
import TA, { type ConeRow, type TaState } from "./ta";
import type { Bars, Indicators } from "./conditions";
import {
  efficiencyRatio,
  fin,
  marketModel,
  neweyWest,
  nwLag,
  olsTrend,
  tTwoSided,
  varianceRatio,
  type VarianceRatio,
} from "./stat";

/** A benchmark's total-return index by date (SPY, the sector ETF). */
export interface BenchSeries {
  sym: string;
  kind: "market" | "sector";
  d: string[];
  tr: number[];
}

export interface TrendFit {
  /** Sessions in the window */
  window: number;
  /** Slope of the least-squares line through log total return, annualised: exp(252 · slope) − 1 */
  slopeAnn: number;
  /** Share of the variation in log price the straight line explains */
  r2: number;
  /** Mean daily log return ÷ its Newey-West standard error: the valid test of drift (a t-statistic on price levels is not) */
  driftT: number;
  driftP: number;
  /** Kaufman efficiency ratio and what a random walk of the same length averages (1/√window) */
  efficiency: number | null;
  efficiencyRw: number;
}
export interface RelStrength {
  sym: string;
  kind: "market" | "sector";
  /** (1 + own return) ÷ (1 + benchmark return) − 1 over 63 and 252 sessions, and for the 12-1 month window */
  rs63: number | null;
  rs252: number | null;
  rsMom: number | null;
  /** Market model over the last 252 paired daily returns */
  n: number;
  beta: number | null;
  seBeta: number | null;
  corr: number | null;
  r2: number | null;
  /** Annualised standard deviation of the part of returns the benchmark does not explain */
  idioVol: number | null;
}
export interface LevelRow {
  price: number;
  /** What defines the level */
  kind: "resistance" | "support" | "average" | "vwap" | "gap" | "range";
  label: string;
  detail: string;
  /** Price ÷ close − 1 */
  distance: number;
  /** Distance in units of ATR(14) */
  atrs: number | null;
  touches?: number;
}
export interface Measures {
  asOf: string;
  first: string;
  bars: number;
  close: number;
  state: TaState;
  trend: { fits: TrendFit[] };
  momentum: {
    r21: number | null;
    r63: number | null;
    r126: number | null;
    r252: number | null;
    /** Total return from 252 to 21 sessions ago, and from 126 to 21 sessions ago (the latest month is skipped) */
    mom12_1: number | null;
    mom6_1: number | null;
    vs: RelStrength[];
  };
  stretch: {
    z20: number | null;
    z50: number | null;
    rsi: number | null;
    /** RSI's percentile among its own trailing two years (point in time) */
    rsiRank: number | null;
  };
  /** Does the stock trend or revert? Variance ratios over the last `window` daily returns. */
  walk: {
    window: number;
    rows: VarianceRatio[];
    /** Chance of a statistic at least this large at any of the horizons under a random walk (Šidák) */
    pJoint: number | null;
    reading: "continue" | "reverse" | "random";
  };
  volatility: {
    rv21: number | null;
    rv63: number | null;
    /** Percentile of the 21-day figure in its own trailing three years, and in the whole history */
    rank3y: number | null;
    rankAll: number | null;
    atr: number | null;
    atrPct: number | null;
    cone: ConeRow[];
    /** One-standard-deviation move over 5 and 21 sessions if volatility stays at its 21-day level */
    expected: { sessions: number; pct: number; low: number; high: number }[];
  };
  drawdown: {
    current: number;
    peakDate: string;
    /** Sessions since the last all-time high of the total-return index */
    sessionsUnder: number;
    max: number;
    maxPeak: string;
    maxTrough: string;
    maxRecovered: string | null;
    longestUnder: number;
    longestFrom: string;
    longestTo: string | null;
  };
  liquidity: {
    hasVolume: boolean;
    /** Median daily dollar volume, last 20 sessions; mean, last 60 */
    dollarVol20: number | null;
    dollarVol60: number | null;
    /** Amihud (2002): mean of |daily return| ÷ dollar volume over 60 sessions, per $1 million traded */
    amihud: number | null;
    /** Last session's volume ÷ the average of the 20 sessions before it */
    relVol: number | null;
    /** Share of the last 20 sessions' volume that traded on days the close rose */
    upVolShare: number | null;
  };
  levels: LevelRow[];
  risk: {
    atr: number | null;
    /** Stop distance used for the arithmetic below: this many ATRs */
    stopAtrs: number;
    stopPct: number | null;
    stopLevel: number | null;
    /** Fraction of an account put at risk in the example */
    riskFraction: number;
    /** Position size (share of the account) at which a move to the stop loses riskFraction */
    positionPct: number | null;
    /** Largest one-day fall in the history, and the fall exceeded on 1 day in 20 */
    worstDay: number | null;
    worstDate: string | null;
    var95: number | null;
  };
}

const last = <T>(a: T[]) => a[a.length - 1];
const ret = (tr: number[], i: number, k: number) => (i - k >= 0 ? tr[i] / tr[i - k] - 1 : null);

/** Trend line, drift test and efficiency over the last `window` sessions of the total-return index. */
export function trendFit(tr: number[], window: number): TrendFit | null {
  const n = tr.length;
  if (n < window + 1) return null;
  const lp = new Float64Array(window + 1);
  for (let k = 0; k <= window; k++) lp[k] = Math.log(tr[n - 1 - window + k]);
  const fit = olsTrend(lp);
  if (!fit) return null;
  const r = new Float64Array(window);
  for (let k = 0; k < window; k++) r[k] = lp[k + 1] - lp[k];
  const nw = neweyWest(r, nwLag(window));
  const t = nw.se > 0 ? nw.mean / nw.se : NaN;
  return {
    window,
    slopeAnn: Math.exp(252 * fit.slope) - 1,
    r2: fit.r2,
    driftT: t,
    driftP: tTwoSided(t, window - 1),
    efficiency: efficiencyRatio(lp),
    efficiencyRw: 1 / Math.sqrt(window),
  };
}

/** Benchmark return between two of the symbol's dates (null when the benchmark has no bar on either). */
function benchReturn(b: BenchSeries, idx: Map<string, number>, from: string, to: string) {
  const a = idx.get(from);
  const z = idx.get(to);
  return a != null && z != null && b.tr[a] > 0 ? b.tr[z] / b.tr[a] - 1 : null;
}

export function relStrength(B: Bars, b: BenchSeries): RelStrength {
  const i = B.c.length - 1;
  const idx = new Map(b.d.map((x, k) => [x, k]));
  const rs = (from: number, to: number) => {
    if (from < 0) return null;
    const own = B.tr[to] / B.tr[from] - 1;
    const br = benchReturn(b, idx, B.d[from], B.d[to]);
    return br == null ? null : (1 + own) / (1 + br) - 1;
  };
  // paired daily returns over the last 252 sessions on which both traded
  const ys: number[] = [];
  const xs: number[] = [];
  for (let k = Math.max(1, i - 251); k <= i; k++) {
    const a = idx.get(B.d[k - 1]);
    const z = idx.get(B.d[k]);
    if (a == null || z == null) continue;
    ys.push(B.tr[k] / B.tr[k - 1] - 1);
    xs.push(b.tr[z] / b.tr[a] - 1);
  }
  const mm = marketModel(ys, xs);
  return {
    sym: b.sym,
    kind: b.kind,
    rs63: rs(i - 63, i),
    rs252: rs(i - 252, i),
    rsMom: rs(i - 252, i - 21),
    n: mm?.n ?? ys.length,
    beta: mm?.beta ?? null,
    seBeta: mm?.seBeta ?? null,
    corr: mm?.corr ?? null,
    r2: mm?.r2 ?? null,
    idioVol: mm ? mm.residSd * Math.sqrt(252) : null,
  };
}

export const WALK_WINDOW = 1260;
export const WALK_HORIZONS = [2, 5, 10, 20];
export function randomWalk(tr: number[]): Measures["walk"] {
  const n = tr.length;
  const w = Math.min(WALK_WINDOW, n - 1);
  const lp = new Float64Array(w + 1);
  for (let k = 0; k <= w; k++) lp[k] = Math.log(tr[n - 1 - w + k]);
  const rows = WALK_HORIZONS.map((q) => varianceRatio(lp, q)).filter((r): r is VarianceRatio => !!r);
  if (!rows.length) return { window: w, rows, pJoint: null, reading: "random" };
  const best = rows.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
  const pJoint = 1 - (1 - best.p) ** rows.length;
  return {
    window: w,
    rows,
    pJoint,
    reading: pJoint < 0.05 ? (best.vr > 1 ? "continue" : "reverse") : "random",
  };
}

export function drawdownStats(d: string[], tr: number[]): Measures["drawdown"] {
  const n = tr.length;
  let peak = 0;
  let longest = 0;
  let longestFrom = 0;
  let longestTo: number | null = null;
  for (let i = 1; i < n; i++) {
    if (tr[i] >= tr[peak]) {
      // the spell under water that just ended ran from the old peak to this bar
      if (i - peak > longest) {
        longest = i - peak;
        longestFrom = peak;
        longestTo = i;
      }
      peak = i;
    }
  }
  if (n - 1 - peak > longest) {
    longest = n - 1 - peak;
    longestFrom = peak;
    longestTo = null;
  }
  const m = TA.maxDrawdown(tr);
  return {
    current: tr[n - 1] / tr[peak] - 1,
    peakDate: d[peak],
    sessionsUnder: n - 1 - peak,
    max: m.dd,
    maxPeak: d[m.peak],
    maxTrough: d[m.trough],
    maxRecovered: m.recovered != null ? d[m.recovered] : null,
    longestUnder: longest,
    longestFrom: d[longestFrom],
    longestTo: longestTo != null ? d[longestTo] : null,
  };
}

export function liquidity(B: Bars, hasVolume: boolean): Measures["liquidity"] {
  const { c, v } = B;
  const i = c.length - 1;
  if (!hasVolume || i < 61)
    return { hasVolume, dollarVol20: null, dollarVol60: null, amihud: null, relVol: null, upVolShare: null };
  const dv = (k: number) => c[k] * v[k];
  const d20 = Array.from({ length: 20 }, (_, k) => dv(i - k)).sort((a, b) => a - b);
  let sum60 = 0;
  let ill = 0;
  let illN = 0;
  for (let k = i - 59; k <= i; k++) {
    sum60 += dv(k);
    if (dv(k) > 0) {
      ill += Math.abs(c[k] / c[k - 1] - 1) / dv(k);
      illN++;
    }
  }
  let prior = 0;
  for (let k = i - 20; k < i; k++) prior += v[k];
  let upV = 0;
  let allV = 0;
  for (let k = i - 19; k <= i; k++) {
    allV += v[k];
    if (c[k] > c[k - 1]) upV += v[k];
  }
  return {
    hasVolume,
    dollarVol20: (d20[9] + d20[10]) / 2,
    dollarVol60: sum60 / 60,
    amihud: illN ? (ill / illN) * 1e6 : null,
    relVol: prior > 0 ? v[i] / (prior / 20) : null,
    upVolShare: allV > 0 ? upV / allV : null,
  };
}

/** How many ATRs the example stop sits from the close, and the share of an account risked. */
export const RISK = { stopAtrs: 2, riskFraction: 0.01 } as const;

export interface MeasureInput {
  bars: Bars;
  indicators: Indicators;
  bench?: BenchSeries[];
  /** Earnings release dates, ascending (for the anchored VWAP) */
  earnings?: string[];
}

export function measures({ bars: B, indicators: I, bench = [], earnings = [] }: MeasureInput): Measures {
  const { d, o, h, l, c, v, tr } = B;
  const n = c.length;
  const i = n - 1;
  const close = c[i];
  const st = TA.state(o, h, l, c, v);
  const atr = I.atr[i];
  const sma50 = TA.sma(c, 50);
  const sd50 = TA.stdev(c, 50);
  const cone = TA.volCone(c);
  const rv21 = I.rv21[i];
  const rv63 = last(TA.realizedVol(c, 63));

  // ---- levels: one ladder of everything price may react to, nearest first within each side
  const atrs = (p: number) => (fin(atr) && atr > 0 ? (p - close) / atr : null);
  const levels: LevelRow[] = [];
  const push = (price: number | null | undefined, kind: LevelRow["kind"], label: string, detail: string, touches?: number) => {
    if (!fin(price) || price <= 0) return;
    levels.push({ price, kind, label, detail, distance: price / close - 1, atrs: atrs(price), touches });
  };
  for (const L of TA.levels(h, l, c))
    push(
      L.price,
      L.kind,
      L.kind === "support" ? "Support" : "Resistance",
      `${L.touches} swing points (${L.highs} highs, ${L.lows} lows), last ${d[L.last]}`,
      L.touches,
    );
  push(st.sma50, "average", "50-day average", "Simple average of the last 50 closes");
  push(st.sma200, "average", "200-day average", "Simple average of the last 200 closes");
  push(st.hi52, "range", "52-week high", `Intraday high on ${d[st.hi52i]}`);
  push(st.lo52, "range", "52-week low", `Intraday low on ${d[st.lo52i]}`);
  if (I.hasVolume) {
    const lowAnchor = st.lo52i;
    push(TA.anchoredVwap(h, l, c, v, lowAnchor)[i], "vwap", "VWAP from the 52-week low", `Volume-weighted average price since ${d[lowAnchor]}`);
    const lastE = [...earnings].reverse().find((x) => x <= d[i]);
    if (lastE) {
      const a = d.findIndex((x) => x >= lastE);
      if (a >= 0 && a < i) push(TA.anchoredVwap(h, l, c, v, a)[i], "vwap", "VWAP from the last earnings release", `Volume-weighted average price since ${d[a]}`);
    }
  }
  for (const g of TA.gapFills(I.events, h, l)) {
    if (g.filled != null) continue;
    const dist = g.edge / close - 1;
    if (Math.abs(dist) > 0.2) continue;
    push(g.edge, "gap", g.type === "gap_up" ? "Open gap below" : "Open gap above", `Gap of ${d[g.i]} fills at this price (${(g.bottom).toFixed(2)} to ${(g.top).toFixed(2)})`);
  }
  levels.sort((a, b) => b.price - a.price);

  // ---- tail risk from the daily total returns
  let worst = 0;
  let worstI = -1;
  const rets: number[] = [];
  for (let k = 1; k < n; k++) {
    const r = tr[k] / tr[k - 1] - 1;
    rets.push(r);
    if (r < worst) {
      worst = r;
      worstI = k;
    }
  }
  rets.sort((a, b) => a - b);
  const stopPct = fin(atr) ? (RISK.stopAtrs * atr) / close : null;

  const walk = randomWalk(tr);
  const sig = fin(rv21) ? rv21 / Math.sqrt(252) : null;
  return {
    asOf: d[i],
    first: d[0],
    bars: n,
    close,
    state: st,
    trend: { fits: [126, 252].map((w) => trendFit(tr, w)).filter((f): f is TrendFit => !!f) },
    momentum: {
      r21: ret(tr, i, 21),
      r63: ret(tr, i, 63),
      r126: ret(tr, i, 126),
      r252: ret(tr, i, 252),
      mom12_1: i - 252 >= 0 ? tr[i - 21] / tr[i - 252] - 1 : null,
      mom6_1: i - 126 >= 0 ? tr[i - 21] / tr[i - 126] - 1 : null,
      vs: bench.map((b) => relStrength(B, b)),
    },
    stretch: {
      z20: I.z20[i],
      z50: fin(sma50[i]) && fin(sd50[i]) && sd50[i]! > 0 ? (close - sma50[i]!) / sd50[i]! : null,
      rsi: I.rsi[i],
      rsiRank: I.rsiRank[i],
    },
    walk,
    volatility: {
      rv21,
      rv63,
      rank3y: I.rvRank[i],
      rankAll: cone.find((z) => z.n === 21)?.pct ?? null,
      atr,
      atrPct: fin(atr) ? atr / close : null,
      cone,
      expected:
        sig == null
          ? []
          : [5, 21].map((s) => {
              const pct = sig * Math.sqrt(s);
              return { sessions: s, pct, low: close * (1 - pct), high: close * (1 + pct) };
            }),
    },
    drawdown: drawdownStats(d, tr),
    liquidity: liquidity(B, I.hasVolume),
    levels,
    risk: {
      atr,
      stopAtrs: RISK.stopAtrs,
      stopPct,
      stopLevel: fin(atr) ? close - RISK.stopAtrs * atr : null,
      riskFraction: RISK.riskFraction,
      positionPct: stopPct ? RISK.riskFraction / stopPct : null,
      worstDay: worstI >= 0 ? worst : null,
      worstDate: worstI >= 0 ? d[worstI] : null,
      var95: rets.length >= 100 ? -rets[Math.floor(0.05 * rets.length)] : null,
    },
  };
}

/** One-standard-deviation move over `sessions` trading days implied by an annualised volatility. */
export const impliedMove = (annualVol: number, sessions: number) => annualVol * Math.sqrt(sessions / 252);
