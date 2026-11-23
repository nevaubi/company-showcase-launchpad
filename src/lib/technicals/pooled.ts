// Cross-company evidence for the Market view: the pipeline's pooled forward returns after each chart event
// (tech/signals.json), judged by the same rules as a single stock's evidence. The file publishes a 95%
// interval with standard errors clustered by calendar month; the interval is converted back to a p-value so
// every event-horizon pair can be adjusted together for the number of things tested.
import type { SignalsFile } from "./data";
import { EVIDENCE, type Horizon } from "./evidence";
import { bhAdjust, zTwoSided } from "./stat";
import TA from "./ta";

export type PooledReason = "ok" | "small" | "base" | "cost" | "unstable";
export const POOLED_REASON_TEXT: Record<PooledReason, string> = {
  ok: "Passes every check",
  small: "Small sample",
  base: "Not distinguishable from all days",
  cost: "Smaller than trading costs",
  unstable: "Sign differs between periods",
};

export interface PooledRow {
  type: string;
  name: string;
  dir: 1 | -1;
  text: string;
  h: Horizon;
  /** Events with a complete forward window, the calendar months they fall in, and the companies they come from */
  n: number;
  months: number;
  symbols: number;
  mean: number;
  hit: number;
  /** Mean and up-share over every company-day (the base rate) */
  base: number | null;
  baseHit: number | null;
  excess: number | null;
  ci: [number, number] | null;
  /** Standard error implied by the published interval, the z statistic and its two-sided p-value */
  se: number | null;
  z: number | null;
  p: number | null;
  /** Benjamini-Hochberg adjusted p-value over every event-horizon pair with enough events */
  q: number | null;
  verdict: "reliable" | "context";
  reason: PooledReason;
}

/** 97.5th percentile of the standard normal: the half-width of a 95% interval in standard errors. */
const Z975 = 1.959963984540054;
/** A period enters the stability check only with at least this many events. */
const MIN_PERIOD = 30;

/** Every event type at every horizon, with one false-discovery adjustment across the whole table. */
export function pooledFamily(SG: Pick<SignalsFile, "signals" | "base">): PooledRow[] {
  const rows: PooledRow[] = [];
  for (const type of Object.keys(TA.SIGNALS)) {
    const S = SG.signals[type];
    if (!S) continue;
    for (const h of EVIDENCE.horizons) {
      const P = S[String(h)];
      if (!P || typeof P !== "object" || !P.n) continue;
      const base = SG.base[String(h)]?.all;
      const ci = P.excess_ci ?? null;
      const excess = P.excess ?? null;
      const se = ci && ci[1] > ci[0] ? (ci[1] - ci[0]) / (2 * Z975) : null;
      const z = se != null && excess != null ? excess / se : null;
      const periods = Object.values(P.by_period ?? {}).filter((x) => x.n >= MIN_PERIOD && x.excess != null);
      const stable = excess == null || periods.every((x) => Math.sign(x.excess!) === Math.sign(excess));
      rows.push({
        type,
        name: TA.SIGNALS[type].name,
        dir: TA.SIGNALS[type].dir as 1 | -1,
        text: TA.SIGNALS[type].text,
        h,
        n: P.n,
        months: P.months,
        symbols: S.symbols,
        mean: P.mean,
        hit: P.hit,
        base: base?.mean ?? null,
        baseHit: base?.hit ?? null,
        excess,
        ci,
        se,
        z,
        p: z != null ? zTwoSided(z) : null,
        q: null,
        verdict: "context",
        // refined below once the family is known
        reason: stable ? "base" : "unstable",
      });
    }
  }
  const family = rows.filter((r) => r.p != null && r.n >= EVIDENCE.minPooled);
  const q = bhAdjust(family.map((r) => r.p!));
  family.forEach((r, i) => (r.q = q[i]));
  for (const r of rows) {
    const unstable = r.reason === "unstable";
    if (r.q == null) r.reason = "small";
    else if (r.q > EVIDENCE.fdr) r.reason = "base";
    else if (Math.abs(r.excess ?? 0) <= EVIDENCE.cost) r.reason = "cost";
    else if (unstable) r.reason = "unstable";
    else r.reason = "ok";
    r.verdict = r.reason === "ok" ? "reliable" : "context";
  }
  return rows;
}
