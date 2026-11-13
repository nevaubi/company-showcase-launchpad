// Stock splits put per-share figures and share counts from older filings on a different basis from newer
// ones: a 10-K reports EPS for the shares that existed when it was filed. Each period's value comes from the
// latest filing that disclosed it, so a ten-year row can hold three bases at once. This restates every
// per-share and share-count cell to today's basis, keeping the filed number as the cell's source. Pure.
import type { Cell, Period, Row, Statement } from "./types";

const SPLIT_NOTE = "stock split";
const AS_FILED = "As filed";

const rowOf = (rows: Row[], key: string) => rows.find((r) => r.key === key);

const RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];

/**
 * The split between two consecutive share counts, or 1. A split restates the weighted count exactly, so the
 * ratio sits within a couple of percent of a round number; buybacks and issuance drift and rarely land on one.
 * Precision matters more than recall here: a missed split leaves the filed figure, a false one invents a number.
 * 3-for-2 is accepted only on a near-exact match because a 50% share issuance looks the same.
 */
export function splitStep(later: number, earlier: number, tol: number, known: number[] = []): number {
  if (!(later > 0 && earlier > 0)) return 1;
  const r = later / earlier;
  const up = r >= 1 ? r : 1 / r;
  if (up < 1.4) return 1;
  const hit = (x: number, t: number) => Math.abs(up / x - 1) <= t;
  // A factor already proven on the tighter quarterly series may drift more over a full year.
  const proven = known.map((k) => (k >= 1 ? k : 1 / k)).find((k) => hit(k, 0.08));
  const s = proven ?? RATIOS.find((x) => hit(x, tol)) ?? (hit(1.5, Math.min(tol, 0.015)) ? 1.5 : undefined);
  if (!s) return 1;
  return r >= 1 ? s : 1 / s;
}

/** A split found on the quarterly series: its factor and the fiscal year of the first quarter on the new basis. */
export interface KnownSplit {
  factor: number;
  fy: number;
}

/** Fiscal years to place a known split by, with the periods the share counts belong to. */
export interface SplitAnchors {
  periods: Period[];
  known: KnownSplit[];
}

/**
 * Where a share-count series steps by a split: a map from the index of the last period on the old basis to
 * the factor that brings it onto the next period's basis.
 */
function detectSteps(shares: (number | null | undefined)[], tol: number, anchors?: SplitAnchors): Map<number, { factor: number; later: number }> {
  const at = shares.map((v, i) => (v != null && v > 0 ? i : -1)).filter((i) => i >= 0);
  const factors = (anchors?.known ?? []).map((k) => k.factor);
  // A split is one clean step between two level stretches. Share issuance (a merger, a rescue, an IPO) shows
  // up in the weighted count over two periods, so the count is still moving on one side of the jump.
  const level = (i: number, j: number) => {
    const r = (shares[j] as number) / (shares[i] as number);
    return r > 0.85 && r < 1.18;
  };
  // Raw step between each pair of consecutive counts (index k is the step from at[k - 1] to at[k]).
  const raw = at.map((later, k) => {
    if (k === 0) return 1;
    const gap = later - at[k - 1] - 1;
    // Each period without a count in between is another period of buybacks or issuance to allow for.
    return splitStep(shares[later] as number, shares[at[k - 1]] as number, Math.min(0.06, tol + gap * 0.015), factors);
  });
  // The neighbouring stretch must be level, or be the same step undone: one period already restated by a later
  // filing sits as a spike among unrestated ones.
  const undone = (f: number, g: number) => g !== 1 && Math.abs(f * g - 1) < 1e-9;
  const steps = new Map<number, { factor: number; later: number }>();
  for (let k = 1; k < at.length; k++) {
    const f = raw[k];
    if (f === 1) continue;
    if (k + 1 < at.length && !level(at[k], at[k + 1]) && !undone(f, raw[k + 1])) continue;
    if (k - 2 >= 0 && !level(at[k - 2], at[k - 1]) && !undone(f, raw[k - 1])) continue;
    steps.set(at[k - 1], { factor: f, later: at[k] });
  }
  if (!anchors) return steps;
  // A split proven on the quarterly counts must also sit somewhere in the yearly ones, a year or two earlier
  // (a 10-K restates its comparative years). When the company also issued or bought back a lot of stock that
  // year, the yearly step is well off the round multiple, so look for the nearest sizeable step in that window.
  const fy = (i: number) => anchors.periods[i]?.fy;
  const up = (f: number) => (f >= 1 ? f : 1 / f);
  for (const k of anchors.known) {
    const s = up(k.factor);
    const placed = [...steps.values()].some((x) => Math.abs(up(x.factor) / s - 1) < 1e-9 && Math.sign(Math.log(x.factor)) === Math.sign(Math.log(k.factor)) && fy(x.later) >= k.fy - 3 && fy(x.later) <= k.fy + 1);
    if (placed) continue;
    let best: { earlier: number; later: number; dev: number } | null = null;
    for (let j = 1; j < at.length; j++) {
      const later = at[j];
      const earlier = at[j - 1];
      if (steps.has(earlier) || fy(later) == null || fy(later) < k.fy - 3 || fy(later) > k.fy) continue;
      const r = (shares[later] as number) / (shares[earlier] as number);
      const size = k.factor >= 1 ? r : 1 / r;
      const dev = Math.abs(size / s - 1);
      if (size < 1.4 || dev > 0.3) continue;
      if (!best || dev < best.dev) best = { earlier, later, dev };
    }
    if (best) steps.set(best.earlier, { factor: k.factor, later: best.later });
  }
  return steps;
}

/**
 * For each period, the cumulative split factor between that period's filing basis and the latest one,
 * read from step jumps in a share-count series (4-for-1 shows as a count four times larger a period later).
 * 1 where nothing happened since. Periods without a count take the basis of the next period that has one.
 */
export function splitFactors(shares: (number | null | undefined)[], tol = 0.04, anchors?: SplitAnchors): number[] {
  const steps = detectSteps(shares, tol, anchors);
  const out = new Array<number>(shares.length).fill(1);
  let cum = 1;
  for (let i = shares.length - 1; i >= 0; i--) {
    cum *= steps.get(i)?.factor ?? 1;
    out[i] = cum;
  }
  return out;
}

/** The splits found in a share-count series, with the fiscal year each new basis starts in. */
export function splitEvents(shares: (number | null | undefined)[], periods: Period[], tol = 0.04): KnownSplit[] {
  return [...detectSteps(shares, tol).values()].map((x) => ({ factor: x.factor, fy: periods[x.later].fy }));
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 10000) / 10000));
const ratio = (f: number) => (f >= 1 ? `${fmt(f)}-for-1` : `1-for-${fmt(1 / f)}`);

function restated(c: Cell, v: number, formula: string): Cell {
  if (!c.src && c.derived) return { ...c, v, derived: { ...c.derived, formula: `${c.derived.formula}; then ${formula.replace(/^As filed \S+ /, "")}` } };
  const parts = c.src ? [{ ...c.src, label: AS_FILED, sign: 1 as const }] : [];
  return { v, derived: { formula, parts }, alts: c.alts, approx: c.approx };
}

/** A quarter computed from the year and the other quarters, not read from a filing. */
const derivedQuarter = (c: Cell) => !!c.derived && !c.src && c.derived.parts[0]?.label !== AS_FILED;

/** True when a cell was restated for a split by this module. */
export const isSplitRestated = (c: Cell | null | undefined) => !!c?.derived?.formula.includes(SPLIT_NOTE);

/** True when any cell in the statement was restated for a split. */
export const hasSplitRestatement = (st: Statement | undefined) => !!st?.rows.some((r) => r.cells.some(isSplitRestated));

function restateRow(row: Row, factors: number[]): Row {
  if (row.unit !== "usdPerShare" && row.unit !== "shares") return row;
  if (factors.every((f) => f === 1)) return row;
  const perShare = row.unit === "usdPerShare";
  return {
    ...row,
    cells: row.cells.map((c, i) => {
      const f = factors[i] ?? 1;
      if (!c || f === 1) return c;
      return perShare
        ? restated(c, c.v / f, `As filed ${fmt(c.v)} ÷ ${fmt(f)}: restated for the ${ratio(f)} ${SPLIT_NOTE} adjustment since that filing`)
        : restated(c, c.v * f, `As filed ${fmt(c.v)} × ${fmt(f)}: restated for the ${ratio(f)} ${SPLIT_NOTE} adjustment since that filing`);
    }),
  };
}

/**
 * The share count each period's per-share figures were stated on: the reported basic count, else diluted,
 * else net income ÷ EPS where both were read from a filing and EPS is large enough for the division to hold.
 */
export function shareBasis(income: Statement): (number | null)[] {
  const cell = (key: string, i: number) => rowOf(income.rows, key)?.cells[i];
  return income.periods.map((_, i) => {
    // Basic first: the diluted count also moves when options and converts come into the money.
    const reported = cell("sharesBasic", i)?.v ?? cell("sharesDiluted", i)?.v;
    if (reported != null && reported > 0) return reported;
    const ni = cell("netIncome", i);
    const eps = cell("epsDiluted", i) ?? cell("epsBasic", i);
    if (!ni?.src || !eps?.src || ni.v <= 0 || eps.v < 0.5) return null;
    return ni.v / eps.v;
  });
}

/**
 * Restate an income statement's per-share and share-count rows to the latest share basis. `known` lists the
 * splits already found on the quarterly series, which confirm and place the looser year-over-year steps.
 */
export function restateIncomeForSplits(income: Statement, known: KnownSplit[] = []): Statement {
  const factors = splitFactors(shareBasis(income), 0.04, known.length ? { periods: income.periods, known } : undefined);
  if (factors.every((f) => f === 1)) return income;
  return { ...income, rows: income.rows.map((r) => restateRow(r, factors)) };
}

/** Restate a balance sheet's share counts. They are point-in-time, so they carry their own step dates. */
export function restateBalanceForSplits(balance: Statement, known: KnownSplit[] = []): Statement {
  const anchors = known.length ? { periods: balance.periods, known } : undefined;
  return {
    ...balance,
    rows: balance.rows.map((r) => (r.unit === "shares" ? restateRow(r, splitFactors(r.cells.map((c) => c?.v), 0.04, anchors)) : r)),
  };
}

/**
 * A quarter that no 10-Q reports (usually the fourth) is derived as the year minus the other three. When a
 * split fell inside that year the subtraction mixed two bases. Recompute those per-share cells from the
 * restated year and quarters.
 */
export function rederiveQuarters(quarterly: Statement, annual: Statement): Statement {
  const yearAt = new Map(annual.periods.map((p, i) => [p.fy, i]));
  const byYear = new Map<number, number[]>();
  quarterly.periods.forEach((p: Period, i) => byYear.set(p.fy, [...(byYear.get(p.fy) ?? []), i]));
  return {
    ...quarterly,
    rows: quarterly.rows.map((row) => {
      if (row.unit !== "usdPerShare") return row;
      const year = rowOf(annual.rows, row.key);
      if (!year) return row;
      let changed = false;
      const cells = row.cells.map((c, i) => {
        if (!c || !derivedQuarter(c)) return c;
        const fy = quarterly.periods[i].fy;
        const idx = byYear.get(fy) ?? [];
        const others = idx.filter((k) => k !== i);
        const y = year.cells[yearAt.get(fy) ?? -1];
        if (idx.length !== 4 || !y || others.some((k) => !row.cells[k] || derivedQuarter(row.cells[k]!))) return c;
        // Only years a split restatement touched need redoing.
        if (![y, c, ...others.map((k) => row.cells[k])].some(isSplitRestated)) return c;
        const v = y.v - others.reduce((s, k) => s + row.cells[k]!.v, 0);
        changed = true;
        const base = c.derived!.formula.split("; then ")[0];
        return { ...c, v, derived: { ...c.derived!, formula: `${base}, with the year and the other quarters on today's share basis (${SPLIT_NOTE} since)` } };
      });
      return changed ? { ...row, cells } : row;
    }),
  };
}
