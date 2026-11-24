// One symbol's technical analysis, computed from its daily history: measures, tested conditions, the read,
// the earnings-reaction history and the event log. Pure and serialisable, so it runs in analysis.worker.ts
// (client.ts) with the main thread as the fallback, and in tests.
import type { Bar } from "@/lib/financials/types";
import { earningsReactions, reactionStats, type Reaction, type ReactionStats } from "@/lib/markets/core";
import TA from "./ta";
import { indicators, type Bars } from "./conditions";
import { evidence, EVIDENCE, type Evidence, type PooledSignals } from "./evidence";
import { measures, type BenchSeries, type Measures } from "./measures";
import type { SignalsFile } from "./data";
import { pooledFamily, type PooledRow } from "./pooled";
import { binomTwoSided, ForwardReturns, forwardTest, type ForwardTest } from "./stat";
import { technicalRead, type ReadContext, type ReadSentence } from "./read";

export interface AnalysisInput {
  sym: string;
  bars: Bars;
  /** SPY and the sector ETF, when the symbol has them */
  bench?: BenchSeries[];
  /** Earnings releases (8-K results): the filing date and the filing to open */
  releases?: { filed: string; accn: string; doc: string }[];
  /** tech/signals.json `signals`: cross-company forward returns after each event */
  pooled?: PooledSignals | null;
  /** tech/signals.json `base`: the all-days rate behind each pooled excess (needed for the cross-company verdicts) */
  pooledBase?: SignalsFile["base"] | null;
  universe?: ReadContext["universe"];
  /** See EvidenceOptions.intervals */
  intervals?: "all" | "candidates";
}

export interface EventLogRow {
  date: string;
  i: number;
  type: string;
  name: string;
  dir: 1 | -1;
  close: number;
  /** Forward total return by horizon; null while the window is still open */
  fwd: Record<number, number | null>;
}

export interface Technicals {
  sym: string;
  asOf: string;
  first: string;
  bars: number;
  measures: Measures;
  evidence: Evidence;
  /** The cross-company record of each chart event and horizon (pooled.ts); null when the file is not available */
  pooled: PooledRow[] | null;
  read: ReadSentence[];
  reactions: { rows: Reaction[]; stats: ReactionStats; drift: DriftTest } | null;
  events: EventLogRow[];
  /** Milliseconds the computation took */
  ms: number;
}

/**
 * What followed the releases, tested like any other condition: the release windows' ends are a flag series,
 * and the 20-day return after them is compared with every 20-day window of the history (Hodrick standard
 * error, Student-t). The continuation share is compared with what independence would give: if the next 20
 * days had nothing to do with the reaction, a share up × up-share of all windows + (1 − up) × (1 − up-share)
 * would continue it; the p-value is an exact two-sided binomial test.
 */
export interface DriftTest {
  h: number;
  test: ForwardTest | null;
  /** Releases with a complete 20-day window, how many continued the reaction's direction, and the share independence predicts */
  n: number;
  continued: number;
  expected: number | null;
  p: number | null;
}

export function driftTest(B: Bars, rows: Reaction[], h = 20): DriftTest {
  const n = B.c.length;
  const flag = new Uint8Array(n);
  const ends: { end: number; move: number }[] = [];
  for (const r of rows) {
    const i = B.d.findIndex((d) => d >= r.date);
    if (i <= 0 || i + 1 + h >= n) continue;
    flag[i + 1] = 1;
    ends.push({ end: i + 1, move: r.move });
  }
  const logRet = new Float64Array(n);
  for (let i = 1; i < n; i++) logRet[i] = Math.log(B.tr[i] / B.tr[i - 1]);
  const F = new ForwardReturns(B.tr, h);
  const test = ends.length ? forwardTest(F, logRet, flag, 0) : null;
  let continued = 0;
  let up = 0;
  for (const e of ends) {
    const fwd = B.tr[e.end + h] / B.tr[e.end] - 1;
    if (Math.sign(fwd) === Math.sign(e.move)) continued++;
    if (e.move > 0) up++;
  }
  const m = ends.length;
  const expected = test && m ? (up / m) * test.hitAll + (1 - up / m) * (1 - test.hitAll) : null;
  return { h, test, n: m, continued, expected, p: expected != null ? binomTwoSided(continued, m, expected) : null };
}

/** Fewer bars than this and nothing is computed (the 200-day average alone needs 200). */
export const MIN_BARS = 60;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function analyze(input: AnalysisInput): Technicals | null {
  const t0 = now();
  const B = input.bars;
  const n = B.c.length;
  if (n < MIN_BARS) return null;
  const I = indicators(B);
  const releases = input.releases ?? [];
  const M = measures({
    bars: B,
    indicators: I,
    bench: input.bench,
    earnings: releases.map((r) => r.filed.slice(0, 10)).sort(),
  });
  const E = evidence(B, { indicators: I, pooled: input.pooled, seed: input.sym, intervals: input.intervals });

  const pooled =
    input.pooled && input.pooledBase
      ? pooledFamily({ signals: input.pooled as SignalsFile["signals"], base: input.pooledBase })
      : null;

  let reactions: Technicals["reactions"] = null;
  if (releases.length) {
    // Bars in the price-file shape; the adjusted close carries the total-return index.
    const k = B.c[n - 1] / B.tr[n - 1];
    const bars: Bar[] = B.d.map((d, i) => [d, B.o[i], B.h[i], B.l[i], B.c[i], B.tr[i] * k, B.v[i]]);
    const spy = input.bench?.find((b) => b.kind === "market");
    const spyBars: Bar[] | undefined = spy?.d.map((d, i) => [d, spy.tr[i], spy.tr[i], spy.tr[i], spy.tr[i], spy.tr[i], 0]);
    const rows = earningsReactions(bars, releases, spyBars).filter((r) => r.date >= B.d[0]);
    if (rows.length) reactions = { rows, stats: reactionStats(rows), drift: driftTest(B, rows) };
  }

  const events: EventLogRow[] = [...I.events]
    .sort((a, b) => b.i - a.i)
    .map((e) => {
      const sg = TA.SIGNALS[e.type];
      const fwd: Record<number, number | null> = {};
      for (const h of EVIDENCE.horizons) fwd[h] = e.i + h < n ? B.tr[e.i + h] / B.tr[e.i] - 1 : null;
      return { date: B.d[e.i], i: e.i, type: e.type, name: sg?.name ?? e.type, dir: (sg?.dir ?? 1) as 1 | -1, close: B.c[e.i], fwd };
    });

  return {
    sym: input.sym,
    asOf: B.d[n - 1],
    first: B.d[0],
    bars: n,
    measures: M,
    evidence: E,
    pooled,
    read: technicalRead(M, E, { universe: input.universe, sym: input.sym, pooled }),
    reactions,
    events,
    ms: Math.round(now() - t0),
  };
}

/** Bars for the analysis from a price file's rows ([date, open, high, low, close, adjusted close, volume]). */
export function barsFromPriceRows(rows: Bar[]): Bars {
  const ok = rows.filter((b) => b[4] > 0 && b[0].length >= 10);
  const d = ok.map((b) => b[0].slice(0, 10));
  const adj0 = ok[0]?.[5] || ok[0]?.[4] || 1;
  return {
    d,
    o: ok.map((b) => b[1] || b[4]),
    h: ok.map((b) => Math.max(b[2] || b[4], b[4], b[1] || b[4])),
    l: ok.map((b) => Math.min(b[3] || b[4], b[4], b[1] || b[4])),
    c: ok.map((b) => b[4]),
    v: ok.map((b) => b[6] || 0),
    // The adjusted close is the split- and dividend-adjusted series, so its ratio is the total return.
    tr: ok.map((b) => (b[5] || b[4]) / adj0),
  };
}
