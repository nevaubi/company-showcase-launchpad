// Evidence layer: which conditions have been followed by returns that differ from this stock's own base rate,
// after allowing for overlapping windows, small samples, trading costs and the number of things tested.
// A condition is called "reliable" only when every check passes; everything else is context.
import { bhFdr } from "@/lib/signals/stats";
import {
  conditions,
  indicators,
  type Bars,
  type Condition,
  type ConditionGroup,
  type Indicators,
} from "./conditions";
import {
  bhAdjust,
  forwardInterval,
  ForwardReturns,
  forwardTest,
  hashSeed,
  type ForwardTest,
} from "./stat";

export const EVIDENCE = {
  /** Forward horizons, trading days */
  horizons: [5, 20, 60] as const,
  /** First bar used (every indicator has warmed up by then; the same start as ta.js and the pipeline) */
  start: 252,
  /** Non-overlapping occurrences needed before a condition can count as reliable */
  minIndependent: 20,
  /** Below this only the count is shown */
  minReport: 8,
  /** Benjamini-Hochberg false-discovery rate across everything tested for the stock */
  fdr: 0.05,
  /** Round-trip trading cost the mean excess has to clear */
  cost: 0.002,
  /** Block-bootstrap resamples */
  bootstrap: 1000,
  /** A pooled cross-company statistic is used only with at least this many events */
  minPooled: 100,
} as const;

export type Horizon = (typeof EVIDENCE.horizons)[number];
export type Verdict = "reliable" | "context";
/** Why a tested condition is context and not a signal (the first check that fails). */
export type Reason =
  | "ok"
  | "few" // under minReport independent cases: no statistics
  | "small" // under minIndependent
  | "base" // not distinguishable from the base rate after multiple-testing control
  | "interval" // bootstrap interval includes zero
  | "cost" // smaller than the cost assumption
  | "unstable" // sign differs between the two halves of the history
  | "pooled"; // the cross-company statistics do not support it

export const REASON_TEXT: Record<Reason, string> = {
  ok: "Passes every check",
  few: "Too few cases to estimate",
  small: "Small sample",
  base: "Not distinguishable from the base rate",
  interval: "Interval includes zero",
  cost: "Smaller than trading costs",
  unstable: "Sign differs between the two halves of the history",
  pooled: "Not supported across tracked companies",
};

export interface PooledStat {
  n: number;
  excess: number | null;
  ci: [number, number] | null;
}
/** The shape of tech/signals.json this layer reads (cross-company forward returns after each event). */
export type PooledSignals = Record<
  string,
  Record<string, { n?: number; excess?: number | null; excess_ci?: [number, number] | null } | unknown>
>;

export interface EvidenceCell {
  test: ForwardTest;
  /** Benjamini-Hochberg adjusted p-value; null when the sample is too small to enter the family */
  q: number | null;
  verdict: Verdict;
  reason: Reason;
  pooled: PooledStat | null;
}
export interface EvidenceRow {
  key: string;
  name: string;
  group: ConditionGroup;
  kind: "state" | "event";
  dir: 1 | -1 | 0;
  text: string;
  active: boolean;
  /** State: first day of the current run. Event: latest day it fired. */
  atDate: string | null;
  sessionsAgo: number | null;
  /** Bars on which the condition held since the first bar used */
  days: number;
  cells: Partial<Record<Horizon, EvidenceCell>>;
}
export interface Evidence {
  rows: EvidenceRow[];
  /** Tests in the multiple-testing family */
  tested: number;
  reliable: { key: string; h: Horizon }[];
  /** First and last bar used, and how many sessions that is */
  sample: { from: string; to: string; bars: number };
}

function pooledOf(P: PooledSignals | null | undefined, key: string, h: number): PooledStat | null {
  const s = P?.[key]?.[String(h)] as
    | { n?: number; excess?: number | null; excess_ci?: [number, number] | null }
    | undefined;
  if (!s || typeof s !== "object" || !s.n) return null;
  return { n: s.n, excess: s.excess ?? null, ci: s.excess_ci ?? null };
}

/** Whether the cross-company statistics allow the stock's own result to stand. */
export function pooledSupports(p: PooledStat | null, excess: number): boolean {
  // No cross-company statistics for this condition (states), or too few pooled events: own history decides.
  if (!p || p.n < EVIDENCE.minPooled || !p.ci || p.excess == null) return true;
  const clear = p.ci[0] > 0 || p.ci[1] < 0;
  return clear && Math.sign(p.excess) === Math.sign(excess);
}

export interface EvidenceOptions {
  /** Bootstrap resamples (default EVIDENCE.bootstrap) */
  bootstrap?: number;
  /**
   * Which tests get a bootstrap interval: "all" (the page, which shows it for every row) or "candidates"
   * (only tests that pass multiple-testing control, the only place the interval decides anything).
   */
  intervals?: "all" | "candidates";
  pooled?: PooledSignals | null;
  /** Reuse indicator series already computed for the measures */
  indicators?: Indicators;
  seed?: string;
}

export function evidence(B: Bars, opt: EvidenceOptions = {}): Evidence {
  const n = B.c.length;
  const I = opt.indicators ?? indicators(B);
  const conds = conditions(B, I, EVIDENCE.start);
  const logRet = new Float64Array(n);
  for (let i = 1; i < n; i++) logRet[i] = Math.log(B.tr[i] / B.tr[i - 1]);
  const fwd = new Map<number, ForwardReturns>();
  for (const h of EVIDENCE.horizons) fwd.set(h, new ForwardReturns(B.tr, h));
  const B_ = opt.bootstrap ?? EVIDENCE.bootstrap;
  const seedBase = opt.seed ?? "";

  interface Draft {
    cond: Condition;
    h: Horizon;
    test: ForwardTest;
  }
  const drafts: Draft[] = [];
  for (const cond of conds)
    for (const h of EVIDENCE.horizons) {
      const t = forwardTest(fwd.get(h)!, logRet, cond.flag, cond.from);
      if (t && t.nEff >= EVIDENCE.minReport && Number.isFinite(t.t)) drafts.push({ cond, h, test: t });
    }

  // Multiple-testing family: every (condition, horizon) with enough independent cases to be a candidate.
  // The rule depends only on how often a condition occurred, never on what followed, so it cannot bias the tests.
  const family = drafts.filter((d) => d.test.nEff >= EVIDENCE.minIndependent);
  const q = bhAdjust(family.map((d) => d.test.p));
  const pass = bhFdr(
    family.map((d) => d.test.p),
    EVIDENCE.fdr,
  );
  const qOf = new Map<Draft, { q: number; pass: boolean }>();
  family.forEach((d, i) => qOf.set(d, { q: q[i], pass: pass[i] }));
  const all = (opt.intervals ?? "all") === "all";
  for (const d of drafts)
    if (all || qOf.get(d)?.pass)
      d.test.ci = forwardInterval(fwd.get(d.h)!, logRet, d.cond.flag, d.test, B_, hashSeed(`${seedBase}|${d.cond.key}|${d.h}`));

  const cellOf = (d: Draft): EvidenceCell => {
    const t = d.test;
    const fam = qOf.get(d);
    const pooled = d.cond.kind === "event" ? pooledOf(opt.pooled, d.cond.key, d.h) : null;
    let reason: Reason = "ok";
    if (!fam) reason = "small";
    else if (!fam.pass) reason = "base";
    else if (!t.ci || (t.ci[0] <= 0 && t.ci[1] >= 0)) reason = "interval";
    else if (Math.abs(t.excess) <= EVIDENCE.cost) reason = "cost";
    else if (
      t.halves[0] == null ||
      t.halves[1] == null ||
      Math.sign(t.halves[0]) !== Math.sign(t.excess) ||
      Math.sign(t.halves[1]) !== Math.sign(t.excess)
    )
      reason = "unstable";
    else if (!pooledSupports(pooled, t.excess)) reason = "pooled";
    return { test: t, q: fam ? fam.q : null, verdict: reason === "ok" ? "reliable" : "context", reason, pooled };
  };

  const rows: EvidenceRow[] = conds.map((cond) => {
    const cells: Partial<Record<Horizon, EvidenceCell>> = {};
    for (const d of drafts) if (d.cond === cond) cells[d.h] = cellOf(d);
    let days = 0;
    for (let i = cond.from; i < n; i++) days += cond.flag[i];
    return {
      key: cond.key,
      name: cond.name,
      group: cond.group,
      kind: cond.kind,
      dir: cond.dir,
      text: cond.text,
      active: cond.active,
      atDate: cond.at != null ? B.d[cond.at] : null,
      sessionsAgo: cond.at != null ? n - 1 - cond.at : null,
      days,
      cells,
    };
  });
  const reliable: { key: string; h: Horizon }[] = [];
  for (const r of rows)
    for (const h of EVIDENCE.horizons) if (r.cells[h]?.verdict === "reliable") reliable.push({ key: r.key, h });
  return {
    rows,
    tested: family.length,
    reliable,
    sample: {
      from: B.d[Math.min(EVIDENCE.start, n - 1)] ?? "",
      to: B.d[n - 1] ?? "",
      bars: Math.max(0, n - EVIDENCE.start),
    },
  };
}

/** Conditions in force today that pass every check, strongest (smallest q) first. */
export function reliableToday(E: Evidence): { row: EvidenceRow; h: Horizon; cell: EvidenceCell }[] {
  const out: { row: EvidenceRow; h: Horizon; cell: EvidenceCell }[] = [];
  for (const row of E.rows) {
    if (!row.active) continue;
    for (const h of EVIDENCE.horizons) {
      const cell = row.cells[h];
      if (cell?.verdict === "reliable") out.push({ row, h, cell });
    }
  }
  return out.sort((a, b) => (a.cell.q ?? 1) - (b.cell.q ?? 1));
}
