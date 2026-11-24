// Published setups: the shape written by `bun scripts/setups.ts` (public/data/setups.json, the
// fallback) and by the daily setups job (setup_results), plus the shared selection rules. Browser-safe.
import { adjustedT, GATE, type Regime, type VariantProof } from "./backtest";
import { STRATEGY, type Family, type StrategyId } from "./strategies";

export interface LiveRecord {
  /** Signals the engine saw live (not backfilled) whose holding period has finished. */
  n: number;
  avgNet: number | null;
  avgExSpy: number | null;
  hit: number | null;
  since: string | null;
}

export interface VariantMeta extends VariantProof {
  strategy: StrategyId;
  family: Family;
  side: 1 | -1;
  horizon: number;
  live?: LiveRecord;
}

export interface Setup {
  ticker: string;
  name: string;
  sector: string;
  key: string;
  strategy: StrategyId;
  family: Family;
  side: 1 | -1;
  horizon: number;
  firedAt: string;
  detail: string;
  strength: number;
  price: number;
  stop: number;
  target: number;
  atr: number;
  /** Out-of-sample average net return in today's regime, shrunk toward zero for small samples. */
  edge: number;
  /** Passed the strict gate; false = watch-only near miss. */
  proven: boolean;
  spark: number[];
}

export interface PairSetup {
  a: string;
  b: string;
  nameA: string;
  nameB: string;
  sector: string;
  z: number;
  beta: number;
  halfLife: number;
  rho: number;
  adf: number;
  /** Long A / short B when +1. */
  side: 1 | -1;
  zs: number[];
  priceA: number;
  priceB: number;
}

export interface MarketContext {
  vix: number | null;
  vix3m: number | null;
  /** VIX / VIX3M; above 1 = inverted term structure (stress). */
  vixRatio: number | null;
  /** Share of covered stocks above their 200-day average. */
  breadth200: number | null;
  /** Share of covered stocks within 2% of a 52-week high. */
  nearHighs: number | null;
  /** Median 5-day share of volume sold short (FINRA). */
  shortRatio: number | null;
}

export interface SetupsFile {
  generatedAt: string;
  asOf: string;
  companies: number;
  regime: Regime;
  oosStart: string;
  gate: Record<string, number>;
  variants: VariantMeta[];
  setups: Setup[];
  /** Whether the pairs strategy (key `pairs:L:20`) passed the gate; pairs are watch-only otherwise. */
  pairsProven: boolean;
  pairs: PairSetup[];
  market?: MarketContext;
  /** "daily" when written by the scheduled job, "full" by the full-history script. */
  source?: "daily" | "full";
}

export const variantKey = (s: StrategyId, side: 1 | -1, h: number) => `${s}:${side > 0 ? "L" : "S"}:${h}`;

export function parseVariantKey(key: string): { strategy: StrategyId; side: 1 | -1; horizon: number } {
  const [s, side, h] = key.split(":");
  return { strategy: s as StrategyId, side: side === "L" ? 1 : -1, horizon: Number(h) };
}

export function variantMeta(p: VariantProof, live?: LiveRecord): VariantMeta {
  const k = parseVariantKey(p.key);
  return { ...p, ...k, family: STRATEGY[k.strategy]?.family ?? "reversal", ...(live ? { live } : {}) };
}

/** A variant is a "near miss" worth watching: positive after costs out of sample with t >= 1.5. */
export const isNearMiss = (v: VariantMeta) => !v.passed && (v.outSample.avgNet ?? 0) > 0 && (adjustedT(v.outSample) ?? 0) >= 1.5;

export interface LiveFiring {
  ticker: string;
  name: string;
  sector: string;
  variant: string;
  firedAt: string;
  strength: number;
  detail: string;
  price: number;
  atr: number;
  spark: number[];
}

/** Stop/target distances in ATRs: momentum and event trades get room to run. */
export function riskPlan(family: Family, side: 1 | -1, price: number, atr: number) {
  const wide = family === "momentum" || family === "events" || family === "links";
  const risk = (wide ? 2.5 : 2) * atr;
  return { stop: +(price - side * risk).toFixed(2), target: +(price + side * risk * (wide ? 2 : 1.5)).toFixed(2) };
}

/**
 * Today's setups: live firings of variants that passed the gate (proven) or are near misses (watch
 * only), and that have made money in today's market regime. One card per ticker/strategy/side.
 */
export function pickSetups(variants: VariantMeta[], live: LiveFiring[], today: Regime, max = 150): Setup[] {
  const byKey = new Map(variants.map((v) => [v.key, v]));
  const best = new Map<string, Setup>();
  for (const L of live) {
    const v = byKey.get(L.variant);
    if (!v || (!v.passed && !isNearMiss(v))) continue;
    const rg = v.regimes[today];
    if (!rg || rg.n < GATE.minRegimeN || !((rg.avgNet ?? 0) > 0)) continue;
    const edge = (rg.avgNet! * v.outSample.n) / (v.outSample.n + 200);
    const setup: Setup = {
      ticker: L.ticker, name: L.name, sector: L.sector, key: v.key, strategy: v.strategy, family: v.family, side: v.side, horizon: v.horizon,
      firedAt: L.firedAt, detail: L.detail, strength: +L.strength.toFixed(2), price: +L.price.toFixed(2), atr: +L.atr.toFixed(3),
      ...riskPlan(v.family, v.side, L.price, L.atr), proven: v.passed, edge: +edge.toFixed(5), spark: L.spark,
    };
    const id = `${L.ticker}:${v.strategy}:${v.side}`;
    const cur = best.get(id);
    if (!cur || Number(cur.proven) < Number(v.passed) || (cur.proven === v.passed && cur.edge < edge)) best.set(id, setup);
  }
  return [...best.values()].sort((a, b) => Number(b.proven) - Number(a.proven) || b.edge - a.edge).slice(0, max);
}

export interface GateCheck {
  id: string;
  label: string;
  ok: boolean;
}

/** The eight checks of the strict gate, in display order (same rules as `finalize`). */
export function gateChecks(v: VariantMeta, gate: Record<string, number> = GATE): GateCheck[] {
  const o = v.outSample;
  const goodRegimes = Object.values(v.regimes).filter((r) => r.n >= gate.minRegimeN && (r.avgNet ?? 0) > 0).length;
  return [
    { id: "n", label: `${gate.minN}+ trades out of sample`, ok: o.n >= gate.minN && o.days >= gate.minDays },
    { id: "net", label: "Profitable after costs", ok: (o.avgNet ?? 0) > 0 },
    { id: "t", label: `t-stat ≥ ${gate.minT}`, ok: (adjustedT(o) ?? 0) >= gate.minT },
    { id: "fdr", label: "Survives false-discovery control", ok: v.fdr },
    { id: "dsr", label: `Deflated Sharpe ≥ ${gate.minDsr}`, ok: (v.dsr ?? 0) >= gate.minDsr },
    { id: "is", label: "Worked in earlier years", ok: (v.inSample.avgNet ?? 0) > 0 },
    { id: "spy", label: "Beats the S&P 500", ok: (o.avgExSpy ?? 0) > 0 },
    { id: "regime", label: `Works in ${gate.minRegimes}+ market regimes`, ok: goodRegimes >= gate.minRegimes },
  ];
}
