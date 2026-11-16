// Out-of-sample evaluation with costs, date clustering, multiple-testing control and regime checks.
// Rules are fixed in advance (published parameters, no fitting); 2016-2021 is the in-sample check and
// 2022 onward the out-of-sample test. Variants are reduced to per-day aggregates first so the same
// math runs on in-memory samples (script) and on database aggregates (daily job).
import { bhFdr, deflatedSharpe, moments, pOneSided } from "./stats";

export const OOS_START = "2022-01-01";
export type Regime = "Up, calm" | "Up, stressed" | "Down, calm" | "Down, stressed";
export const REGIMES: Regime[] = ["Up, calm", "Up, stressed", "Down, calm", "Down, stressed"];

/** Market regime at bar i: SPY vs its 200-day average, VIX vs 20. */
export function regimeAt(spy: ArrayLike<number>, spy200: ArrayLike<number>, vix: ArrayLike<number>, i: number): Regime {
  const up = !(spy[i] < spy200[i]);
  const calm = !(vix[i] >= 20);
  return `${up ? "Up" : "Down"}, ${calm ? "calm" : "stressed"}` as Regime;
}

/** Compact per-variant trade samples. `net` is the directional return vs the benchmark after costs. */
export class Samples {
  i: number[] = [];
  net: number[] = [];
  exSpy: number[] = [];
  gross: number[] = [];
  push(i: number, net: number, exSpy: number, gross: number) {
    this.i.push(i);
    this.net.push(net);
    this.exSpy.push(exSpy);
    this.gross.push(gross);
  }
}

/** All trades signalled on one calendar day, summed. */
export interface DailyAgg {
  i: number;
  n: number;
  net: number;
  ex: number;
  gross: number;
  hits: number;
}

export function aggregate(s: Samples): DailyAgg[] {
  const by = new Map<number, DailyAgg>();
  for (let k = 0; k < s.i.length; k++) {
    const i = s.i[k];
    const a = by.get(i) ?? { i, n: 0, net: 0, ex: 0, gross: 0, hits: 0 };
    a.n++;
    a.net += s.net[k];
    a.ex += s.exSpy[k];
    a.gross += s.gross[k];
    if (s.net[k] > 0) a.hits++;
    by.set(i, a);
  }
  return [...by.values()].sort((a, b) => a.i - b.i);
}

export interface SplitStats {
  n: number;
  days: number;
  avgNet: number | null;
  avgGross: number | null;
  avgExSpy: number | null;
  hit: number | null;
  t: number | null;
  sharpe: number | null;
  skew: number;
  kurt: number;
}

const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e5) / 1e5 : null);

/** Stats with returns first averaged per signal date, so 200 stocks firing on one day count as one observation. */
export function dailyStats(days: DailyAgg[]): SplitStats {
  let n = 0, net = 0, gross = 0, ex = 0, hit = 0;
  const clusters: number[] = [];
  for (const d of days) {
    if (!d.n) continue;
    n += d.n;
    net += d.net;
    gross += d.gross;
    ex += d.ex;
    hit += d.hits;
    clusters.push(d.net / d.n);
  }
  const m = clusters.length > 2 ? moments(clusters) : { mean: NaN, sd: NaN, skew: 0, kurt: 3 };
  const t = m.mean / (m.sd / Math.sqrt(clusters.length));
  return {
    n,
    days: clusters.length,
    avgNet: n ? r4(net / n) : null,
    avgGross: n ? r4(gross / n) : null,
    avgExSpy: n ? r4(ex / n) : null,
    hit: n ? r4(hit / n) : null,
    t: r4(t),
    sharpe: r4(m.mean / m.sd),
    skew: Number.isFinite(m.skew) ? m.skew : 0,
    kurt: Number.isFinite(m.kurt) ? m.kurt : 3,
  };
}

/** Back-compat helper used by tests: stats over the samples whose bar index passes `keep`. */
export function splitStats(s: Samples, keep: (i: number) => boolean): SplitStats {
  return dailyStats(aggregate(s).filter((d) => keep(d.i)));
}

export interface VariantInput {
  key: string;
  samples: Samples;
}

/** Everything about one variant that doesn't depend on the other variants. JSON-safe. */
export interface VariantPartial {
  key: string;
  inSample: SplitStats;
  outSample: SplitStats;
  regimes: Record<Regime, { n: number; avgNet: number | null }>;
  years: { year: string; n: number; avgNet: number | null }[];
  /** Cumulative average net return per month. */
  curve: [string, number][];
  maxDrawdown: number;
}

export interface VariantProof extends VariantPartial {
  dsr: number | null;
  fdr: boolean;
  passed: boolean;
  failed: string[];
}

export const GATE = { minN: 100, minDays: 50, minT: 2, minDsr: 0.95, fdrQ: 0.05, minRegimeN: 30, minRegimes: 2 };

/** Per-variant statistics from per-day aggregates on the shared calendar. */
export function variantPartial(key: string, days: DailyAgg[], dates: string[], regime: Regime[]): VariantPartial {
  const oosFrom = dates.findIndex((d) => d >= OOS_START);
  const cut = oosFrom < 0 ? dates.length : oosFrom;
  const valid = days.filter((d) => d.i >= 0 && d.i < dates.length);
  const regimes = Object.fromEntries(REGIMES.map((r) => [r, { n: 0, sum: 0 }])) as Record<Regime, { n: number; sum: number }>;
  const years = new Map<string, { n: number; sum: number }>();
  const months = new Map<string, { n: number; sum: number }>();
  for (const d of valid) {
    const rg = regimes[regime[d.i]];
    if (rg) {
      rg.n += d.n;
      rg.sum += d.net;
    }
    const y = years.get(dates[d.i].slice(0, 4)) ?? { n: 0, sum: 0 };
    y.n += d.n;
    y.sum += d.net;
    years.set(dates[d.i].slice(0, 4), y);
    const m = months.get(dates[d.i].slice(0, 7)) ?? { n: 0, sum: 0 };
    m.n += d.n;
    m.sum += d.net;
    months.set(dates[d.i].slice(0, 7), m);
  }
  let cum = 0, peak = 0, dd = 0;
  const curve: [string, number][] = [...months.entries()].sort().map(([m, x]) => {
    cum += x.sum / x.n;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
    return [m, Math.round(cum * 1e4) / 1e4];
  });
  return {
    key,
    inSample: dailyStats(valid.filter((d) => d.i < cut)),
    outSample: dailyStats(valid.filter((d) => d.i >= cut)),
    regimes: Object.fromEntries(REGIMES.map((r) => [r, { n: regimes[r].n, avgNet: regimes[r].n ? r4(regimes[r].sum / regimes[r].n) : null }])) as VariantPartial["regimes"],
    years: [...years.entries()].sort().map(([year, x]) => ({ year, n: x.n, avgNet: r4(x.sum / x.n) })),
    curve,
    maxDrawdown: Math.round(dd * 1e4) / 1e4,
  };
}

/** Apply the strict gate across every variant (false-discovery and deflated-Sharpe depend on all of them). */
export function finalize(parts: VariantPartial[]): VariantProof[] {
  const pv = parts.map((p) => (p.outSample.t == null ? 1 : pOneSided(p.outSample.t)));
  const fdr = bhFdr(pv, GATE.fdrQ);
  const srs = parts.map((p) => p.outSample.sharpe).filter((x): x is number => x != null);
  const srMean = srs.reduce((a, b) => a + b, 0) / Math.max(srs.length, 1);
  const srVar = srs.reduce((a, b) => a + (b - srMean) ** 2, 0) / Math.max(srs.length - 1, 1);
  return parts.map((p, k) => {
    const o = p.outSample;
    const dsr = o.sharpe == null ? null : r4(deflatedSharpe(o.sharpe, o.days, o.skew, o.kurt, parts.length, srVar));
    const goodRegimes = REGIMES.filter((r) => p.regimes[r].n >= GATE.minRegimeN && (p.regimes[r].avgNet ?? 0) > 0).length;
    const failed: string[] = [];
    if (o.n < GATE.minN || o.days < GATE.minDays) failed.push(`Too few out-of-sample trades (${o.n})`);
    if (!((o.avgNet ?? 0) > 0)) failed.push("Loses money out of sample after costs");
    if (!((o.t ?? 0) >= GATE.minT)) failed.push(`Not statistically significant (t = ${o.t?.toFixed(2) ?? "n/a"})`);
    if (!fdr[k]) failed.push("Fails the false-discovery check across all strategies");
    if (!((dsr ?? 0) >= GATE.minDsr)) failed.push(`Deflated Sharpe ${dsr == null ? "n/a" : dsr.toFixed(2)} below ${GATE.minDsr}`);
    if (!((p.inSample.avgNet ?? 0) > 0)) failed.push(p.inSample.n ? "Did not work in the earlier years" : "No earlier-years history to confirm it");
    if (!((o.avgExSpy ?? 0) > 0)) failed.push("Does not beat the S&P 500 out of sample");
    if (goodRegimes < GATE.minRegimes) failed.push(`Works in only ${goodRegimes} market regime${goodRegimes === 1 ? "" : "s"}`);
    return { ...p, dsr, fdr: fdr[k], passed: failed.length === 0, failed };
  });
}

/** Evaluate every variant and apply the strict gate. `dates` and `regime` are on the shared calendar. */
export function evaluate(variants: VariantInput[], dates: string[], regime: Regime[]): VariantProof[] {
  return finalize(variants.map((v) => variantPartial(v.key, aggregate(v.samples), dates, regime)));
}
