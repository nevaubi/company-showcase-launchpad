// Published short-term price strategies with fixed rules (no fitting). `fire` returns +1 long,
// -1 short or 0, using only data up to and including bar i; trades enter at the next open.
import type { Features } from "./features";

export type StrategyId =
  | "reversal" | "residual" | "rsi2" | "gap" | "volShock" | "stressRev"
  | "volPremium" | "high52" | "squeeze" | "tsmom"
  | "pead" | "earnRunup" | "insider" | "shortFlow" | "fails"
  | "custMom" | "confluence" | "pairs";

export type Family = "reversal" | "momentum" | "events" | "links" | "multi" | "pairs";

export const FAMILY_LABEL: Record<Family, string> = {
  reversal: "Snap-back",
  momentum: "Momentum",
  events: "Events",
  links: "Supply chain",
  multi: "Confluence",
  pairs: "Pairs",
};

export interface StrategyDef {
  id: StrategyId;
  label: string;
  family: Family;
  rule: string;
  /** Data the rule needs beyond daily prices (shown on the strategy card). */
  data?: string;
  /** First year the needed data exists; earlier years can't produce trades. */
  dataFrom?: string;
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
    id: "stressRev",
    label: "Panic-day snap back",
    family: "reversal",
    rule: "5-day drop net of its sector beyond 2 standard deviations while the market is stressed (VIX above 25 or VIX above 3-month VIX); bet on a rebound",
    source: "Nagel (2012); Avellaneda & Lee (2010)",
    data: "Cboe VIX and VIX3M",
    horizons: [5],
    sides: [1],
    fire: (f, i) => {
      const z = zRes(f, i), vix = f.mk?.vix[i] ?? NaN, ratio = f.mk?.vixRatio[i] ?? NaN;
      if (!ok(z, vix)) return 0;
      const stressed = vix >= 25 || (Number.isFinite(ratio) && ratio >= 1);
      return stressed && z <= -2 ? 1 : 0;
    },
    strength: (f, i) => Math.abs(zRes(f, i)),
    detail: (f, i) => `${zRes(f, i).toFixed(1)} standard deviations vs its sector; VIX ${(f.mk?.vix[i] ?? 0).toFixed(1)}${Number.isFinite(f.mk?.vixRatio[i] ?? NaN) ? `, term ratio ${(f.mk!.vixRatio[i]).toFixed(2)}` : ""}`,
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
    id: "pead",
    label: "Earnings drift",
    family: "events",
    rule: "3-day reaction to an earnings release (SEC 8-K item 2.02), net of its sector, beyond 2 standard deviations; bet the move continues",
    source: "Bernard & Thomas (1989); Chan, Jegadeesh & Lakonishok (1996)",
    data: "SEC 8-K item 2.02 filing dates",
    horizons: [20, 40],
    sides: [1, -1],
    fire: (f, i) => {
      const z = f.ev?.earnZ[i] ?? NaN;
      return !ok(z) ? 0 : z >= 2 ? 1 : z <= -2 ? -1 : 0;
    },
    strength: (f, i) => Math.abs(f.ev!.earnZ[i]),
    detail: (f, i) => `${pct(f.ev!.earnRet[i])} vs its sector over the 3 days around results (${f.ev!.earnZ[i].toFixed(1)} standard deviations)`,
  },
  {
    id: "earnRunup",
    label: "Pre-earnings run-up",
    family: "events",
    rule: "Five trading days before the expected results date (same quarter last year + 52 weeks); hold through the release",
    source: "Frazzini & Lamont (2007); Barber et al. (2013)",
    data: "SEC 8-K item 2.02 filing dates",
    horizons: [6],
    sides: [1],
    fire: (f, i) => (f.ev?.earnAhead[i] === 5 ? 1 : 0),
    strength: () => 1,
    detail: () => "Results expected in about 5 trading days",
  },
  {
    id: "insider",
    label: "Insider buying cluster",
    family: "events",
    rule: "Two or more officers or directors buying on the open market (Form 4 code P, $25K+, not pre-planned) within 30 days",
    source: "Cohen, Malloy & Pomorski (2012); Lakonishok & Lee (2001)",
    data: "SEC Form 4 open-market purchases",
    dataFrom: "2016",
    horizons: [20, 40],
    sides: [1],
    fire: (f, i) => ((f.ev?.buyers30[i] ?? 0) >= 2 ? 1 : 0),
    strength: (f, i) => f.ev!.buyers30[i],
    detail: (f, i) => `${f.ev!.buyers30[i]} insiders bought ${f.ev!.buyValue30[i] >= 1e6 ? `$${(f.ev!.buyValue30[i] / 1e6).toFixed(1)}M` : `$${Math.round(f.ev!.buyValue30[i] / 1e3)}K`} in 30 days`,
  },
  {
    id: "shortFlow",
    label: "Short-selling flow",
    family: "events",
    rule: "5-day share of volume sold short beyond 2 standard deviations of its prior 60 days; heavy shorting → short, unusually light shorting → long",
    source: "Boehmer, Jones & Zhang (2008); Diether, Lee & Werner (2009)",
    data: "FINRA daily short-sale volume",
    dataFrom: "2018",
    horizons: [5, 10],
    sides: [1, -1],
    fire: (f, i) => {
      const z = f.ev?.shortZ[i] ?? NaN;
      if (!ok(z)) return 0;
      // Fire on the first day past the threshold only.
      const prev = f.ev!.shortZ[i - 1];
      if (z >= 2 && !(prev >= 2)) return -1;
      if (z <= -2 && !(prev <= -2)) return 1;
      return 0;
    },
    strength: (f, i) => Math.abs(f.ev!.shortZ[i]),
    detail: (f, i) => `${pct(f.ev!.shortRatio5[i])} of volume sold short over 5 days (${f.ev!.shortZ[i].toFixed(1)} standard deviations vs normal)`,
  },
  {
    id: "fails",
    label: "Fails-to-deliver pile-up",
    family: "events",
    rule: "A newly published SEC fails-to-deliver reading at least 3× the stock's median of the prior 12 half-months and at least 25% of a day's dollar volume; persistent delivery failures flag hard-to-borrow, overpriced stock → short",
    source: "Autore, Boulton & Braga-Alves (2015); Stratmann & Welborn (2016)",
    data: "SEC fails-to-deliver files (published ~2 weeks after each half-month)",
    dataFrom: "2018",
    horizons: [10, 20],
    sides: [-1],
    fire: (f, i) => {
      const e = f.ev;
      if (!e || !e.failsNew[i]) return 0;
      return e.failsX[i] >= 3 && e.failsDV[i] >= 0.25 ? -1 : 0;
    },
    strength: (f, i) => Math.min(f.ev!.failsX[i], 20),
    detail: (f, i) => `Fails averaged ${pct(f.ev!.failsDV[i])} of a day's dollar volume, ${Number.isFinite(f.ev!.failsX[i]) ? `${f.ev!.failsX[i].toFixed(1)}×` : "far above"} its usual level`,
  },
  {
    id: "custMom",
    label: "Customer momentum",
    family: "links",
    rule: "Monthly: the company's customers named in its own or their SEC filings moved beyond 1 standard deviation vs the S&P 500 over 21 days; bet the supplier follows",
    source: "Cohen & Frazzini (2008); Menzly & Ozbas (2010)",
    data: "Supplier–customer links quoted from 10-K/10-Q filings",
    dataFrom: "2023",
    horizons: [21],
    sides: [1, -1],
    fire: (f, i) => {
      if (i % 21 !== 0) return 0;
      const z = f.cust?.[i] ?? NaN;
      return !ok(z) ? 0 : z >= 1 ? 1 : z <= -1 ? -1 : 0;
    },
    strength: (f, i) => Math.abs(f.cust![i]),
    detail: (f, i) => `Customers ${f.cust![i] >= 0 ? "up" : "down"} ${Math.abs(f.cust![i]).toFixed(1)} standard deviations vs the S&P 500 over 21 days`,
  },
  {
    id: "confluence",
    label: "Confluence",
    family: "multi",
    rule: "Two or more different strategies point the same way on the same stock within 3 trading days",
    source: "Combination of the rules above; Asness et al. (2013) on combining signals",
    horizons: [10],
    sides: [1, -1],
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
