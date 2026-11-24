// The conditions the Technicals page tests: standard, fixed definitions (no parameter is tuned to the stock),
// each evaluated at the close of a bar from that bar and earlier bars only. "State" conditions hold for runs of
// days; "event" conditions are the single-day triggers ta.js detects (unchanged definitions, shared with the
// pipeline's cross-company statistics in tech/signals.json).
import TA, { type TaEvent } from "./ta";
import { fin, trailingRank } from "./stat";

export type ConditionGroup = "trend" | "momentum" | "stretch" | "volatility" | "volume";
export const GROUP_LABEL: Record<ConditionGroup, string> = {
  trend: "Trend",
  momentum: "Momentum",
  stretch: "Stretch",
  volatility: "Volatility",
  volume: "Volume",
};

export interface Condition {
  key: string;
  name: string;
  group: ConditionGroup;
  kind: "state" | "event";
  /** What the textbook reading expects of later returns: 1 higher, -1 lower, 0 no direction */
  dir: 1 | -1 | 0;
  /** Plain definition */
  text: string;
  /** 1 on bars where the condition holds at the close */
  flag: Uint8Array;
  /** First bar at which the condition can be evaluated (indicator warm-up) */
  from: number;
  /** State: holds on the last bar. Event: fired within the last RECENT_SESSIONS bars. */
  active: boolean;
  /** State: first bar of the current run. Event: the latest bar it fired on. Null when never. */
  at: number | null;
}

export interface Bars {
  d: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  /** Total-return index (dividends reinvested) */
  tr: number[];
}

/** An event counts as in force for this many sessions after it fires. */
export const RECENT_SESSIONS = 5;
/** Trailing windows for the percentile conditions (bars): at most `max`, at least `min` observations. */
export const RANK = { rsi: { max: 504, min: 252 }, vol: { max: 756, min: 252 } } as const;

const EVENT_GROUP: Record<string, ConditionGroup> = {
  golden_cross: "trend",
  death_cross: "trend",
  st_up: "trend",
  st_down: "trend",
  high_52w: "momentum",
  low_52w: "momentum",
  macd_bull: "momentum",
  macd_bear: "momentum",
  gap_up: "stretch",
  gap_down: "stretch",
  rsi_oversold: "stretch",
  rsi_overbought: "stretch",
  rsi_bull_div: "stretch",
  rsi_bear_div: "stretch",
  squeeze_bull: "volatility",
  squeeze_bear: "volatility",
};

/** Indicator series shared by the conditions, the measures and the chart panes. */
export interface Indicators {
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  sd20: (number | null)[];
  rsi: (number | null)[];
  rsiRank: (number | null)[];
  rv21: (number | null)[];
  rvRank: (number | null)[];
  atr: (number | null)[];
  z20: (number | null)[];
  hi252: (number | null)[];
  lo252: (number | null)[];
  volAvg20: (number | null)[];
  squeeze: boolean[];
  events: TaEvent[];
  hasVolume: boolean;
}

export function indicators(B: Bars): Indicators {
  const { o, h, l, c, v } = B;
  const sma20 = TA.sma(c, 20);
  const sd20 = TA.stdev(c, 20);
  const rsi = TA.rsi(c, 14);
  const rv21 = TA.realizedVol(c, 21);
  const det = TA.detect(o, h, l, c);
  return {
    sma20,
    sma50: TA.sma(c, 50),
    sma200: TA.sma(c, 200),
    sd20,
    rsi,
    rsiRank: trailingRank(rsi, RANK.rsi.max, RANK.rsi.min),
    rv21,
    rvRank: trailingRank(rv21, RANK.vol.max, RANK.vol.min),
    atr: TA.atr(h, l, c, 14),
    z20: c.map((x, i) => {
      const m = sma20[i];
      const s = sd20[i];
      return fin(m) && fin(s) && s > 0 ? (x - m) / s : null;
    }),
    hi252: TA.rollMax(h, 252),
    lo252: TA.rollMin(l, 252),
    volAvg20: TA.sma(v, 20),
    squeeze: det.squeeze,
    events: det.events,
    hasVolume: v.slice(-250).some((x) => x > 0),
  };
}

const firstDefined = (x: ArrayLike<number | null>) => {
  for (let i = 0; i < x.length; i++) if (fin(x[i])) return i;
  return x.length;
};

/** Every condition, in display order. `start` is the first bar used for statistics (after indicator warm-up). */
export function conditions(B: Bars, I: Indicators = indicators(B), start = 252): Condition[] {
  const n = B.c.length;
  const { c, v, tr } = B;
  const out: Condition[] = [];
  const state = (
    key: string,
    name: string,
    group: ConditionGroup,
    dir: 1 | -1 | 0,
    text: string,
    from: number,
    test: (i: number) => boolean,
  ) => {
    const flag = new Uint8Array(n);
    const f = Math.max(start, from);
    for (let i = f; i < n; i++) if (test(i)) flag[i] = 1;
    let at: number | null = null;
    if (n && flag[n - 1]) {
      at = n - 1;
      while (at > f && flag[at - 1]) at--;
    }
    out.push({ key, name, group, kind: "state", dir, text, flag, from: f, active: at != null, at });
  };
  const num = (x: (number | null)[], i: number) => x[i] as number;

  const f200 = firstDefined(I.sma200);
  state("trend_up", "Rising trend", "trend", 1, "Close above the 50-day average and the 50-day above the 200-day", f200, (i) => c[i] > num(I.sma50, i) && num(I.sma50, i) > num(I.sma200, i));
  state("trend_down", "Falling trend", "trend", -1, "Close below the 50-day average and the 50-day below the 200-day", f200, (i) => c[i] < num(I.sma50, i) && num(I.sma50, i) < num(I.sma200, i));
  state("above_200", "Above the 200-day average", "trend", 1, "Close above its 200-day simple average", f200, (i) => c[i] > num(I.sma200, i));
  state("below_200", "Below the 200-day average", "trend", -1, "Close below its 200-day simple average", f200, (i) => c[i] < num(I.sma200, i));

  state("mom_pos", "12-1 month momentum positive", "momentum", 1, "Total return from 252 to 21 sessions ago is above zero", 252, (i) => tr[i - 21] > tr[i - 252]);
  state("mom_neg", "12-1 month momentum negative", "momentum", -1, "Total return from 252 to 21 sessions ago is below zero", 252, (i) => tr[i - 21] < tr[i - 252]);
  const f252 = firstDefined(I.hi252);
  state("near_high", "Within 5% of the 52-week high", "momentum", 1, "Close at or above 95% of the highest high of the last 252 sessions", f252, (i) => c[i] >= 0.95 * num(I.hi252, i));
  state("near_low", "Within 5% of the 52-week low", "momentum", -1, "Close at or below 105% of the lowest low of the last 252 sessions", f252, (i) => c[i] <= 1.05 * num(I.lo252, i));

  const fz = firstDefined(I.z20);
  state("z20_low", "Two deviations below the 20-day average", "stretch", 1, "Close at least 2 standard deviations (of the last 20 closes) below their average", fz, (i) => fin(I.z20[i]) && num(I.z20, i) <= -2);
  state("z20_high", "Two deviations above the 20-day average", "stretch", -1, "Close at least 2 standard deviations (of the last 20 closes) above their average", fz, (i) => fin(I.z20[i]) && num(I.z20, i) >= 2);
  const fr = firstDefined(I.rsiRank);
  state("rsi_low", "RSI in its lowest tenth", "stretch", 1, "RSI(14) at or below the 10th percentile of its own trailing two years", fr, (i) => fin(I.rsiRank[i]) && num(I.rsiRank, i) <= 0.1);
  state("rsi_high", "RSI in its highest tenth", "stretch", -1, "RSI(14) at or above the 90th percentile of its own trailing two years", fr, (i) => fin(I.rsiRank[i]) && num(I.rsiRank, i) >= 0.9);

  const fv = firstDefined(I.rvRank);
  state("vol_high", "Volatility in its highest fifth", "volatility", 0, "21-day realised volatility at or above the 80th percentile of its own trailing three years", fv, (i) => fin(I.rvRank[i]) && num(I.rvRank, i) >= 0.8);
  state("vol_low", "Volatility in its lowest fifth", "volatility", 0, "21-day realised volatility at or below the 20th percentile of its own trailing three years", fv, (i) => fin(I.rvRank[i]) && num(I.rvRank, i) <= 0.2);
  state("squeeze_on", "Volatility squeeze", "volatility", 0, "Bollinger bands (20, 2) inside the Keltner channel (20, 1.5)", 20, (i) => I.squeeze[i]);

  if (I.hasVolume) {
    // Today's volume against the average of the 20 sessions before it, so a surge does not raise its own yardstick.
    const fa = firstDefined(I.volAvg20) + 1;
    state("vol_surge_up", "Heavy volume on an up day", "volume", 1, "Volume at least twice the average of the prior 20 sessions, close above the prior close", fa, (i) => v[i] > 0 && v[i] >= 2 * num(I.volAvg20, i - 1) && c[i] > c[i - 1]);
    state("vol_surge_down", "Heavy volume on a down day", "volume", -1, "Volume at least twice the average of the prior 20 sessions, close below the prior close", fa, (i) => v[i] > 0 && v[i] >= 2 * num(I.volAvg20, i - 1) && c[i] < c[i - 1]);
  }

  for (const [type, sg] of Object.entries(TA.SIGNALS)) {
    const flag = new Uint8Array(n);
    let at: number | null = null;
    for (const e of I.events)
      if (e.type === type && e.i >= start) {
        flag[e.i] = 1;
        at = e.i;
      }
    out.push({
      key: type,
      name: sg.name,
      group: EVENT_GROUP[type] ?? "momentum",
      kind: "event",
      dir: sg.dir,
      text: sg.text,
      flag,
      from: start,
      active: at != null && at >= n - RECENT_SESSIONS,
      at,
    });
  }
  return out;
}
