// Walk-forward evaluation with costs, date clustering, multiple-testing control and regime checks.
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
export function splitStats(s: Samples, keep: (i: number) => boolean): SplitStats & { clusters: number[] } {
  const by = new Map<number, [number, number]>();
  let n = 0, net = 0, gross = 0, ex = 0, hit = 0;
  for (let k = 0; k < s.i.length; k++) {
    const i = s.i[k];
    if (!keep(i)) continue;
    n++;
    net += s.net[k];
    gross += s.gross[k];
    ex += s.exSpy[k];
    if (s.net[k] > 0) hit++;
    const c = by.get(i) ?? [0, 0];
    c[0] += s.net[k];
    c[1]++;
    by.set(i, c);
  }
  const clusters = [...by.values()].map(([a, b]) => a / b);
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
    clusters,
  };
}

export interface VariantInput {
  key: string;
  samples: Samples;
}

export interface VariantProof {
  key: string;
  inSample: SplitStats;
  outSample: SplitStats;
  dsr: number | null;
  fdr: boolean;
  regimes: Record<Regime, { n: number; avgNet: number | null }>;
  years: { year: string; n: number; avgNet: number | null }[];
  /** Cumulative average net return per month (out-of-sample highlighted from OOS_START). */
  curve: [string, number][];
  maxDrawdown: number;
  passed: boolean;
  failed: string[];
}

export const GATE = { minN: 100, minDays: 50, minT: 2, minDsr: 0.95, fdrQ: 0.05, minRegimeN: 30, minRegimes: 2 };

/** Evaluate every variant and apply the strict gate. `dates` and `regime` are on the shared calendar. */
export function evaluate(variants: VariantInput[], dates: string[], regime: Regime[]): VariantProof[] {
  const oosFrom = dates.findIndex((d) => d >= OOS_START);
  const isS = variants.map((v) => splitStats(v.samples, (i) => i < oosFrom));
  const oosS = variants.map((v) => splitStats(v.samples, (i) => i >= oosFrom));
  const pv = oosS.map((s) => (s.t == null ? 1 : pOneSided(s.t)));
  const fdr = bhFdr(pv, GATE.fdrQ);
  const srs = oosS.map((s) => s.sharpe).filter((x): x is number => x != null);
  const srMean = srs.reduce((a, b) => a + b, 0) / Math.max(srs.length, 1);
  const srVar = srs.reduce((a, b) => a + (b - srMean) ** 2, 0) / Math.max(srs.length - 1, 1);
  return variants.map((v, k) => {
    const o = oosS[k];
    const dsr = o.sharpe == null ? null : r4(deflatedSharpe(o.sharpe, o.clusters.length, o.skew, o.kurt, variants.length, srVar));
    const regimes = Object.fromEntries(REGIMES.map((r) => [r, { n: 0, sum: 0 }])) as Record<Regime, { n: number; sum: number }>;
    const years = new Map<string, { n: number; sum: number }>();
    const months = new Map<string, { n: number; sum: number }>();
    const s = v.samples;
    for (let j = 0; j < s.i.length; j++) {
      const i = s.i[j];
      const rg = regimes[regime[i]];
      rg.n++;
      rg.sum += s.net[j];
      const y = years.get(dates[i].slice(0, 4)) ?? { n: 0, sum: 0 };
      y.n++;
      y.sum += s.net[j];
      years.set(dates[i].slice(0, 4), y);
      const m = months.get(dates[i].slice(0, 7)) ?? { n: 0, sum: 0 };
      m.n++;
      m.sum += s.net[j];
      months.set(dates[i].slice(0, 7), m);
    }
    let cum = 0, peak = 0, dd = 0;
    const curve: [string, number][] = [...months.entries()].sort().map(([m, x]) => {
      cum += x.sum / x.n;
      peak = Math.max(peak, cum);
      dd = Math.min(dd, cum - peak);
      return [m, Math.round(cum * 1e4) / 1e4];
    });
    const reg = Object.fromEntries(REGIMES.map((r) => [r, { n: regimes[r].n, avgNet: regimes[r].n ? r4(regimes[r].sum / regimes[r].n) : null }])) as VariantProof["regimes"];
    const goodRegimes = REGIMES.filter((r) => reg[r].n >= GATE.minRegimeN && (reg[r].avgNet ?? 0) > 0).length;
    const failed: string[] = [];
    if (o.n < GATE.minN || o.days < GATE.minDays) failed.push(`Too few out-of-sample trades (${o.n})`);
    if (!((o.avgNet ?? 0) > 0)) failed.push("Loses money out of sample after costs");
    if (!((o.t ?? 0) >= GATE.minT)) failed.push(`Not statistically significant (t = ${o.t?.toFixed(2) ?? "n/a"})`);
    if (!fdr[k]) failed.push("Fails the false-discovery check across all strategies");
    if (!((dsr ?? 0) >= GATE.minDsr)) failed.push(`Deflated Sharpe ${dsr == null ? "n/a" : dsr.toFixed(2)} below ${GATE.minDsr}`);
    if (!((isS[k].avgNet ?? 0) > 0)) failed.push("Did not work in the earlier years");
    if (!((o.avgExSpy ?? 0) > 0)) failed.push("Does not beat the S&P 500 out of sample");
    if (goodRegimes < GATE.minRegimes) failed.push(`Works in only ${goodRegimes} market regime${goodRegimes === 1 ? "" : "s"}`);
    const strip = ({ clusters: _c, ...rest }: SplitStats & { clusters: number[] }) => rest;
    return {
      key: v.key,
      inSample: strip(isS[k]),
      outSample: strip(o),
      dsr,
      fdr: fdr[k],
      regimes: reg,
      years: [...years.entries()].sort().map(([year, x]) => ({ year, n: x.n, avgNet: r4(x.sum / x.n) })),
      curve,
      maxDrawdown: Math.round(dd * 1e4) / 1e4,
      passed: failed.length === 0,
      failed,
    };
  });
}
