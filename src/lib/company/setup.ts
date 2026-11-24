// Levels and chart signals for the Overview's price section, computed from the bars the page already loads instead
// of a precomputed file: the file covers a small part of the universe and is days old by the time it is read.
// Everything here is the shared market rules (src/lib/markets/core.ts) applied to one company's daily bars. Pure.
import { detectPatterns, earningsReactions, patternEdges, PATTERN_META, reactionStats, supportResistance, type PatternKind, type Reaction, type ReactionStats } from "@/lib/markets/core";
import type { Bar } from "@/lib/financials/types";

export interface Level {
  price: number;
  /** swing highs or lows that cluster at the level */
  touches: number;
}

export interface ActiveSignal {
  kind: PatternKind;
  label: string;
  bias: "bullish" | "bearish" | "neutral";
  rule: string;
  date: string;
  price: number;
  /** how the same rule played out on this stock before: times it fired with 20 sessions of follow-up, and how often it went the rule's way */
  past: { n: number; hitRate: number | null; avgFwd20: number | null } | null;
}

export interface ChartSetup {
  /** date of the last bar: what "now" means for the levels and signals */
  asOf: string;
  /** last adjusted close, the price the levels are measured from */
  price: number;
  /** nearest clustered level below and above the price */
  support: Level | null;
  resistance: Level | null;
  /** rules that fired in the last `RECENT_SESSIONS` sessions, newest first */
  active: ActiveSignal[];
  /** sessions of history the rules ran over */
  sessions: number;
}

export const RECENT_SESSIONS = 10;
/** Fewer bars than this and the rules (50- and 200-day averages, 52-week ranges) have nothing to stand on. */
export const MIN_SESSIONS = 60;

export function chartSetup(bars: Bar[]): ChartSetup | null {
  if (bars.length < MIN_SESSIONS) return null;
  const last = bars[bars.length - 1];
  const levels = supportResistance(bars);
  const hits = detectPatterns(bars);
  const edges = new Map(patternEdges(hits).map((e) => [e.kind, e]));
  const active: ActiveSignal[] = hits
    .filter((h) => h.index >= bars.length - RECENT_SESSIONS)
    .sort((a, b) => b.index - a.index)
    .map((h) => {
      const meta = PATTERN_META[h.kind];
      const e = edges.get(h.kind);
      return { kind: h.kind, label: meta.label, bias: meta.bias, rule: meta.rule, date: h.date, price: h.price, past: e && e.n > 0 ? { n: e.n, hitRate: e.hitRate, avgFwd20: e.avgFwd20 } : null };
    });
  return { asOf: last[0].slice(0, 10), price: last[5], support: levels.support[0] ?? null, resistance: levels.resistance[0] ?? null, active, sessions: bars.length };
}

export interface EarningsReactions {
  /** two-day reactions to past releases, newest first */
  reactions: Reaction[];
  stats: ReactionStats | null;
  /** date of the last bar the reactions were measured on */
  asOf: string | null;
}

/** Stock reactions to the company's earnings releases over the loaded bars, with the summary statistics. */
export function earningsRead(bars: Bar[], releases: { filed: string; accn: string; doc: string }[], spy?: Bar[]): EarningsReactions {
  const reactions = bars.length ? earningsReactions(bars, releases, spy) : [];
  return { reactions, stats: reactions.length ? reactionStats(reactions) : null, asOf: bars.at(-1)?.[0]?.slice(0, 10) ?? null };
}
