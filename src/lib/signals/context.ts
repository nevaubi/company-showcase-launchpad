// Shared market calendar and benchmarks for the setup engine (SPY, sector ETFs, VIX, VIX3M), stored
// as one compact file so the daily job and the full-history script scan on identical inputs. Pure.
import type { Bar } from "../financials/types";
import { align, rollMean, type Aligned } from "./features";
import { regimeAt, type Regime } from "./backtest";
import { chainBench, SECTOR_ETF, type ScanContext } from "./scan";

export const CALENDAR_START = "2016-01-01";
export const BENCH_SYMBOLS = ["SPY", "^VIX", ...new Set(Object.values(SECTOR_ETF))];

export interface BenchFile {
  generatedAt: string;
  dates: string[];
  /** Adjusted opens and closes per symbol on `dates` (null before the symbol's history starts). */
  o: Record<string, (number | null)[]>;
  c: Record<string, (number | null)[]>;
  vix3m: (number | null)[];
}

const r = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

/** Calendar = SPY trading days from CALENDAR_START through `end`. */
export function benchFromBars(bars: Record<string, Bar[]>, vix3m: Map<string, number>, end: string): BenchFile {
  const dates = (bars.SPY ?? []).map((b) => b[0].slice(0, 10)).filter((d) => d >= CALENDAR_START && d <= end).sort();
  const o: BenchFile["o"] = {}, c: BenchFile["c"] = {};
  for (const sym of BENCH_SYMBOLS) {
    const a = align(dates, bars[sym] ?? []);
    o[sym] = Array.from(a.o, (x, i) => (a.start >= 0 && i >= a.start ? r(x) : null));
    c[sym] = Array.from(a.c, (x, i) => (a.start >= 0 && i >= a.start ? r(x) : null));
  }
  // VIX3M: carry the last value over days Cboe didn't publish.
  let last: number | null = null;
  const v3 = dates.map((d) => (vix3m.has(d) ? (last = vix3m.get(d)!) : last));
  return { generatedAt: new Date().toISOString(), dates, o, c, vix3m: v3 };
}

function aligned(b: BenchFile, sym: string): Aligned | undefined {
  const cs = b.c[sym], os = b.o[sym];
  if (!cs) return undefined;
  const D = b.dates.length;
  const c = new Float64Array(D).fill(NaN), o = new Float64Array(D).fill(NaN);
  let start = -1;
  for (let i = 0; i < D; i++) {
    const x = cs[i];
    if (x != null) {
      c[i] = x;
      o[i] = os?.[i] ?? x;
      if (start < 0) start = i;
    } else if (start >= 0) {
      c[i] = c[i - 1];
      o[i] = c[i - 1];
    }
  }
  return { start, o, c, h: c, l: c, v: new Float64Array(D) };
}

export interface EngineContext extends ScanContext {
  vix3m: Float64Array;
}

export function contextFromBench(b: BenchFile): EngineContext {
  const spy = aligned(b, "SPY")!;
  const vixA = aligned(b, "^VIX");
  const D = b.dates.length;
  const vix = vixA ? vixA.c : new Float64Array(D).fill(NaN);
  const vix3m = new Float64Array(D).fill(NaN);
  const vixRatio = new Float64Array(D).fill(NaN);
  for (let i = 0; i < D; i++) {
    const v3 = b.vix3m[i];
    if (v3 != null && v3 > 0) {
      vix3m[i] = v3;
      vixRatio[i] = vix[i] / v3;
    }
  }
  const spy200 = rollMean(spy.c, 200, Math.max(spy.start, 0));
  const regime: Regime[] = b.dates.map((_, i) => regimeAt(spy.c, spy200, vix, i));
  const benches = new Map<string, Aligned>();
  return {
    dates: b.dates,
    spy,
    regime,
    vix,
    vix3m,
    vixRatio,
    benchFor: (sector: string) => {
      if (!benches.has(sector)) benches.set(sector, chainBench(spy, SECTOR_ETF[sector] ? aligned(b, SECTOR_ETF[sector]) : undefined));
      return benches.get(sector)!;
    },
  };
}

/** Cboe's VIX3M history CSV ("DATE,OPEN,HIGH,LOW,CLOSE", dates MM/DD/YYYY). */
export function parseCboeCsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const p = line.trim().split(",");
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(p[0] ?? "");
    const close = Number(p[4]);
    if (m && close > 0) out.set(`${m[3]}-${m[1]}-${m[2]}`, close);
  }
  return out;
}
export const VIX3M_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv";
