// One symbol's technical analysis, computed from its daily history: measures, tested conditions, the read,
// the earnings-reaction history and the event log. Pure and serialisable, so it runs in analysis.worker.ts
// (client.ts) with the main thread as the fallback, and in tests.
import type { Bar } from "@/lib/financials/types";
import { earningsReactions, reactionStats, type Reaction, type ReactionStats } from "@/lib/markets/core";
import TA from "./ta";
import { indicators, type Bars } from "./conditions";
import { evidence, EVIDENCE, type Evidence, type PooledSignals } from "./evidence";
import { measures, type BenchSeries, type Measures } from "./measures";
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
  read: ReadSentence[];
  reactions: { rows: Reaction[]; stats: ReactionStats } | null;
  events: EventLogRow[];
  /** Milliseconds the computation took */
  ms: number;
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

  let reactions: Technicals["reactions"] = null;
  if (releases.length) {
    // Bars in the price-file shape; the adjusted close carries the total-return index.
    const k = B.c[n - 1] / B.tr[n - 1];
    const bars: Bar[] = B.d.map((d, i) => [d, B.o[i], B.h[i], B.l[i], B.c[i], B.tr[i] * k, B.v[i]]);
    const spy = input.bench?.find((b) => b.kind === "market");
    const spyBars: Bar[] | undefined = spy?.d.map((d, i) => [d, spy.tr[i], spy.tr[i], spy.tr[i], spy.tr[i], spy.tr[i], 0]);
    const rows = earningsReactions(bars, releases, spyBars).filter((r) => r.date >= B.d[0]);
    if (rows.length) reactions = { rows, stats: reactionStats(rows) };
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
    read: technicalRead(M, E, { universe: input.universe }),
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
