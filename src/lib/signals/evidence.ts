// How much each strategy variant's backtest is worth, worked out when the page is read from what
// the nightly job already stores (setup_variant_stats / setup_results): no new table and no rerun.
// Pure and browser-safe.
//
// Whether a rule may put signals on the list and how large its edge is taken to be are separate
// questions, answered separately:
//   1. Overlap. The stored t-statistic counts every signal day as independent although trades held
//      for h days overlap. Here the record is cut into calendar months, which do not overlap, and
//      the error of the monthly average allows for holds that run into the next month.
//   2. Membership: luck across many tries. Every variant is one try. A variant is listed only if it
//      survives Benjamini-Hochberg false-discovery control over all of them on the month-by-month
//      record, so when no rule has an edge the list is empty about nine days in ten.
//   3. Size: the variant's average is shrunk toward zero. It keeps the larger of an empirical-Bayes
//      share (spread of real edges estimated from every variant, low end used, more months keep
//      more) and the part of its own record above what the luckiest worthless rule would show.
//   4. Today's market: the variant's record in today's regime moves the edge up or down, itself
//      shrunk by how many trades that regime holds.
import { adjustedT, GATE, OOS_START, REGIMES, type Regime } from "./backtest";
import { weekdaysBetween } from "./events";
import type { VariantMeta } from "./setups";
import { bhQ, expectedMaxZ, hacSe, mean, normInv, std, tCdf } from "./stats";

export const EVIDENCE = {
  /** Months with trades a variant needs before its record can put it on the list. */
  minMonths: 24,
  /** False-discovery rates: one listed rule in twenty expected to be luck for a candidate, one in ten to be watched. */
  candidateFdr: 0.05,
  watchFdr: 0.1,
  /** One-sided 5% bar for a single test: the level two or three of 46 worthless rules reach by luck. */
  singleTestT: 1.645,
  /**
   * Regime samples are bunched in time, so each counts for half the months its share of trades
   * suggests. Measured on production samples (23 Nov 2026): the error of a within-regime monthly
   * average is 1.2 to 1.5 times (median, stressed regimes) what an even spread would give, on top
   * of all-years months being about twice as variable as months since 2022.
   */
  regimeDesign: 2,
  /** Finished live signals and independent holding periods needed before the live record can demote a variant. */
  liveMinN: 30,
  liveMinBlocks: 6,
  /** Standard errors below its expected edge at which a losing live record puts a variant on probation. */
  liveZ: -2,
} as const;

/** The record cut into calendar months, which do not overlap the way signal days do. */
export interface BlockStats {
  /** Calendar months with at least one trade. */
  months: number;
  /** Average of the monthly average net return per trade. */
  mean: number;
  /** Standard deviation of the monthly averages. */
  sd: number;
  /** Standard error of `mean`, allowing for holds that run into the following months. */
  se: number;
  t: number;
  /** Months with a positive average. */
  positive: number;
  /** Independent months the error is worth: (sd / se) squared. */
  nEff: number;
}

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/**
 * Month-by-month record from the stored curve (running sum of the monthly average net return per
 * trade). The error is the larger of the plain one and a Newey-West one over the months a hold can
 * reach into, so the correction can only widen it.
 */
export function monthlyBlocks(curve: readonly (readonly [string, number])[], horizon: number, from = OOS_START.slice(0, 7), minMonths = 12): BlockStats | null {
  const x: number[] = [], at: number[] = [];
  let prev = 0;
  for (const [m, cum] of curve) {
    const v = cum - prev;
    prev = cum;
    if (m >= from && Number.isFinite(v)) {
      x.push(v);
      at.push(monthIndex(m));
    }
  }
  if (x.length < minMonths) return null;
  const mu = mean(x), sd = std(x, mu);
  if (!(sd > 0)) return null;
  const lag = Math.max(1, Math.ceil((Number.isFinite(horizon) ? horizon : 1) / 21));
  const se = Math.max(sd / Math.sqrt(x.length), hacSe(x, lag, at));
  return { months: x.length, mean: mu, sd, se, t: mu / se, positive: x.filter((v) => v > 0).length, nEff: (sd / se) ** 2 };
}

/** How far real effects spread across variants, estimated by the method of moments. */
export interface PriorScale {
  /** Variance used: the estimate less one standard error, never below zero. */
  value: number;
  /** The plain estimate. */
  raw: number;
  /** Its standard error (NaN with fewer than three groups). */
  se: number;
  groups: number;
}

/**
 * Spread of real effects, in units of each item's own noise. An item is a t-statistic `z` worth `n`
 * independent observations; if its true effect per observation has variance tau2, then
 * E[z^2 - 1] = tau2 * n, so tau2 is the least-squares slope of (z^2 - 1) on n through the origin.
 * Items that share a group (two holding periods of one rule, the regimes of one variant) are
 * averaged first so they count once; the standard error is the robust one across groups.
 *
 * `positiveOnly` uses only items that came out positive. If every true effect were zero the squared
 * t of a positive item would still average 1, so the excess measures real winners alone. Losing
 * after costs is common and real; counting the losers would make the winners look more credible.
 */
export function priorScale(items: readonly { group: string; z: number; n: number }[], positiveOnly = false): PriorScale {
  const by = new Map<string, { a: number[]; n: number[] }>();
  for (const it of items) {
    if (!Number.isFinite(it.z) || !(it.n > 0) || (positiveOnly && !(it.z > 0))) continue;
    const g = by.get(it.group) ?? { a: [], n: [] };
    g.a.push(it.z * it.z - 1);
    g.n.push(it.n);
    by.set(it.group, g);
  }
  const g = [...by.values()].map((x) => ({ a: mean(x.a), n: mean(x.n) }));
  const snn = g.reduce((s, x) => s + x.n * x.n, 0);
  if (!g.length || !(snn > 0)) return { value: 0, raw: 0, se: NaN, groups: g.length };
  const raw = g.reduce((s, x) => s + x.n * x.a, 0) / snn;
  if (g.length < 3) return { value: 0, raw, se: NaN, groups: g.length };
  const meat = g.reduce((s, x) => s + (x.n * (x.a - raw * x.n)) ** 2, 0);
  const se = Math.sqrt((g.length / (g.length - 1)) * meat) / snn;
  return { value: Math.max(0, raw - se), raw, se, groups: g.length };
}

export interface RegimeFit {
  regime: Regime;
  /** Trades in this regime, all years. */
  n: number;
  /** Their average net return per trade. */
  mean: number;
  /** `mean` less the variant's average over all regimes. */
  deviation: number;
  /** Share of the deviation kept after shrinkage. */
  kept: number;
  /** What the regime adds to the variant's edge. */
  adjust: number;
}

export type LiveVerdict = "none" | "short" | "in line" | "ahead" | "behind";

export interface LiveCheck {
  /** Finished signals the engine caught as they fired. */
  n: number;
  avgNet: number | null;
  avgExSpy: number | null;
  hit: number | null;
  since: string | null;
  /** Holding periods laid end to end between the first live signal and the last that could have finished. */
  blocks: number;
  /** Range the backtest allows for an average over a record this short: expected edge plus or minus this. */
  band: number | null;
  /** Standard errors the live average sits from the expected edge. */
  z: number | null;
  verdict: LiveVerdict;
}

/**
 * proven: passes every check of the strict gate. candidate: not proven, but survives
 * false-discovery control at 5% on its month-by-month record. watch: survives it at 10%.
 * probation: would be listed, but its live record is well below its backtest. unproven: the rest.
 */
export type Grade = "proven" | "candidate" | "watch" | "probation" | "unproven";

/** Grades whose signals may appear in the default list. */
export const LISTED: readonly Grade[] = ["proven", "candidate", "watch"];

export interface VariantEvidence {
  key: string;
  strategy: VariantMeta["strategy"];
  family: VariantMeta["family"];
  side: 1 | -1;
  horizon: number;
  /** Passed every check of the strict gate. */
  passed: boolean;
  blocks: BlockStats | null;
  /** The stored t-statistic (signal days as independent; overlap-corrected once the job stores it). */
  tStored: number | null;
  /** One-sided p-value of the monthly record (Student's t), 1 without a record. */
  p: number;
  /** Smallest false-discovery rate at which this variant would be listed, among all variants. */
  q: number;
  /** Share of the monthly average kept after shrinkage toward zero. */
  kept: number;
  /** Expected net return per trade before today's regime. */
  base: number;
  regimes: RegimeFit[];
  /** Today's regime, when it has enough trades to say anything. */
  regime: RegimeFit | null;
  /** Expected net return per trade in today's regime, after costs. */
  edge: number;
  live: LiveCheck;
  grade: Grade;
  /** Why a variant that is not listed is where it is. */
  reason: string;
}

/** What the whole set of variants says about luck. */
export interface Discovery {
  /** Variants tried: every one counts as a test. */
  tested: number;
  /** The best t-statistic that many worthless rules are expected to show. */
  expectedBestT: number;
  /** The t-statistic the best rule needs to be watched: the first Benjamini-Hochberg step at the watch rate, Student's t on a typical record's months. */
  firstBarT: number;
  bestT: number | null;
  bestKey: string | null;
  /** Variants at or above the one-test bar, and how many luck alone would put there. */
  atSingleBar: number;
  expectedAtSingleBar: number;
  proven: number;
  candidates: number;
  watch: number;
  probation: number;
}

export interface EvidenceBook {
  asOf: string;
  regime: Regime;
  variants: VariantEvidence[];
  byKey: Map<string, VariantEvidence>;
  /** Spread of real edges across variants (per independent month, in units of monthly noise squared). */
  prior: PriorScale;
  /** Spread of real regime effects (same units). */
  regimePrior: PriorScale;
  discovery: Discovery;
}

const groupOf = (v: Pick<VariantMeta, "strategy" | "side">) => `${v.strategy}:${v.side > 0 ? "L" : "S"}`;

interface Cell {
  regime: Regime;
  n: number;
  mean: number;
  deviation: number;
  /** Sampling variance of the deviation, in units of the variant's monthly noise squared. */
  v: number;
}

/** A variant's regimes with enough trades, each with the error of its deviation from the variant's average. */
function regimeCells(v: VariantMeta, months: number): Cell[] {
  const cells = REGIMES.map((r) => ({ regime: r, n: v.regimes?.[r]?.n ?? 0, mean: v.regimes?.[r]?.avgNet ?? null }));
  const total = cells.reduce((s, c) => s + c.n, 0);
  if (!total) return [];
  const all = cells.reduce((s, c) => s + c.n * (c.mean ?? 0), 0) / total;
  const out: Cell[] = [];
  for (const c of cells) {
    if (c.mean == null || c.n < GATE.minRegimeN) continue;
    const share = c.n / total;
    // Months this regime is worth: its share of all months with trades, cut for bunching in time.
    const worth = Math.max((months * share) / EVIDENCE.regimeDesign, 1);
    // The regime is part of the average it is compared with, hence the (1 - share).
    out.push({ regime: c.regime, n: c.n, mean: c.mean, deviation: c.mean - all, v: (1 - share) / worth });
  }
  return out;
}

/** The t-statistic with `p` of Student's t below it (bisection on the CDF; `df` large reads as the normal). */
export function tQuantile(p: number, df: number): number {
  if (!(df > 0) || !Number.isFinite(df) || df > 1e4) return normInv(p);
  let lo = -60, hi = 60;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Degrees of freedom of a typical record: the median number of independent months, less one. */
function typicalDf(vs: readonly VariantEvidence[]): number {
  const n = vs.flatMap((e) => (e.blocks ? [e.blocks.nEff] : [])).sort((a, b) => a - b);
  if (!n.length) return Infinity;
  return Math.max((n.length % 2 ? n[n.length >> 1] : (n[n.length / 2 - 1] + n[n.length / 2]) / 2) - 1, 1);
}

/** Live record against what the backtest allows for a record that short. */
export function liveCheck(v: Pick<VariantMeta, "live" | "horizon">, expected: number, monthlySd: number | null, asOf: string): LiveCheck {
  const L = v.live;
  const n = L?.n ?? 0;
  const base: LiveCheck = { n, avgNet: L?.avgNet ?? null, avgExSpy: L?.avgExSpy ?? null, hit: L?.hit ?? null, since: L?.since ?? null, blocks: 0, band: null, z: null, verdict: "none" };
  if (!n || !L?.since || L.avgNet == null) return base;
  const h = Math.max(1, v.horizon || 1);
  // Signal days whose trades could have finished: a signal has to be one holding period old.
  const span = Math.max(0, weekdaysBetween(L.since, asOf) - h) + 1;
  const blocks = Math.floor((span - 1) / h) + 1;
  // An average over `span` trading days is noisier than a month's by sqrt(21 / span).
  const se = monthlySd != null && monthlySd > 0 ? monthlySd * Math.sqrt(21 / span) : null;
  const z = se ? (L.avgNet - expected) / se : null;
  const enough = n >= EVIDENCE.liveMinN && blocks >= EVIDENCE.liveMinBlocks;
  const verdict: LiveVerdict = !enough || z == null ? "short" : z <= EVIDENCE.liveZ && L.avgNet < 0 ? "behind" : z >= -EVIDENCE.liveZ ? "ahead" : "in line";
  return { ...base, blocks, band: se == null ? null : 1.96 * se, z, verdict };
}

/**
 * Evidence for every variant at once (false-discovery control and shrinkage need all of them).
 * `regime` is today's market regime and `asOf` the session the live records run to.
 */
export function buildEvidence(variants: readonly VariantMeta[], regime: Regime, asOf: string): EvidenceBook {
  const blocks = variants.map((v) => monthlyBlocks(v.curve ?? [], v.horizon));
  // One-sided p-values, Student's t on the months the error is worth. No record is no evidence.
  const p = blocks.map((b) => (b ? 1 - tCdf(b.t, Math.max(b.nEff - 1, 1)) : 1));
  const q = bhQ(p);

  const prior = priorScale(variants.flatMap((v, i) => (blocks[i] ? [{ group: groupOf(v), z: blocks[i]!.t, n: blocks[i]!.nEff }] : [])), true);
  const cells = variants.map((v, i) => (blocks[i] ? regimeCells(v, v.curve.length) : []));
  // Regime effects go either way, so every cell counts; a variant's regimes share its group.
  const regimePrior = priorScale(variants.flatMap((v, i) => cells[i].map((c) => ({ group: v.key, z: c.deviation / blocks[i]!.sd / Math.sqrt(c.v), n: 1 / c.v }))));

  const tested = variants.length;
  const lucky = expectedMaxZ(tested);
  const out: VariantEvidence[] = variants.map((v, i) => {
    const b = blocks[i];
    const head = { key: v.key, strategy: v.strategy, family: v.family, side: v.side, horizon: v.horizon, passed: v.passed, tStored: adjustedT(v.outSample), p: p[i], q: q[i] };
    if (!b) {
      return { ...head, blocks: null, kept: 0, base: 0, regimes: [], regime: null, edge: 0, live: liveCheck(v, 0, null, asOf), grade: "unproven", reason: "Under 12 months of trades since 2022" };
    }
    // Shrinkage from the whole set, or what the variant's own record keeps beyond the luckiest worthless rule, whichever is larger.
    const pooled = (prior.value * b.nEff) / (1 + prior.value * b.nEff);
    const own = b.t > lucky ? 1 - (lucky / b.t) ** 2 : 0;
    const kept = Math.max(pooled, own);
    const base = kept * b.mean;
    const fits: RegimeFit[] = cells[i].map((c) => {
      const k = regimePrior.value > 0 ? regimePrior.value / (regimePrior.value + c.v) : 0;
      return { regime: c.regime, n: c.n, mean: c.mean, deviation: c.deviation, kept: k, adjust: k ? k * c.deviation : 0 };
    });
    const fit = fits.find((f) => f.regime === regime) ?? null;
    const edge = base + (fit?.adjust ?? 0);
    const live = liveCheck(v, edge, b.sd, asOf);
    const enoughMonths = b.months >= EVIDENCE.minMonths;
    const ok = b.mean > 0 && enoughMonths && edge > 0;
    let grade: Grade = "unproven";
    if (v.passed && edge >= 0) grade = "proven";
    else if (ok && q[i] <= EVIDENCE.candidateFdr) grade = "candidate";
    else if (ok && q[i] <= EVIDENCE.watchFdr) grade = "watch";
    let reason = "";
    if (grade !== "unproven" && live.verdict === "behind") {
      grade = "probation";
      reason = "Live record is well below its backtest";
    } else if (grade === "unproven") {
      reason = !(b.mean > 0) ? "No profit after costs since 2022"
        : !enoughMonths ? `Only ${b.months} months with trades since 2022`
          : q[i] <= EVIDENCE.watchFdr ? "Has lost money in markets like today's"
            : "Cannot be told apart from luck";
    }
    return { ...head, blocks: b, kept, base, regimes: fits, regime: fit, edge, live, grade, reason };
  });

  let best: { key: string; t: number } | null = null;
  let atSingleBar = 0;
  for (const e of out) {
    if (!e.blocks) continue;
    if (!best || e.blocks.t > best.t) best = { key: e.key, t: e.blocks.t };
    if (e.blocks.t >= EVIDENCE.singleTestT) atSingleBar++;
  }
  const count = (g: Grade) => out.filter((e) => e.grade === g).length;
  const discovery: Discovery = {
    tested,
    expectedBestT: lucky,
    firstBarT: tQuantile(1 - EVIDENCE.watchFdr / Math.max(tested, 1), typicalDf(out)),
    bestT: best?.t ?? null,
    bestKey: best?.key ?? null,
    atSingleBar,
    expectedAtSingleBar: tested * 0.05,
    proven: count("proven"),
    candidates: count("candidate"),
    watch: count("watch"),
    probation: count("probation"),
  };
  return { asOf, regime, variants: out, byKey: new Map(out.map((e) => [e.key, e])), prior, regimePrior, discovery };
}
