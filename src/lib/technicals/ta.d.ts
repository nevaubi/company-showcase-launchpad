// Types for ta.js (the ported indicator and statistics library).
type Arr = (number | null)[];

export interface SignalDef {
  name: string;
  dir: 1 | -1;
  text: string;
}
export interface TaEvent {
  type: string;
  i: number;
  bars: number[];
}
export interface Summary {
  n: number;
  n_eff: number;
  mean?: number;
  median?: number;
  hit?: number;
  sd?: number | null;
  ci?: [number, number] | null;
  hit_ci?: [number | null, number | null];
  excess?: number;
  label?: string;
  pending?: number;
}
export interface Backtest {
  horizons: number[];
  base: Record<number, { n: number; mean: number; median: number; hit: number }>;
  signals: Record<string, Record<number, Summary>>;
}
export interface ConeRow {
  n: number;
  count: number;
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  current: number | null;
  pct: number | null;
}
export interface Moments {
  n: number;
  mean: number;
  sd: number;
  skew: number;
  kurt: number;
  p1: number;
  p5: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  beyond2: number;
  beyond3: number;
  normal2: number;
  normal3: number;
}
export interface Level {
  price: number;
  touches: number;
  bars: number[];
  first: number;
  last: number;
  kind: "support" | "resistance";
  highs: number;
  lows: number;
  distance: number;
}
export interface Gap extends TaEvent {
  edge: number;
  top: number;
  bottom: number;
  filled: number | null;
}
export interface TaState {
  i: number;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  vs50: number | null;
  vs200: number | null;
  slope50: number | null;
  rsi: number | null;
  atr: number | null;
  atrPct: number | null;
  macd: number | null;
  macdSig: number | null;
  macdHist: number | null;
  adx: number | null;
  pdi: number | null;
  mdi: number | null;
  st: number | null;
  stLine: number | null;
  hi52: number;
  hi52i: number;
  lo52: number;
  lo52i: number;
  fromHi: number;
  fromLo: number;
  squeeze: number;
  bbWidth: number | null;
  bbWidthPct: number | null;
  trend: "up" | "down" | "mixed" | null;
}
export interface Analysis {
  events: TaEvent[];
  squeeze: boolean[];
  levels: Level[];
  trend: unknown;
  gaps: Gap[];
  backtest: Backtest;
  cone: ConeRow[];
  moments: Moments;
  hist: { x0: number; x1: number; n: number }[];
  dd: number[];
  mdd: { dd: number; peak: number; trough: number; recovered: number | null };
  seas: { month: SeasonCell[]; dow: SeasonCell[]; monthRows: [string, number][] };
  state: TaState;
}
export interface SeasonCell {
  n: number;
  mean: number | null;
  median: number | null;
  hit: number | null;
  sd: number | null;
}
export interface Sentence {
  text: string;
  refs: string[];
}

declare const TA: {
  SIGNALS: Record<string, SignalDef>;
  analyze(x: { o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; tr: number[]; d: string[] }): Analysis;
  risk(x: { c: number[]; bench: Record<string, { v: (number | null)[]; rate: boolean }>; windows: number[] }): Record<string, Record<number, { beta: Arr; corr: Arr }>>;
  summary(st: TaState, extra?: { cone?: ConeRow[]; since?: string; rsSpy?: number | null; rsSector?: number | null; recent?: { type: string; date: string }[] }): Sentence[];
  validateSummary(sentences: Sentence[], values: Record<string, unknown>): string[];
  sma(a: Arr, n: number): Arr;
  ema(a: Arr, n: number): Arr;
  rsi(c: number[], n?: number): Arr;
  macd(c: number[], fast?: number, slow?: number, sig?: number): { line: Arr; signal: Arr; hist: Arr };
  bollinger(c: number[], n?: number, k?: number): { mid: Arr; upper: Arr; lower: Arr; width: Arr; pctb: Arr };
  supertrend(h: number[], l: number[], c: number[], n?: number, mult?: number): { line: Arr; dir: Arr };
  realizedVol(c: number[], n: number): Arr;
  logRets(c: number[]): Arr;
  quantile(sorted: number[], q: number): number | null;
  meanOf(a: number[]): number | null;
};
export default TA;
