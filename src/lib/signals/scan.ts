// One-ticker scan shared by `bun scripts/setups.ts` (full history) and the daily setups job:
// features → every strategy's firings → non-overlapping trade samples after costs. Pure.
import type { Bar } from "../financials/types";
import { align, features, roundTripCost, tradeCost, type Aligned, type Features } from "./features";
import { eventFeatures, type TickerEvents } from "./events";
import { STRATEGIES, STRATEGY, type Family, type StrategyId } from "./strategies";
import type { Regime } from "./backtest";
import { variantKey } from "./setups";

export const MIN_BARS = 300;
export const WARMUP = 260;
/** Firings in the last LIVE_BARS bars are "live" (actionable at the next open). */
export const LIVE_BARS = 3;
export const SECTOR_ETF: Record<string, string> = {
  "Information Technology": "XLK", Financials: "XLF", "Health Care": "XLV", "Consumer Discretionary": "XLY", "Consumer Staples": "XLP",
  Energy: "XLE", Industrials: "XLI", Materials: "XLB", "Real Estate": "XLRE", Utilities: "XLU", "Communication Services": "XLC",
};

export interface ScanContext {
  dates: string[];
  spy: Aligned;
  regime: Regime[];
  vix: ArrayLike<number>;
  vixRatio: ArrayLike<number>;
  benchFor: (sector: string) => Aligned;
}

export interface ScanInput {
  ticker: string;
  sector: string;
  bars: Bar[];
  events?: TickerEvents;
  /** Customers' 21-day excess return z per bar (supply-chain links), when known. */
  cust?: Float64Array;
}

export interface Firing {
  variant: string;
  strategy: StrategyId;
  family: Family;
  side: 1 | -1;
  horizon: number;
  i: number;
  strength: number;
  detail: string;
  cost: number;
}

export interface SampleRow {
  variant: string;
  i: number;
  net: number;
  ex: number;
  gross: number;
}

export interface ScanOut {
  a: Aligned;
  f: Features;
  bench: Aligned;
  samples: SampleRow[];
  firings: Firing[];
}

/** Realised trade: enter at the open after bar i, exit at the close of bar i + h. Null until that bar exists. */
export function tradeOutcome(a: Aligned, bench: Aligned, spy: Aligned, i: number, side: 1 | -1, h: number, cost: number) {
  if (i + h >= a.c.length) return null;
  const r = a.c[i + h] / a.o[i + 1] - 1;
  const rb = bench.c[i + h] / bench.o[i + 1] - 1;
  const rs = spy.c[i + h] / spy.o[i + 1] - 1;
  if (!Number.isFinite(r) || !Number.isFinite(rb) || !Number.isFinite(rs)) return null;
  return { net: side * (r - rb) - cost, ex: side * (r - rs) - cost, gross: side * r };
}

export function scanTicker(ctx: ScanContext, input: ScanInput): ScanOut | null {
  const { dates, spy } = ctx;
  const D = dates.length;
  const a = align(dates, input.bars);
  if (a.start < 0 || D - a.start < MIN_BARS) return null;
  const bench = ctx.benchFor(input.sector);
  const f = features(a, bench.c);
  if (input.events) f.ev = eventFeatures(dates, f, bench.c, input.events);
  f.mk = { vix: ctx.vix, vixRatio: ctx.vixRatio };
  if (input.cust) f.cust = input.cust;

  const firings: Firing[] = [];
  const from = a.start + WARMUP;
  // Which strategies fired which way on each bar (for confluence).
  const byBar = new Map<number, Map<StrategyId, 1 | -1>>();
  for (const s of STRATEGIES) {
    if (!s.fire) continue;
    for (let i = from; i < D; i++) {
      const d = s.fire(f, i);
      if (!d || !s.sides.includes(d)) continue;
      const rt = roundTripCost(f.dv20[i]);
      if (rt == null) continue;
      const strength = s.strength ? s.strength(f, i) : 1;
      const detail = s.detail ? s.detail(f, i) : s.label;
      for (const h of s.horizons) firings.push({ variant: variantKey(s.id, d, h), strategy: s.id, family: s.family, side: d, horizon: h, i, strength, detail, cost: tradeCost(rt, d, h) });
      // Supply-chain signals are computed across companies, so the daily per-ticker scan can't see them; keep confluence price/event-only.
      if (s.family === "links") continue;
      const m = byBar.get(i) ?? new Map();
      m.set(s.id, d);
      byBar.set(i, m);
    }
  }
  // Confluence: two or more different strategies agreeing within 3 bars, at least one firing today.
  const conf = STRATEGY.confluence;
  for (const i of [...byBar.keys()].sort((x, y) => x - y)) {
    for (const side of [1, -1] as const) {
      const today = [...byBar.get(i)!.entries()].filter(([, d]) => d === side).map(([id]) => id);
      if (!today.length) continue;
      const agree = new Set(today);
      for (let k = 1; k <= 2; k++) for (const [id, d] of byBar.get(i - k) ?? []) if (d === side) agree.add(id);
      if (agree.size < 2) continue;
      const rt = roundTripCost(f.dv20[i]);
      if (rt == null) continue;
      for (const h of conf.horizons) {
        firings.push({
          variant: variantKey("confluence", side, h), strategy: "confluence", family: "multi", side, horizon: h, i,
          strength: agree.size, detail: [...agree].map((id) => STRATEGY[id].label).join(" + "), cost: tradeCost(rt, side, h),
        });
      }
    }
  }
  firings.sort((x, y) => x.i - y.i);

  // Non-overlapping samples per variant: a new trade only after the previous one has exited.
  const samples: SampleRow[] = [];
  const next = new Map<string, number>();
  for (const F of firings) {
    if (F.i < (next.get(F.variant) ?? 0)) continue;
    const out = tradeOutcome(a, bench, spy, F.i, F.side, F.horizon, F.cost);
    if (!out) continue;
    samples.push({ variant: F.variant, i: F.i, ...out });
    next.set(F.variant, F.i + F.horizon + 1);
  }
  return { a, f, bench, samples, firings };
}

/** Sector ETF close chained onto SPY returns where the ETF has no history yet. */
export function chainBench(spy: Aligned, etf: Aligned | undefined): Aligned {
  if (!etf) return spy;
  const D = spy.c.length;
  const c = new Float64Array(D), o = new Float64Array(D);
  c[0] = spy.c[0];
  o[0] = spy.o[0];
  for (let i = 1; i < D; i++) {
    const have = etf.start >= 0 && i > etf.start;
    const r = have ? etf.c[i] / etf.c[i - 1] : spy.c[i] / spy.c[i - 1];
    c[i] = c[i - 1] * r;
    o[i] = c[i - 1] * (have ? etf.o[i] / etf.c[i - 1] : spy.o[i] / spy.c[i - 1]);
  }
  return { start: 0, c, o, h: c, l: c, v: new Float64Array(D) };
}

/**
 * Customer momentum per bar for one supplier: mean 21-day return of its linked customers net of SPY,
 * scaled by their average 60-day volatility. A link counts only from the date of the filing that states it.
 */
export function customerZ(D: number, spy: Aligned, customers: { from: number; c: Float64Array; vol60: Float64Array }[]): Float64Array {
  const out = new Float64Array(D).fill(NaN);
  for (let i = 21; i < D; i++) {
    let sum = 0, vol = 0, n = 0;
    const rs = spy.c[i] / spy.c[i - 21] - 1;
    for (const cu of customers) {
      if (i < cu.from) continue;
      const r = cu.c[i] / cu.c[i - 21] - 1, v = cu.vol60[i];
      if (!Number.isFinite(r) || !(v > 0)) continue;
      sum += r - rs;
      vol += v;
      n++;
    }
    if (n) out[i] = sum / n / ((vol / n) * Math.sqrt(21));
  }
  return out;
}
