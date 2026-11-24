// What is unusual now across every covered company, by exactly the rules the company tab uses
// (`riseFlag` for counts, `rangeFlag` for series). The database can only count stored rows per
// 90-day window (`alt_event_buckets`) and give each company's latest reading (`alt_series_leaders`),
// so those pick the candidates and the candidates' own rows are then tested by the tab's rule.
// Pure.
import { binomialUpper } from "@/lib/alt/derive";
import { EVENT_STREAMS, RISE_WINDOWS, type RangeRule } from "@/lib/alt/history";
import { rangeFlag, riseFlag, type CompanyAltRow, type Figure, type Flag } from "@/lib/alt/company";
import type { EventBucket } from "@/lib/alt/screen";

export interface UnusualItem {
  ticker: string;
  dataset: string;
  kind: Flag["kind"];
  direction: "up" | "down";
  text: string;
  /** strength within its kind (−log10 p for a rise, the ratio to the range edge for a reading) */
  strength: number;
  date: string | null;
  rule: string;
  figure: Figure;
  /** counts per whole 90-day window, oldest first (rises only), for a spark */
  history?: number[];
}

/** Datasets the rise rule watches: those with a watched stream (history.ts). */
export const WATCHED_DATASETS = Object.entries(EVENT_STREAMS).filter(([, ss]) => ss.some((s) => s.watch)).map(([d]) => d);

/** Loose pre-screen on stored rows (a superset of what the rule on filings can flag): p on rows below this. */
export const PRESCREEN_P = 0.05;

/**
 * Company × dataset pairs whose row counts per 90-day window come anywhere near a rise: at least 3
 * rows in the latest window, at least 3 earlier windows after the first non-empty one, at least as
 * many rows as their mean, and a conditional tail on rows below PRESCREEN_P. The rule itself counts
 * filings (several 8-K items are one filing) and needs 4 earlier whole windows, so this keeps every
 * pair it could flag and drops the thousands it cannot.
 */
export function bucketCandidates(buckets: EventBucket[]): { ticker: string; dataset: string }[] {
  const watched = new Set(WATCHED_DATASETS);
  const m = new Map<string, { h: number[]; ticker: string; dataset: string }>();
  for (const b of buckets) {
    if (b.bucket < 0 || b.bucket >= RISE_WINDOWS || !watched.has(b.dataset)) continue;
    const k = `${b.ticker}|${b.dataset}`;
    const e = m.get(k) ?? { h: Array(RISE_WINDOWS).fill(0), ticker: b.ticker, dataset: b.dataset };
    e.h[RISE_WINDOWS - 1 - b.bucket] += Number(b.n);
    m.set(k, e);
  }
  const out: { ticker: string; dataset: string }[] = [];
  for (const e of m.values()) {
    const latest = e.h[e.h.length - 1];
    const first = e.h.findIndex((n) => n > 0);
    const prior = e.h.slice(first + 1, -1);
    if (latest < 3 || prior.length < 3) continue;
    const sum = prior.reduce((a, b) => a + b, 0);
    if (latest < sum / prior.length) continue;
    if (binomialUpper(latest, sum + latest, 1 / (prior.length + 1)) >= PRESCREEN_P) continue;
    out.push({ ticker: e.ticker, dataset: e.dataset });
  }
  return out;
}

const itemOf = (ticker: string, f: Flag): UnusualItem => ({ ticker, dataset: f.dataset, kind: f.kind, direction: f.direction, text: f.text, strength: f.strength, date: f.date, rule: f.rule, figure: f.figure, history: f.history });

function byTicker(rows: CompanyAltRow[]) {
  const by = new Map<string, CompanyAltRow[]>();
  for (const r of rows) (by.get(r.ticker) ?? by.set(r.ticker, []).get(r.ticker)!).push(r);
  return by;
}

/** The tab's rise rule on candidates' rows of one dataset (rows reaching back RISE_LOOKBACK_DAYS). */
export function confirmCounts(dataset: string, rows: CompanyAltRow[], today: string): UnusualItem[] {
  const out: UnusualItem[] = [];
  for (const [ticker, rs] of byTicker(rows.filter((r) => r.dataset === dataset))) {
    const f = riseFlag(dataset, rs, today);
    if (f) out.push(itemOf(ticker, f));
  }
  return out;
}

export interface LeaderLike {
  ticker: string;
  date: string;
  value: number;
  base_median: number | null;
  base_n: number | null;
}

/**
 * Companies a range rule could flag, from each company's latest reading and its trailing-year
 * median. The rule compares with the highest (lowest) reading of a longer span, which is at least
 * (at most) that median, so "at least `factor` × the median" is necessary for a reading above the
 * range. Rules on single quarters (a transformed rate) and readings of a month still running cannot
 * be judged from the stored value, so those companies are always passed on.
 */
export function rangeCandidates(leaders: LeaderLike[], rule: RangeRule, today: string): string[] {
  if (rule.quarterOnly) return leaders.map((r) => r.ticker);
  return leaders
    .filter((r) => {
      if (rule.dataset === "attention" && r.date.slice(0, 7) >= today.slice(0, 7)) return true;
      if (r.base_median == null) return false;
      const up = r.value >= rule.factor * r.base_median && r.value >= (rule.minLatest ?? -Infinity);
      const down = rule.sides === "both" && r.value <= r.base_median / rule.factor;
      return up || down;
    })
    .map((r) => r.ticker);
}

/** The tab's range rule on candidates' readings of one series. */
export function confirmSeries(rows: CompanyAltRow[], rule: RangeRule, today: string): UnusualItem[] {
  const out: UnusualItem[] = [];
  for (const [ticker, rs] of byTicker(rows.filter((r) => r.dataset === rule.dataset && r.title === rule.title && r.value != null && r.date))) {
    rs.sort((a, b) => a.date!.localeCompare(b.date!));
    const f = rangeFlag(rule, rs, today);
    if (f) out.push(itemOf(ticker, f));
  }
  return out;
}

/**
 * Rank everything unusual: rises first (counts), then readings against their range, each by its own
 * strength (the two are not on one scale), then newest.
 */
export function rankUnusual(items: UnusualItem[]): UnusualItem[] {
  return [...items].sort((a, b) => (a.kind !== b.kind ? (a.kind === "rise" ? -1 : 1) : b.strength - a.strength || (b.date ?? "").localeCompare(a.date ?? "")));
}

/**
 * How much of the hub's height to hold after a control shortened it, so the browser never has to pull the reader
 * up. A press notes the page's height (`held`); from then on the page keeps at least enough height to reach the
 * bottom of the window at the reader's position, and never more than it had. Scrolling up lets it go; 0 releases.
 * `top` is the page's top in document coordinates.
 */
export function holdFloor(held: number, scrollY: number, viewportH: number, top: number): number {
  if (held <= 0) return 0;
  const need = Math.ceil(scrollY + viewportH - top);
  return need <= 0 ? 0 : Math.min(held, need);
}
