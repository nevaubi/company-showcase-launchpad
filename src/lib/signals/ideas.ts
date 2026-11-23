// Trade ideas (three-month, fundamentals-led) ranked at read time from the published file: what each
// rule's history can and cannot say, and a short list that only holds ideas resting on a rule that
// has at least made money against the S&P 500. Pure and deterministic.
import { SIGNAL_META, type BacktestStats, type Direction, type Idea, type SignalKind } from "./core";

export const IDEA_LIMITS = { max: 12, perSector: 3, minFirings: 100 } as const;

/** Rules in display order: fundamentals first, then price, longs before shorts. */
export const RULE_ORDER: SignalKind[] = ["cheap", "accel", "insiderBuy", "pullback", "rich", "decel", "breakdown"];

/**
 * edge: beat the S&P 500 more often than a coin flip allows and made money against it on average.
 * coin flip: made money on average, but its hit rate is inside what a coin flip gives.
 * against: lost against the S&P 500 on average. thin: too few firings to say anything.
 */
export type RuleReading = "edge" | "coin flip" | "against" | "thin";

export interface RuleRecord {
  kind: SignalKind;
  label: string;
  dir: Direction;
  rule: string;
  /** Historical firings, each held three months. */
  n: number;
  /** Average return against the S&P 500, in the rule's direction. */
  avgExcess: number | null;
  /** Share of firings that beat the S&P 500. */
  hitRate: number | null;
  /** Half-width of the 95% range a fair coin gives over `n` independent firings, around 50%. */
  band: number | null;
  reading: RuleReading;
}

/** 95% range of a fair coin's hit rate over n independent tosses: 50% plus or minus this. */
export const coinBand = (n: number) => (n > 0 ? 1.96 * Math.sqrt(0.25 / n) : null);

export function ruleRecord(kind: SignalKind, s: BacktestStats | undefined): RuleRecord {
  const meta = SIGNAL_META[kind];
  const n = s?.n ?? 0;
  const base = { kind, label: meta.label, dir: meta.dir, rule: meta.rule, n, avgExcess: s?.avgExcess ?? null, hitRate: s?.hitRate ?? null, band: coinBand(n) };
  if (n < IDEA_LIMITS.minFirings || base.avgExcess == null || base.hitRate == null || base.band == null) return { ...base, reading: "thin" };
  if (base.avgExcess <= 0) return { ...base, reading: "against" };
  return { ...base, reading: base.hitRate - 0.5 > base.band ? "edge" : "coin flip" };
}

export function ruleRecords(pooled: Partial<Record<SignalKind, BacktestStats>>): RuleRecord[] {
  return RULE_ORDER.map((k) => ruleRecord(k, pooled[k]));
}

export const READING_LABEL: Record<RuleReading, string> = {
  edge: "Beat the S&P 500 more often than chance",
  "coin flip": "No better than a coin flip",
  against: "Lost to the S&P 500 on average",
  thin: "Too few firings to judge",
};

export interface RankedIdea extends Idea {
  /** Signals pointing the idea's way. */
  reasons: number;
  /** Of those, signals whose rule has made money against the S&P 500 over enough firings. */
  supported: number;
  /** Signals pointing the other way. */
  opposing: number;
  /** Average of the supported rules' excess return: what history says such an idea made in three months. */
  expected: number | null;
}

export interface IdeaRanking {
  /** Ideas resting on a rule that made money, best first, a few per sector. */
  list: RankedIdea[];
  /** Every idea, best first; ideas resting only on rules that lost or have no record come last. */
  all: RankedIdea[];
}

/**
 * Rank the published ideas. An idea counts a reason only when that reason's rule has made money
 * against the S&P 500 over at least `minFirings` firings; an opposing signal cancels one reason.
 * Ties: more reasons, the better rule record, then the ticker, so the order never depends on input order.
 */
export function rankIdeas(ideas: readonly Idea[], pooled: Partial<Record<SignalKind, BacktestStats>>, limits: { max: number; perSector: number } = IDEA_LIMITS): IdeaRanking {
  const records = new Map(RULE_ORDER.map((k) => [k, ruleRecord(k, pooled[k])]));
  const rows: RankedIdea[] = ideas.map((idea) => {
    const aligned = idea.signals.filter((s) => SIGNAL_META[s.kind].dir === idea.direction);
    const good = aligned.filter((s) => {
      const r = records.get(s.kind)?.reading;
      return r === "edge" || r === "coin flip";
    });
    const expected = good.length ? good.reduce((a, s) => a + (records.get(s.kind)!.avgExcess ?? 0), 0) / good.length : null;
    return { ...idea, reasons: aligned.length, supported: good.length, opposing: idea.signals.length - aligned.length, expected };
  });
  const net = (r: RankedIdea) => r.supported - r.opposing;
  const all = rows.sort(
    (a, b) =>
      net(b) - net(a) ||
      b.supported - a.supported ||
      b.reasons - a.reasons ||
      (b.expected ?? -1) - (a.expected ?? -1) ||
      (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
  );
  const list: RankedIdea[] = [];
  const perSector = new Map<string, number>();
  for (const r of all) {
    if (list.length >= limits.max) break;
    if (net(r) < 1 || (perSector.get(r.sector) ?? 0) >= limits.perSector) continue;
    list.push(r);
    perSector.set(r.sector, (perSector.get(r.sector) ?? 0) + 1);
  }
  return { list, all };
}

/** What the rules' histories add up to, in one plain sentence. */
export function ideasVerdict(records: readonly RuleRecord[]): string {
  const judged = records.filter((r) => r.reading !== "thin");
  const edge = judged.filter((r) => r.reading === "edge");
  const against = judged.filter((r) => r.reading === "against");
  if (!judged.length) return "No rule has enough history to judge yet.";
  if (edge.length) return `${edge.length} of ${judged.length} rules beat the S&P 500 more often than a coin flip allows. The rest did not.`;
  return `None of the ${judged.length} rules with a history has beaten the S&P 500 more often than a coin flip allows${against.length ? `, and ${against.length} lost to it on average` : ""}. Use these ideas as a place to start research, not as forecasts.`;
}
