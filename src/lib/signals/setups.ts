// Shape of public/data/setups.json, written by `bun scripts/setups.ts`. Browser-safe.
import type { Regime, VariantProof } from "./backtest";
import type { StrategyId } from "./strategies";

export interface VariantMeta extends VariantProof {
  strategy: StrategyId;
  side: 1 | -1;
  horizon: number;
}

export interface Setup {
  ticker: string;
  name: string;
  sector: string;
  key: string;
  strategy: StrategyId;
  side: 1 | -1;
  horizon: number;
  firedAt: string;
  detail: string;
  strength: number;
  price: number;
  stop: number;
  target: number;
  /** Out-of-sample average net return in today's regime, shrunk toward zero for small samples. */
  edge: number;
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

export interface SetupsFile {
  generatedAt: string;
  asOf: string;
  companies: number;
  regime: Regime;
  oosStart: string;
  gate: Record<string, number>;
  variants: VariantMeta[];
  setups: Setup[];
  pairs: PairSetup[];
  /** Pairs strategy proof is in `variants` under key `pairs:L:20`. */
}

export const variantKey = (s: StrategyId, side: 1 | -1, h: number) => `${s}:${side > 0 ? "L" : "S"}:${h}`;
