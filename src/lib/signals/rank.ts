// Today's live signals turned into a short, ranked list at read time. Each signal takes its
// variant's expected edge (evidence.ts: shrunk backtest average, adjusted for today's regime), pays
// for any trading cost above the variant's usual, and has to get past a liquidity floor and
// crowding limits. Pure and deterministic: the same inputs always give the same list.
import { LISTED, type EvidenceBook, type Grade, type VariantEvidence } from "./evidence";
import { BORROW_FEE } from "./features";
import { riskPlan, type Setup } from "./setups";
import type { Family, StrategyId } from "./strategies";

/** One live firing as stored in `setup_signals`. */
export interface LiveSignal {
  ticker: string;
  name: string;
  sector: string;
  variant: string;
  firedAt: string;
  /** Session on which the engine first saw it; equal to `firedAt` when it was caught live. */
  firstSeen?: string | null;
  strength: number;
  detail: string;
  price: number;
  atr: number;
  /** 20-day average dollar volume; null on rows written by the full-history script. */
  dv20: number | null;
  /** Round-trip trading cost plus borrow for shorts, as a fraction of the position. */
  cost: number | null;
}

export type SideFilter = "all" | "long" | "short";
/** Holding period buckets: up to a week, up to two weeks, a month or more. */
export type HoldFilter = "all" | "week" | "fortnight" | "month";

export interface RankFilters {
  side: SideFilter;
  hold: HoldFilter;
  family: "all" | Family;
  sector: string;
  /** Least 20-day average dollar volume. */
  minDollarVolume: number;
}

/** Dollar-volume floors offered on the page; the default keeps out the engine's thinnest cost tier. */
export const LIQUIDITY_FLOORS = [5e6, 2e7, 1e8, 5e8] as const;
export const DEFAULT_FILTERS: RankFilters = { side: "all", hold: "all", family: "all", sector: "all", minDollarVolume: 2e7 };

/** Size of the list and how much of it one rule or one sector may take. */
export const RANK_LIMITS = { max: 20, perRule: 5, perSector: 5 } as const;
export type RankLimits = { max: number; perRule: number; perSector: number };

/**
 * A 14-day average range above this share of the price means the stored bars are wrong (a missed
 * split, a bad print): no stock moves 40% of its price a day for two weeks. Such a row gets no risk
 * plan, since its stop would sit at or below zero, and stays out of the ranked lists.
 */
export const MAX_ATR_SHARE = 0.4;
export const barsLookRight = (price: number, atr: number) => Number.isFinite(atr) && atr > 0 && atr < MAX_ATR_SHARE * price;

export const holdBucket = (horizon: number): Exclude<HoldFilter, "all"> => (horizon <= 5 ? "week" : horizon <= 10 ? "fortnight" : "month");

/**
 * 20-day dollar volume of a signal: the stored figure, or the floor of the cost tier the engine
 * charged it (the round trip is priced from dollar volume, see `roundTripCost`), so rows without
 * a stored figure can still be held to the liquidity floor.
 */
export function dollarVolumeOf(s: Pick<LiveSignal, "dv20" | "cost">, side: 1 | -1, horizon: number): number | null {
  if (s.dv20 != null && s.dv20 > 0) return s.dv20;
  if (s.cost == null || !Number.isFinite(s.cost)) return null;
  const roundTrip = s.cost - (side < 0 ? (BORROW_FEE * horizon) / 252 : 0);
  const eps = 1e-5;
  return roundTrip <= 0.0004 + eps ? 5e8 : roundTrip <= 0.0008 + eps ? 1e8 : roundTrip <= 0.0016 + eps ? 2e7 : 5e6;
}

export interface RankedSetup {
  /** ticker|variant|firedAt, unique per stored row. */
  id: string;
  ticker: string;
  name: string;
  sector: string;
  /** Variant key: strategy:side:holding days. */
  key: string;
  strategy: StrategyId;
  family: Family;
  side: 1 | -1;
  horizon: number;
  firedAt: string;
  detail: string;
  strength: number;
  price: number;
  atr: number;
  dollarVolume: number | null;
  cost: number | null;
  stop: number;
  target: number;
  /** Distance to the stop as a share of the price. */
  risk: number;
  grade: Grade;
  /** Expected net return of this trade: the variant's edge today less its cost above the variant's usual. */
  edge: number;
  /** Trading cost above the variant's median for the session; cheaper than usual earns nothing. */
  costPenalty: number;
  /** Smallest false-discovery rate at which the variant would be listed. */
  q: number;
  /** Overlap-corrected t-statistic of the variant's monthly record (null without one). */
  ruleT: number | null;
  /** Where this signal's strength sits among the variant's live signals: 0 weakest, 1 strongest. */
  strengthPct: number;
  /** Caught on the day it fired (counts toward the live record). */
  liveCaught: boolean;
  /** False when the stored price history is implausible (see `barsLookRight`): no risk plan, never ranked. */
  barsOk: boolean;
}

export interface Ranking {
  /** The default list: listed grades only, best first, crowding limits applied. */
  list: RankedSetup[];
  /** The same limits over every rule with a positive record that its live record does not contradict: what would be next in line. */
  closest: RankedSetup[];
  /** Every signal that passes the filters, one per ticker, rule and side, best first (rows with broken bars included, flagged). */
  all: RankedSetup[];
  counts: {
    /** Rows given, rows of variants the book knows, and distinct ticker and variant pairs left after the filters. */
    fired: number;
    known: number;
    filtered: number;
    /** Signals from listed rules after the filters, before crowding. */
    listed: number;
  };
}

const median = (x: number[]) => {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const GRADE_ORDER: Record<Grade, number> = { proven: 0, candidate: 1, watch: 2, probation: 3, unproven: 4 };

/**
 * Best first. Listed rules rank by expected edge; rules that are not listed have no edge worth the
 * name, so they rank by how close their record comes (its t-statistic). Then: cheaper to trade,
 * fired more recently, stronger, more liquid, and names, so ties never depend on input order.
 */
export function compareSetups(a: RankedSetup, b: RankedSetup): number {
  const listed = LISTED.includes(a.grade) && LISTED.includes(b.grade);
  return (
    GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] ||
    (listed ? b.edge - a.edge : 0) ||
    (b.ruleT ?? -99) - (a.ruleT ?? -99) ||
    b.edge - a.edge ||
    a.costPenalty - b.costPenalty ||
    (a.firedAt < b.firedAt ? 1 : a.firedAt > b.firedAt ? -1 : 0) ||
    b.strengthPct - a.strengthPct ||
    (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0) ||
    (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/** Crowding control over rows already in rank order: one per ticker, a few per rule and side, a few per sector. */
export function crowd(rows: readonly RankedSetup[], limits: RankLimits = RANK_LIMITS): RankedSetup[] {
  const out: RankedSetup[] = [];
  const tickers = new Set<string>();
  const perRule = new Map<string, number>();
  const perSector = new Map<string, number>();
  for (const r of rows) {
    if (out.length >= limits.max) break;
    const rule = `${r.strategy}:${r.side}`;
    if (tickers.has(r.ticker) || (perRule.get(rule) ?? 0) >= limits.perRule || (perSector.get(r.sector) ?? 0) >= limits.perSector) continue;
    out.push(r);
    tickers.add(r.ticker);
    perRule.set(rule, (perRule.get(rule) ?? 0) + 1);
    perSector.set(r.sector, (perSector.get(r.sector) ?? 0) + 1);
  }
  return out;
}

const passes = (r: RankedSetup, f: RankFilters) =>
  (f.side === "all" || (f.side === "long") === r.side > 0) &&
  (f.hold === "all" || holdBucket(r.horizon) === f.hold) &&
  (f.family === "all" || r.family === f.family) &&
  (f.sector === "all" || r.sector === f.sector) &&
  // The engine never trades under $5M a day, so that floor lets everything it stored through.
  (f.minDollarVolume <= 5e6 || (r.dollarVolume ?? 0) >= f.minDollarVolume);

/**
 * Rank a session's live signals. Signals of variants the book does not know are dropped (pairs are
 * shown separately). A signal's strength is used only to order signals of the same rule: on the
 * live record so far it shows no relation to the outcome, so it does not change the expected edge.
 */
export function rankSetups(book: EvidenceBook, signals: readonly LiveSignal[], filters: RankFilters = DEFAULT_FILTERS, limits: RankLimits = RANK_LIMITS): Ranking {
  const known = signals.filter((s) => book.byKey.has(s.variant) && Number.isFinite(s.price) && s.price > 0);
  // A rule that fires on the same stock several days running is one setup: keep the latest firing.
  const latest = new Map<string, LiveSignal>();
  for (const s of known) {
    const k = `${s.ticker}|${s.variant}`;
    const cur = latest.get(k);
    if (!cur || s.firedAt > cur.firedAt) latest.set(k, s);
  }
  const byVariant = new Map<string, LiveSignal[]>();
  for (const s of latest.values()) {
    const g = byVariant.get(s.variant) ?? [];
    g.push(s);
    byVariant.set(s.variant, g);
  }
  const rows: RankedSetup[] = [];
  for (const [key, group] of byVariant) {
    const e = book.byKey.get(key) as VariantEvidence;
    const usual = median(group.map((s) => s.cost).filter((c): c is number => c != null && Number.isFinite(c)));
    const strengths = group.map((s) => s.strength).filter((x) => Number.isFinite(x));
    for (const s of group) {
      const below = strengths.filter((x) => x < s.strength).length;
      const ties = strengths.filter((x) => x === s.strength).length;
      const strengthPct = strengths.length > 1 && Number.isFinite(s.strength) ? (below + (ties - 1) / 2) / (strengths.length - 1) : 0.5;
      const costPenalty = s.cost != null && Number.isFinite(usual) ? Math.max(0, s.cost - usual) : 0;
      const plan = riskPlan(e.family, e.side, s.price, s.atr);
      rows.push({
        id: `${s.ticker}|${key}|${s.firedAt}`,
        ticker: s.ticker, name: s.name, sector: s.sector, key, strategy: e.strategy, family: e.family, side: e.side, horizon: e.horizon,
        firedAt: s.firedAt, detail: s.detail, strength: s.strength, price: s.price, atr: s.atr,
        dollarVolume: dollarVolumeOf(s, e.side, e.horizon), cost: s.cost, stop: plan.stop, target: plan.target, risk: Math.abs(s.price - plan.stop) / s.price,
        grade: e.grade, edge: e.edge - costPenalty, costPenalty, q: e.q, ruleT: e.blocks?.t ?? null, strengthPct,
        liveCaught: s.firstSeen != null && s.firstSeen === s.firedAt,
        barsOk: barsLookRight(s.price, s.atr),
      });
    }
  }
  const filtered = rows.filter((r) => passes(r, filters)).sort(compareSetups);
  // One row per ticker, rule and side: the better-evidenced holding period.
  const seen = new Set<string>();
  const all = filtered.filter((r) => {
    const k = `${r.ticker}|${r.strategy}|${r.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const listed = all.filter((r) => r.barsOk && LISTED.includes(r.grade) && (r.grade === "proven" ? r.edge >= 0 : r.edge > 0));
  // Next in line: a positive record, and no live record that contradicts it (probation for a rule that
  // would be listed, "behind" for one that is not: well below zero over enough holding periods).
  const next = all.filter((r) => {
    const e = book.byKey.get(r.key);
    return r.barsOk && r.grade !== "probation" && e?.live.verdict !== "behind" && (e?.blocks?.mean ?? 0) > 0;
  });
  return {
    list: crowd(listed, limits),
    closest: crowd(next, limits),
    all,
    counts: { fired: signals.length, known: known.length, filtered: filtered.length, listed: listed.length },
  };
}

/** A ranked row in the shape the published file and the assistant use. */
export function toSetup(r: RankedSetup, spark: number[] = []): Setup {
  return {
    ticker: r.ticker, name: r.name, sector: r.sector, key: r.key, strategy: r.strategy, family: r.family, side: r.side, horizon: r.horizon,
    firedAt: r.firedAt, detail: r.detail, strength: +r.strength.toFixed(2), price: +r.price.toFixed(2), stop: r.stop, target: r.target, atr: +r.atr.toFixed(3),
    edge: +r.edge.toFixed(5), proven: r.grade === "proven", spark,
  };
}
