// Risk and chart-signal figures of a group: member beta (the group file), 60-day volatility (the member
// tape), average earnings move and live chart signals (the markets analytics file, built by
// scripts/markets.ts). Each figure states how many members it rests on, because the three sources do
// not cover the same companies and the markets file can be the small bundled copy. Pure.
import { PATTERN_META, type PatternKind } from "@/lib/markets/core";
import type { MarketsFile } from "@/lib/markets/query";
import { annualised, type MemberTape } from "./breadth";
import { mean, median } from "./stats";

export type Bias = "bullish" | "bearish" | "neutral";

export interface Signal {
  kind: PatternKind;
  label: string;
  bias: Bias;
  /** Rule that triggered it, for a tooltip. */
  rule: string;
  date: string;
  /** Sessions since it triggered. */
  ago: number | null;
}

export interface MarketLite {
  /** Earnings releases with a measured reaction. */
  prints: number;
  /** Average absolute move from the close before a release to the close of the day after. */
  avgAbsMove: number | null;
  /** Patterns that triggered in the last ten sessions. */
  signals: Signal[];
}

export interface MarketIndex {
  /** Day the file was built. */
  asOf: string | null;
  /** Companies in the file. */
  size: number;
  by: Map<string, MarketLite>;
}

/** The few fields the sector pages use out of the markets file, by ticker. */
export function marketIndex(f: Pick<MarketsFile, "generatedAt" | "companies">): MarketIndex {
  const by = new Map<string, MarketLite>();
  for (const c of f.companies ?? []) {
    const m = c.stats?.avgAbsMove;
    by.set(c.ticker, {
      prints: c.stats?.n ?? 0,
      avgAbsMove: typeof m === "number" && Number.isFinite(m) && (c.stats?.n ?? 0) > 0 ? m : null,
      signals: (c.active ?? [])
        .filter((h) => PATTERN_META[h.kind])
        .map((h) => ({ kind: h.kind, label: PATTERN_META[h.kind].label, bias: PATTERN_META[h.kind].bias, rule: PATTERN_META[h.kind].rule, date: h.date, ago: h.ago ?? null })),
    });
  }
  return { asOf: f.generatedAt ? f.generatedAt.slice(0, 10) : null, size: by.size, by };
}

export interface Based {
  /** The figure; null when no member has one. */
  v: number | null;
  /** Members it rests on. */
  n: number;
}

export interface GroupSignals {
  /** Live signals across the group. */
  total: number;
  /** Members with at least one. */
  companies: number;
  bullish: number;
  bearish: number;
  neutral: number;
  /** Count per pattern, most frequent first. */
  kinds: { kind: PatternKind; label: string; bias: Bias; n: number }[];
}

export interface GroupRisk {
  members: number;
  /** Median one-year beta to SPY of the members. */
  beta: Based;
  /** Median 60-day volatility of the members, annualised. */
  vol: Based;
  /** Mean of the members' average absolute earnings move. */
  earnings: Based;
  signals: GroupSignals;
  /** Members present in the markets file: earnings moves and signals describe only these. */
  covered: number;
}

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Earnings-move and signal figures of a group from the markets file. */
export function groupMarket(members: readonly string[], market: MarketIndex | null | undefined): { earnings: Based; signals: GroupSignals; covered: number } {
  const rows = members.map((t) => market?.by.get(t)).filter((r): r is MarketLite => !!r);
  const moves = rows.map((r) => r.avgAbsMove).filter(fin);
  const all = rows.flatMap((r) => r.signals);
  const kinds = new Map<PatternKind, GroupSignals["kinds"][number]>();
  for (const s of all) {
    const k = kinds.get(s.kind) ?? { kind: s.kind, label: s.label, bias: s.bias, n: 0 };
    k.n++;
    kinds.set(s.kind, k);
  }
  const of = (b: Bias) => all.filter((s) => s.bias === b).length;
  return {
    earnings: { v: mean(moves), n: moves.length },
    signals: {
      total: all.length,
      companies: rows.filter((r) => r.signals.length).length,
      bullish: of("bullish"),
      bearish: of("bearish"),
      neutral: of("neutral"),
      kinds: [...kinds.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    },
    covered: rows.length,
  };
}

/** Every risk figure of a group, each with the number of members behind it. */
export function groupRisk(
  members: readonly string[],
  src: { beta?: ReadonlyMap<string, number | null | undefined> | null; tape?: ReadonlyMap<string, MemberTape> | null; market?: MarketIndex | null },
): GroupRisk {
  const betas = members.map((t) => src.beta?.get(t)).filter(fin);
  const vols = members.map((t) => src.tape?.get(t)?.vol60).filter(fin);
  return {
    members: members.length,
    beta: { v: median(betas), n: betas.length },
    vol: { v: annualised(median(vols)), n: vols.length },
    ...groupMarket(members, src.market),
  };
}
